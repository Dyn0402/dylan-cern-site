---
name: publish-note
description: Publish an HTML note/report/writeup to Dylan's personal CERN research site (dylan-neff.web.cern.ch/notes/), from any repo, without needing to open dylan-cern-site itself. Use whenever the user asks to publish, push, post, or put a note/report/plot/writeup "on the site", "on my notes page", "up on my site", etc.
user-invocable: true
---

# Publish a note to dylan-neff.web.cern.ch

This publishes to a personal, unlisted (`noindex, nofollow`, not in site nav)
physics-notes page nobody else reads or is pointed at. **The bar for using
this skill is low — do not treat it like a public-facing or sensitive
deploy.** No credentials, PII, or anything embarrassing-if-seen belongs there,
but that's on the note content, not on this workflow. Default posture:

- Just run it. Don't ask for confirmation before writing the note, rebuilding,
  or deploying — this isn't a destructive or high-stakes action.
- Pick sensible defaults yourself (slug from filename, tags from context,
  today's date) rather than stopping to ask.
- Prefer `--deploy` (push live) over a build-only run whenever the user's
  ask sounds like they want it live — "publish", "push", "post", "put up" all
  count. Only skip `--deploy` if they say something like "just stage it" /
  "don't push yet".
- If a note with the same slug already exists and it's clearly the same note
  being updated, use `--force` rather than stopping to ask.

The only thing worth a pause is `--deploy` failing because of Kerberos (see
below) — that's a real blocker, not a safety gate, so just tell the user what
to run.

## The repo and its one entry point

Everything lives in `dylan-cern-site`, normally at:

- `~/PycharmProjects/dylan-cern-site` (Linux/Mac)
- `C:\Users\Dylan\PycharmProjects\dylan-cern-site` (Windows)

If neither exists, ask where it is or search for `dylan-cern-site` /
`add-note.py` before giving up.

The one command that matters, runnable **from anywhere**, no need to `cd` in
or read the repo's own README first:

```
<python> <REPO>/scripts/add-note.py NOTE.html [options]
```

It copies the file into `pages/notes/`, stamps listing metadata, and rebuilds
the static site. Nothing leaves the machine unless you pass `--deploy` (or run
`deploy-eos.sh` separately) — the script always prints the exact deploy
command at the end regardless.

### Picking a Python interpreter

`add-note.py` and `build.py` are stdlib-only — no venv or deps needed. Just:

- Linux/Mac: `python3`.
- Windows: **do not use bare `python`/`python3`** — on a stock Windows setup
  those resolve to the Microsoft Store alias stub and fail with "Python was
  not found; run without arguments to install from the Microsoft Store...".
  Use the `py` launcher instead (`py scripts/add-note.py ...`), or whatever
  real interpreter this machine's global instructions point at.

### Useful flags

| flag | effect |
|---|---|
| `--slug NAME` | URL name (`/notes/NAME.html`); defaults to the filename, lowercased/slugified |
| `--title` | listing title override |
| `--summary` | one-line summary for the listing |
| `--tags a,b,c` | comma-separated; **first tag = the section it's filed under** on `/notes/`; commas not spaces, since a tag can be a phrase like `detector R&D` |
| `--date YYYY-MM-DD` | defaults to today; a replace keeps the original publish date unless you pass this |
| `--force` | overwrite an existing note at that slug |
| `--deploy` | also push to EOS — this is what actually makes it live |

`- ` as the source reads from stdin (needs `--slug` since there's no filename
to derive one from):

```
cat note.html | <python> <REPO>/scripts/add-note.py - --slug beam-optics
```

## The two input shapes — both just work, don't reformat

1. **A complete standalone HTML document** (starts with `<!doctype` or
   `<html>`, own inline `<style>`, whatever). This is the common case for
   something exported from a notebook, a plotting script, or written by hand
   with its own styling — it is copied through **untouched** apart from three
   injected `<head>` lines (noindex tag, manifest link, service-worker
   registration). Don't restyle it, don't strip its CSS, don't wrap it in
   anything. Metadata for the listing comes from, in priority order:
   `--title`/`--summary`/`--date`/`--tags` flags, then an existing
   `<!--note ... -->` comment block right before the doctype, then `<title>`
   / `<meta name="description">`. Only `date` has no fallback (undated notes
   sort last, no date shown).

2. **A fragment** — body HTML with `---`-delimited front matter (`title:`,
   `description:`, `date:`, `tags:`, `summary:`, `short_title:`) — gets the
   site's shared chrome (nav, theme toggle, `style.css`). For this shape
   `--title`/`--summary`/`--date`/`--tags` are ignored; edit the front matter
   directly instead. `add-note.py` warns about this on stderr if you pass
   them anyway.

If unsure which shape the source is in, just pass it through — the script
detects this itself (`is_standalone()` in `build.py`), no need to inspect it
yourself first.

## Deploying (making it actually live)

`--deploy` (or, separately, `./scripts/deploy-eos.sh` from the repo root)
rsyncs an explicit allowlist to CERN EOS web hosting. It never passes
`--delete`, so it's one-directional and safe to run repeatedly. It needs a
forwarded Kerberos ticket:

```
kinit dneff@CERN.CH
```

If deploy fails with "Permission denied" on `/eos`, the forwarded ticket
expired but a stale `ControlPersist` master is still up:

```
ssh -O exit lxplus
```

then retry. This is the one place you may need to hand control back to the
user — they have to type their Kerberos password interactively.

## Unpublishing a note

Deleting the source in `pages/notes/` and rebuilding drops it from the
generated `notes/` dir, the listing, and the service-worker precache — but
`deploy-eos.sh` never deletes on EOS, so the old copy stays reachable at its
URL until removed by hand:

```
ssh lxplus 'rm /eos/user/d/dneff/www/notes/<slug>.html'
curl -sI https://dylan-neff.web.cern.ch/notes/<slug>.html | head -1   # want 404
```

## If `add-note.py`'s flags ever change

This skill is a copy of the workflow documented in `dylan-cern-site`'s
README under "Notes" — if the two disagree, the README is current and this
file is stale; update this file to match.
