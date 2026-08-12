#!/usr/bin/env python3
"""Freeze the n_TOF side of the campaign into data/x17-ntof-runs.json.

    python3 scripts/freeze_x17_ntof.py [--src ~/PycharmProjects/nTof_x17]

The DREAM run table (`freeze_x17_runs.py`) answers "did we record it and is it
on EOS". This answers the other half: n_TOF ran its own DAQ over the same beam,
and its 445 runs are reconstructed by n_TOF's production, by us, or by both.
A DREAM run is useless for physics without the n_TOF run that overlaps it, so
the two tables are checked separately and joined on the third page.

Inputs, all produced by `nTof_x17/ntof_processing/campaign_qa/`:

  results/completed_ledger_<date>.csv   per run, does the partial set COVER the
                                        run -- judged from the `index` tree,
                                        not from whether a merge happened
  results/settled_runs_<date>.txt       FINISHED / STABLE-BUT-UNMERGED / MOVING
  results/beam_state.json               protons and beam fraction, for the runs
                                        it was run on
  results/slim_inventory_<date>.csv     one row per (DREAM sub-run x n_TOF run)
                                        segment that was attempted
  results/slim_todo_<date>.txt          the segments not attempted yet

and, for when each run actually ran, two listings from `slim_study/`:

  coverage_inputs/ntof_index_times.txt  run start/end from the `index` tree
  coverage_inputs/ntof_raw_times.txt    fallback: raw stream1 file mtimes

Both need a correction and neither is usable raw -- see `run_times()`.

The latest dated file of each kind is used, and the date it carries is emitted
as `as_of` -- this is a moving campaign and a page that does not say when it
was true is worse than no page.

Nothing is copied through wholesale; every field below is named explicitly.
"""

import argparse
import collections
import datetime as dt
import csv
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_SRC = pathlib.Path.home() / "PycharmProjects" / "nTof_x17"

# settled_runs.txt writes its classes as "## NAME -- n [runs]" headers followed
# by comma-separated ranges. Anything not listed is UNKNOWN rather than assumed
# finished, and an UNRECOGNISED header clears the current class rather than
# letting its runs fall into the previous one -- the file carries a fourth
# "zero-byte done/run<N>.root" section whose two runs are already listed above
# it, and folding them into MOVING silently overcounted it by two.
SETTLED_HEAD = re.compile(r"^##\s*(.+?)\s*--\s*(\d+)")
SETTLED_KEY = {"FINISHED": "finished",
               "STABLE BUT UNMERGED": "unmerged",
               "MOVING": "moving"}

# slim_todo.txt is a comment block; its table rows look like
#     #  224617  partials     5   212.8  run_104 0009,0010,...
TODO_ROW = re.compile(r"^#\s*(\d{6})\s+(\w+)\s+(\d+)\s+([\d.]+)\s+(run_\d+)\s+([\w,]+)")


def latest(d, pattern):
    """The newest file matching a dated glob, and the date out of its name."""
    hits = sorted(d.glob(pattern))
    if not hits:
        sys.exit(f"no {pattern} under {d}")
    m = re.search(r"(\d{4}-\d{2}-\d{2})", hits[-1].name)
    return hits[-1], (m.group(1) if m else "")


def read_settled(path):
    """{run: 'finished'|'unmerged'|'moving'} from the ranges in the file.

    Each header states how many runs its section holds, and that count is
    asserted against what the ranges actually expand to -- the mistake this
    catches is silent (an unparsed header leaves the previous class in force and
    its runs are simply added to the wrong one).
    """
    out, key, want, got = {}, None, {}, collections.Counter()
    for line in path.read_text().splitlines():
        head = SETTLED_HEAD.match(line)
        if head:
            key = SETTLED_KEY.get(head.group(1).strip().upper())
            if key:
                want[key] = int(head.group(2))
            continue
        if key is None or line.startswith("#") or not line.strip():
            continue
        for chunk in line.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            if "-" in chunk:
                a, b = chunk.split("-")
                runs = range(int(a), int(b) + 1)
            elif chunk.isdigit():
                runs = [int(chunk)]
            else:
                continue
            for r in runs:
                out[r] = key
            got[key] += len(runs)
    for k, n in want.items():
        if got[k] != n:
            sys.exit(f"{path.name}: '{k}' header says {n} runs, ranges give {got[k]}")
    return out


