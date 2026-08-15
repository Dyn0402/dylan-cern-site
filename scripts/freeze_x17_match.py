#!/usr/bin/env python3
"""Freeze the DREAM<->n_TOF match into data/x17-match.json.

    python3 scripts/freeze_x17_match.py [--records DIR] [--ledger DIR] [--src DIR]

Two units, and the page shows both:

  * a **segment** -- one DREAM sub-run crossed with the one n_TOF run that was
    taking beam at the same time. The smallest thing that can carry its own
    clock fit (the DREAM clock wanders ~1 ppm burst to burst; the fit that
    removes it is per bunch, inside a segment).

  * a **pulse** -- one DREAM burst, i.e. one proton pulse on the target. This
    is the unit the physics is counted in, and since 2026-08-13 it is the unit
    the accounting is done in: every burst of every sub-run since run_79 has
    exactly one terminal state in the pulse ledger
    (nTof_x17/ntof_processing/slim_pipeline/pulse_ledger.py), MATCHED or a
    named reason why not.

Inputs
------
  <records>/**/runs/<run>/<subrun>/ntof_hits/clock_qa.json
        one per segment that produced a file. The tree holds several vintages
        (the 08-12 campaign mirror, the 08-13 re-slim, the refactor run); the
        NEWEST record per segment wins.
  <records>/**/slim_summary_<ntof>.json  and  <records>/*inventory*.csv
        every segment ATTEMPTED, so the failures are here and nowhere else.
        Summaries win over the CSV; newest summary wins.
  <ledger>/run_*_<subrun>.json, <ledger>/campaign_ledger.json
        the pulse ledger: per burst state / n_TOF run / bunch / reason.
  <src>/ntof_processing/slim_pipeline/segments.py
        the segment universe (every (sub-run, n_TOF run) pair with beam overlap)
        and the overlap minutes for it.

Reading only the QA records would give a page where everything passes, which
is the exact failure mode the campaign write-up warns about: a mis-joined
segment fails its clock fit and writes no file, so QA never sees it. The
summaries make the failures visible, the segment universe makes "never
attempted" visible, and the pulse ledger makes both COUNTABLE in the unit
that matters.
"""

import argparse
import collections
import csv
import json
import pathlib
import re
import statistics
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_SRC = pathlib.Path.home() / "PycharmProjects" / "nTof_x17"
DEFAULT_RECORDS = pathlib.Path("/media/dylan/data/x17/slim_recovery_2026-08-13")
ARMS = ("A", "B", "C", "D")

# The pulse ledger's terminal states, in the order the page lists them.
# `ours` = counts in the denominator of "pulses we should have matched".
STATES = [
    ("MATCHED", "matched", True,
     "joined to an n_TOF bunch and the wall+plastic coincidence measured at "
     ">= 80 % of the pulse's triggers"),
    ("LOW_COINC", "low coincidence", True,
     "joined, coincidence measured but below the 80 % bar (73-80 %, small "
     "bursts) -- correctly joined, usable, kept out of MATCHED by the bar"),
    ("UNKNOWN_COINC", "coincidence not measured", True,
     "joined but the product predates the per-pulse arrays"),
    ("TOO_FEW_TRIGGERS", "too few triggers", True,
     "joined, but fewer than 10 triggers in the burst -- nothing to judge on"),
    ("NTOF_NO_BUNCH", "n_TOF not recording", True,
     "the burst falls in a gap of the n_TOF DAQ (run transition, reset)"),
    ("UNJOINED", "not joined", True,
     "a beam pulse the join left without a bunch number"),
    ("SEGMENT_FAILED", "segment failed", True,
     "the segment's join refused (no candidate lock reached the coincidence bar)"),
    ("NOT_ATTEMPTED", "not attempted", True,
     "no segment was ever run for this pulse"),
    ("EMPTY_PULSE", "empty pulse", False,
     "a DREAM burst with no proton pulse behind it -- not ours to match"),
    ("NO_BEAM_PULSE", "no beam", False,
     "cosmic-bounce block or beam off -- not beam-triggered by construction"),
    ("NOT_COINC_TRIGGERED", "not coincidence-triggered", False,
     "trigger mode without the wall+plastic coincidence (scint, mesh scans)"),
]
STATE_KEYS = [s[0] for s in STATES]
OURS = {s[0] for s in STATES if s[2]}


