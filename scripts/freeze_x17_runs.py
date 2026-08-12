#!/usr/bin/env python3
"""Turn the EOS run survey into data/x17-runs.json, the run-QA table's input.

    python3 scripts/freeze_x17_runs.py SURVEY.json [--ledger stats_ledger.csv]

SURVEY.json comes from `survey_runs.py` run on lxplus, which walks
/eos/experiment/ntof/data/x17/july_beam/runs and counts, per sub-run, the raw
files the DAQ wrote and each processed product made from them. This script
turns that into one row per run and decides what the row says.

The checks, and what each one actually means
--------------------------------------------
Every raw file is one (acquisition, FEU) pair -- an acquisition being a
(timestamp, file number), because a sub-run that was stopped and restarted has
two of them sharing file number 000 -- so the products have exact expected
counts rather than approximate ones:

    decoded  == raw                 every raw file was decoded
    hits     == decoded             every decode produced hits
    combined == acquisitions        every acquisition was FEU-combined

Note the survey excludes `Mx17_pedestals_datrun_*.fdf` from the raw count. Those
are pedestal acquisitions that the early runs wrote under the `datrun` name;
counting them as physics data made every early run report "50 % decoded" when
nothing whatsoever was missing.

A run is then one of:

    complete    all three hold, on every sub-run
    partial     some product is short -- processing did not finish
    raw only    nothing but raw on disk; never processed
    empty       no raw data (a run that was started and abandoned)

**"partial" is not "broken".** Plenty of runs here were configuration studies
that were deliberately never pushed through the full chain, and a run whose raw
files are all present has lost nothing -- it can be reprocessed. The page says
"processing coverage" for exactly that reason. What would be alarming is raw
files *missing*, and that is a different column.

Event counts come from `survey_events.py`, which reads the per-FEU number out of
the DREAM RunCtrl log archived in every sub-run -- so they exist for the whole
campaign, run_1 included, not only for the runs the DAQ machine's statistics
ledger covers (run_67 on). Pass --ledger as well and the two are cross-checked
where they overlap; any disagreement is printed and counted, because the ledger
is what every already-published number was computed from.

Live hours likewise cover everything: they come from each sub-run's own
run_time.txt on EOS, the only surviving record of when the early runs ran.
"""

import argparse
import collections
import csv
import datetime as dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "x17-runs.json"

# The trigger field is a paragraph of operator notes. The first sentence is
# reliably what the run was for, which is what makes the table readable.
FIRST_SENTENCE = re.compile(r"^(.{0,180}?[.!])(?:\s|$)", re.S)


def purpose(trigger):
    """The first sentence of the operator's trigger note.

    The early runs put a bare trigger name there ("PS Pickup") rather than a
    description, and it has no full stop -- so the ellipsis only goes on when
    something was actually cut, or a nine-character field reads as truncated.
    """
    if not trigger:
        return ""
    t = " ".join(trigger.split())
    m = FIRST_SENTENCE.match(t)
    if m:
        return m.group(1).strip()
    return t if len(t) <= 180 else t[:180].rstrip() + "…"


# Mode, exactly as nTof_x17_DAQ/projections/run_stats.py decides it: from
# `beam_type` in the run's own run_config.json, never from sub-run name matching
# (a "cos" in a sub-run tag means nothing reliable). Mirrored here rather than
# imported because that module lives on the DAQ machine and wants pandas.
#
# This is the backfill that makes the whole campaign comparable: the live
# dashboard only ever knew modes for run_67 onward, because that is where its
# ledger starts, but run_config.json is archived beside the data for all 161
# runs and says the same thing.
COSMIC_BEAM_TYPES = {"cosmics", "cosmic"}
NON_PHYSICS_BEAM_TYPES = {"pulser", "test", "daq_test"}


def mode_of(beam_type):
    """('beam'|'cosmics'|'pulser', is_physics) for a run_config beam_type."""
    bt = (beam_type or "unknown").lower()
    if bt in COSMIC_BEAM_TYPES:
        return "cosmics", True
    if bt in NON_PHYSICS_BEAM_TYPES:
        # 'pulser' is the only one the campaign actually used; test/daq_test
        # would land here too, which is right -- they are equally not physics.
        return "pulser", False
    return "beam", True


def load_configs(path):
    """{run number: scan record} from survey_configs.py.

    A run is an HV scan iff its per-sub-run HV setpoint map is not the same in
    every sub-run -- see that script. The axis is the set of detector roles
    whose voltage moved, so "resist" and "drift+resist" are different scans and
    a threshold or latency ladder, which moves no voltage at all, is neither.
    """
    d = json.loads(pathlib.Path(path).read_text())
    out = {}
    for name, c in d.items():
        axis = c.get("hv_axis") or {}
        if not axis:
            continue
        out[int(name.split("_")[1])] = {
            "p": c.get("hv_points", 0),
            "a": {k: v for k, v in sorted(axis.items(),
                                          key=lambda kv: -kv[1])},
        }
    return out


