/* Shared machinery for the three /x17/ QA tables.

   The DREAM runs, the n_TOF runs and the segments that join them are three
   different things and get three pages, but they are all "a sortable table of
   frozen rows, each expanding into a fact list, with a filter row above and a
   total row below". That part is here; each page supplies its own columns,
   filters, detail block and plot.

   Loaded before the page's own script. Everything hangs off window.x17 so the
   pages stay plain <script> tags with no module plumbing.

   The one rule worth stating: a column is {key, label, num, cell}, and `key` is
   BOTH the sort key and the field it reads, so a column is sortable by
   construction and nothing has to be kept in step by hand. */

(() => {
  'use strict';

  const esc = s => String(s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const fmt = {
    int: v => Math.round(v).toLocaleString('en-GB'),
    M: v => v >= 1e6 ? (v / 1e6).toFixed(2) + ' M'
      : v >= 1e3 ? (v / 1e3).toFixed(0) + ' k' : String(v),
    gb: v => v >= 1000 ? (v / 1000).toFixed(2) + ' TB' : v.toFixed(1) + ' GB',
    pct: (a, b) => b ? Math.round(100 * a / b) : 0,
    hrs: v => v ? v.toFixed(1) + ' h' : '—',
    hoursText: h => h >= 1 ? h.toFixed(1) + ' h' : Math.round(h * 60) + ' min',
    mins: v => v >= 60 ? (v / 60).toFixed(1) + ' h' : Math.round(v) + ' min',
    dash: '<span class="dim">—</span>',
    esc,
  };

  /* Timestamps. Every QA page renders epochs through these and only these, so
     the tables cannot drift into different formats or -- much worse -- into
     different clocks.

     UTC, always, and never the reader's own zone. The two DAQs recorded local
     time in two different ways (the n_TOF index tree stamps UTC+2 and the
     listing reads it as UTC; the DREAM run config writes a bare local string
     with no zone at all), both are corrected to true UTC when the data is
     frozen, and re-rendering here would undo that for anyone outside CEST while
     looking perfectly correct to everyone in it.

     The year is dropped: the whole campaign is one year. */
  fmt.utcDay = { timeZone: 'UTC', day: 'numeric', month: 'short' };
  fmt.utcMin = { ...fmt.utcDay, hour: '2-digit', minute: '2-digit' };
  fmt.stamp = (t, o) => (t === null || t === undefined) ? fmt.dash
    : new Date(t * 1000).toLocaleString('en-GB', o || fmt.utcMin);

  /* Nice round tick step: 1/2/2.5/5 x 10^n, aiming for four or five of them. */
  function tickStep(max) {
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw || 1));
    return ([1, 2, 2.5, 5, 10].find(m => m * mag >= raw) || 10) * mag;
  }

  /* A category chip that carries its colour as an inline custom-property blend,
     so the palette stays in style.css and the chip stays a token reference. */
  function chip(kind, tok, label) {
    return `<span class="chip ${kind}" style="color:var(${tok});` +
      `border-color:color-mix(in srgb, var(${tok}) 40%, transparent)">${label}</span>`;
  }

  /* A <ul class="facts"> from [[key, value], ...]; null/'' render as an em dash
     rather than as an empty cell, so a missing value is visibly missing. */
  function facts(pairs) {
    return '<ul class="facts">' + pairs.filter(Boolean).map(([k, v]) =>
      `<li><span class="k">${esc(k)}</span><span class="v">` +
      `${v === null || v === undefined || v === '' ? '—' : esc(String(v))}` +
      `</span></li>`).join('') + '</ul>';
  }

  /* A read-only table inside an expanded row: the parts a row is made of.

     Not sortable and not filterable, deliberately. It is a handful of rows in
     their natural order — a run's sub-runs as they were taken, a segment's arms
     as they are wired — and sorting controls on it would compete with the ones
     on the table it is nested inside for no gain.

     cols: [{label, num, cell}], rows: whatever cell() reads. */
  function subTable(cols, rows, caption) {
    if (!rows.length) return '';
    return (caption ? `<p class="sub-cap">${caption}</p>` : '') +
      '<div class="sub-scroll"><table class="sub-table"><thead><tr>' +
      cols.map(c => `<th${c.num ? ' class="num"' : ''}>${c.label}</th>`).join('') +
      '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + cols.map(c =>
        `<td${c.num ? ' class="num"' : ''}${c.cls ? ` class="${c.cls}"` : ''}>` +
        `${c.cell(r)}</td>`).join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }

  /* Wire a group of aria-pressed buttons carrying data-<attr>. Calls back with
     the chosen value; the caller owns what that means. */
  function switchGroup(attr, onPick) {
    const btns = document.querySelectorAll(`[data-${attr}]`);
    btns.forEach(b => b.addEventListener('click', () => {
      btns.forEach(o => o.setAttribute('aria-pressed', o === b ? 'true' : 'false'));
      onPick(b.dataset[attr]);
    }));
  }

  /* ---- the table ----------------------------------------------------------

     opts: {head, body, foot, count, noun, cols, sort, dir, detail, total, ...}
       detail(row)  -> HTML for the expanded panel, or '' for no expansion
       total(rows)  -> [cellHtml or '', ...] aligned to cols, or null for none
       footNote     -> shown instead of a total row when total() returns null
       tie(a, b)    -> tie-break when two rows share the sort key
       empty        -> the message when the filter matches nothing
       onSort()     -> called after a header click; re-run your render()      */
  function makeTable(opts) {
    const { head, body, foot, count } = opts;
    const state = { sort: opts.sort, dir: opts.dir === undefined ? -1 : opts.dir };
    let cols = opts.cols, rows = [], all = 0;

    function render(shown, totalCount) {
      rows = shown;
      all = totalCount === undefined ? shown.length : totalCount;

      head.innerHTML = '<tr>' + cols.map(c => {
        const on = c.key === state.sort;
        return `<th data-sort="${c.key}" tabindex="0" role="button"` +
          (c.title ? ` title="${esc(c.title)}"` : '') +
          (on ? ` data-dir="${state.dir > 0 ? 'up' : 'down'}"` +
            ` aria-sort="${state.dir > 0 ? 'ascending' : 'descending'}"` : '') +
          `>${c.label}</th>`;
      }).join('') + '</tr>';

      const col = cols.find(c => c.key === state.sort) || cols[0];
      // Ties break on the natural order the freeze script emitted, so a sort on
      // a coarse column (a status word, say) is still deterministic.
      rows = shown.slice().sort((a, b) => {
        let x = a[col.key], y = b[col.key];
        if (x === null || x === undefined) x = col.num ? -Infinity : '';
        if (y === null || y === undefined) y = col.num ? -Infinity : '';
        if (x === y) return opts.tie ? opts.tie(a, b) : 0;
        return (x > y ? 1 : -1) * state.dir;
      });

      // The row/detail pairing is by POSITION, not by any field of the row.
      // A segment is identified by something like `run_100/0000x224600`, and
      // putting that in an attribute selector means escaping it correctly on
      // every path; an index cannot be got wrong. Both are re-rendered
      // together on every sort, so they cannot drift.
      body.innerHTML = rows.length ? rows.map((r, i) => {
        const det = opts.detail ? opts.detail(r) : '';
        return `<tr class="run-row${det ? '' : ' flat'}" data-row="${i}"` +
          `${det ? ' tabindex="0"' : ''}>` +
          cols.map(c => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.cell(r)}</td>`)
            .join('') + '</tr>' +
          (det ? `<tr class="run-detail" data-detail="${i}" hidden>` +
            `<td colspan="${cols.length}">${det}</td></tr>` : '');
      }).join('')
        : `<tr><td class="empty" colspan="${cols.length}">${opts.empty}</td></tr>`;

      if (foot) {
        const cells = rows.length && opts.total ? opts.total(rows) : null;
        foot.innerHTML = cells
          ? '<tr>' + cols.map((c, i) => `<td>${cells[i] || ''}</td>`).join('') + '</tr>'
          : (rows.length && opts.footNote
            ? `<tr><td colspan="${cols.length}" class="foot-note">${opts.footNote}</td></tr>`
            : '');
      }
      if (count) {
        count.textContent = rows.length === all
          ? `${all} ${opts.noun}` : `${rows.length} of ${all} ${opts.noun}`;
      }
    }

    function sortBy(th) {
      if (!th || !th.dataset.sort) return;
      const key = th.dataset.sort;
      // A new column starts descending for numbers (biggest first is what you
      // want from "Events") and ascending for text.
      const col = cols.find(c => c.key === key);
      state.dir = key === state.sort ? -state.dir : (col && col.num ? -1 : 1);
      state.sort = key;
      opts.onSort();
    }

    function toggle(tr) {
      if (!tr) return;
      const d = body.querySelector(`[data-detail="${tr.dataset.row}"]`);
      if (d) d.hidden = !d.hidden;
    }

    head.addEventListener('click', e => sortBy(e.target.closest('th')));
    head.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        sortBy(e.target.closest('th'));
      }
    });
    body.addEventListener('click', e => toggle(e.target.closest('.run-row')));
    body.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle(e.target.closest('.run-row'));
      }
    });

    return {
      render,
      setCols(next) { cols = next; },
      get sort() { return state.sort; },
      set sort(k) { state.sort = k; },
      get dir() { return state.dir; },
      set dir(d) { state.dir = d; },
    };
  }

  /* Fetch a frozen dataset, or reveal the page's [id] fallback paragraph. */
  function load(url, fallbackId, then) {
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(then)
      .catch(() => {
        const f = document.getElementById(fallbackId);
        if (f) f.hidden = false;
      });
  }

  window.x17 = { fmt, esc, chip, facts, subTable, tickStep, switchGroup,
                 makeTable, load };
})();
