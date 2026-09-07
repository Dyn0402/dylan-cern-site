#!/usr/bin/env python3
"""Update the X17 preliminary analysis board from anywhere on this machine.

    python3 /path/to/dylan-cern-site/scripts/x17_board.py log "Froze the sample"
    python3 .../x17_board.py stage recon --status done
    python3 .../x17_board.py question "One flash veto, or one per chamber?"
    python3 .../x17_board.py question --resolve "flash veto" --answer "Per chamber."
    python3 .../x17_board.py defer "Per-channel gain" --why "..." --unblock "..."
    python3 .../x17_board.py output "Frozen sample" --href ../notes/x.html --desc "..."
    python3 .../x17_board.py show

The board is <REPO>/pages/x17/analysis.html -- an ordinary hand-written
fragment, and this script edits it in place rather than rendering it from data.
That is deliberate. The page has to stay something a person (or an agent in
another repo) can open and rewrite freely: add a section, restructure the
pipeline, paste a table in. A JSON schema would buy consistency and cost
exactly the freedom the page is for.

So this covers only the repetitive parts -- the entries you add ten times a day
and would otherwise hand-format. Anything structural: edit the HTML.

WHERE IT WRITES. Each managed list is bracketed by marker comments in the
fragment:

    <!-- board:log:start -->  ...  <!-- board:log:end -->
    <!-- board:questions:start -->  ...
    <!-- board:deferred:start -->   ...
    <!-- board:outputs:start -->    ...

New entries go in at the TOP of log and outputs (newest first) and at the
BOTTOM of questions and deferred (they read as an accumulating list). The
markers are the only thing this script depends on; everything between them can
be reformatted by hand and it will still work, as long as the markers survive.

It rebuilds the site afterwards. Nothing leaves the machine unless you pass
--deploy; the command to do it by hand is printed either way.
"""

import argparse
import datetime as dt
import html
import pathlib
import re
import subprocess
import sys

# A Windows console is cp1252 by default, and the board's own text is full of
# em dashes and "e+e-" superscripts — so `show` would die on the very content
# it exists to print. Files are always read and written as UTF-8 explicitly;
# this is only about the terminal.
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

REPO = pathlib.Path(__file__).resolve().parent.parent
BOARD = REPO / "pages" / "x17" / "analysis.html"
URL = "https://dylan-neff.web.cern.ch/x17/analysis.html"

STATUSES = ("todo", "active", "done", "blocked")


# --- the marker machinery ---------------------------------------------------

def read_board():
    if not BOARD.is_file():
        sys.exit(f"no board at {BOARD}\n"
                 f"Is this the right repo? Expected {BOARD.relative_to(REPO)}.")
    return BOARD.read_text(encoding="utf-8")


def markers(text, name):
    """(start_index_after_open, index_of_close) for a board:<name> region."""
    open_m = f"<!-- board:{name}:start -->"
    close_m = f"<!-- board:{name}:end -->"
    a, b = text.find(open_m), text.find(close_m)
    if a < 0 or b < 0 or b < a:
        sys.exit(f"could not find the {name} markers in "
                 f"{BOARD.relative_to(REPO)}.\n"
                 f"Expected {open_m} ... {close_m}. If the section was "
                 f"rewritten by hand, put the two comments back around it.")
    return a + len(open_m), b


def region_indent(region):
    """The region's own indent level, taken from its closing marker's line."""
    m = re.search(r"\n([ \t]*)$", region)
    return m.group(1) if m else "      "


def insert(text, name, block, *, at_top=True):
    """Splice an entry into a marked region, keeping the file's indentation."""
    a, b = markers(text, name)
    region = text[a:b]
    pad = region_indent(region)
    body = "\n".join(pad + line if line.strip() else line
                     for line in block.strip("\n").split("\n"))
    # Existing entries keep the indentation they already have -- this only ever
    # adds a line, so a region someone reformatted by hand stays reformatted.
    # rstrip as well as strip("\n"): the region ends "\n<pad>" before the close
    # marker, and keeping that tail would leave a blank line behind on every
    # insert -- one per entry, forever.
    kept = region.strip("\n").rstrip()
    parts = ([body, kept] if at_top else [kept, body]) if kept else [body]
    return text[:a] + "\n" + "\n".join(parts) + "\n" + pad + text[b:]


def write_board(text, *, deploy, what):
    BOARD.write_text(text, encoding="utf-8")
    print(f"{what} -> {BOARD.relative_to(REPO)}", flush=True)
    subprocess.run([sys.executable, "scripts/build.py"], cwd=REPO, check=True)
    if deploy:
        subprocess.run(["./scripts/deploy-eos.sh"], cwd=REPO, check=True)
        print(f"\nlive at {URL}")
    else:
        print(f"\nBuilt, not deployed. To publish:\n"
              f"    cd {REPO} && ./scripts/deploy-eos.sh\n"
              f"It will then be at {URL}")