def load_dashboard(path):
    """{run number: row} from the retired dashboard's runs.json.

    It carries two things this survey cannot derive from the archive: how much
    of each run's on-air time the beam was actually down, and which side was
    responsible (PS/machine vs nTOF). Those come from the beam watcher's
    records, so they exist only for the runs the ledger covers -- run_67 on.
    """
    d = json.loads(pathlib.Path(path).read_text())
    return {r["num"]: r for r in d.get("runs", [])}


def load_events(path):
    """{(run, subrun): events} from the RunCtrl-log survey."""
    d = json.loads(pathlib.Path(path).read_text())
    return {(run, sub): ev for run, subs in d.items() for sub, ev in subs.items()}


def load_ledger(path):
    """{(run, subrun): events} from the DAQ machine's statistics ledger."""
    events = {}
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            try:
                events[(r["run"], r["subrun"])] = int(r["events"])
            except (TypeError, ValueError):
                continue
    return events


def classify(agg):
    if not agg["raw"]:
        return "empty"
    if not agg["decoded"]:
        return "raw only"
    if (agg["decoded"] == agg["raw"] and agg["hits"] == agg["decoded"]
            and agg["combined"] == agg["file_nums"]):
        return "complete"
    return "partial"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("survey")
    ap.add_argument("--ledger", default=None,
                    help="projections/stats_ledger.csv, for event counts")
    ap.add_argument("--dashboard", default=None,
                    help="the retired dashboard's runs.json, for beam-off hours")
    ap.add_argument("--events", default=None,
                    help="survey_events.py output: per-sub-run event counts")
    ap.add_argument("--configs", default=None,
                    help="survey_configs.py output: which runs swept an HV setting")
    args = ap.parse_args()

    survey = json.loads(pathlib.Path(args.survey).read_text())
    ledger = load_ledger(args.ledger) if args.ledger else {}
    dash = load_dashboard(args.dashboard) if args.dashboard else {}
    logs = load_events(args.events) if args.events else {}
    scans = load_configs(args.configs) if args.configs else {}
    # The logs are the source; the ledger is the check. Disagreement would mean
    # the published statistics and this page are counting different things, so
    # it is surfaced rather than silently resolved.
    disagree = [k for k in ledger if k in logs and ledger[k] != logs[k]]
    events_by_sub = dict(ledger)
    events_by_sub.update(logs)
    subs_out = []

    rows, totals, run_mode = [], collections.Counter(), {}
    for name, rec in sorted(survey.items(), key=lambda kv: int(kv[0].split("_")[1])):
        subs = rec["subruns"]
        cfg = rec.get("config") or {}

        agg = collections.Counter()
        feus, problems, starts, ends, seconds, events = set(), [], [], [], 0.0, 0
        have_events = False
        for sname, s in subs.items():
            for k in ("raw", "decoded", "hits", "combined", "ped_files",
                      "ped_products"):
                agg[k] += s.get(k, 0)
            agg["file_nums"] += s["n_file_nums"]
            agg["bytes"] += s["bytes"]
            agg["raw_bytes"] += s["raw_bytes"]
            if s["n_feus"]:
                feus.add(s["n_feus"])
            if s["t_start"]:
                starts.append(s["t_start"])
                if s["seconds"]:
                    ends.append(s["t_start"] + s["seconds"])
                    seconds += s["seconds"]
            ev = events_by_sub.get((name, sname))
            if ev is not None:
                events += ev
                have_events = True
                if s["t_start"]:
                    subs_out.append([int(s["t_start"]), int(s["seconds"] or 0),
                                     int(ev), name])

            # Per-sub-run notes, so a partial run says which sub-run is short
            # rather than only that something somewhere is missing. A count
            # *above* the expected one is a different animal from one below it
            # -- it means products with no surviving raw behind them, or the
            # same data combined twice -- so it is never called "short".
            def note(kind, got, want):
                extra = " — more products than acquisitions" if got > want else ""
                problems.append({"s": sname, "w": f"{kind} {got}/{want}{extra}"})

            if s["raw"] and s["decoded"] != s["raw"]:
                note("decoded", s["decoded"], s["raw"])
            elif s["decoded"] and s["hits"] != s["decoded"]:
                note("hits", s["hits"], s["decoded"])
            elif s["decoded"] and s["combined"] != s["n_file_nums"]:
                note("combined", s["combined"], s["n_file_nums"])
            if s["raw"] and not s["hv_monitor"]:
                problems.append({"s": sname, "w": "no hv_monitor.csv"})
            if s["raw"] and not s["run_time_txt"]:
                problems.append({"s": sname, "w": "no run_time.txt"})

        status = classify(agg)
        totals[status] += 1
        num = int(name.split("_")[1])
        mode, physics = mode_of(cfg.get("beam_type"))

        # On-air hours: first sub-run start to last sub-run end, so the gaps
        # between sub-runs (pedestals, HV settling, an operator deciding what to
        # do next) are inside it. Live hours are the sum of the sub-runs
        # themselves. The difference is the overhead of running the experiment,
        # and it is worth seeing.
        h_air = round((max(ends) - min(starts)) / 3600, 2) if ends and starts else 0.0
        dr = dash.get(num, {})
        run_mode[name] = mode

        # Prefer the run_config start time; fall back to the earliest sub-run.
        start = cfg.get("start_time") or (
            dt.datetime.fromtimestamp(min(starts)).strftime("%Y-%m-%d %H:%M:%S")
            if starts else None)

        rows.append({
            "n": num,
            "mode": mode,
            "phys": physics,
            # Orthogonal to mode: a scan is something a run DOES, and it does it
            # while running on beam, on cosmics or on the pulser.
            "hv": scans.get(num),
            "hair": h_air,
            "rate": (round(events / seconds * 3600) if events and seconds else None),
            "offps": dr.get("off_ps_h"),
            "offnt": dr.get("off_ntof_h"),
            "t": start[:16] if start else None,
            "end": (dt.datetime.fromtimestamp(max(ends)).strftime("%Y-%m-%dT%H:%M")
                    if ends else None),
            "h": round(seconds / 3600, 2),
            "nsub": len(subs),
            "beam": cfg.get("beam_type"),
            "gas": cfg.get("gas"),
            "tgt": cfg.get("target_type"),
            "gb": round(agg["bytes"] / 1e9, 1),
            "raw": agg["raw"], "dec": agg["decoded"], "hit": agg["hits"],
            "cmb": agg["combined"], "exp": agg["file_nums"],
            "ped": agg["ped_files"],
            "feus": sorted(feus),
            "ev": events if have_events else None,
            "st": status,
            "why": purpose(cfg.get("trigger")),
            "bad": problems[:12],
            "n_bad": len(problems),
            "cfg_err": rec.get("config_error"),
        })

    hours = sum(r["h"] for r in rows)

    # Sub-run bars for the statistics plot:
    #   [start epoch, seconds, events, mode index, run number]
    # sorted by time, mode indexing into MODE_ORDER. The run number rides along
    # so the plot can follow the table's mode filter and name a run on hover.
    # One row per sub-run for the whole campaign is ~2,700 entries; arrays of
    # plain integers rather than objects is what keeps that under 100 kB.
    MODE_ORDER = ["beam", "cosmics", "pulser"]
    subs = sorted(([t0, secs, ev, MODE_ORDER.index(run_mode.get(run, "beam")),
                    int(run.split("_")[1])]
                   for t0, secs, ev, run in subs_out), key=lambda s: s[0])

    payload = {
        "note": "Frozen by scripts/freeze_x17_runs.py from a survey of "
                "/eos/experiment/ntof/data/x17/july_beam/runs. See that file "
                "for what each check means.",
        "source": pathlib.Path(args.survey).name,
        "summary": {
            "runs": len(rows),
            "by_mode": dict(collections.Counter(r["mode"] for r in rows)),
            "hv_scans": sum(1 for r in rows if r["hv"]),
            # Sorted by NAME, not by the per-run count order, or the same axis
            # arrives under two spellings ("drift+resist" and "resist+drift").
            "by_hv_axis": dict(collections.Counter(
                "+".join(sorted(r["hv"]["a"])) for r in rows if r["hv"])),
            "beam_off_from": "run_67" if dash else None,
            "subruns": sum(r["nsub"] for r in rows),
            "hours": round(hours, 1),
            "tb": round(sum(r["gb"] for r in rows) / 1000, 2),
            "raw_files": sum(r["raw"] for r in rows),
            "events": sum(r["ev"] or 0 for r in rows),
            "events_source": "RunCtrl logs" if logs else "ledger",
            "events_subruns": len(subs),
            "ledger_disagreements": len(disagree),
            "by_status": dict(totals),
            "span": [min((r["t"] for r in rows if r["t"]), default=None),
                     max((r["end"] for r in rows if r["end"]), default=None)],
        },
        "runs": rows,
        "mode_order": MODE_ORDER,
        "subs": subs,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    s = payload["summary"]
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} kB)")
    print(f"  {s['runs']} runs, {s['subruns']} sub-runs, {s['hours']} h, "
          f"{s['tb']} TB, {s['raw_files']:,} raw files")
    print(f"  status: " + ", ".join(f"{k} {v}" for k, v in sorted(totals.items())))
    print(f"  modes: " + ", ".join(f"{k} {v}" for k, v in sorted(s["by_mode"].items())))
    if scans:
        print(f"  HV scans: {s['hv_scans']} — " +
              ", ".join(f"{k} {v}" for k, v in sorted(s["by_hv_axis"].items())))
    print(f"  events: {s['events']:,} over {s['events_subruns']} sub-runs "
          f"(source: {s['events_source']})")
    if ledger and logs:
        both = sum(1 for k in ledger if k in logs)
        print(f"  cross-check: {both} sub-runs in both the ledger and the logs, "
              f"{len(disagree)} disagree")
        for k in disagree[:5]:
            print(f"    {k[0]}/{k[1]}: ledger {ledger[k]:,} vs log {logs[k]:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