def sub_short(name):
    """`stat090_0007` -> `0007`; anything else is left alone."""
    return name[8:] if name.startswith("stat090_") else name


def run_no(d):
    return int(d.split("_")[1])


# ------------------------------------------------------------------ records

def load_records(root):
    """{(dream, sub, ntof): (record, join, mtime)} -- newest per segment."""
    out = {}
    for p in sorted(root.rglob("clock_qa.json")):
        try:
            d = json.loads(p.read_text())
        except ValueError:
            continue
        s = d.get("segment") or {}
        if not s:
            continue
        key = (s["dream_run"], s["dream_subrun"], int(s["ntof_run"]))
        mt = p.stat().st_mtime
        old = out.get(key)
        # newest wins; among equal times prefer the one carrying the per-pulse
        # arrays (contract 2026-08-13)
        score = (mt, bool((d.get("pulses") or {}).get("bunch")))
        if old is None or score > old[2]:
            join = None
            cal = p.with_name("calibration.json")
            if cal.exists():
                try:
                    join = json.loads(cal.read_text()).get("join")
                except ValueError:
                    join = None
            out[key] = (d, join, score)
    return {k: (v[0], v[1]) for k, v in out.items()}


def load_attempts(root, src_results):
    """{(dream, sub, ntof): (status, reason)} for every attempted segment.

    Inventory CSVs first (oldest evidence), then slim summaries in mtime
    order so the newest attempt of a segment is what stands.
    """
    out = {}
    csvs = list(root.glob("*inventory*.csv")) + \
        sorted(src_results.glob("slim_inventory_*.csv"))
    for p in csvs:
        with open(p) as f:
            for row in csv.DictReader(f):
                key = (row["dream_run"], row["sub_run"], int(row["ntof_run"]))
                out[key] = (row.get("status", "?"),
                            row.get("reason") or row.get("error") or "",
                            row)
    sums = sorted(root.rglob("slim_summary_*.json"),
                  key=lambda p: p.stat().st_mtime)
    for p in sums:
        try:
            s = json.loads(p.read_text())
        except ValueError:
            continue
        recs = s if isinstance(s, list) else s.get("segments", [])
        for rec in recs:
            key = (rec.get("dream_run"),
                   rec.get("sub_run") or rec.get("dream_subrun"),
                   int(rec.get("ntof_run", 0)))
            arb = rec.get("arbiter") or {}
            reason = arb.get("reason") or rec.get("error") or ""
            out[key] = (rec.get("status", "?"), reason, rec)
    return out


