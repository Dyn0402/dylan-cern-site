# dylan-cern-site

Personal research site — <https://dylan-neff.web.cern.ch/>. A static,
self-contained "live CV" with interactive sketches of each research topic
(X17 at n_TOF, Micromegas/MPGDs, sPHENIX luminosity, STAR/QGP), a hub for the
n_TOF campaign's data and analyses at `/x17/`, plus a private notes section at
`/hub/` that reads offline.
No framework, no external dependencies, no trackers. The only build step is a
stdlib Python script that stamps shared chrome onto page bodies and generates
the notes listing and the service worker; what it emits is plain static HTML.

## Layout

```
pages/                  SOURCE -- edit these
pages/notes/            SOURCE -- notes; see "Notes" below
pages/x17/index.html    SOURCE -- the campaign hub; see "The X17 hub"
pages/x17/qa.html       SOURCE -- DREAM run QA;  see "The three QA tables"
pages/x17/qa-ntof.html  SOURCE -- n_TOF run QA
pages/x17/qa-match.html SOURCE -- the DREAM <-> n_TOF match
templates/base.html     SOURCE -- shared <head>, topbar, nav, footer
templates/sw.js         SOURCE -- offline cache, before the asset list is filled in
index.html              generated
projects/*.html         generated per-project write-ups
notes/*.html            generated, plus a generated notes/index.html listing
hub/index.html          generated private front door -- see "The hub"
x17/index.html          generated campaign hub
x17/qa.html             generated DREAM run table
x17/qa-ntof.html        generated n_TOF run table
x17/qa-match.html       generated match table
x17/live/               the retired DAQ dashboard, frozen -- not generated,
                        written once by scripts/archive_x17_dashboard.py
sw.js                   generated service worker (precache list + content hash)
manifest.json           web app manifest -- makes the site installable
style.css               palette + layout (same dataviz palette as the x17 DAQ page)
assets/                 portrait, app icons
cv/                     CV PDF, served at /cv/Dylan_Neff_CV.pdf
data/publications.json  generated -- see below
data/x17-campaign.json  frozen campaign statistics -- see "The X17 hub"
data/x17-runs.json      frozen DREAM run survey  -- see "The three QA tables"
data/x17-ntof-runs.json frozen n_TOF run ledger
data/x17-match.json     frozen per-segment match QA
js/shared.js            theme toggle, canvas/DPR helpers, tooltip
js/offline.js           "you are offline" banner on the hub and notes listing
js/notes-filter.js      filter box on the notes listing
js/x17.js               e+e- opening-angle spectrum (mass & signal sliders)
js/x17-campaign.js      the two campaign charts on /x17/
js/x17-table.js         shared table machinery for the three QA pages
js/x17-runs.js          the DREAM run table and its strip, both views
js/x17-ntof.js          the n_TOF run table and its strip, both views
js/x17-match.js         the match table, the residual histogram, both views
js/live-status.js       the old live run pill -- parked, see "The X17 hub"
js/micromegas.js        drift/avalanche/centroid animation
js/vernier.js           beam-overlap + rate-scan demo
js/qgp.js               collision geometry + proton-multiplicity histogram
js/publications.js      renders the publication list from data/publications.json
scripts/build.py        pages/ -> HTML, plus notes/index.html, hub/ and sw.js
scripts/add-note.py     publish a note from anywhere -- see "Notes"
scripts/deploy-eos.sh   rsync an allowlist to EOS
scripts/fetch_publications.py   sync from INSPIRE
scripts/freeze_x17_campaign.py  ledger -> data/x17-campaign.json
scripts/survey_runs.py          runs on lxplus: walk the EOS run tree
scripts/survey_events.py        runs on lxplus: per-sub-run event counts
scripts/survey_configs.py       runs on lxplus: which runs swept an HV setting
scripts/freeze_x17_runs.py      surveys -> data/x17-runs.json
scripts/freeze_x17_ntof.py      campaign_qa ledgers -> data/x17-ntof-runs.json
scripts/freeze_x17_match.py     clock_qa records -> data/x17-match.json
scripts/archive_x17_dashboard.py  freeze the retired dashboard into x17/live/
scripts/test-sw.mjs     the service-worker allowlist
scripts/test-filter.mjs the notes filter box
scripts/test-table.mjs  the shared QA table: sorting, expansion, totals
```

