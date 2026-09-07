/* /x17/analysis.html — the preliminary analysis board.

   The board is a hand-written fragment, not a rendered dataset, so this script
   does no layout and draws nothing. It does exactly two things, both of which
   exist to stop the page contradicting itself:

   1. The "where we stand" tiles are COUNTED FROM THE PIPELINE below them —
      stages by data-status, deferred rows, unresolved questions. Change a
      stage's status and the tiles follow; there is no second place to edit and
      therefore no way for the headline to be wrong about the body.

   2. The four input tiles take their headline numbers from the same frozen
      JSON the QA pages read, so this row cannot drift from the pages it links
      to. Fetch failures are silent — the static markup already carries the
      right numbers and is what a reader with no JS sees.

   Neither is load-bearing. With JavaScript off the page is complete; these
   only remove a maintenance obligation. */

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---- 1. tiles counted from the body ---------------------------------- */

  const stats = $('#board-stats');
  if (stats) {
    const stages = $$('.stage-list .stage');
    const count = s => stages.filter(el => el.dataset.status === s).length;

    /* A question is open unless it has been explicitly resolved, so a hand-
       written <li class="q"> with no data-status counts as open — the failure
       mode we want is over-reporting open questions, not under-reporting. */
    const open = $$('.qlist .q').filter(el => el.dataset.status !== 'resolved');

    const set = (key, val) =>
      $$(`[data-board-stat="${key}"]`, stats).forEach(el => { el.textContent = String(val); });

    set('total', stages.length);
    set('done', count('done'));
    set('active', count('active'));
    set('blocked', count('blocked'));
    set('questions', open.length);
  }

  /* ---- 2. input tiles from the frozen QA data --------------------------- */

  const fmtInt = v => Math.round(v).toLocaleString('en-GB');

  /* Each entry: where the JSON lives, and what to pull out of it. `n` returns
     the headline string for the tile; `sub` optionally rewrites the caption.
     Both may return null to mean "leave the markup alone", which is what an
     unexpected shape should do rather than writing "undefined" onto the page. */
  const INPUTS = {
    dream: {
      src: 'x17-runs.json',
      n: d => d.summary && d.summary.runs ? fmtInt(d.summary.runs) : null,
    },
    ntof: {
      src: 'x17-ntof-runs.json',
      n: d => Array.isArray(d.runs) ? fmtInt(d.runs.length) : null,
    },
    match: {
      src: 'x17-match.json',
      /* The board's headline for the match is the pulse-level number, not the
         segment count: what an analysis needs to know is what fraction of the
         beam can be put on the n_TOF clock at all. */
      n: d => {
        const p = d.pulses;
        if (!p || !p.den) return null;
        return (100 * p.matched / p.den).toFixed(2) + ' %';
      },
      sub: d => {
        const p = d.pulses;
        if (!p || !p.den) return null;
        return `${fmtInt(p.matched)} of ${fmtInt(p.den)} matchable pulses on one clock, at the ` +
          `${Math.round(100 * (p.accept_frac ?? 0.6))} % per-pulse bar. This is what makes an ` +
          `event an n_TOF event.`;
      },
    },
    pedestals: {
      src: 'x17-pedestals.json',
      n: d => d.n_sets ? fmtInt(d.n_sets) : null,
    },
  };

  /* The board sits at /x17/, one level below the site root, same as the QA
     pages — so data/ is reached the same way they reach it. */
  const ROOT = '../data/';

  Object.entries(INPUTS).forEach(([key, spec]) => {
    const tile = $(`[data-input="${key}"]`);
    if (!tile) return;
    fetch(ROOT + spec.src)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then(d => {
        const n = spec.n(d);
        if (n !== null && $('.n', tile)) $('.n', tile).textContent = n;
        const sub = spec.sub ? spec.sub(d) : null;
        if (sub !== null && $('.d', tile)) $('.d', tile).textContent = sub;
      })
      .catch(() => { /* static markup stands */ });
  });

  /* ---- 3. the "as of" stamp -------------------------------------------- */

  /* The newest log entry dates the board. Reading it from the log rather than
     from a hand-typed date means the header cannot claim to be current while
     the last entry is a week old. */
  const first = $('.log .log-entry .log-when');
  const asof = $('#board-asof');
  if (first && asof) {
    const iso = first.textContent.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, d] = iso.split('-').map(Number);
      const pretty = new Date(Date.UTC(y, m - 1, d))
        .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      asof.textContent = `last entry ${pretty}`;
    }
  }
})();
