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

import json
import os
import re
import sys

PER_FEU = re.compile(r"\((\d+)\s*/\s*FEU\)")


def events_in(raw_dir):
    """Highest per-FEU count in this sub-run's RunCtrl logs, or None."""
    best = None
    try:
        names = os.listdir(raw_dir)
    except OSError:
        return None
    for fname in names:
        if not fname.endswith(".log") or fname == "dream_daq.log":
            continue
        try:
            with open(os.path.join(raw_dir, fname), errors="replace") as f:
                for line in f:
                    m = PER_FEU.search(line)
                    if m:
                        val = int(m.group(1))
                        if best is None or val > best:
                            best = val
        except OSError:
            continue
    return best


def main():
    root, out_path = sys.argv[1], sys.argv[2]
    runs = sorted((d for d in os.listdir(root) if re.fullmatch(r"run_\d+", d)),
                  key=lambda d: int(d.split("_")[1]))
    result = {}
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
