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
templates/base.html     SOURCE -- shared <head>, topbar, nav, footer
index.html              generated
projects/*.html         generated per-project write-ups
style.css               palette + layout (same dataviz palette as the x17 DAQ page)
assets/                 portrait
cv/                     CV PDF, served at /cv/Dylan_Neff_CV.pdf
data/publications.json  generated -- see below
js/shared.js            theme toggle, canvas/DPR helpers, tooltip
js/x17.js               e+e- opening-angle spectrum (mass & signal sliders)
js/micromegas.js        drift/avalanche/centroid animation
js/vernier.js           beam-overlap + rate-scan demo
js/qgp.js               collision geometry + proton-multiplicity histogram
js/publications.js      renders the publication list from data/publications.json
scripts/                publication sync + deploy
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

### Writing a project page

Each has a `<div class="stub">` marking the Results section as unwritten — a
deliberately conspicuous block so a draft never reads as finished. Delete it
when the section is real. Useful classes: `.facts` for a key/value grid of
detector or run parameters, `.page-body` for the prose column.

## TODO

- Confirm the affiliation line: the CV lists *Affiliated Researcher, The
  University of Manchester* while its address block is CERN.
- Fill in the Results section on each project page (marked with a `.stub`).