def esc(s):
    """Entry text is prose typed on a command line, so escape it. Callers that
    genuinely want markup (a link inside a log entry) pass --html."""
    return html.escape(s, quote=False)


def today(arg=None):
    if arg:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", arg):
            sys.exit(f"bad date {arg!r}: want YYYY-MM-DD")
        return arg
    return dt.date.today().isoformat()


# --- the commands -----------------------------------------------------------

def cmd_log(args):
    text = read_board()
    body = args.text if args.html else esc(args.text)
    if args.link:
        label = esc(args.link_text or args.link)
        body += f' <a href="{html.escape(args.link, quote=True)}">{label}</a>'
    lines = ['<li class="log-entry">',
             f'  <p class="log-when">{today(args.date)}</p>',
             f'  <p class="log-what">{body}</p>']
    if args.tag:
        tags = " · ".join(esc(t.strip()) for t in args.tag.split(",") if t.strip())
        lines.append(f'  <p class="log-tags">{tags}</p>')
    lines.append("</li>")
    write_board(insert(text, "log", "\n".join(lines), at_top=True),
                deploy=args.deploy, what="log entry added")


def cmd_question(args):
    text = read_board()

    if args.resolve:
        needle = args.resolve.lower()
        if not args.answer:
            sys.exit("--resolve needs --answer: the answer is the useful part")
        a, b = markers(text, "questions")
        region = text[a:b]
        items = list(re.finditer(r'<li class="q"[^>]*>.*?</li>', region, re.S))
        hits = [m for m in items if needle in re.sub(r"<[^>]+>", " ", m.group(0)).lower()]
        if not hits:
            sys.exit(f"no open question matching {args.resolve!r}. "
                     f"Run `show` to see them.")
        if len(hits) > 1:
            sys.exit(f"{args.resolve!r} matches {len(hits)} questions; "
                     f"be more specific.")
        item = hits[0].group(0)
        if 'data-status="resolved"' in item:
            sys.exit("that question is already resolved")

        # Indent the answer to match the item it is being added to, rather than
        # to the region: a hand-written entry may sit at any depth.
        line_start = region.rfind("\n", 0, hits[0].start()) + 1
        pad = region[line_start:hits[0].start()]

        new = item.replace('data-status="open"', 'data-status="resolved"', 1)
        answer = args.answer if args.html else esc(args.answer)
        new = new.replace(
            "</li>",
            f'  <p class="q-answer"><b>Resolved {today(args.date)}:</b> '
            f'{answer}</p>\n{pad}</li>', 1)
        region = region[:hits[0].start()] + new + region[hits[0].end():]
        write_board(text[:a] + region + text[b:],
                    deploy=args.deploy, what="question resolved")
        return

    if not args.text:
        sys.exit("give the question text, or use --resolve")
    body = args.text if args.html else esc(args.text)
    block = ('<li class="q" data-status="open">\n'
             f'  <p class="q-text">{body}</p>\n'
             f'  <p class="q-meta">opened {today(args.date)}</p>\n'
             '</li>')
    write_board(insert(text, "questions", block, at_top=False),
                deploy=args.deploy, what="question added")


def cmd_defer(args):
    if not (args.why and args.unblock):
        sys.exit("a deferred item needs --why and --unblock.\n"
                 "That is the whole point of the section: without both, "
                 "'we skipped it' reads as 'we forgot it'.")
    text = read_board()
    title, why, unblock = (esc(args.title), esc(args.why), esc(args.unblock))
    block = (f'<li class="staged"><span class="t">{title}'
             f'<span class="chip">deferred</span></span>\n'
             f'  <span class="d"><b>Why:</b> {why} '
             f'<b>Unblocked by:</b> {unblock}</span></li>')
    write_board(insert(text, "deferred", block, at_top=False),
                deploy=args.deploy, what="deferred item added")


def cmd_output(args):
    text = read_board()
    title, desc = esc(args.title), esc(args.desc or "")
    if args.href:
        href = html.escape(args.href, quote=True)
        row = (f'<li><a class="t" href="{href}">{title}'
               f'<span class="chip live">live</span></a>\n'
               f'  <span class="d">{desc}</span></li>')
    else:
        # No link yet: the same staged convention the hub uses, so nothing on
        # the page is ever an anchor that 404s.
        row = (f'<li class="staged"><span class="t">{title}'
               f'<span class="chip">to publish</span></span>\n'
               f'  <span class="d">{desc}</span></li>')
    write_board(insert(text, "outputs", row, at_top=True),
                deploy=args.deploy, what="output row added")