The app icons in `assets/` (`icon-192`, `icon-512`, `icon-maskable-512`,
`apple-touch-icon`) were drawn geometrically — an atom mark in the palette's
`--series-1`/`--series-2` on the dark plane — rather than typeset from the ⚛
glyph, so they do not depend on installed fonts. To change the icon, replace
all four; the maskable one keeps its mark inside the middle 80% because the
platform may crop it to a circle.

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

The trigger-scheme link points at `trigger_scheme.html`, which is published by
hand and does not exist in this repo, so it 404s in preview and works once
deployed. Everything else, `/x17/` included, previews exactly as it deploys.

`/hub/` and `/notes/` do work locally, service worker included — it needs HTTPS
or `localhost`, and `localhost` counts. Two caveats when previewing offline
behaviour: a registered worker survives across edits, so use a hard reload (or
Application → Service Workers → Unregister) when the cache seems stale; and
`python -m http.server` knows more MIME types than the deployed Apache does, so
a header being right locally proves nothing about EOS — check the live site,
which is how the manifest bug below was found.

## Deploy

```
./scripts/deploy-eos.sh
```

The site is served from `/eos/user/d/dneff/www/` on CERN EOS web hosting. That
directory also holds `trigger_scheme.html`, a standalone page published by hand,
which this repo does **not** own.

So the deploy script copies only an explicit allowlist (`PAYLOAD`) and never
passes `--delete`. Adding a file to the site means adding it to that list.
It re-checks that neighbour afterwards and prints what it found.

**`/x17/` changed hands.** Until 2026-08-10 it was written by
`stats_collector.py` on the DAQ machine and this repo would not touch it; now
this repo owns `x17/index.html`, the three QA pages and `x17/live/`. Before the
first deploy of
that, **stop `stats_page_watcher` on the DAQ machine** — it re-uploads its own
`index.html` on the first push of each session, so a watcher that is still
running will overwrite the hub, and only when it happens to restart:

```
ssh daq 'tmux ls | grep stats_page_watcher'
ssh daq 'tmux kill-session -t stats_page_watcher'
```

Its four leftovers (`data.json`, `runs.json`, `progress.png`, `ipc_yield.png`)
were removed by hand on 2026-08-12, once the archived dashboard was confirmed to
carry its own copies of all four. `/x17/` should now hold only `index.html`, the
three `qa*.html` pages and `live/`.

Because it never deletes, **renaming or removing a file leaves the old copy
served.** This bites hardest when unpublishing a note: deleting the source
makes `build.py` drop the generated file, the listing entry and the precache
entry, but rsync says nothing about a file that no longer exists locally, so
the note stays reachable at its own URL on EOS. Removing it is a manual step:

```
ssh lxplus 'rm /eos/user/d/dneff/www/notes/<slug>.html'
curl -sI https://dylan-neff.web.cern.ch/notes/<slug>.html | head -1   # want 404
```

`build.py` prints this reminder whenever it prunes. The same step was needed
when `manifest.webmanifest` became `manifest.json`.

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
the deploy script, and link to it. Notes are the exception — `notes/` is
already in `PAYLOAD`, and `scripts/add-note.py` does the rest.

Notes accept four more front-matter fields, ignored elsewhere: `date`, `tags`,
`summary` and `short_title`. See "Notes".

### Writing a project page

Each has a `<div class="stub">` marking the Results section as unwritten — a
deliberately conspicuous block so a draft never reads as finished. Delete it
when the section is real. Useful classes: `.facts` for a key/value grid of
detector or run parameters, `.page-body` for the prose column.

## The X17 hub

`/x17/` is the entry point for the 2026 n_TOF campaign: the totals, two frozen
plots, and links out to run QA, the analyses and the data. Source is an ordinary
fragment, `pages/x17/index.html`.

### The numbers are frozen, not live

Data taking ended 2026-08-10, so nothing on the page polls anything.
`scripts/freeze_x17_campaign.py` turns the DAQ machine's sub-run ledger and one
frozen projection into `data/x17-campaign.json` (~12 kB), and
`js/x17-campaign.js` draws the two plots kept from the retired dashboard —
integrated events, and events per day — plus the stat tiles and a table view.

