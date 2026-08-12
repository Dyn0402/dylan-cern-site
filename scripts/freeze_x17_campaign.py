#!/usr/bin/env python3
"""Freeze the n_TOF campaign statistics into data/x17-campaign.json.

    python3 scripts/freeze_x17_campaign.py LEDGER.csv PROJECTION.json

The /x17/ hub is a *post-campaign* page: data taking ended 2026-08-10 and the
numbers on it will never move again. So the two plots it keeps from the retired
live dashboard — integrated events, and events per day — are rendered from a
frozen snapshot committed here, not polled from the beamline. Nothing on the
page fetches the DAQ machine any more.

Inputs, both produced by nTof_x17_DAQ/projections/ on the DAQ machine:

    stats_ledger.csv          one row per completed sub-run
    saved/projection_*.json   a frozen projection, for the overlay

Copy them off the DAQ box and pass the paths:

    scp daq:PycharmProjects/nTof_x17_DAQ/projections/stats_ledger.csv /tmp/
    scp 'daq:PycharmProjects/nTof_x17_DAQ/projections/saved/*.json' /tmp/
    python3 scripts/freeze_x17_campaign.py /tmp/stats_ledger.csv \\
            /tmp/projection_2026-07-27.json

What counts as a beam trigger here matches what the live dashboard published:
`neutrons` plus `unknown`, and **not** `pulser` — pulser sub-runs are DAQ
characterisation, not physics, and folding them in would have inflated the
headline number by ~88k. Cosmics are counted separately throughout, because
they were taken during beam-off periods and adding the two curves would imply
an exposure that never happened.

The cumulative series is thinned to about `MAX_POINTS` samples for the page,
always keeping the first and last, so the JSON stays a few tens of kB. The
daily series is not thinned — there are only 20 days.
"""

import argparse
import collections
import csv
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "x17-campaign.json"

# Sub-run beam_type values that count toward the published beam total. 'pulser'
# is deliberately absent; see the module docstring.
BEAM_TYPES = {"neutrons", "unknown"}

MAX_POINTS = 220


def read_ledger(path):
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            try:
                t_end = float(r["t_end_unix"])
                events = int(r["events"])
            except (TypeError, ValueError):
                continue                      # a row the collector never closed
            rows.append({
                "run": r["run"],
                "beam_type": r["beam_type"],
                "cosmic": r["is_cosmic"] == "True",
                "t_end": t_end,
                "t_start": float(r["t_start_unix"]),
                "hours": float(r["hours"]),
                "events": events,
            })
    rows.sort(key=lambda r: r["t_end"])
    if not rows:
        sys.exit(f"{path}: no usable rows")
    return rows


def thin(points, limit=MAX_POINTS):
    """Keep every `stride`-th point, plus both ends. The curve is monotone and
    smooth, so uniform thinning cannot hide a feature the eye would want."""
    if len(points) <= limit:
        return points
    stride = -(-len(points) // limit)         # ceil
    kept = points[::stride]
    if kept[-1] != points[-1]:
        kept.append(points[-1])
    return kept


def cumulative(rows):
    """[t, beam_so_far, cosmics_so_far] at each sub-run end."""
    beam = cos = 0
    series = []
    for r in rows:
        if r["cosmic"]:
            cos += r["events"]
        elif r["beam_type"] in BEAM_TYPES:
            beam += r["events"]
        else:
            continue                          # pulser: excluded from both
        series.append([int(r["t_end"]), beam, cos])
    return series


def daily(rows):
    """Per-calendar-day totals, in the beamline's local time — the day boundary
    that shift crews actually worked to."""
    days = collections.defaultdict(
        lambda: {"beam": 0, "cos": 0, "beam_hours": 0.0, "cos_hours": 0.0})
    for r in rows:
        key = dt.datetime.fromtimestamp(r["t_start"]).strftime("%Y-%m-%d")
        d = days[key]
        if r["cosmic"]:
            d["cos"] += r["events"]
            d["cos_hours"] += r["hours"]
        elif r["beam_type"] in BEAM_TYPES:
            d["beam"] += r["events"]
            d["beam_hours"] += r["hours"]
    return [{"d": k, **{kk: (round(vv, 2) if isinstance(vv, float) else vv)
                        for kk, vv in v.items()}}
            for k, v in sorted(days.items())]


def projection_curve(path, t_end):
    """The frozen projection as [t, events], clipped to the end of the run."""
    proj = json.loads(pathlib.Path(path).read_text())
    pts = []
    for p in proj.get("points", []):
        t = dt.datetime.fromisoformat(p["t"]).timestamp()
        if t > t_end:
            break
        pts.append([int(t), int(p["events"])])
    return proj, thin(pts)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ledger", help="projections/stats_ledger.csv")
    ap.add_argument("projection", help="projections/saved/projection_<date>.json")
    ap.add_argument("--first-run", default="run_67",
                    help="the earliest run the ledger covers, for the footnote")
    args = ap.parse_args()

    rows = read_ledger(args.ledger)
    cum = cumulative(rows)
    t_first, t_last = rows[0]["t_start"], rows[-1]["t_end"]
    proj, proj_pts = projection_curve(args.projection, t_last)

    beam_rows = [r for r in rows if not r["cosmic"] and r["beam_type"] in BEAM_TYPES]
    cos_rows = [r for r in rows if r["cosmic"]]
    pulser_rows = [r for r in rows if r["beam_type"] == "pulser"]

    beam_events = sum(r["events"] for r in beam_rows)
    payload = {
        "note": "Frozen by scripts/freeze_x17_campaign.py — see that file. "
                "Data taking has ended; these numbers do not change.",
        "source": {"ledger": pathlib.Path(args.ledger).name,
                   "projection": pathlib.Path(args.projection).name},
        "campaign": {
            "start": dt.datetime.fromtimestamp(t_first).isoformat(timespec="minutes"),
            "end": dt.datetime.fromtimestamp(t_last).isoformat(timespec="minutes"),
            "days": round((t_last - t_first) / 86400, 1),
            "first_run": args.first_run,
        },
        "totals": {
            "beam_events": beam_events,
            "cosmic_events": sum(r["events"] for r in cos_rows),
            "beam_subruns": len(beam_rows),
            "cosmic_subruns": len(cos_rows),
            "pulser_subruns": len(pulser_rows),
            "beam_hours": round(sum(r["hours"] for r in beam_rows), 1),
            "cosmic_hours": round(sum(r["hours"] for r in cos_rows), 1),
            "runs": len({r["run"] for r in rows}),
        },
        "projection": {
            "name": proj.get("created", "")[:10],
            "created": proj.get("created"),
            "final_events": proj.get("final_events"),
            "pct_of_projection": (round(100 * beam_events / proj["final_events"], 1)
                                  if proj.get("final_events") else None),
        },
        "cumulative": thin(cum),
        "daily": daily(rows),
        "projection_curve": proj_pts,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    t = payload["totals"]
    print(f"wrote {OUT.relative_to(ROOT)} "
          f"({OUT.stat().st_size // 1024} kB) — "
          f"{t['beam_events']:,} beam / {t['cosmic_events']:,} cosmic events, "
          f"{len(payload['cumulative'])} curve points, "
          f"{len(payload['daily'])} days")


if __name__ == "__main__":
    main()
