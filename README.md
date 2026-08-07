# dylan-cern-site

Personal research site — <https://dylan-neff.web.cern.ch/>. A static,
self-contained "live CV" with interactive sketches of each research topic
(X17 at n_TOF, Micromegas/MPGDs, sPHENIX luminosity, STAR/QGP).
No framework, no external dependencies, no trackers. The only build step
is a ~120-line stdlib Python script that stamps shared chrome onto page bodies;
what it emits is plain static HTML.

## Layout

```
pages/                  SOURCE -- edit these
pages/notes/            SOURCE -- notes; see "Notes" below
templates/base.html     SOURCE -- shared <head>, topbar, nav, footer
templates/sw.js         SOURCE -- offline cache, before the asset list is filled in
index.html              generated
projects/*.html         generated per-project write-ups
notes/*.html            generated, plus a generated notes/index.html listing
hub/index.html          generated private front door -- see "The hub"
sw.js                   generated service worker (precache list + content hash)
manifest.json    web app manifest -- makes the site installable
style.css               palette + layout (same dataviz palette as the x17 DAQ page)
assets/                 portrait, app icons
cv/                     CV PDF, served at /cv/Dylan_Neff_CV.pdf
data/publications.json  generated -- see below
js/shared.js            theme toggle, canvas/DPR helpers, tooltip
js/offline.js           "you are offline" banner on the hub and notes listing
js/notes-filter.js      filter box on the notes listing
scripts/add-note.py     publish a note from anywhere -- see "Notes" below
js/x17.js               e+e- opening-angle spectrum (mass & signal sliders)
js/micromegas.js        drift/avalanche/centroid animation
js/vernier.js           beam-overlap + rate-scan demo
js/qgp.js               collision geometry + proton-multiplicity histogram
js/publications.js      renders the publication list from data/publications.json
scripts/                publication sync + deploy + note publishing + tests
```

## Publications are data, not markup

The page fetches `data/publications.json` at load and renders the list from it,
so the site, the CV and INSPIRE cannot silently drift apart. After a paper
lands:

```
python3 scripts/fetch_publications.py
```

That pulls every record INSPIRE attributes to author 1763981, writes the total
and per-collaboration counts, and features the entries listed in `SELECTED` at
the top of the script. To feature a new paper, add its arXiv id, DOI, or a
distinctive title fragment to `SELECTED` and rerun. The page keeps a static
fallback entry in `#pub-list` for when the fetch fails.

## Preview locally

```
python3 -m http.server -d . 8000
# http://localhost:8000
```

The "Live from the experiment" pill reads `x17/data.json` and the trigger-scheme
link points at `trigger_scheme.html`; neither exists locally, so the pill shows
"status offline" and that link 404s in preview. Both work once deployed.

## Deploy

```
./scripts/deploy-eos.sh
```

The site is served from `/eos/user/d/dneff/www/` on CERN EOS web hosting. That
directory also holds content this repo does **not** own:

- `x17/` — the live DAQ dashboard, regenerated automatically by the stats job
  at the beamline. Never write inside it.
- `trigger_scheme.html` — standalone page, hand-published.

So the deploy script copies only an explicit allowlist (`PAYLOAD`) and never
passes `--delete`. Adding a file to the site means adding it to that list.
It re-checks both neighbours afterwards and prints what it found.

Deploying needs a Kerberos ticket (`kinit dneff@CERN.CH`) forwarded to lxplus.
If `/eos` comes back "Permission denied", the forwarded ticket has expired but
the `ControlPersist 1d` master is still up holding the stale credentials —
`ssh -O exit lxplus`, then retry.

## Pages are built

`index.html` and everything under `projects/` are **generated**. They carry a
do-not-edit banner. Edit the fragment in `pages/` or the shared chrome in
`templates/base.html`, then:

```
python3 scripts/build.py          # rebuild
python3 scripts/build.py --check  # exit 1 if any output is stale
```

`scripts/deploy-eos.sh` runs the build itself, so what gets rsynced can never
lag its sources.

A fragment is body HTML with a small front-matter block:

```
---
title: Searching for X17 at n_TOF — Dylan Neff
description: One sentence for search results and link previews.
og_description: Shorter variant for link previews (optional; defaults to description).
og_type: article
skip: body
scripts: js/shared.js
---
<p class="crumb">...</p>
```

`{{root}}` in the template resolves to the relative path back to the site root
— empty at the top level, `../` one level down — which is how one piece of nav
markup works at both depths. Adding a nav item is a one-line edit in
`templates/base.html`.

Adding a page: drop a fragment in `pages/`, add its output path to `PAYLOAD` in
the deploy script, and link to it.

## Notes

Served at `/notes/`. To publish one — **from anywhere on the machine**, without
opening this repo:

```
python3 ~/PycharmProjects/dylan-cern-site/scripts/add-note.py NOTE.html
```

That copies the file into `pages/notes/`, stamps the listing metadata and
rebuilds. It does not deploy; it prints the command that does. `--slug` sets
the URL name, `--tags` files it under a topic, `--force` replaces an existing
note, `--deploy` pushes as well. Replacing a note keeps the date it was first
published under, so fixing a typo does not reorder the listing; `--date` moves
it.

That workflow is also written up as a personal skill in
`~/.claude/skills/publish-note/`, so a Claude session in any other repository
can publish a note without reading this one. **If the script's flags change,
update that skill too.**

### The two shapes

`pages/notes/` holds the sources. Two shapes work:

- a **fragment** with front matter, as above — it gets the site chrome,
  nav, theme toggle and `style.css`;
- a **complete standalone document** (starts with `<!doctype` or `<html>`),
  copied through untouched apart from three injected `<head>` lines: the
  `noindex` tag, the manifest link, and the service-worker registration.

