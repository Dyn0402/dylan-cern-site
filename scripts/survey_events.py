#!/usr/bin/env python3
"""Per-sub-run event counts for the WHOLE campaign, read off the EOS archive.

    python3 survey_events.py /eos/experiment/ntof/data/x17/july_beam/runs out.json

Runs on lxplus. Complements survey_runs.py, which counts files but not events.

The DAQ's statistics ledger only starts at run_67, because the runs before it had
already been rotated off the DAQ disk when the ledger was created. But the number
was never actually lost: `dream_daq_control.py` copies the DREAM RunCtrl log into
each sub-run's `raw_daq_data/` at the end of the sub-run, and that log carries the
summary line

    FeuCtrl_StopDataTaking OK after total 2216 events in 8 FEUs (277/FEU) ...

Those logs went to EOS with the data, so every sub-run of the campaign still has
its own count, run_1 included.

**The per-FEU number is the event count.** Every event is read out by every FEU,
so the "total 2216" is the FEU-summed figure and using it would multiply the
campaign by eight. This mirrors `nTof_x17_DAQ/get_run_events.py`, which is the
definition the ledger and every published statistic already use -- highest
`(N/FEU)` in any RunCtrl log in the directory, ignoring `dream_daq.log`.
"""

import argparse
import json
import os
import re
import sys

PER_FEU = re.compile(r"\((\d+)\s*/\s*FEU\)")


def events_in(raw_dir):
    """Per-FEU events this sub-run recorded, summed over its acquisitions.

    One `RunCtrl_<date>_<time>.log` per acquisition, each ending with

        FeuCtrl_StopDataTaking OK after total 792 events in 8 FEUs (99/FEU)

    and the per-FEU number is the physics count -- every event is read out by
    every FEU, so the FEU-summed total would multiply the campaign by eight.

    **Summed, not maximised.** A sub-run that was stopped and restarted holds
    several acquisitions, and taking the largest silently drops all but one:
    `run_9/scan10_dr800_A495_04` logs 47/FEU and 99/FEU, so the largest is a
    32 % undercount of its true 146. The counts are per acquisition rather than
    cumulative -- `run_68/cos_003_r540_c00` logs 1,617/FEU then 0/FEU, and a
    running total cannot go down -- so they add, and an acquisition that took
    nothing contributes nothing.

    NOTE this deliberately differs from `nTof_x17_DAQ/get_run_events.py`, which
    takes the maximum and which every previously published campaign statistic
    was computed from. That tool has the same undercount; this is not a
    divergence in convention but a correction to one.
    """
    total, found = 0, False
    try:
        names = os.listdir(raw_dir)
    except OSError:
        return None
    for fname in sorted(names):
        if not fname.endswith(".log") or fname == "dream_daq.log":
            continue
        try:
            with open(os.path.join(raw_dir, fname), errors="replace") as f:
                for line in f:
                    m = PER_FEU.search(line)
                    if m:
                        total += int(m.group(1))
                        found = True
        except OSError:
            continue
    return total if found else None


# ---- run selection -------------------------------------------------------
# These scripts are copied to lxplus one at a time, so they cannot import a
# shared module and this block is duplicated verbatim in all three.

def parse_runs(spec):
    """{5, 12, 40..44} from "5,12,40-44"; a bare number is a single run."""
    out = set()
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            a, b = chunk.split("-", 1)
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(chunk))
    return out


def select(root, args):
    """The run directories to walk, in run order, and the rows to keep.

    Walking a subset and writing the result out would silently destroy every
    run that was not walked, so **a subset run merges into the existing output
    by default**. That is the whole point of --runs: reprocess three runs,
    re-survey those three, leave the other hundred and fifty-eight alone.
    Pass --replace to write only what was walked.
    """
    all_runs = sorted((d for d in os.listdir(root) if re.fullmatch(r"run_\d+", d)),
                      key=lambda d: int(d.split("_")[1]))
    if not args.runs:
        return all_runs, {}
    want = parse_runs(args.runs)
    runs = [d for d in all_runs if int(d.split("_")[1]) in want]
    missing = want - {int(d.split("_")[1]) for d in runs}
    if missing:
        sys.exit(f"no such run(s) under {root}: "
                 + ", ".join(f"run_{n}" for n in sorted(missing)))
    keep = {}
    if not args.replace and os.path.exists(args.out):
        with open(args.out) as f:
            keep = json.load(f)
        print(f"merging {len(runs)} run(s) into {len(keep)} already in "
              f"{args.out}", flush=True)
    return runs, keep


def cli(what):
    p = argparse.ArgumentParser(description=what)
    p.add_argument("root", help="the runs/ directory on EOS")
    p.add_argument("out", help="output JSON")
    p.add_argument("--runs", help="only these, e.g. 5,12,40-44 (merges into "
                                  "an existing output file)")
    p.add_argument("--replace", action="store_true",
                   help="with --runs, write ONLY the walked runs")
    return p.parse_args()

def main():
    args = cli("read per-sub-run event counts out of the RunCtrl logs")
    root, out_path = args.root, args.out
    runs, result = select(root, args)
    for i, run in enumerate(runs, 1):
        run_path = os.path.join(root, run)
        got = {}
        for sub in sorted(os.listdir(run_path)):
            raw = os.path.join(run_path, sub, "raw_daq_data")
            if not os.path.isdir(raw):
                continue
            ev = events_in(raw)
            if ev is not None:
                got[sub] = ev
        result[run] = got
        print(f"[{i}/{len(runs)}] {run}: {len(got)} sub-runs, "
              f"{sum(got.values()):,} events", flush=True)
        with open(out_path, "w") as f:            # checkpoint every run
            json.dump(result, f)
    total = sum(sum(v.values()) for v in result.values())
    print(f"done — {total:,} events over "
          f"{sum(len(v) for v in result.values())} sub-runs")


if __name__ == "__main__":
    main()
