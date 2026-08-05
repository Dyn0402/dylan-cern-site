# dylan-cern-site

Personal research site — <https://dylan-neff.web.cern.ch/>. A static,
self-contained "live CV" with interactive sketches of each research topic
(X17 at n_TOF, Micromegas/MPGDs, sPHENIX luminosity, STAR/QGP).
No build step, no framework, no external dependencies, no trackers.

## Layout

```
index.html              landing page
projects/*.html         per-project write-ups, linked from the research cards
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

## Project pages

`projects/x17.html`, `micromegas.html`, `sphenix.html` and `qgp.html` are plain
hand-editable HTML — there is no template step. Each has a `<div class="stub">`
marking the Results section as unwritten; that block is deliberately conspicuous
so a draft never reads as finished. Delete it when the section is real.

Useful classes: `.facts` for a key/value grid of detector or run parameters,
`.page-body` for the prose column, `.stub` for an unwritten section.

**Note on duplication.** The topbar and footer are now copied across five pages.
Editing the nav means editing all five. That is fine at this size but is the
usual point where a ~60-line build script (template + content fragments) starts
paying for itself.

## TODO

- Confirm the affiliation line: the CV lists *Affiliated Researcher, The
  University of Manchester* while its address block is CERN.
- A dedicated X17 write-up page, if the landing page gets crowded.