def emit_ok(rec, join):
    """The fields the page uses, from one full clock_qa record."""
    c, m, pb = rec["clock"], rec["match"], rec["perbunch"]
    levels = collections.Counter(x["level"] for x in rec["checks"])
    j = join or {}
    return {
        "st": "ok",
        "v": rec["verdict"],
        "flags": [{"n": x["name"], "l": x["level"], "d": x["detail"]}
                  for x in rec["checks"] if x["level"] != "PASS"],
        "nchk": sum(levels.values()),
        "lv": "".join(x["level"][0] for x in rec["checks"]),
        "chkv": [round(x["value"], 6) if isinstance(x["value"], (int, float))
                 else None for x in rec["checks"]],
        "arms": [[m["per_arm"][a]["n"],
                  round(m["per_arm"][a]["frac"], 4),
                  round(m["per_arm"][a]["residual_mean"], 3),
                  round(m["per_arm"][a]["offset_ns"], 2),
                  round(m["per_arm"][a]["offset_vs_ref"], 2)] for a in ARMS],
        "K": c["K"],
        "T0": round(c["T0_ns"], 2),
        "arm": [round(c["arm_offset_ns"][a], 2) for a in ARMS],
        "nfit": c["n_bunches_fitted"],
        "eff": round(m["efficiency"], 5),
        "cv": round(m["cv_gap"], 5),
        "acc": round(m["accidental"], 6),
        "pur": round(m["purity"], 5),
        "rms": round(m["residual_rms"], 2),
        "mean": round(m["residual_mean"], 3),
        "nev": m["n_events"],
        "nph": m["n_physics"],
        "da": round(pb["da_rms"], 2),
        "dk": round(pb["dk_rms_ppm"], 3),
        "nb": pb["n_bunches"],
        "beamav": round(pb["beam_availability"], 4),
        "para": round(pb["parasitic_fraction"], 3),
        "int": round(pb["intensity_median_e10"], 1),
        "snr": round(rec["bootstrap"]["snr"], 1),
        "mb": rec["segment"]["size_mb"],
        # how the burst->pulse lock was chosen: 'count' (clear count win),
        # 'intensity', 'coincidence' (the arbiter), 'verified' (hand scan)
        "lock": j.get("pulse_match_chosen_by"),
        "off": (round(j["pulse_match_offset_s"], 2)
                if j.get("pulse_match_offset_s") is not None else None),
        "srch": j.get("lock_search_s"),
    }


# ------------------------------------------------------------------- ledger

def load_ledger(ledger):
    """Per sub-run pulse rows + per-(sub-run, n_TOF run) counts."""
    camp_p = ledger / "campaign_ledger.json"
    camp = json.loads(camp_p.read_text()) if camp_p.exists() else {}
    subs, per_seg = [], {}
    for p in sorted(ledger.glob("run_*.json")):
        d = json.loads(p.read_text())
        b = d["bursts"]
        st, nr, rs = b["state"], b["ntof_run"], b.get("reason", [])
        n = len(st)
        states = collections.Counter(st)
        den = sum(v for k, v in states.items() if k in OURS)
        # per n_TOF run inside the sub-run: [den, matched, low, other-ours]
        seg = collections.defaultdict(lambda: [0, 0, 0])
        why = collections.Counter()
        for i in range(n):
            k = st[i]
            r = int(nr[i]) if nr[i] else 0
            if k in OURS:
                seg[r][0] += 1
                if k == "MATCHED":
                    seg[r][1] += 1
                elif k == "LOW_COINC":
                    seg[r][2] += 1
                else:
                    reason = rs[i] if i < len(rs) and rs[i] else k
                    why[(k, reason)] += 1
        for r, v in seg.items():
            if r:
                per_seg[(d["run"], d["subrun"], r)] = v
        lock = d.get("lock") or {}
        subs.append({
            "d": d["run"], "s": sub_short(d["subrun"]),
            "n": n, "den": den, "m": states.get("MATCHED", 0),
            "st": {k: v for k, v in states.items() if v},
            "lock": ([round(lock["offset_s"], 2), lock.get("chosen_by")]
                     if lock.get("offset_s") is not None else None),
            "pend": d.get("lock_pending"),
            # n_TOF run 0 = bursts the ledger could not place in any run
            # (n_TOF DAQ gaps); they are in `st`, not a segment of their own
            "segs": [[r, *v] for r, v in sorted(seg.items()) if r],
            # unmatched pulses by (state, reason), largest first, capped
            "why": [[k, reason, c] for (k, reason), c in
                    sorted(why.items(), key=lambda kv: -kv[1])[:8]],
        })
    subs.sort(key=lambda r: (run_no(r["d"]), r["s"]))
    return camp, subs, per_seg