# The `index` tree's Date/Time fields are LOCAL -- the n_TOF DAQ writes UTC+2 --
# and the listing turns them into an epoch as if they were UTC, so they run two
# hours fast. The raw listing is true UTC but starts when the first raw file
# finished writing, about a minute in. Both constants are `slim_study`'s, and
# both were measured rather than assumed: over the 109 runs that have both,
# raw_start - index_start is a flat -7127 s (p10 -7185, p90 -7080), which is
# -7200 plus that write lag. The campaign is entirely inside CEST, so a single
# offset is correct for all of it.
INDEX_SHIFT_S = -7200
RAW_LAG_S = -73


def stamp(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc)\
             .strftime("%Y-%m-%d %H:%M")


def read_spans(path, shift):
    """{run: (start, end, n_bunches)} from a `run lo hi n` listing."""
    out = {}
    for line in path.read_text().splitlines():
        p = line.split()
        if len(p) >= 4 and p[0].isdigit():
            out[int(p[0])] = (int(p[1]) + shift, int(p[2]) + shift, int(p[3]))
    return out


def run_times(src):
    """{run: (start, end, source)} preferring the index tree over raw mtimes."""
    d = src / "ntof_processing" / "slim_study" / "coverage_inputs"
    idx = read_spans(d / "ntof_index_times.txt", INDEX_SHIFT_S)
    raw = read_spans(d / "ntof_raw_times.txt", RAW_LAG_S)
    out = {}
    for run, (a, b, n) in idx.items():
        # A one-bunch or zero-length entry is a stub, not a run that lasted no
        # time; fall through to the raw listing rather than publishing 0 s.
        if n >= 2 and b > a:
            out[run] = (a, b, "index")
    for run, (a, b, _) in raw.items():
        out.setdefault(run, (a, b, "raw"))
    return out


def read_beam(path):
    return {int(r["run"]): {
        "bunches": r["bunches"],
        "beam_pct": round(r["beam_pct"], 2),
        "protons": round(r["protons_1e12"], 1),
        "state": r["state"],
    } for r in json.loads(path.read_text())}


def read_segments(path):
    """Attempted segments, grouped by n_TOF run."""
    by_run = collections.defaultdict(list)
    for r in csv.DictReader(path.open()):
        by_run[int(r["ntof_run"])].append({
            "dream": r["dream_run"],
            "sub": r["sub_run"],
            "status": r["status"],
            "eff": float(r["efficiency"]) if r["efficiency"] else None,
            "min": float(r["overlap_min"] or 0),
            "kind": r["kind"],
        })
    return by_run


def read_todo(path):
    """{run: (source, n_segments, minutes, dream_run)} for what is not slimmed."""
    out = {}
    for line in path.read_text().splitlines():
        m = TODO_ROW.match(line)
        if m:
            out[int(m.group(1))] = {
                "src": m.group(2), "segs": int(m.group(3)),
                "min": float(m.group(4)), "dream": m.group(5),
                # The todo table prints one DREAM run per row, so a run that
                # straddles two names only the majority side's sub-runs and its
                # own count comes out one short. Pad rather than lose it.
                "subs": (m.group(6).split(",") +
                         ["?"] * max(0, int(m.group(3)) - len(m.group(6).split(","))))
            }
    return out


