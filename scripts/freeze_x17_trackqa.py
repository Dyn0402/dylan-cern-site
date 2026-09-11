#!/usr/bin/env python3
"""Freeze the per-track tracking QA into the three tiers /x17/qa-tracks.html reads.

    python3 scripts/freeze_x17_trackqa.py \
        --qa   /media/dylan/data/x17/sept26_prelim/tracking_qa_fullpass \
        --index /media/dylan/data/x17/sept26_prelim/trackqa_web/shard_index.json

The other four QA pages freeze one table and render it. This one has three
tiers, because the thing being described spans six orders of magnitude -- 36
runs, 3 232 file tags, 29 million tracks -- and no single file is right for all
of them:

  tier 1  data/x17-trackqa.json         ~300 kB, always loaded. The campaign
                                        reference per arm, one row per
                                        (run, arm), the outlier list, the gap
                                        and drift tables.
  tier 2  data/trackqa/<run>.json.gz    one per run, loaded on click. Every
                                        file tag of that run as a time series --
                                        the finest slice that can resolve a
                                        transient.
  tier 3  the parquet shards            NOT frozen here. Built by
                                        `sept26_prelim_analysis.trackqa_shards`
                                        and read directly from the browser over
                                        HTTP range requests. This script only
                                        copies their index through, so the page
                                        knows what exists and how big it is.

Inputs are the CSVs `sept26_prelim_analysis.tracking_qa` writes: per_arm.csv,
per_run.csv, per_tag.csv, outliers.csv, gap_check.csv, drift.csv and the
tracking_qa.meta.json beside them.

WHY TIER 2 IS GZIPPED BY HAND. The CERN Apache does not compress on the fly and
ignores Accept-Encoding (measured 2026-09-10), so a 1.4 MB tag table would go
over the wire at 1.4 MB. Written as .json.gz it is ~300 kB and the page
inflates it with DecompressionStream, which every browser that can run the rest
of the page already has. The file is served as application/x-gzip and is NOT
transparently decoded -- that is deliberate and the page depends on it.

Numbers are rounded to four significant figures on the way out. These are
quantiles of a distribution that moved 7 % between runs; the sixteenth decimal
place float64 prints is not a measurement, and it is a third of the file size.
"""

import argparse
import collections
import csv
import datetime as dt
import gzip
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARMS = ('A', 'B', 'C', 'D')

# The variables the page can plot, in the order it offers them. `col` is the
# column in the parquet shards, `key` the prefix of the frozen quantile columns
# (`chi2dof_x_p50`), so tier 1/2 and tier 3 are addressed by the same name.
# Labels are plain text: tracking_qa's are LaTeX, for matplotlib.
VARS = [
    # key            col              label                            log  lo     hi
    ('chi2dof_x',   'chi2dof_x',     'chi2/dof, x view',                1,  0.3,   3e3),
    ('chi2dof_y',   'chi2dof_y',     'chi2/dof, y view',                1,  0.3,   3e3),
    ('n_strips_x',  'x_n_strips',    'strips in fit, x view',           0,  0,     220),
    ('n_strips_y',  'y_n_strips',    'strips in fit, y view',           0,  0,     220),
    ('tan_err_x',   'x_tan_err',     'sigma(tan theta), x',             1,  1e-2,  1e0),
    ('tan_err_y',   'y_tan_err',     'sigma(tan theta), y',             1,  1e-2,  1e0),
    ('p0_err_x',    'x_p0_err',      'sigma(p0), x   [strips]',         1,  0.2,   20),
    ('p0_err_y',    'y_p0_err',      'sigma(p0), y   [strips]',         1,  0.2,   20),
    ('t0_err_x',    'x_t0_err',      'sigma(t0), x   [ns]',             1,  1,     1e4),
    ('tan_x',       'tanx',          'tan theta_x  (raw)',              0, -3,     3),
    ('tan_y',       'tany',          'tan theta_y  (raw)',              0, -3,     3),
    ('t0_x',        'x_t0',          't0, x view   [ns]',               0, -400,   900),
    ('t0_y',        'y_t0',          't0, y view   [ns]',               0, -400,   900),
    ('drift_len',   'drift_len_mm',  'drift span   [mm]',               0,  0,     40),
    ('q_total',     'q_total',       'cluster charge   [ADC]',          1,  10,    1e6),
    ('q_per_len',   'q_per_len',     'charge / path length',            1,  1,     1e4),
    ('q_u50_x',     'x_q_u50',       'charge at mid-drift, x',          0,  0,     1100),
    ('n_dropped_x', 'x_n_dropped',   'strips dropped, x view',          0,  0,     160),
    ('n_cand_x',    'n_cand_x',      'x-view candidates',               0,  0,     6),
    ('n_cand_y',    'n_cand_y',      'y-view candidates',               0,  0,     6),
]