```
scp daq:PycharmProjects/nTof_x17_DAQ/projections/stats_ledger.csv /tmp/
scp 'daq:PycharmProjects/nTof_x17_DAQ/projections/saved/*.json' /tmp/
python3 scripts/freeze_x17_campaign.py /tmp/stats_ledger.csv /tmp/projection_2026-07-27.json
```

Three things that script decides, and the page repeats in a footnote, because
each one changes the headline number:

- **beam** means `neutrons` + `unknown` sub-runs and **excludes** the 27 pulser
  sub-runs, which is what the live dashboard published;
- **cosmics are never added to beam** — they were taken during beam-off periods,
  so a combined curve would imply an exposure that never happened;
- the ledger **starts at run_67**. Earlier runs were rotated off the DAQ disk
  before it existed, so they are in no curve on the page.

The tiles also carry the final numbers as static text in the fragment, so the
headline survives with JS off or the fetch failing; the script overwrites them
from the JSON when it loads. If you re-freeze, re-check those four numbers.

### The three QA tables

Two DAQs recorded this campaign on two clocks, so QA is three pages, not one,
and they share `js/x17-table.js` — columns, sorting, row expansion, the total
row — while each owns its own data, filters and plots:

| page | one row is | frozen by |
|---|---|---|
| `qa.html` | a DREAM run | `freeze_x17_runs.py` |
| `qa-ntof.html` | an n_TOF run | `freeze_x17_ntof.py` |
| `qa-match.html` | a **segment** — one DREAM sub-run × one n_TOF run | `freeze_x17_match.py` |

Each carries the same `.qa-nav` strip at the top, marking the current page with
`aria-current="page"`. A column is `{key, label, num, cell}` where `key` is both
the sort key and the field it reads, so a column is sortable by construction;
`scripts/test-table.mjs` covers the sort/expand/total behaviour.

**Every row expands into the parts it is made of** — `x17.subTable()`, a small
read-only table nested inside the detail panel. Deliberately not sortable: it is
a handful of rows in their natural order, and a second set of sort controls
would compete with the outer table's for nothing.

| page | a row expands into |
|---|---|
| `qa.html` | its **sub-runs**, columns following the current view |
| `qa-ntof.html` | the **segments** it shares with DREAM |
| `qa-match.html` | its **four arms** and all **nineteen QA checks** |

n_TOF's own reconstruction partials would be the other natural nesting on the
middle page, and they are not there: the ledger checks whether the partial *set*
covers the run, not what each partial holds, so listing them needs a survey of
its own.

Two things the nesting bought, both worth keeping. A sub-run's status is
**derived** from its counts by the same three rules the run's status uses, so a
green sub-run cannot sit inside a run that is amber for its sake — the run-level
exception list that used to be frozen alongside is gone. And the campaign-wide
sub-run array the statistics strip plots is now **assembled in the browser**
from the same per-run rows, so the plot and the tables cannot disagree; that
alone paid for the nesting in file size.

#### The DREAM run table

`/x17/qa.html` is every run of the campaign — all 161 — with its sub-run count,
live hours, size on EOS and how far it got through the processing chain. It is
built by **walking the archive**, not from a logbook, in two steps:

```
R=/eos/experiment/ntof/data/x17/july_beam/runs
scp scripts/survey_{runs,events,configs}.py lxplus:       # they need EOS mounted
ssh lxplus "nohup python3 -u survey_runs.py   $R ~/campaign_survey.json  &"
ssh lxplus "nohup python3 -u survey_events.py $R ~/campaign_events.json  &"
ssh lxplus "python3 survey_configs.py         $R ~/campaign_configs.json"
scp lxplus:'campaign_survey.json campaign_events.json campaign_configs.json' /tmp/
python3 scripts/freeze_x17_runs.py /tmp/campaign_survey.json \
        --events /tmp/campaign_events.json \    # event counts, whole campaign
        --ledger /tmp/stats_ledger.csv \        # optional: cross-check only
        --configs /tmp/campaign_configs.json \  # HV scans
        --dashboard x17/live/runs.json          # optional: adds beam-off hours
```

The page has **two views over the same rows** — *processing* (sub-runs, size on
EOS, how far through the chain) and *statistics* (on-air time, events, rate,
beam-off split) — switched by `#processing` / `#statistics`, plus a beam /
cosmics / pulser mode filter. The view changes the columns, the strip's
colouring and the footer totals; only the mode filter and the search box change
which runs are listed, and the totals follow them. Those conventions, the mode
chips and the newest-first default come from the retired shift dashboard's run
list, kept at `/x17/live/#runs`.