def coverage(row):
    """One word for whether this run is usable, and from whose processing.

    `off_state` COVERED means n_TOF's own partial set spans the run. Ours is a
    fallback, and an OFF_RECIPE product is deliberately not counted as coverage:
    it was made with a different UserInput and mixing recipes is exactly the
    mistake this ledger exists to prevent.
    """
    off, ours = row["off_state"], row["ours_state"]
    if off == "COVERED":
        return "official"
    if ours == "COVERED":
        return "ours"
    if off == "MERGED_ONLY":
        return "merged only"
    if ours == "OFF_RECIPE":
        return "off recipe"
    return "short"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=pathlib.Path, default=DEFAULT_SRC)
    args = ap.parse_args()
    res = args.src / "ntof_processing" / "campaign_qa" / "results"
    if not res.is_dir():
        sys.exit(f"not found: {res}")

    ledger_p, as_of = latest(res, "completed_ledger_*.csv")
    settled_p, _ = latest(res, "settled_runs_*.txt")
    inv_p, _ = latest(res, "slim_inventory_*.csv")
    todo_p, _ = latest(res, "slim_todo_*.txt")

    settled = read_settled(settled_p)
    beam = read_beam(res / "beam_state.json")
    segs = read_segments(inv_p)
    todo = read_todo(todo_p)
    times = run_times(args.src)

    runs = []
    for row in csv.DictReader(ledger_p.open()):
        n = int(row["run"])
        mine = segs.get(n, [])
        ok = [s for s in mine if s["status"] == "OK"]
        bad = [s for s in mine if s["status"] == "FAILED"]
        skip = [s for s in mine if s["status"].startswith("SKIPPED")]
        pend = todo.get(n)
        dreams = sorted({s["dream"] for s in mine} |
                        ({pend["dream"]} if pend else set()))
        rec = {
            "n": n,
            "cov": coverage(row),
            "off": row["off_state"],
            "offp": int(row["off_parts"] or 0),
            "contig": row["off_contiguous"] == "True",
            "first": int(row["run_first"] or 0),
            "last": int(row["run_last"] or 0),
            "ours": row["ours_state"],
            "oursp": int(row["ours_parts"] or 0),
            "prod": row["ours_prod"],
            "mb": round(int(row["merged_bytes"] or 0) / 1e6, 1),
            "settled": settled.get(n, "unknown"),
            # The slim leg: how much of this run has been joined to DREAM.
            "nok": len(ok), "nbad": len(bad), "nskip": len(skip),
            "npend": pend["segs"] if pend else 0,
            "dreams": dreams,
            # The segments this run shares with DREAM, so the page can expand a
            # run into its parts. n_TOF's own partials would be the other
            # natural nesting, but the ledger aggregates them and does not say
            # what each one covers -- that would need its own survey.
            #   [DREAM run, sub-run, status, minutes, efficiency]
            "segs": [[s["dream"], s["sub"], s["status"], s["min"], s["eff"]]
                     for s in sorted(mine, key=lambda s: (s["dream"], s["sub"]))]
                    + ([[pend["dream"], sub, "PENDING",
                         round(pend["min"] / pend["segs"], 1), None]
                        for sub in pend["subs"]] if pend else []),
            "eff": (round(sum(s["eff"] for s in ok) / len(ok), 4)
                    if ok else None),
            "minj": round(sum(s["min"] for s in ok), 1) if ok else 0.0,
            # All the beam this run shares with DREAM, whatever became of it --
            # the denominator "minj" is a fraction of, and the bar the match
            # view draws, so a run that failed entirely is still a tall bar.
            "minall": round(sum(s["min"] for s in mine) +
                            (pend["min"] if pend else 0.0), 1),
        }
        if n in beam:
            rec["beam"] = beam[n]
        if n in times:
            # Start and end only. Duration is derived from them on the page:
            # storing a rounded copy alongside cost a 15-second run 3 of its
            # seconds, and two fields that can disagree are one too many.
            a, b, how = times[n]
            rec["t0"], rec["t1"], rec["tsrc"] = a, b, how
        runs.append(rec)

    # A run that no DREAM sub-run overlaps is not a failure of anything -- most
    # of the 445 predate the DREAM detector being in the beam at all -- so it
    # gets its own class rather than sitting at "0 segments slimmed".
    for r in runs:
        r["slim"] = ("none" if not (r["nok"] or r["nbad"] or r["nskip"]
                                    or r["npend"])
                     else "done" if r["nok"] and not (r["nbad"] or r["npend"])
                     else "partial" if r["nok"]
                     else "pending" if r["npend"] and not r["nbad"]
                     else "failed")

    out = {
        "as_of": as_of,
        "source": {"ledger": ledger_p.name, "settled": settled_p.name,
                   "inventory": inv_p.name, "todo": todo_p.name},
        "runs": runs,
    }
    dest = ROOT / "data" / "x17-ntof-runs.json"
    dest.write_text(json.dumps(out, separators=(",", ":")))

    cov = collections.Counter(r["cov"] for r in runs)
    slim = collections.Counter(r["slim"] for r in runs)
    over = [r for r in runs if r["slim"] != "none"]
    print(f"{dest.relative_to(ROOT)}  {dest.stat().st_size/1000:.0f} kB  "
          f"as of {as_of}")
    print(f"{len(runs)} n_TOF runs; coverage {dict(cov)}")
    print(f"{len(over)} overlap DREAM beam; slim {dict(slim)}")
    print(f"segments: {sum(r['nok'] for r in runs)} ok, "
          f"{sum(r['nbad'] for r in runs)} failed, "
          f"{sum(r['nskip'] for r in runs)} skipped, "
          f"{sum(r['npend'] for r in runs)} not attempted")

    timed = [r for r in runs if "t0" in r]
    src = collections.Counter(r["tsrc"] for r in timed)
    print(f"times: {len(timed)}/{len(runs)} runs {dict(src)}")
    if timed:
        lo = min(r["t0"] for r in timed)
        hi = max(r["t1"] for r in timed)
        print(f"       {stamp(lo)} -> {stamp(hi)} UTC, "
              f"{sum(r['t1'] - r['t0'] for r in timed) / 3600:.0f} h of running")
    for r in runs:
        if "t0" not in r:
            print(f"       !! no time for {r['n']} ({r['settled']})")
    cross_check(runs)


