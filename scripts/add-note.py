#!/usr/bin/env python3
"""Publish an HTML note to the site from anywhere on this machine.

    python3 /path/to/dylan-cern-site/scripts/add-note.py NOTE.html
    python3 .../add-note.py NOTE.html --slug beam-optics --date 2026-08-07
    cat note.html | python3 .../add-note.py - --slug beam-optics

It copies the file into pages/notes/, stamps the listing metadata, and rebuilds.
Nothing leaves the machine: deploying is a separate, explicit step, because the
site is public and that push is not something to do as a side effect. The
command to run is printed at the end (or pass --deploy).

The input is normally a complete standalone document -- the kind that arrives
with its own inline styling. It is copied through untouched; the build injects
only the noindex tag, the manifest link and the service-worker registration.
A fragment with front matter (see README) works too and gets the site chrome.

Metadata for the listing is taken from --title/--date/--summary, else from an
existing <!--note--> block, else from <title> and <meta name="description">.
Replacing a note (--force) keeps the date it was first published under, so
fixing a typo does not reorder the listing; pass --date to move it.
"""

import argparse
import datetime as dt
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
NOTES = REPO / "pages" / "notes"
SITE = "https://dylan-neff.web.cern.ch"

sys.path.insert(0, str(REPO / "scripts"))
from build import (DESC_TAG, NOTE_META, TITLE_TAG,  # noqa: E402
                   is_standalone, parse_meta_lines)

SLUG_OK = re.compile(r"\A[a-z0-9][a-z0-9-]*\Z")


def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "note"


def published_date(dest):
    """The date this note already carries, if it is being replaced."""
    if not dest.is_file():
        return None
    m = NOTE_META.match(dest.read_text(encoding="utf-8"))
    return parse_meta_lines(m.group(1), {}).get("date") if m else None


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="HTML file to publish, or - for stdin")
    ap.add_argument("--slug", help="URL name; defaults to the filename")
    ap.add_argument("--title", help="listing title")
    ap.add_argument("--summary", help="one line for the listing")
    ap.add_argument("--tags", help="comma-separated topics; the first one is "
                                   "the section the note is filed under")
    ap.add_argument("--date", help="YYYY-MM-DD, defaults to today")
    ap.add_argument("--force", action="store_true",
                    help="overwrite a note that already exists")
    ap.add_argument("--deploy", action="store_true",
                    help="also push to EOS -- this publishes it")
    args = ap.parse_args()

    if args.source == "-":
        if not args.slug:
            sys.exit("reading from stdin needs --slug")
        text = sys.stdin.read()
        slug = args.slug
    else:
        src = pathlib.Path(args.source)
        if not src.is_file():
            sys.exit(f"no such file: {src}")
        text = src.read_text(encoding="utf-8")
        slug = args.slug or slugify(src.stem)

    if not SLUG_OK.match(slug):
        sys.exit(f"bad slug {slug!r}: use lowercase letters, digits and dashes")
    if slug == "index":
        sys.exit("'index' is the generated listing; pick another slug")

    dest = NOTES / f"{slug}.html"
    if dest.exists() and not args.force:
        sys.exit(f"{dest.relative_to(REPO)} already exists; --force to replace")

    if is_standalone(text):
        meta = {}
        m = NOTE_META.match(text)
        if m:
            parse_meta_lines(m.group(1), meta)
            text = text[m.end():].lstrip("\n")

        if args.title:
            meta["title"] = args.title
        elif "title" not in meta:
            t = TITLE_TAG.search(text)
            if t:
                meta["title"] = t.group(1).strip()

        if args.summary:
            meta["summary"] = args.summary
        elif "summary" not in meta:
            d = DESC_TAG.search(text)
            if d:
                meta["summary"] = d.group(1).strip()

        if args.tags:
            meta["tags"] = args.tags

        # The date is a publication date, so it sticks: replacing a note to fix
        # a typo must not reorder the listing. A re-export carries no <!--note-->
        # block, so fall back to the one already published before using today.
        meta["date"] = (args.date or meta.get("date") or published_date(dest)
                        or dt.date.today().isoformat())

        block = "<!--note\n" + "".join(
            f"{k}: {v}\n" for k, v in meta.items() if v) + "-->\n"
        text = block + text
    else:
        # A fragment carries its own front matter and build.py validates it, so
        # leave the text alone; just flag what would surprise you later.
        fm = text.split("---\n", 2)[1] if text.startswith("---\n") else ""
        if "date:" not in fm:
            print("warning: fragment has no 'date:' — it will sort last",
                  file=sys.stderr)
        if args.title or args.summary or args.date or args.tags:
            print("warning: --title/--summary/--date/--tags are ignored for a "
                  "fragment; edit its front matter instead", file=sys.stderr)

    NOTES.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8", newline="\n")
    # flush: the subprocess writes to the same stdout, and would otherwise
    # land ahead of everything buffered here.
    print(f"wrote {dest.relative_to(REPO)}", flush=True)

    subprocess.run([sys.executable, "scripts/build.py"], cwd=REPO, check=True)

    url = f"{SITE}/notes/{slug}.html"
    if args.deploy:
        subprocess.run(["./scripts/deploy-eos.sh"], cwd=REPO, check=True)
        print(f"\nlive at {url}")
    else:
        print(f"\nBuilt, not deployed. To publish:\n"
              f"    cd {REPO} && ./scripts/deploy-eos.sh\n"
              f"It will then be at {url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