**Event counts are backfilled to all 161 runs**, and were recovered rather than
estimated. The statistics ledger starts at run_67, but `dream_daq_control.py`
copies the DREAM RunCtrl log into every sub-run's `raw_daq_data/`, and it carries
`StopDataTaking OK after total N events in 8 FEUs (M/FEU)`. Those logs went to
EOS with the data, so `survey_events.py` can read **M, the per-FEU count** — the
FEU-summed *N* would multiply the campaign by eight — for all 2,691 sub-runs
that recorded anything. Pass `--ledger` too and the overlap is cross-checked:
**890 of 891 sub-runs agree exactly**; the one that does not
(`run_68/cos_003_r540_c00`, ledger 0 vs log 1,617) is a cosmics sub-run the
ledger missed. Any future disagreement is printed and counted by the script.

That is also what makes the statistics view's plot possible: one bar per
sub-run, height in events, on a real time axis, so beam stops are the gaps
rather than something drawn. The axis stops at the 99th percentile because one
eleven-hour sub-run in run_31 recorded 879 k against ~120 k for every ordinary
hour-long one; it is drawn clipped with a broken top edge rather than dropped or
allowed to flatten the rest.

**Scanning is a second, independent axis, not another mode.** A run sweeps a
voltage *while* running on beam, cosmics or pulser, so the page filters on the
two separately and they compose. `survey_configs.py` decides it exactly: every
entry of `sub_runs` in `run_config.json` carries the full HV setpoint map it was
taken at, so a run is an **HV scan** iff that map is not identical across its
sub-runs, and `detectors[].hv_channels` turns the channels that moved into a
named axis — **44 runs swept resist, 20 swept drift and resist**. It catches
two-point "bounces" as well as 101-point sweeps, and correctly does not flag the
latency, threshold, IPD or jumbo-frame ladders, which hold HV fixed. Name
matching would have missed most of them: the earliest scans record their trigger
note as just "PS Pickup".

Run **mode is backfilled to all 161 runs** from `beam_type` in each run's
`run_config.json`, mirroring `run_stats.py`'s rule exactly (`cosmics`/`cosmic` →
cosmics; `pulser`/`test`/`daq_test` → not physics; everything else → beam). The
dashboard only knew modes from run_67 on. Beam-off hours cannot be backfilled —
they come from the beam watcher, not the archive — so they stay blank before
run_67.

**Re-survey only what changed.** All three scripts take `--runs`, which walks a
subset and **merges into the existing output file**:

```
ssh lxplus "python3 -u survey_runs.py $R ~/campaign_survey.json --runs 88,90-93"
```

Merging is the default on purpose: walking three runs and writing the result out
would silently destroy the other hundred and fifty-eight, and the file would look
perfectly healthy. `--replace` opts out when you really do want only the walked
runs. An unknown run number is a hard error rather than a quiet no-op.

This matters more than it sounds. The full walk is ~20 minutes when EOS is
healthy but was **53 seconds per run** on the evening of 2026-08-12 — six hours
for the campaign — and reprocessing usually touches a handful of runs. Note the
three scripts are copied to lxplus individually and so cannot share a module;
the selection helper is duplicated verbatim in each.

The full survey checkpoints after every run, so a dropped
connection costs nothing. Both scripts document what each count means; the two
things worth knowing before reading the table are that **"partly processed" is
not "broken"** (many runs were configuration studies never meant to go through
the full chain, and the raw data is all there either way) and that **event
counts start at run_67** while **live hours cover everything**, because those
come from each sub-run's own `run_time.txt` on EOS rather than from the ledger.

Timestamps come from `run_config.json`, never from EOS file mtimes — those
record when the backup ran, which for the early runs is days after the data was
taken.

#### The n_TOF run table

`/x17/qa-ntof.html` is the other DAQ's 445 runs. Its inputs are already produced
by `nTof_x17/ntof_processing/campaign_qa/`, so the freeze reads the newest dated
file of each kind and carries that date onto the page as `as_of`:

```
python3 scripts/freeze_x17_ntof.py [--src ~/PycharmProjects/nTof_x17]
```

