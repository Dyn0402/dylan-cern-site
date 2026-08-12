#!/usr/bin/env python3
"""Walk the campaign's run tree on EOS and emit one JSON record per run.

Runs on lxplus (EOS is a FUSE mount there). One `find` per run directory, which
is the expensive part -- about 3 s per run, so ~10 min for the campaign.

    python3 survey_runs.py /eos/experiment/ntof/data/x17/july_beam/runs out.json

What it records per sub-run, and why:

  raw       Mx17_<tag>_datrun_*.fdf   one per (acquisition, FEU) -- what the DAQ wrote
  decoded   decoded_root/*.root       one per (file_num, FEU) -- must match raw
  hits      hits_root/*_hits.root     one per (file_num, FEU) -- must match decoded
  combined  combined_hits_root/*.root one per file_num       -- must match n_file_nums
  ped       Mx17_pedestals_*           the pedestal/threshold run, in two shapes:
                                       every sub-run has *_pedthr_* (.fdf/.prg),
                                       and the early runs also wrote the pedestal
                                       acquisition itself as pedestals_datrun_*.fdf

The second shape is a trap. Those files are `datrun` by name but are pedestals,
not physics; counting them as raw made every early run read "50 % decoded" when
nothing was missing at all.

"Acquisition" is (timestamp, file number), not file number alone: a sub-run that
was stopped and restarted has two acquisitions sharing file number 000, and each
gets its own combined product. Keying on the file number alone made those runs
look like they had produced twice as many combined files as they should have.

So the completeness checks are exact rather than heuristic: every raw file has a
decode, every decode has hits, and every file number has a combined product.
A sub-run missing a FEU shows up as n_feus < 8 rather than as a bad total.
"""

import argparse
import json
import os
import re
import subprocess
import sys

# Mx17_<subrun-tag>_<kind>_<yymmdd>_<HH>H<MM>_<file_num>_<tail>
#
# <tail> is what distinguishes the products of one acquisition: "01.fdf" (raw,
# per FEU), "01.root" (decoded), "01_hits.root", "feu-combined_hits.root". The
# FEU number is therefore parsed out of the tail rather than matched here --
# combined products have no FEU, being the combination of all of them.
#
# The tag is optional because pedestal files carry none ("Mx17_pedestals_pedthr_
# ..."); requiring it filed all 24 pedestal and threshold files per sub-run
# under "other".
FILE_RE = re.compile(r"^Mx17_(?:(?P<tag>.+?)_)?(?P<kind>datrun|pedestals_pedthr)_"
                     r"(?P<date>\d{6})_(?P<time>\d+H\d+)_"
                     r"(?P<num>\d+)_(?P<tail>.*)$")

FEU_RE = re.compile(r"^(\d+)")

# The early runs took their pedestals as an ordinary acquisition, so the files
# are named `datrun` but are pedestals -- and they are carried all the way
# through decoding and hit finding. They are pedestal material in EVERY product
# directory, not just the raw one. Counting them as physics made those runs read
# "50 % decoded" (raw inflated) and then, once raw was fixed but the products
# were not, "200 % decoded".
PEDESTAL_TAG = "pedestals"


def parse(name):
    """(is_pedestal, acquisition key, FEU) for a product file, or None."""
    m = FILE_RE.match(name)
    if not m:
        return None
    feu = FEU_RE.match(m.group("tail"))
    return (m.group("kind") == "pedestals_pedthr" or m.group("tag") == PEDESTAL_TAG,
            (m.group("date"), m.group("time"), m.group("num")),
            feu.group(1) if feu else None)

CONFIG_KEYS = ["run_name", "start_time", "gas", "beam_type", "target_type",
               "beam_filter", "trigger", "n1081b_scan", "process_on_fly",
               "resume", "save_fdfs"]


def find(path):
    """(relative path, size, mtime) for everything under a run directory."""
    out = subprocess.run(
        ["find", path, "-mindepth", "1", "-maxdepth", "3",
         "-type", "f", "-printf", "%P\t%s\t%T@\n"],
        capture_output=True, text=True, timeout=900)
    for line in out.stdout.splitlines():
        rel, size, mtime = line.split("\t")
        yield rel, int(size), float(mtime)


RUN_TIME_RE = re.compile(r"Run Time:\s*([\d.]+).*?Run Start Time:\s*([\d.]+)", re.S)


def read_run_time(path):
    """(start epoch, seconds) from a sub-run's run_time.txt, or (None, None)."""
    try:
        with open(path) as f:
            m = RUN_TIME_RE.search(f.read())
        return (float(m.group(2)), float(m.group(1))) if m else (None, None)
    except Exception:
        return (None, None)


def blank():
    return {"raw": 0, "raw_bytes": 0, "decoded": 0, "decoded_bytes": 0,
            "tmp": 0,
            "hits": 0, "hits_bytes": 0, "combined": 0, "combined_bytes": 0,
            "ped_files": 0, "other": 0, "bytes": 0,
            "ped_products": 0, "file_keys": set(), "feus": set(),
            "acq_bytes": {}, "empty_acqs": 0, "empty_acq_files": 0,
            "t_first": None, "t_last": None, "hv_monitor": False,
            "t_start": None, "seconds": None,
            "n1081b_config": False, "run_time_txt": False}