# Columns in the shards that are NOT in VARS but are worth plotting: the
# geometry and the n_TOF side. The page histograms these from tier 3 only --
# tracking_qa does not profile them, so there is no frozen quantile to compare
# against, and the page says so.
EXTRA_VARS = [
    ('x_local',          'x at the mesh   [mm]',       0, -200,  200),
    ('y_local',          'y at the mesh   [mm]',       0, -200,  200),
    ('angle_to_beam_deg','angle to beam   [deg]',      0,  0,    180),
    ('dca_axis_mm',      'DCA to beam axis   [mm]',    0,  0,    300),
    ('drift_t_end_ns',   'drift end time   [ns]',      0,  0,    1200),
    ('path_len_mm',      'path length   [mm]',         0,  0,    60),
    # Measured, not guessed: the acquisition window opens on the N93B gate
    # ~0.99 ms after the flash and closes at 75 ms, which over the 19.5 m EAR2
    # path is 2.0 eV down to 0.35 meV. A decade of headroom either side; a
    # wider axis would put the whole campaign in two bins.
    ('t_since_flash_ns', 'time since flash   [ns]',    1,  9e5,  8e7),
    ('e_neutron_keV',    'neutron energy   [keV]',     1,  2e-7, 3e-3),
    ('k_arm',            'angle scale k',              0,  0.8,  2.4),
    ('v_drift_um_ns',    'v_drift   [um/ns]',          0,  10,   60),
]

QUANTS = ('p05', 'p25', 'p50', 'p75', 'p95')
#: The tag timeline carries quartiles only. p05/p95 of a 40-track tag is noise,
#: and dropping them is a third of tier 2.
TAG_QUANTS = ('p25', 'p50', 'p75')

FLAGS = ('gated', 'x_quality_ok', 'y_quality_ok', 'x_plausible', 'y_plausible',
         'x_slope_reliable', 'y_slope_reliable', 'tan_sane', 'drift_railed',
         'x_isochronous', 'y_isochronous')

PATHOLOGY = ('frac_chi2_gt_100', 'frac_chi2_gt_1000', 'frac_tanerr_gt_0p1',
             'frac_q_gt_1e6', 'frac_q_nonfinite', 'frac_strips_ge_200')


def sig(v, n=4):
    """Four significant figures, or None. Keeps JSON honest and small."""
    if v is None or v == '':
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f):
        return None
    if math.isinf(f):
        return None            # 1e34 charges exist in this table; they are
                               # pathologies, counted in PATHOLOGY, not values
    if f == 0:
        return 0.0
    r = round(f, -int(math.floor(math.log10(abs(f)))) + (n - 1))
    return int(r) if r == int(r) and abs(r) < 1e15 else r


# `tracking_qa` derives the tag time from the tag name (`260805_14H06_000`),
# which the DREAM DAQ stamped in Geneva local time with no zone on it. The
# whole campaign is inside CEST so a fixed +02:00 is exact -- but it has to be
# applied, because the other four QA pages are on true UTC and two pages
# showing the same instant two hours apart is worse than either page alone.
# Same constant, same reason, as freeze_x17_runs.CAMPAIGN_TZ.
CAMPAIGN_TZ = dt.timezone(dt.timedelta(hours=2))


def tag_epoch(raw):
    """`2026-08-05 14:06:00` (DAQ local) -> a true-UTC epoch, or None."""
    if not raw:
        return None
    try:
        return int(dt.datetime.fromisoformat(str(raw).strip())
                   .replace(tzinfo=CAMPAIGN_TZ).timestamp())
    except ValueError:
        return None


