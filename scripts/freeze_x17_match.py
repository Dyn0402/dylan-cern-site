#!/usr/bin/env python3
"""Freeze the DREAM<->n_TOF match into data/x17-match.json.

    python3 scripts/freeze_x17_match.py [--records DIR] [--src DIR]

The unit here is a **segment**: one DREAM sub-run crossed with the one n_TOF run
that was taking beam at the same time. A segment is the smallest thing that can
have its own clock fit, because the DREAM timestamp clock wanders about a ppm
from burst to burst and the fit that removes that drift is per bunch, inside a
segment.

Two inputs, and they cover different things on purpose:

  <records>/runs/*/*/ntof_hits/clock_qa.json    one per segment that produced a
                                                file -- the full QA record
  <src>/.../slim_inventory_<date>.csv           every segment ATTEMPTED, so the
                                                failures are here and nowhere
                                                else
  <src>/.../slim_todo_<date>.txt                the segments not yet attempted

Reading only the first would give a page where everything passes, which is the
exact failure mode the campaign write-up warns about: a mis-joined segment
fails its clock fit and writes no file, so QA never sees it. The inventory is
what makes the absent ones visible, and the todo list is what stops "attempted"
being mistaken for "all of it".

`clock_qa.json` carries more than a page can use (per-bunch arrays, per-arm
residual profiles, hit-family breakdowns). Only the fields named below are
emitted, plus two aggregates: the campaign residual histogram, summed bin by
bin, and how each of the 19 checks fared across the fleet.
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
DEFAULT_RECORDS = pathlib.Path("/media/dylan/data/x17/slim_campaign_2026-08-12")

TODO_ROW = re.compile(
    r"^#\s*(\d{6})\s+(\w+)\s+(\d+)\s+([\d.]+)\s+(run_\d+)\s+([\w,]+)")
ARMS = ("A", "B", "C", "D")


def sub_short(name):
    """`stat090_0007` -> `0007`; anything else is left alone.

    The campaign's beam sub-runs are almost all one configuration, so the
    `stat090_` prefix is 8 characters of nothing in every row. run_161's scan
    sub-runs (`dA700rA530_008`) are not, and keep their names.
    """
    return name[8:] if name.startswith("stat090_") else name


def load_records(root):
    """{(dream, sub, ntof): record} from every clock_qa.json under root."""
    out = {}
    for p in sorted(root.rglob("clock_qa.json")):
        d = json.loads(p.read_text())
        s = d["segment"]
        out[(s["dream_run"], s["dream_subrun"], int(s["ntof_run"]))] = d
    return out


def latest(d, pattern):
    hits = sorted(d.glob(pattern))
    if not hits:
        sys.exit(f"no {pattern} under {d}")
    return hits[-1]


def emit(rec, inv):
    """The fields the page uses, from one full clock_qa record."""
    c, m, pb = rec["clock"], rec["match"], rec["perbunch"]
    levels = collections.Counter(x["level"] for x in rec["checks"])
    return {
        "st": "ok",
        "v": rec["verdict"],
        # Named so a reader can go and look: every non-PASS check, with the
        # sentence clock_qa wrote for it. Empty for the great majority.
        "flags": [{"n": x["name"], "l": x["level"], "d": x["detail"]}
                  for x in rec["checks"] if x["level"] != "PASS"],
        "nchk": sum(levels.values()),
        # All nineteen checks, so a segment can be expanded into them rather
        # than only into the ones that failed -- "everything passed" is more
        # convincing when you can see what "everything" was. One letter each,
        # positional against the shared `checks` list; the values ride
        # alongside because the number a check saw is the interesting part.
        "lv": "".join(x["level"][0] for x in rec["checks"]),
        # NOT "cv" -- that is already the cross-validation gap a few lines
        # down, and a dict literal lets the later key win silently.
        "chkv": [round(x["value"], 6) if isinstance(x["value"], (int, float))
                 else None for x in rec["checks"]],
        # The four scintillator arms: how the matched triggers divided between
        # them, and where each one's fitted offset landed.
        #   [n, fraction, mean residual ns, offset ns, offset vs the reference]
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
        "min": inv.get("min"),
        "kind": inv.get("kind"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--records", type=pathlib.Path, default=DEFAULT_RECORDS)
    ap.add_argument("--src", type=pathlib.Path, default=DEFAULT_SRC)
    args = ap.parse_args()
    res = args.src / "ntof_processing" / "campaign_qa" / "results"
    if not args.records.is_dir():
        sys.exit(f"not found: {args.records}")

    recs = load_records(args.records)
    inv_p = latest(res, "slim_inventory_*.csv")
    todo_p = latest(res, "slim_todo_*.txt")
    as_of = re.search(r"(\d{4}-\d{2}-\d{2})", inv_p.name).group(1)

    rows, missing = [], 0
    for r in csv.DictReader(inv_p.open()):
        key = (r["dream_run"], r["sub_run"], int(r["ntof_run"]))
        base = {"d": r["dream_run"], "s": sub_short(r["sub_run"]),
                "n": int(r["ntof_run"]), "kind": r["kind"],
                "min": float(r["overlap_min"] or 0),
                "jb": int(r["joined_bunches"] or 0),
                "je": int(r["joined_events"] or 0)}
        if r["status"] == "OK":
            rec = recs.get(key)
            if rec is None:
                # A shipped segment with no record: the page must not quietly
                # show 169 where the campaign shipped 170.
                missing += 1
                base.update(st="ok", v="NO RECORD", flags=[])
            else:
                base.update(emit(rec, base))
        else:
            base.update(st=("skipped" if r["status"].startswith("SKIPPED")
                            else "failed"), v="", flags=[])
        rows.append(base)

    unnamed = 0
    for line in todo_p.read_text().splitlines():
        m = TODO_ROW.match(line)
        if not m:
            continue
        declared, subs = int(m.group(3)), m.group(6).split(",")
        each = round(float(m.group(4)) / declared, 1)
        # The todo table prints one DREAM run per row, so an n_TOF run that
        # straddles two of them names only the majority side's sub-runs and its
        # count comes out short. Carry the missing ones as segments of an
        # unnamed sub-run rather than losing them: the count is the number that
        # has to be slimmed, and it is the number the campaign quotes.
        for sub in subs + ["?"] * max(0, declared - len(subs)):
            unnamed += sub == "?"
            rows.append({"d": m.group(5), "s": sub_short(sub),
                         "n": int(m.group(1)), "st": "pending", "v": "",
                         "flags": [], "kind": "", "src": m.group(2),
                         "min": each})

    # Campaign order, and it has to be imposed rather than inherited: the
    # inventory is sorted by DREAM run as TEXT, which puts run_79 after run_150,
    # and the pending segments arrive in a separate block at the end. The strip
    # plot's x axis is this order and calls itself the campaign timeline, so it
    # has to actually be one.
    rows.sort(key=lambda r: (int(r["d"].split("_")[1]), r["s"], r["n"]))

    # Campaign residual histogram: the same 50 bins in every record, so they
    # add. This is the plot that shows the match is a 6 ns peak and not a
    # window full of accidentals.
    h0 = next(iter(recs.values()))["match"]["residual_hist"]
    total = [0] * len(h0["counts"])
    for rec in recs.values():
        h = rec["match"]["residual_hist"]
        if (h["lo"], h["hi"], h["bin"]) != (h0["lo"], h0["hi"], h0["bin"]):
            sys.exit("residual histograms do not share a binning")
        for i, v in enumerate(h["counts"]):
            total[i] += v

    # How each check fared across the fleet, in the order clock_qa runs them.
    order, checks = [], collections.defaultdict(collections.Counter)
    for rec in recs.values():
        for x in rec["checks"]:
            if x["name"] not in checks:
                order.append(x["name"])
            checks[x["name"]][x["level"]] += 1

    ok = [r for r in rows if r["st"] == "ok" and r.get("eff")]
    out = {
        "as_of": as_of,
        "source": {"records": args.records.name, "inventory": inv_p.name,
                   "todo": todo_p.name},
        "hist": {"lo": h0["lo"], "hi": h0["hi"], "bin": h0["bin"],
                 "counts": total},
        "checks": [{"n": n, **checks[n]} for n in order],
        "accept_ns": next(iter(recs.values()))["clock"]["accept_ns"],
        "slim_ns": next(iter(recs.values()))["clock"]["slim_ns"],
        "eff_median": round(statistics.median(r["eff"] for r in ok), 5),
        "segs": rows,
    }
    # The per-segment check letters and values are positional against the
    # shared `checks` list, and nothing else would notice if they stopped
    # lining up -- a duplicate key in emit()'s dict literal silently drops one
    # of the two, which is exactly how `chkv` came to be called `cv` once.
    for r in rows:
        if r["st"] == "ok" and "lv" in r:
            if not (len(r["lv"]) == len(r["chkv"]) == len(out["checks"])):
                sys.exit(f"{r['d']}/{r['s']}: {len(r['lv'])} levels and "
                         f"{len(r['chkv'])} values against "
                         f"{len(out['checks'])} checks")

    dest = ROOT / "data" / "x17-match.json"
    dest.write_text(json.dumps(out, separators=(",", ":")))

    st = collections.Counter(r["st"] for r in rows)
    v = collections.Counter(r["v"] for r in rows if r["st"] == "ok")
    print(f"{dest.relative_to(ROOT)}  {dest.stat().st_size/1000:.0f} kB  "
          f"as of {as_of}")
    print(f"{len(rows)} segments {dict(st)}; verdicts {dict(v)}")
    if missing:
        print(f"!! {missing} shipped segment(s) have no clock_qa.json record")
    if unnamed:
        print(f"   {unnamed} pending segment(s) sit on an n_TOF run that "
              f"straddles two DREAM runs; sub-run not named in the todo table")
    effs = sorted(r["eff"] for r in ok)
    print(f"efficiency n={len(effs)} median {out['eff_median']:.2%} "
          f"range {effs[0]:.2%}-{effs[-1]:.2%}")
    print(f"residuals: {sum(total):,} matched hits in +-{h0['hi']:.0f} ns")
    for c in out["checks"]:
        if c.get("PASS", 0) != len(recs):
            print(f"  check not unanimous: {c['n']} {dict(c)}")


if __name__ == "__main__":
    main()