The second is the point. A self-contained HTML file — the kind that arrives
with its own inline styling — gets dropped in and deployed with no
reformatting.

`notes/index.html` is **generated from whatever is in the directory**, so the
listing cannot drift. Don't create `pages/notes/index.html`; the build rejects
it. Deleting a source note deletes its published copy on the next build — only
files carrying the generated banner, so anything hand-placed in `notes/` is
left alone with a warning. Sorting is newest first on `date:`. A note without
one sorts last and shows
no date rather than being given a guessed one — deriving it from the file mtime
would produce a different `notes/index.html` on every fresh clone and make
`build.py --check` fail on a clean checkout.

A standalone note takes its listing metadata from an optional comment block
before the doctype:

```
<!--note
date: 2026-08-07
title: Short title for the listing
summary: One line for the listing.
-->
<!doctype html>
```

Without it, the title falls back to `<title>` and the summary to
`<meta name="description">`. Only `date:` has no fallback.

### Topics

`tags:` is a comma-separated list — commas, not spaces, because topics are
phrases and "detector R&D" is one tag. The **first** tag is the section the
note is filed under on `/notes/`; the rest only widen what the filter box
matches and show as chips on the row. One note appears in exactly one section:
a note under three headings would make the per-section counts lie. Untagged
notes collect under *Unfiled*, which always sorts last. Sections are otherwise
ordered by their most recent note, so what you are working on now is at the
top.

The filter box (`js/notes-filter.js`) matches every word against the title,
summary and tags, so `micromegas gain` narrows rather than widening. It is
inserted by script, so there is no dead control when JS is off — the grouped
list is the no-JS state and is already usable.

### The hub

`/hub/` is a private front door, generated the same way: recent notes, the live
run pill, and links to the CV, the DAQ dashboard and the project pages. It is
where the installed home-screen icon lands (`start_url` in the manifest), and
it is unlisted on the same terms as the notes.

Its "Elsewhere" links point at pages that are **not** precached, so they
dead-end when you are offline. That is intentional — see "Offline" below.

### Unlisted, not private

Every note and the hub carry `noindex, nofollow`, and neither is in the site
nav — "Hub" and "Notes" links appear only once you are already on one of those
pages.
Search engines skip them. **That is obscurity, not access control** — anyone
with the URL can read a note, so nothing genuinely confidential belongs here.
Real privacy would mean access control on the webeos site itself, which applies
to the whole site and would put the public CV behind a login too.

This is deliberately *not* paired with a `robots.txt` `Disallow`. Blocking the
crawl would stop a crawler from ever reading the `noindex` — which is the tag
that actually keeps a page out of an index.

## Offline

`sw.js` and `manifest.json` make the site installable: add it to a phone
home screen and the notes open with no network. `start_url` is `/hub/`, so the
installed icon lands there. Do that once, on the phone, while online — the
precache fills on that first visit.

**Scoped to the hub and notes.** `PRECACHE` in `scripts/build.py` holds those
plus only what they need to render (`style.css`, `js/shared.js`,
`js/offline.js`, `js/notes-filter.js`, `js/live-status.js`, the icons). The
rest of the site is a live CV — the home page carries the DAQ status pill and
fetches `publications.json`, neither of which wants to come out of a cache —
so it stays online-only. The cost is that the topbar nav and the hub's
"Elsewhere" links dead-end offline, which the banner from `js/offline.js`
explains.

Note the distinction the precache list draws: `js/live-status.js` **is**
cached, so the hub renders offline, but the `/x17/data.json` it fetches is
not — the pill just falls back to "status offline". Caching a script is not the
same as caching the live data it reads, and `scripts/test-sw.mjs` asserts both
halves.

The manifest is `manifest.json`, **not** the conventional
`manifest.webmanifest`, because Apache on EOS has no MIME mapping for that
extension and served it with no `Content-Type` header at all. `.json` gets
`application/json`, which browsers accept. Don't rename it back.

`sw.js` is generated from `templates/sw.js` with the precache list filled in
and a hash of those files' contents as the cache name, so deploying a new note
invalidates the old cache by itself — there is no version constant to bump.

**The safety property.** A service worker registered at the root controls the
whole origin — including `/x17/`, which this repo does not own and whose
`data.json` `js/live-status.js` fetches with `cache: 'no-store'` because run
status must be fresh. So the fetch handler is an **allowlist**, the same
discipline as `PAYLOAD`: it calls `respondWith()` only for paths in the
generated precache list and returns without touching anything else, leaving the
browser's normal networking in place. Never widen it to a catch-all.

```
python3 scripts/build.py --check    # outputs match their sources
node scripts/test-sw.mjs            # the allowlist, both halves
node scripts/test-filter.mjs        # the notes filter box
```

`test-sw.mjs` runs the generated worker against stubbed globals and asserts
that `/x17/*` and `trigger_scheme.html` are left alone, and that the hub and
notes still resolve from cache with the network down. Run it after touching
`templates/sw.js` or `PRECACHE`.

Both JS tests use synthetic fixtures rather than reading the built pages, so
writing a note can never turn them red.

Service workers need HTTPS or `localhost`; both the deployed site and
`python3 -m http.server` qualify.

### Writing a project page

Each has a `<div class="stub">` marking the Results section as unwritten — a
deliberately conspicuous block so a draft never reads as finished. Delete it
when the section is real. Useful classes: `.facts` for a key/value grid of
detector or run parameters, `.page-body` for the prose column.

## TODO

- Confirm the affiliation line: the CV lists *Affiliated Researcher, The
  University of Manchester* while its address block is CERN.
- Fill in the Results section on each project page (marked with a `.stub`).