def read_csv(path):
    with open(path, newline='', encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


def run_no(run):
    try:
        return int(str(run).split('_')[1])
    except (IndexError, ValueError):
        return 10 ** 9


def qa_fields(row, quants):
    """The quantile / flag / pathology block of one summary row, flattened."""
    out = {'n': int(float(row['n_tracks']))}
    for key, *_ in VARS:
        vals = [sig(row.get(f'{key}_{q}')) for q in quants]
        if any(v is not None for v in vals):
            out[key] = vals
    out['f'] = [sig(row.get(f'frac_{f}'), 3) for f in FLAGS]
    out['p'] = [sig(row.get(f), 3) for f in PATHOLOGY]
    return out


def freeze(qa_dir, index_path, data_dir):
    qa = pathlib.Path(qa_dir)
    for name in ('per_arm.csv', 'per_run.csv', 'per_tag.csv', 'outliers.csv'):
        if not (qa / name).exists():
            sys.exit(f'missing {qa / name} -- run sept26_prelim_analysis.tracking_qa')

    meta = json.loads((qa / 'tracking_qa.meta.json').read_text(encoding='utf-8'))

    # ---- tier 1 ---------------------------------------------------------- #
    per_arm = {r['arm']: qa_fields(r, QUANTS) for r in read_csv(qa / 'per_arm.csv')}

    runs = collections.defaultdict(dict)
    for r in read_csv(qa / 'per_run.csv'):
        runs[r['run']][r['arm']] = qa_fields(r, QUANTS)

    # The tag table is read once, for two things: tier 2, and the per-run time
    # span and tag count that tier 1 needs. Reading it twice would double the
    # slowest step for nothing.
    tags = collections.defaultdict(list)
    for r in read_csv(qa / 'per_tag.csv'):
        tags[r['run']].append(r)

    shards = collections.defaultdict(list)
    shard_meta = {}
    if index_path:
        idx = json.loads(pathlib.Path(index_path).read_text(encoding='utf-8'))
        shard_meta = {k: idx[k] for k in
                      ('generated', 'gated_only', 'row_group', 'compression',
                       'columns', 'optional_columns', 'n_shards', 'n_tracks',
                       'bytes')
                      if k in idx}
        for s in idx.get('shards', []):
            shards[s['run']].append({
                'subrun': s['subrun'], 'file': s['file'], 'bytes': s['bytes'],
                'n': s['n_tracks'], 'n_gated': s['n_gated'],
                'n_events': s['n_events'], 'arms': s['arms'],
                'n_tags': len(s['tags']),
                # Optional columns this sub-run does not carry. Passed through
                # so the page can say "not recorded here" instead of drawing an
                # empty distribution that reads as a measurement of zero.
                'absent': s.get('absent') or [],
            })

    run_rows = []
    for run in sorted(runs, key=run_no):
        ts = [e for e in (tag_epoch(r.get('t')) for r in tags.get(run, []))
              if e is not None]
        sub = sorted({r['subrun'] for r in tags.get(run, [])})
        run_rows.append({
            'run': run, 'no': run_no(run),
            'n': sum(a['n'] for a in runs[run].values()),
            'arms': runs[run],
            'n_subruns': len(sub),
            'n_tags': len({r['tag'] for r in tags.get(run, [])}),
            't0': min(ts) if ts else None,
            't1': max(ts) if ts else None,
            'condition': ('pre_access_27jul' if run_no(run) <= 81
                          else 'post_access_27jul'),
            'shards': shards.get(run, []),
            'shard_bytes': sum(s['bytes'] for s in shards.get(run, [])),
        })

    outliers = [{
        'arm': r['arm'], 'run': r['run'], 'variable': r['variable'],
        'value': sig(r['value']), 'median': sig(r['arm_median']),
        'shift': sig(r['shift']), 'effect': sig(r['effect'], 3),
        'z': sig(r['z'], 3), 'n': int(float(r['n_tracks'])),
    } for r in read_csv(qa / 'outliers.csv')]

    def opt_csv(name, fields):
        p = qa / name
        if not p.exists():
            return []
        return [{k: (r[k] if k in ('arm', 'variable') else sig(r.get(k)))
                 for k in fields if k in r} for r in read_csv(p)]

    tier1 = {
        'schema': 'dneff/x17-trackqa/1',
        'source': meta,
        'shards': shard_meta,
        'vars': [{'key': k, 'col': c, 'label': l, 'log': bool(g),
                  'lo': lo, 'hi': hi} for k, c, l, g, lo, hi in VARS],
        'extra_vars': [{'key': c, 'col': c, 'label': l, 'log': bool(g),
                        'lo': lo, 'hi': hi} for c, l, g, lo, hi in EXTRA_VARS],
        'quants': list(QUANTS), 'tag_quants': list(TAG_QUANTS),
        'flags': list(FLAGS), 'pathology': list(PATHOLOGY),
        'arm': per_arm,
        'runs': run_rows,
        'outliers': outliers,
        'gap': opt_csv('gap_check.csv', ['arm', 'gap_mm', 'k_applied', 'v_um_ns',
                                         'grid_edge_ns', 'max_span_mm', 'span_p50',
                                         'span_p50_unrailed', 'frac_over_gap',
                                         'frac_railed', 'k_min_for_gap']),
        'drift': opt_csv('drift.csv', ['arm', 'variable', 'rho', 'p', 'n_tags',
                                       'rho_post', 'p_post', 'n_tags_post',
                                       'pre_access', 'post_access',
                                       'first_decile', 'last_decile']),
    }

    data = pathlib.Path(data_dir)
    data.mkdir(parents=True, exist_ok=True)
    t1_path = data / 'x17-trackqa.json'
    t1_path.write_text(json.dumps(tier1, separators=(',', ':')), encoding='utf-8')

    # ---- tier 2 ----------------------------------------------------------- #
    # Columnar, not a list of objects: 5 840 rows x 48 fields as objects would
    # repeat every key 5 840 times, which is most of the file.
    cols = (['arm', 'tag', 'subrun', 't', 'n']
            + [f'{k}_{q}' for k, *_ in VARS for q in TAG_QUANTS]
            + [f'frac_{f}' for f in FLAGS] + list(PATHOLOGY))
    tag_dir = data / 'trackqa'
    tag_dir.mkdir(parents=True, exist_ok=True)

    n_tag_bytes = 0
    for run, rows in tags.items():
        rows.sort(key=lambda r: (r.get('t') or '', r['tag'], r['arm']))
        out = {'run': run, 'cols': cols, 'rows': [
            [r['arm'], r['tag'], r['subrun'],
             tag_epoch(r.get('t')), int(float(r['n_tracks']))]
            + [sig(r.get(f'{k}_{q}')) for k, *_ in VARS for q in TAG_QUANTS]
            + [sig(r.get(f'frac_{f}'), 3) for f in FLAGS]
            + [sig(r.get(f), 3) for f in PATHOLOGY]
            for r in rows]}
        blob = json.dumps(out, separators=(',', ':')).encode('utf-8')
        p = tag_dir / f'{run}.json.gz'
        p.write_bytes(gzip.compress(blob, 9))
        n_tag_bytes += p.stat().st_size

    print(f'tier 1  {t1_path}  {t1_path.stat().st_size/1024:.0f} kB'
          f'  ({len(run_rows)} runs, {len(outliers)} outliers)')
    print(f'tier 2  {tag_dir}/  {len(tags)} files, {n_tag_bytes/1024:.0f} kB total')
    if shard_meta:
        print(f'tier 3  {shard_meta.get("n_shards")} shards, '
              f'{shard_meta.get("bytes", 0)/1e9:.2f} GB -- NOT copied here; '
              f'push them with scripts/deploy-trackqa.sh')
    else:
        print('tier 3  no shard index given; the page will show summaries only')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--qa', required=True,
                    help='the tracking_qa output directory (per_*.csv)')
    ap.add_argument('--index', default=None,
                    help='trackqa_web/shard_index.json from trackqa_shards')
    ap.add_argument('--data', default=str(ROOT / 'data'),
                    help='where the frozen JSON goes (default: repo data/)')
    a = ap.parse_args()
    return freeze(a.qa, a.index, a.data)


if __name__ == '__main__':
    raise SystemExit(main())