def _finite(x):
    """NaN/inf -> None, recursively; everything else untouched."""
    if isinstance(x, float):
        return x if x == x and x not in (float("inf"), float("-inf")) else None
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_finite(v) for v in x]
    return x


# --------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--records", type=pathlib.Path, default=DEFAULT_RECORDS)
    ap.add_argument("--ledger", type=pathlib.Path, default=None)
    ap.add_argument("--src", type=pathlib.Path, default=DEFAULT_SRC)
    ap.add_argument("--as-of", default=None,
                    help="date stamp (default: newest record's mtime)")
    args = ap.parse_args()
    ledger = args.ledger or (args.records / "pulse_ledger")
    for p in (args.records, ledger, args.src):
        if not p.is_dir():
            sys.exit(f"not found: {p}")

    sys.path.insert(0, str(args.src))
    from ntof_processing.slim_pipeline import segments as SEG   # noqa: E402

    recs = load_records(args.records)
    attempts = load_attempts(args.records,
                             args.src / "ntof_processing" / "campaign_qa" / "results")
    camp, psubs, per_seg = load_ledger(ledger)

    # The segment universe: every (sub-run, n_TOF run) pair sharing beam, plus
    # anything that was attempted or produced a file outside that list.
    universe = {}
    for p in SEG.propose():
        universe[(p.dream_run, p.dream_subrun, p.ntof_run)] = p
    keys = set(universe) | set(recs) | set(attempts) | set(per_seg)

    rows, missing = [], 0
    for key in keys:
        d, s, n = key
        prop = universe.get(key)
        att = attempts.get(key)
        inv = att[2] if att else {}
        base = {"d": d, "s": sub_short(s), "n": n,
                "min": (round(prop.overlap_s / 60, 1) if prop else
                        float(inv.get("overlap_min") or 0) or None),
                "kind": (inv.get("kind") or
                         ("whole" if prop and prop.fraction >= 0.9 else
                          "sliver" if prop else None)),
                "jb": int(inv.get("joined_bunches") or 0) or None,
                "je": int(inv.get("joined_events") or 0) or None}
        seg = per_seg.get(key)
        if seg:
            base["pd"], base["pm"], base["pl"] = seg
        no_coinc = "cosbounce" in s or s.startswith(
            ("scint", "scintd", "sngPSmesh", "frand"))
        if key in recs:
            base.update(emit_ok(*recs[key]))
        elif att and att[0] == "OK":
            missing += 1
            base.update(st="ok", v="NO RECORD", flags=[])
        elif no_coinc:
            # not beam-coincidence-triggered: cannot match by construction,
            # whether or not a job was ever pointed at it (the coverage map
            # proposes these and the job refuses with NoLock -- that refusal
            # is not a failure of the join)
            base.update(st="na", v="", flags=[])
        elif att:
            base.update(st=("skipped" if att[0].startswith("SKIPPED")
                            else "failed"), v="", flags=[],
                        err=(att[1] or "")[:240])
        else:
            base.update(st="pending", v="", flags=[])
        rows.append(base)
    rows.sort(key=lambda r: (run_no(r["d"]), r["s"], r["n"]))

    # Campaign residual histogram: the same 50 bins in every record, so they add.
    ok_recs = [r for r, _ in recs.values()]
    h0 = ok_recs[0]["match"]["residual_hist"]
    total = [0] * len(h0["counts"])
    for rec in ok_recs:
        h = rec["match"]["residual_hist"]
        if (h["lo"], h["hi"], h["bin"]) != (h0["lo"], h0["hi"], h0["bin"]):
            sys.exit("residual histograms do not share a binning")
        for i, v in enumerate(h["counts"]):
            total[i] += v

    order, checks = [], collections.defaultdict(collections.Counter)
    for rec in ok_recs:
        for x in rec["checks"]:
            if x["name"] not in checks:
                order.append(x["name"])
            checks[x["name"]][x["level"]] += 1

    ok = [r for r in rows if r["st"] == "ok" and r.get("eff")]
    as_of = args.as_of
    if not as_of:
        import datetime
        newest = max(p.stat().st_mtime for p in
                     list(args.records.rglob("clock_qa.json")) +
                     list(ledger.glob("*.json")))
        as_of = datetime.date.fromtimestamp(newest).isoformat()

    # Pulse totals since run_79 -- the acceptance criterion of the campaign.
    since = camp.get("since_run", 79)
    tot = collections.Counter()
    for r in psubs:
        if run_no(r["d"]) >= since:
            tot.update(r["st"])
    den = sum(v for k, v in tot.items() if k in OURS)
    out = {
        "as_of": as_of,
        "source": {"records": args.records.name, "ledger": ledger.name,
                   "universe": "segments.propose()"},
        "hist": {"lo": h0["lo"], "hi": h0["hi"], "bin": h0["bin"],
                 "counts": total},
        "checks": [{"n": n, **checks[n]} for n in order],
        "accept_ns": ok_recs[0]["clock"]["accept_ns"],
        "slim_ns": ok_recs[0]["clock"]["slim_ns"],
        "eff_median": round(statistics.median(r["eff"] for r in ok), 5),
        "segs": rows,
        "pulses": {
            "since_run": since,
            "states": [{"k": k, "label": lab, "ours": ours, "d": desc,
                        "n": tot.get(k, 0)} for k, lab, ours, desc in STATES],
            "den": den,
            "matched": tot.get("MATCHED", 0),
            "n_subruns": sum(1 for r in psubs if run_no(r["d"]) >= since),
            "unclassified": camp.get("missing_census", []),
            "subs": psubs,
        },
    }
    for r in rows:
        if r["st"] == "ok" and "lv" in r:
            if not (len(r["lv"]) == len(r["chkv"]) == len(out["checks"])):
                sys.exit(f"{r['d']}/{r['s']}: {len(r['lv'])} levels and "
                         f"{len(r['chkv'])} values against "
                         f"{len(out['checks'])} checks")

    dest = ROOT / "data" / "x17-match.json"
    # Python's json writes bare NaN/Infinity, which is not JSON and makes the
    # browser reject the whole file. A record with an arm that saw no triggers
    # carries a NaN mean residual; render it as null.
    dest.write_text(json.dumps(_finite(out), separators=(",", ":"),
                               allow_nan=False))

    st = collections.Counter(r["st"] for r in rows)
    v = collections.Counter(r["v"] for r in rows if r["st"] == "ok")
    print(f"{dest.relative_to(ROOT)}  {dest.stat().st_size/1000:.0f} kB  "
          f"as of {as_of}")
    print(f"{len(rows)} segments {dict(st)}; verdicts {dict(v)}")
    post = [r for r in rows if run_no(r["d"]) >= since]
    print(f"  since run_{since}: {len(post)} segments "
          f"{dict(collections.Counter(r['st'] for r in post))}")
    if missing:
        print(f"!! {missing} shipped segment(s) have no clock_qa.json record")
    effs = sorted(r["eff"] for r in ok)
    print(f"efficiency n={len(effs)} median {out['eff_median']:.2%} "
          f"range {effs[0]:.2%}-{effs[-1]:.2%}")
    print(f"residuals: {sum(total):,} matched hits in +-{h0['hi']:.0f} ns")
    print(f"pulses since run_{since}: {out['pulses']['matched']:,} of {den:,} "
          f"matched = {out['pulses']['matched']/den:.2%}; "
          f"{dict((k, tot[k]) for k in STATE_KEYS if tot.get(k))}")
    if out["pulses"]["unclassified"]:
        print(f"  {len(out['pulses']['unclassified'])} sub-run(s) unclassified "
              f"in the ledger")
    for c in out["checks"]:
        if c.get("PASS", 0) != len(ok_recs):
            print(f"  check not unanimous: {c['n']} {dict(c)}")


if __name__ == "__main__":
    main()
