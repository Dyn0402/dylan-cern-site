---
name: x17-board
description: Read or update the X17 preliminary analysis board at dylan-neff.web.cern.ch/x17/analysis.html — the standing dashboard for the 2026 n_TOF campaign analysis (status, the pipeline, deferred work, open questions, a dated log). Use from any repo whenever the user wants to record a decision, log what was found, mark an analysis stage done or blocked, note something as deferred, raise or answer an open question, or check where the analysis stands. Also use when they say "put this on the board", "log this", "update the dashboard", or ask "what's left / what are we skipping / where are we".
user-invocable: true
---

# The X17 preliminary analysis board

A standing, internal dashboard for the first end-to-end pass over the 2026
n_TOF X17 campaign. It lives at
<https://dylan-neff.web.cern.ch/x17/analysis.html> and its source is
`pages/x17/analysis.html` in the `dylan-cern-site` repo:

- `~/PycharmProjects/dylan-cern-site` (Linux/Mac)
- `C:\Users\Dylan\PycharmProjects\dylan-cern-site` (Windows)

**You do not need to open, read or `cd` into that repo.** Everything below runs
from anywhere. If neither path exists, search for `x17_board.py` before giving
up.

## Posture

This is an internal working page nobody outside the group reads, and updating
it is not a high-stakes action. Default to just doing it:

- Don't ask for confirmation before adding a log entry, flipping a stage or
  recording a question. Write it and say what you wrote.
- Prefer `--deploy` — the board is only useful when it is live. Skip it only
  if the user says "don't push" / "just stage it".
- Pick the wording yourself. A log entry should read like a sentence a
  colleague would write, with the number in it: "Sample frozen at 88 beam runs,
  1,412 sub-runs — HV-scan runs excluded" beats "updated the sample".
- Prose belongs in the entry; don't pad it with a preamble about what you did.

The one thing worth pausing on is a `--deploy` that fails on Kerberos — see
the bottom of this file. That's a blocker to report, not a gate.

## Picking a Python interpreter

`x17_board.py` and `build.py` are stdlib-only — no venv, no deps.

- Linux/Mac: `python3`.
- Windows: **not** bare `python`/`python3` — those hit the Microsoft Store alias
  stub and fail with "Python was not found". Use the `py` launcher.

Below, `<py>` means whichever of those applies and `<REPO>` the path above.

## The commands

```
<py> <REPO>/scripts/x17_board.py show
```

Read the board first when you need to know what is there — it prints the
pipeline with each stage's slug and status, the open questions, the recent log
and the deferred count. The slugs are what the `stage` command takes.

```
# a dated log entry — the most common thing by far
<py> <REPO>/scripts/x17_board.py log "Sample frozen at 88 beam runs" \
      --tag sample,decision --deploy

# with a link out to a note or a QA page
<py> ... log "Flash veto set to 1.8 us" --link ../notes/x.html --link-text "the measurement"

# move a pipeline stage; --note writes the matching log entry in one go
<py> ... stage recon --status done --note "Grid pass finished, 1,412 sub-runs" --deploy
<py> ... stage spectrum --status blocked --note "Waiting on the acceptance curve"

# open questions
<py> ... question "One flash veto for the campaign, or one per chamber?"
<py> ... question --resolve "flash veto" --answer "Per chamber — A recovers slower."

# something deliberately not being done. BOTH flags are required, by design:
# without them 'we skipped it' gets read later as 'we forgot it'.
<py> ... defer "Per-channel gain map" \
      --why "one gain per chamber is enough for a preliminary spectrum" \
      --unblock "a pass over the pulser runs"

# a note or child page the week produced. Omit --href for written-not-published.
<py> ... output "Frozen sample definition" --href ../notes/x17-prelim-sample.html \
      --desc "Which runs entered the preliminary analysis, and why each was cut."
```

Stage statuses are `todo`, `active`, `done`, `blocked`. Dates default to today;
`--date YYYY-MM-DD` overrides. Text is HTML-escaped for you — pass `--html`
only if you are deliberately writing markup.

Every command rebuilds the site. Nothing leaves the machine without `--deploy`;
the deploy command is printed either way.

## Anything structural: edit the file

The board is **hand-written HTML, not a rendered dataset** — that is deliberate,
so it stays something you can restructure freely. The script only covers the
repetitive entries. For anything else, edit `<REPO>/pages/x17/analysis.html`
directly, then:

```
<py> <REPO>/scripts/build.py && <REPO>/scripts/deploy-eos.sh
```

Things you edit by hand rather than through the script:

- **The one-line status** in the `.verdict-card` near the top. It is the first
  thing anyone reads — update it when the picture changes, and don't let it go
  stale.
- **Adding, removing or rewriting a pipeline stage.** Copy an existing
  `<li class="stage" data-stage="…" data-status="…">` block. Numbering is a CSS
  counter, so inserting one in the middle needs no renumbering.
- **New sections, tables, plots** — ordinary markup, the site's `style.css` is
  already loaded.

Two rules that matter:

- **Never hand-edit the "where we stand" numbers.** They are counted from the
  pipeline by `js/x17-analysis.js`. Change the stage instead.
- **Keep the marker comments** (`<!-- board:log:start -->` … `<!-- board:log:end -->`,
  and the same for `questions`, `deferred`, `outputs`). The script writes
  between them and stops with an explanation if one is missing. Everything
  *between* them can be reformatted however you like.

## Child pages and notes

The board is meant to grow children. A longer piece of work — a study, a plot
set, a write-up — belongs in a note published with the `publish-note` skill
(`scripts/add-note.py`), and then linked from the board:

```
<py> <REPO>/scripts/x17_board.py output "Opening-angle spectrum, first look" \
      --href ../notes/<slug>.html --desc "…" --deploy
```

Note hrefs are written relative to `/x17/`, so `../notes/<slug>.html`.

## What the board stands on — don't rebuild these

The four run-QA pages are **finished and frozen**. The board links them and
takes its input numbers from the same frozen JSON they use. Never re-derive
them, and never make a second copy of one:

| page | what it is |
|---|---|
| `/x17/qa.html` | every DREAM run — sub-runs, live hours, processing state |
| `/x17/qa-ntof.html` | the n_TOF runs over the same beam |
| `/x17/qa-match.html` | the join: the two DAQs on one clock |
| `/x17/qa-pedestals.html` | the noise floor under all 4,096 channels |

If a QA number is wrong, the fix belongs on that page (and its freeze script in
`dylan-cern-site/scripts/`), not on the board.

## When deploy fails

`deploy-eos.sh` needs a Kerberos ticket forwarded to lxplus. "Permission
denied" on `/eos` usually means the forwarded ticket expired while the
`ControlPersist` master is still up with stale credentials. Tell the user to
run, in their own terminal:

```
kinit dneff@CERN.CH
ssh -O exit lxplus
```

then retry. The build already succeeded at that point, so nothing is lost.

Also: `deploy-eos.sh` is bash and invokes `python3` — on Windows run it from
Git Bash, or build with the `py` launcher and deploy from a shell that has a
working `python3`.