The question it answers is **not "did the run merge"** — a merged file can be a
stub and large runs routinely never merge — but whether the partial set *covers
the run*, judged from the `index` tree. An off-recipe product is deliberately
not counted as coverage. Two views: *reconstruction* (who covers it, at which
recipe, and whether it is still being written) and *match readiness* (how much
of the beam it shares with DREAM has been joined).

The settled-runs parser **asserts each section header's declared count against
what its ranges expand to**. It has to: the file carries a fourth section whose
two runs are already listed above it, and an unrecognised header silently left
the previous class in force and overcounted MOVING by two.

#### The match table

`/x17/qa-match.html` is the join: 420 segments, 170 of them joined. Its inputs
are the per-segment `clock_qa.json` records the slim pipeline writes beside each
output file, plus the campaign inventory:

```
python3 scripts/freeze_x17_match.py \
    [--records /media/dylan/data/x17/slim_campaign_2026-08-12] \
    [--src ~/PycharmProjects/nTof_x17]
```

**Reading only the records would give a page on which everything passes.** A
mis-joined segment fails its clock fit and writes no file, so QA never sees it;
the inventory is what makes the 107 failures visible and the todo list what
stops "attempted" being mistaken for "all of it". That is why the page defaults
to *coverage* rather than *quality*, and it is worth preserving if this is ever
rewritten.

Two things the freeze imposes rather than inherits. Segments are **sorted into
campaign order** by DREAM run *number* — the inventory sorts them as text, which
puts `run_79` after `run_150`, and the strip's x axis calls itself a timeline.
And a pending row whose n_TOF run straddles two DREAM runs is carried with an
unnamed sub-run rather than dropped, because the todo table prints one DREAM run
per row and its own count is the number that has to be slimmed.

The fixed plot is the **campaign residual histogram**, summed bin by bin over
every joined segment: 12.4 M matched hits in a ±25 ns window with a 6 ns core.
It is never filtered — it is the evidence that the window contains a peak, and
slicing it by whatever the table is showing would turn evidence into decoration.
The strip switches mark type with the view: bars anchored at zero for beam
minutes, **dots** for efficiency, because that axis spans 93.5–97.4 % and a
truncated bar chart would be a lie.

### Link rows are either live or staged

Most of what the hub should point at is not published yet. A row is either a
real anchor with a `live` chip, or a **`li.staged`** — deliberately not an
anchor, carrying a `to publish` or `blocked` chip and, usually, the path to the
report in the analysis repo. Nothing on the page is a link that 404s, and the
staged rows double as the publishing to-do list. Promoting one is: publish the
report (`scripts/add-note.py` handles self-contained HTML), then swap the
`<span class="t">` for an `<a class="t" href=…>` and the chip for `live`.

### The retired dashboard

`/x17/live/` is the beamline's live page frozen at its final state, written by
`scripts/archive_x17_dashboard.py`. It is not regenerated by `build.py` and not
touched by `--check`; run the script once and commit what it writes.

It does not fork the page's markup. The dashboard already had a
`window.__PREVIEW__` hook for local previewing, which makes its own boot code
render once instead of fetching and polling, so the archive is the deployed page
with the final `data.json` and `runs.json` inlined ahead of it. The script then
rewrites the freshness pill, the banner and the footer line, which would
otherwise compute an age from `Date.now()` and shout "stale — 6 days old" in red
at a reader of an archive.

`js/live-status.js`, which fed the run pill on the home page and the hub, is
parked: nothing loads it, but it is still precached and still tested, and it
revives with one line of front matter if a future campaign starts publishing
`/x17/data.json` again.

## Notes

Served at `/notes/`. To publish one — **from anywhere on the machine**, without
opening this repo:

```
python3 ~/PycharmProjects/dylan-cern-site/scripts/add-note.py NOTE.html
```

That copies the file into `pages/notes/`, stamps the listing metadata and
rebuilds. It does not deploy; it prints the command that does.

`--slug` sets the URL name, `--tags` files it under a topic, `--title`,
`--summary` and `--date` override what the document declares, `--force`
replaces an existing note, `--deploy` pushes as well. Replacing a note keeps
the date it was first published under, so fixing a typo does not reorder the
listing; `--date` moves it deliberately. `add-note.py --help` is current.

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
left alone with a warning.

Sorting is newest first on `date:`. A note without one sorts last and shows no
date rather than being given a guessed one — deriving it from the file mtime
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

