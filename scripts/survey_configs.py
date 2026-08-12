#!/usr/bin/env python3
"""Find the scan axis of every run, from its own per-sub-run settings.

    python3 survey_configs.py /eos/experiment/ntof/data/x17/july_beam/runs out.json

Runs on lxplus; reads only `run_config.json`, one per run, so it takes about a
minute rather than the twenty that walking the file tree does.

A scan is not guessed from sub-run names -- `m090On_dr500_r520_062` happens to
be readable, but `scan01_dr800_A350_21` and `cosbounce_cos_0014` are not the
same convention, and a run can be a scan with no hint in the name at all. The
run configuration already holds the answer exactly: each entry of `sub_runs`
carries the full HV setpoint map it was taken at,

    {"sub_run_name": ..., "hvs": {"<board>": {"<channel>": volts}}, ...}

so a run is an HV scan **iff that map is not the same in every sub-run**, and
the channels that differ are the scan axis. `detectors[].hv_channels` maps
(board, channel) to a role -- `drift`, `resist`, and whatever the scintillators
use -- which turns "board 9 channel 0 varied" into "the drift voltage varied".

The same test on `ovr_wrn_hwm`/`ovr_wrn_lwm` finds the trigger-FIFO watermark
scans, which are the other axis the campaign swept per sub-run.

Nothing from the config is copied through wholesale: this emits counts and role
names only. `run_config.json` contains an HV-controller password.
"""

import argparse
import collections
import json
import os
import re
import sys

# Roles worth naming in the output; anything else a detector declares is folded
# into "other" rather than dropped, so a new supply cannot vanish silently.
KNOWN_ROLES = ("drift", "resist", "mesh", "pmt", "sipm", "plastic", "liquid")


def role_map(cfg):
    """{(board, channel): role} from the detector list."""
    out = {}
    for det in cfg.get("detectors") or []:
        for role, chan in (det.get("hv_channels") or {}).items():
            if isinstance(chan, (list, tuple)) and len(chan) == 2:
                out[(str(chan[0]), str(chan[1]))] = role.lower()
    return out


def flatten(hvs):
    """{(board, channel): volts} from a sub-run's nested hvs map."""
    out = {}
    for board, chans in (hvs or {}).items():
        for chan, v in (chans or {}).items():
            out[(str(board), str(chan))] = v
    return out


def survey(cfg):
    subs = cfg.get("sub_runs") or []
    roles = role_map(cfg)

    per_channel = collections.defaultdict(set)
    settings, wms = set(), set()
    for s in subs:
        flat = flatten(s.get("hvs"))
        for key, v in flat.items():
            per_channel[key].add(v)
        if flat:
            settings.add(tuple(sorted(flat.items())))
        wms.add((s.get("ovr_wrn_hwm"), s.get("ovr_wrn_lwm")))

    varied = {k: len(v) for k, v in per_channel.items() if len(v) > 1}
    by_role = collections.Counter()
    for key, n in varied.items():
        role = roles.get(key, "other")
        by_role[role if role in KNOWN_ROLES else "other"] = max(
            by_role.get(role if role in KNOWN_ROLES else "other", 0), n)

    return {
        "n_sub_runs": len(subs),
        "hv_points": len(settings),          # distinct full HV setpoint maps
        "hv_axis": dict(by_role),            # role -> distinct values it took
        "hv_channels_varied": len(varied),
        "wm_points": len([w for w in wms if w != (None, None)]),
        "roles_seen": sorted({r for r in roles.values()}),
    }


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
    args = cli("find which runs swept an HV setting, from their configs")
    root, out_path = args.root, args.out
    runs, result = select(root, args)
    for run in runs:
        path = os.path.join(root, run, "run_config.json")
        try:
            with open(path) as f:
                cfg = json.load(f)
        except Exception as e:
            result[run] = {"error": f"{type(e).__name__}: {e}"}
            continue
        result[run] = survey(cfg)
    with open(out_path, "w") as f:
        json.dump(result, f)

    scans = {k: v for k, v in result.items() if v.get("hv_axis")}
    print(f"{len(result)} runs, {len(scans)} with a varying HV setpoint")
    axes = collections.Counter()
    for v in scans.values():
        axes["+".join(sorted(v["hv_axis"]))] += 1
    for axis, n in axes.most_common():
        print(f"  {axis:<22} {n}")
    roles = collections.Counter()
    for v in result.values():
        for r in v.get("roles_seen", []):
            roles[r] += 1
    print("roles declared by detectors:", dict(roles))
    wm = sum(1 for v in result.values() if v.get("wm_points", 0) > 1)
    print(f"runs with a varying trigger watermark: {wm}")


if __name__ == "__main__":
    main()