def survey_run(run_dir):
    subs = {}
    cfg, cfg_err = {}, None
    try:
        with open(os.path.join(run_dir, "run_config.json")) as f:
            raw_cfg = json.load(f)
        cfg = {k: raw_cfg.get(k) for k in CONFIG_KEYS}
        dd = raw_cfg.get("dream_daq_info") or {}
        cfg["dream_config"] = os.path.basename(dd.get("daq_config_template_path") or "")
    except Exception as e:                      # a run with no config is itself QA
        cfg_err = f"{type(e).__name__}: {e}"

    for rel, size, mtime in find(run_dir):
        parts = rel.split("/")
        if len(parts) == 1:
            continue                            # run-level file (log, config)
        sub = parts[0]
        s = subs.setdefault(sub, blank())
        s["bytes"] += size
        s["t_first"] = mtime if s["t_first"] is None else min(s["t_first"], mtime)
        s["t_last"] = mtime if s["t_last"] is None else max(s["t_last"], mtime)

        name = parts[-1]
        inner = parts[1] if len(parts) == 3 else ""

        # Half-written products, left behind by an interrupted merge:
        #   .Mx17_run2_..._feu-combined_hits.root.5pxp5V
        # `ls` hides them and `find` does not, so they were being counted as
        # products -- run_2/run2 read "9 combined for 2 acquisitions" off
        # seven of these, and the page reported a run as not fully processed
        # on the strength of it. A dot-file is never a product. They are
        # counted separately rather than ignored, because they are junk on EOS
        # and somebody should know they are there.
        if name.startswith("."):
            s["tmp"] += 1
            continue

        if inner == "":
            if name == "hv_monitor.csv":
                s["hv_monitor"] = True
            elif name == "n1081b_config.json":
                s["n1081b_config"] = True
            continue

        p = parse(name)
        if inner in ("decoded_root", "hits_root", "combined_hits_root"):
            key = {"decoded_root": "decoded", "hits_root": "hits",
                   "combined_hits_root": "combined"}[inner]
            if p and p[0]:
                s["ped_products"] += 1      # a decoded/hit pedestal acquisition
            else:
                s[key] += 1
                s[key + "_bytes"] += size
        elif inner == "raw_daq_data":
            if name == "run_time.txt":
                s["run_time_txt"] = True
                # The only record of when a sub-run actually ran, and the only
                # one that exists for run_1..66 -- those predate the statistics
                # ledger, which was created after they left the DAQ disk. The
                # find() mtimes are when EOS took the copy, not when the DAQ
                # took the data, and must never be used for the second.
                s["t_start"], s["seconds"] = read_run_time(
                    os.path.join(run_dir, sub, inner, name))
            elif p and name.endswith(".fdf") and not p[0]:
                s["raw"] += 1
                s["raw_bytes"] += size
                s["file_keys"].add(p[1])
                a = s["acq_bytes"].setdefault(p[1], [0, 0])
                a[0] += 1
                a[1] += size
                if p[2]:
                    s["feus"].add(p[2])
            elif p and p[0]:
                s["ped_files"] += 1
            else:
                s["other"] += 1

    for s in subs.values():
        # An acquisition whose every FDF is 0 bytes holds no data, so there is
        # nothing to decode and its absent products are not a processing gap.
        # Two ways this happens, both benign and both confirmed on EOS:
        #
        #   * the DAQ opened a file-roll segment at the boundary and the run
        #     ended before anything was written to it -- the trailing segment
        #     of a stat090 sub-run, whose other twelve are ~200 MB each;
        #   * an acquisition ran its full length and saw zero triggers
        #     (IntRate 0.00 Hz), which is a quiet detector, not a lost file.
        #
        # Counting them made eight sub-runs across seven runs read as "one
        # acquisition never decoded" on every survey. They are dropped from the
        # raw and acquisition counts and reported separately, because an empty
        # raw file is worth knowing about even though it is not a fault.
        empty = [k for k, (n, b) in s["acq_bytes"].items() if b == 0]
        for k in empty:
            s["empty_acqs"] += 1
            s["empty_acq_files"] += s["acq_bytes"][k][0]
            s["raw"] -= s["acq_bytes"][k][0]
            s["file_keys"].discard(k)
        s["n_file_nums"] = len(s["file_keys"])   # acquisitions, see the docstring
        s["n_feus"] = len(s["feus"])
        s["feus"] = sorted(s["feus"])
        del s["file_keys"], s["acq_bytes"]

    return {"config": cfg, "config_error": cfg_err,
            "subruns": {k: subs[k] for k in sorted(subs)}}


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
    args = cli("walk the EOS run tree and count every product per sub-run")
    root, out_path = args.root, args.out
    runs, result = select(root, args)
    for i, run in enumerate(runs, 1):
        result[run] = survey_run(os.path.join(root, run))
        n = len(result[run]["subruns"])
        print(f"[{i}/{len(runs)}] {run}: {n} sub-runs", flush=True)
        with open(out_path, "w") as f:          # checkpoint every run
            json.dump(result, f)
    print(f"done — {len(runs)} run(s) walked, {len(result)} in {out_path}")


if __name__ == "__main__":
    main()