`/hub/` is a private front door, generated the same way: recent notes, and links
to the CV, the campaign hub and the project pages. It is where the installed
home-screen icon lands (`start_url` in the manifest), and it is unlisted on the
same terms as the notes.

Its "Elsewhere" links point at pages that are **not** precached, so they
dead-end when you are offline. That is intentional — see "Offline" below.

### Unlisted, not private

Every note and the hub carry `noindex, nofollow`, and neither is in the site
nav — "Hub" and "Notes" links appear only once you are already on one of those
pages, so the public homepage looks exactly as it did before any of this
existed. Search engines skip them. **That is obscurity, not access control** —
anyone with the URL can read a note, so nothing confidential belongs here.
Real privacy would mean access control on the webeos site itself, which applies
to the whole site and would put the public CV behind a login too.

This is deliberately *not* paired with a `robots.txt` `Disallow`. Blocking the
crawl would stop a crawler from ever reading the `noindex` — which is the tag
that actually keeps a page out of an index.

## Offline

`sw.js` and `manifest.json` make the site installable: add it to a phone home
screen and the notes open with no network. `start_url` is `/hub/`, so the
installed icon lands there.

### Installing it on a phone

Once per device, **while online**:

- **iPhone / iPad — must be Safari.** Open
  <https://dylan-neff.web.cern.ch/hub/>, tap **Share** (the square with an
  arrow), scroll to **Add to Home Screen**, **Add**. Chrome on iOS does not
  reliably offer this.
- **Android — Chrome.** Same URL, **⋮** → **Add to Home screen** (or **Install
  app**). Chrome may offer an install banner unprompted.

Then open it once from the icon while still online: that visit is when the
worker installs and fills the cache. After that, airplane mode should still
open the hub and every note.

If Android offers only a plain bookmark shortcut rather than "Install app", the
manifest is not being read — check that `/manifest.json` returns
`application/json` (see below).

On iOS, Safari can evict caches after a long stretch of not opening the app.
One online visit restores them; nothing is lost but the offline copy.

### What gets cached

**Scoped to the hub and notes.** `PRECACHE` in `scripts/build.py` holds those
plus only what they need to render (`style.css`, `js/shared.js`,
`js/offline.js`, `js/notes-filter.js`, `js/live-status.js`, the icons). The
rest of the site is a live CV — the home page fetches `publications.json`, and
`/x17/` is mostly links out to reports and CERN-only storage that no cache can
make work — so it stays online-only. The cost is that the topbar nav and the
hub's "Elsewhere" links dead-end offline, which the banner from `js/offline.js`
explains.

`js/live-status.js` is still in that list although nothing loads it any more;
see "The X17 hub" for why it is parked rather than deleted. The distinction it
was there to draw still holds and `scripts/test-sw.mjs` still asserts both
halves: the script is cached, the `/x17/data.json` it would fetch is not.
Caching a script is not the same as caching the live data it reads.

The manifest is `manifest.json`, **not** the conventional
`manifest.webmanifest`, because Apache on EOS has no MIME mapping for that
extension and served it with **no `Content-Type` header at all** — which
browsers may refuse to treat as a manifest, costing the install prompt and so
the whole offline mechanism. `.json` gets `application/json`, which browsers
accept. Don't rename it back. `sw.js` is fine as-is (`application/javascript`).

Worth knowing how that was missed: locally, `python -m http.server` knows the
`.webmanifest` type and everything looked correct. Only `curl -I` against the
deployed site showed the header was absent. Check deployed headers, not the
preview's.

`sw.js` is generated from `templates/sw.js` with the precache list filled in
and a hash of those files' contents as the cache name, so deploying a new note
invalidates the old cache by itself — there is no version constant to bump.

### The safety property

A service worker registered at the root controls the
whole origin — including `/x17/`, which is online-only by design, and which for
most of this repository's life was published by a machine at the beamline that
knew nothing about a service worker. So the fetch handler is an **allowlist**, the same
discipline as `PAYLOAD`: it calls `respondWith()` only for paths in the
generated precache list and returns without touching anything else, leaving the
browser's normal networking in place. Never widen it to a catch-all.

## Tests

There is no CI; run these by hand. Nothing here needs a browser or a network.

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

## TODO

- Confirm the affiliation line: the CV lists *Affiliated Researcher, The
  University of Manchester* while its address block is CERN.
- Fill in the Results section on each project page (marked with a `.stub`).