def cross_check(runs):
    """Do the n_TOF times land where the DREAM times say they should?

    The two clocks are corrected independently -- n_TOF's by the -7200 s above,
    DREAM's not at all, because `run_config.json` already writes epochs -- so
    "they agree" is a real test rather than a tautology, and a wrong offset here
    would be a silent two-hour error that still looks plausible on a plot.

    Every segment the slim pipeline joined is one assertion: a DREAM sub-run
    and an n_TOF run that were demonstrably taking beam at the same moment,
    because a coincidence peak was fitted between them. Its sub-runs must
    therefore overlap that n_TOF run's window here too.
    """
    try:
        dream = json.loads((ROOT / "data" / "x17-runs.json").read_text())
        match = json.loads((ROOT / "data" / "x17-match.json").read_text())
    except FileNotFoundError as e:
        print(f"cross-check skipped: {e.filename} not frozen yet")
        return

    spans = collections.defaultdict(list)
    for s in dream["subs"]:                       # [start, seconds, ...., run]
        spans[s[4]].append((s[0], s[0] + s[1]))
    times = {r["n"]: (r["t0"], r["t1"]) for r in runs if "t0" in r}

    checked = bad = 0
    for seg in match["segs"]:
        if seg["st"] != "ok" or seg["n"] not in times:
            continue
        a, b = times[seg["n"]]
        run = int(seg["d"].split("_")[1])
        best = max((min(y, b) - max(x, a) for x, y in spans.get(run, [(0, 0)])),
                   default=0) / 60
        checked += 1
        # Half the overlap the pipeline itself measured: generous, because this
        # is testing a two-hour offset, not the minute-level agreement.
        if best < 0.5 * seg["min"]:
            bad += 1
            print(f"       !! {seg['d']}/{seg['s']} x {seg['n']}: "
                  f"{best:.1f} min of overlap here vs {seg['min']:.1f} reported")
    print(f"cross-check: {checked - bad}/{checked} joined segments have a DREAM "
          f"sub-run overlapping their n_TOF run")
    if bad:
        sys.exit("the two time bases disagree -- check INDEX_SHIFT_S")


if __name__ == "__main__":
    main()
