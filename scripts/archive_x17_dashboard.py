#!/usr/bin/env python3
"""Freeze the live DAQ dashboard into x17/live/, so retiring it loses nothing.

    python3 scripts/archive_x17_dashboard.py            # pull from the live site
    python3 scripts/archive_x17_dashboard.py --from DIR # from files already copied

During data taking, /x17/ was published by `stats_collector.py` on the DAQ
machine: a static page that polled `data.json` every 20 s. This repo did not own
it. Now that the campaign is over, /x17/ becomes the analysis hub in
pages/x17/, and the dashboard moves down to /x17/live/ as a snapshot of its
final state.

Making it static uses the hook the page already has. `stats_collector.py --html`
renders a local preview by inlining a payload as `window.__PREVIEW__`, and the
page's own boot code takes that branch instead of fetching and polling:

    if (window.__PREVIEW__) { render(...); } else { poll(); setInterval(...); }

So the archive is the deployed page with the final `data.json` and `runs.json`
inlined ahead of it. No network, no timer, no stale banner — and no fork of the
page's markup, which would rot the moment anyone touched the original.

Three things are then rewritten, because a snapshot that still claims to be
live is worse than no snapshot:

  * the freshness pill, which would otherwise compute an age from `Date.now()`
    and shout "stale — 6 days old" in red;
  * the banner underneath it, which says the DAQ machine has stopped pushing;
  * the footer line "page refreshes every 20 s".

Run it once, when the publisher on the DAQ machine has been stopped. Running it
again later is harmless but pointless: the inputs no longer change.
"""

import argparse
import json
import pathlib
import re
import shutil
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "x17" / "live"
SRC = "https://dylan-neff.web.cern.ch/x17/"

# The page and the two payloads it fetches, plus the plots it shows. The PNGs
# are referenced relatively, so copying them beside the page is all it takes.
DOCS = ["index.html", "data.json", "runs.json"]
IMAGES = ["progress.png", "ipc_yield.png"]

ARCHIVED_ON = "10 August 2026"

BANNER = (
    "<b>Archived snapshot.</b> This is the live shift dashboard as it stood at "
    "the end of the run on " + ARCHIVED_ON + ". Nothing on it updates any more — "
    'the publisher on the DAQ machine has been stopped. For the campaign '
    'totals and the analyses built on this data, see '
    '<a href="../" style="color:inherit;text-decoration:underline">the X17 hub</a>.'
)

# Runs after the page's own boot code, so it overwrites what render() just put
# in the freshness pill and the banner.
FREEZE = """
<script>
/* Injected by scripts/archive_x17_dashboard.py. The page rendered itself from
   the inlined payload above; these three edits stop it claiming to be live. */
(function () {
  var f = document.getElementById("freshness");
  if (f) {
    f.className = "pill";
    var t = document.getElementById("freshness-text");
    if (t) t.textContent = "archived — final state, %(on)s";
  }
  var b = document.getElementById("banner");
  if (b) { b.className = "banner show"; b.innerHTML = %(banner)s; }
  var s = document.getElementById("stamp");
  if (s && s.parentNode) {
    s.parentNode.innerHTML = s.outerHTML + " \\u00b7 archived copy, no longer updating";
  }
})();
</script>
"""


def fetch(name, src_dir):
    if src_dir:
        return (pathlib.Path(src_dir) / name).read_bytes()
    with urllib.request.urlopen(SRC + name, timeout=30) as r:
        return r.read()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="src_dir", default=None,
                    help="a directory holding the files instead of the live site")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)

    page = fetch("index.html", args.src_dir).decode("utf-8")
    payload = {
        "latest": json.loads(fetch("data.json", args.src_dir))["latest"],
        "runs": json.loads(fetch("runs.json", args.src_dir)),
    }

    if "__PREVIEW__" not in page:
        sys.exit("the dashboard no longer has the __PREVIEW__ hook this script "
                 "relies on — check stats_page/page.html before changing this")

    # data.json also carries `history`, the 24 h live trace. It is all zeros by
    # the time the run has ended, and the page hides that panel when it is
    # empty, so it is deliberately not inlined.
    inline = ("<script>window.__PREVIEW__ = "
              + json.dumps(payload, separators=(",", ":"))
              + ";</script>\n")

    # Ahead of the last </script> block is not good enough: the boot code has to
    # see __PREVIEW__ already set, so this goes before the first <script> that
    # could run it. The page keeps all its logic in one trailing block.
    m = re.search(r"<script>(?!\s*window\.__PREVIEW__)", page)
    if not m:
        sys.exit("could not find a <script> tag to inject ahead of")
    page = page[:m.start()] + inline + page[m.start():]

    freeze = FREEZE % {"on": ARCHIVED_ON, "banner": json.dumps(BANNER)}
    # The dashboard closes neither <body> nor <html> -- it simply ends after its
    # script block -- so appending is the normal path, not the fallback. Doing
    # this as a plain .replace("</body>") failed silently and shipped an archive
    # still flashing "stale, 12 min old" in red.
    if "</body>" in page:
        page = page.replace("</body>", freeze + "</body>", 1)
    else:
        page = page.rstrip() + "\n" + freeze
    # The title should say what this is in a tab full of tabs.
    page = re.sub(r"<title>(.*?)</title>", r"<title>\1 (archived)</title>",
                  page, count=1, flags=re.S)

    for marker in ("window.__PREVIEW__ =", "Archived snapshot", "(archived)"):
        if marker not in page:
            sys.exit(f"injection failed: {marker!r} is not in the output")

    (OUT / "index.html").write_text(page, encoding="utf-8", newline="\n")
    for name in IMAGES:
        (OUT / name).write_bytes(fetch(name, args.src_dir))

    # The two payloads are kept beside the page even though it no longer fetches
    # them -- they are the campaign's final state as the DAQ published it, and
    # runs.json is an input to scripts/freeze_x17_runs.py (beam-off hours per
    # run, which exist nowhere in the EOS archive).
    for name in ("data.json", "runs.json"):
        (OUT / name).write_bytes(fetch(name, args.src_dir))

    total = sum(f.stat().st_size for f in OUT.iterdir() if f.is_file())
    print(f"wrote {OUT.relative_to(ROOT)}/ — "
          f"{len(list(OUT.iterdir()))} files, {total // 1024} kB")
    print("add x17/live/ to PAYLOAD in scripts/deploy-eos.sh if it is not there")


if __name__ == "__main__":
    main()