def cmd_stage(args):
    text = read_board()
    pat = re.compile(r'(<li class="stage" data-stage="'
                     + re.escape(args.slug) + r'" data-status=")([a-z]+)(")')
    m = pat.search(text)
    if not m:
        have = re.findall(r'data-stage="([^"]+)"', text)
        sys.exit(f"no stage {args.slug!r}. The board has: {', '.join(have)}")
    if args.status not in STATUSES:
        sys.exit(f"bad status {args.status!r}: one of {', '.join(STATUSES)}")
    was = m.group(2)
    text = text[:m.start()] + m.group(1) + args.status + m.group(3) + text[m.end():]
    what = f"stage {args.slug}: {was} -> {args.status}"

    # Flipping a stage is exactly when something is worth saying about it, so
    # --note writes the log entry in the same commit rather than as a second
    # command that is easy to forget.
    if args.note:
        body = esc(args.note)
        block = ('<li class="log-entry">\n'
                 f'  <p class="log-when">{today(args.date)}</p>\n'
                 f'  <p class="log-what">{body}</p>\n'
                 f'  <p class="log-tags">stage: {esc(args.slug)}</p>\n'
                 '</li>')
        text = insert(text, "log", block, at_top=True)
        what += " (+ log entry)"
    write_board(text, deploy=args.deploy, what=what)


def cmd_show(args):
    text = read_board()
    strip = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()

    print(f"{BOARD.relative_to(REPO)}  ->  {URL}\n")
    print("PIPELINE")
    for m in re.finditer(r'<li class="stage" data-stage="([^"]+)" '
                         r'data-status="([^"]+)">\s*<div class="stage-head">\s*'
                         r'<h3>(.*?)</h3>', text, re.S):
        slug, status, title = m.group(1), m.group(2), strip(m.group(3))
        print(f"  [{status:<7}] {slug:<12} {title}")

    a, b = markers(text, "questions")
    print("\nQUESTIONS")
    for m in re.finditer(r'<li class="q"[^>]*data-status="([^"]+)".*?</li>',
                         text[a:b], re.S):
        body = strip(m.group(0))
        print(f"  [{m.group(1):<8}] {body[:110]}")

    a, b = markers(text, "log")
    print("\nLOG (newest first)")
    for m in list(re.finditer(r'<li class="log-entry">.*?</li>',
                              text[a:b], re.S))[:args.n]:
        print(f"  {strip(m.group(0))[:130]}")

    a, b = markers(text, "deferred")
    n_def = len(re.findall(r"<li", text[a:b]))
    print(f"\nDEFERRED: {n_def} item(s)")
    return 0


# --- wiring -----------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--date", help="YYYY-MM-DD, defaults to today")
        p.add_argument("--html", action="store_true",
                       help="the text is already HTML; do not escape it")
        p.add_argument("--deploy", action="store_true",
                       help="also push to EOS -- this publishes it")
        return p

    p = common(sub.add_parser("log", help="add a dated log entry"))
    p.add_argument("text")
    p.add_argument("--tag", help="comma-separated, shown under the entry")
    p.add_argument("--link", help="URL to append to the entry")
    p.add_argument("--link-text", help="label for --link; defaults to the URL")
    p.set_defaults(fn=cmd_log)

    p = common(sub.add_parser("question", help="add or resolve an open question"))
    p.add_argument("text", nargs="?")
    p.add_argument("--resolve", metavar="SUBSTRING",
                   help="resolve the one open question matching this text")
    p.add_argument("--answer", help="the answer, required with --resolve")
    p.set_defaults(fn=cmd_question)

    p = common(sub.add_parser("defer", help="record something as out of scope"))
    p.add_argument("title")
    # Both are required, but not by argparse: cmd_defer's own message says why
    # a deferral without them is not worth recording, and that is the thing
    # worth reading when you have just been stopped.
    p.add_argument("--why", help="why it is not being done now")
    p.add_argument("--unblock", help="what would unblock it")
    p.set_defaults(fn=cmd_defer)

    p = common(sub.add_parser("output", help="add a note or child page it produced"))
    p.add_argument("title")
    p.add_argument("--href", help="link; omit for a written-but-unpublished row")
    p.add_argument("--desc", help="one line under the title")
    p.set_defaults(fn=cmd_output)

    p = common(sub.add_parser("stage", help="change a pipeline stage's status"))
    p.add_argument("slug", help="the stage's data-stage value; `show` lists them")
    p.add_argument("--status", required=True, choices=STATUSES)
    p.add_argument("--note", help="also add a log entry saying why")
    p.set_defaults(fn=cmd_stage)

    p = sub.add_parser("show", help="print the board's current state")
    p.add_argument("-n", type=int, default=8, help="log entries to print")
    p.set_defaults(fn=cmd_show)

    args = ap.parse_args()
    return args.fn(args) or 0


if __name__ == "__main__":
    sys.exit(main())
