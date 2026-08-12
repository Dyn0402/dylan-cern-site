/* /x17/qa.html — the campaign's run table, from data/x17-runs.json.

   Two views over the same 161 rows, because "is this run good?" and "what did
   this run get us?" are different questions with different columns:

     processing   sub-runs, size on EOS, how far through the chain it got
     statistics   on-air time, events, rate, and how long the beam was down

   Switching view changes the columns, the strip's colouring and the footer
   totals — never which runs are listed. The mode filter does that, and the
   footer follows it, because a total that ignores the filter above it is a lie.
   That rule, the mode chips and the newest-first default are carried over from
   the retired shift dashboard's run list, which is archived at /x17/live/#runs.

   Everything is frozen; scripts/freeze_x17_runs.py says where each number comes
   from. Status and mode are never carried by colour alone — every bar and row
   states its category in words. */

(() => {
  'use strict';
  const { css, fitCanvas, register, makeTip } = window.viz;

  const tbody = document.getElementById('run-rows');
  if (!tbody) return;

  const canvas = document.getElementById('strip-canvas');
  const thead = document.getElementById('run-head');
  const tfoot = document.getElementById('run-foot');
  const filterEl = document.getElementById('run-filter');
  const countEl = document.getElementById('run-count');
  const legendEl = document.getElementById('strip-legend');
  const capEl = document.getElementById('strip-cap');

  const STATUS = {
    complete: { label: 'fully processed', tok: '--good' },
    partial: { label: 'partly processed', tok: '--warning' },
    'raw only': { label: 'raw only', tok: '--series-1' },
    empty: { label: 'no data', tok: '--muted' },
  };
  const MODE = {
    beam: { label: 'Beam', tok: '--series-1' },
    cosmics: { label: 'Cosmics', tok: '--series-2' },
    pulser: { label: 'Pulser', tok: '--muted' },
  };

  const PAD = { l: 46, r: 14, t: 22, b: 24 };
  // Below this a sub-run's rate is dominated by start/stop overhead, so it is
  // drawn but not allowed to set the axis. See drawSubStrip().
  const MIN_RATE_SECS = 60;

  /* Nice round tick step: 1/2/2.5/5 x 10^n, aiming for four or five of them. */
  function tickStep(max) {
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw || 1));
    return ([1, 2, 2.5, 5, 10].find(m => m * mag >= raw) || 10) * mag;
  }

  const fmtInt = v => Math.round(v).toLocaleString('en-GB');
  const fmtM = v => v >= 1e6 ? (v / 1e6).toFixed(2) + ' M'
    : v >= 1e3 ? (v / 1e3).toFixed(0) + ' k' : String(v);
  const gb = v => v >= 1000 ? (v / 1000).toFixed(2) + ' TB' : v.toFixed(1) + ' GB';
  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
  const hrs = v => v ? v.toFixed(1) + ' h' : '—';
  const hoursText = h => h >= 1 ? h.toFixed(1) + ' h' : Math.round(h * 60) + ' min';
  const dash = '<span class="dim">—</span>';

  const esc = s => String(s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const when = t => t ? t.replace('T', ' ').slice(5) : '—';   // drop the year: one campaign

  function chip(kind, tok, label) {
    return `<span class="chip ${kind}" style="color:var(${tok});` +
      `border-color:color-mix(in srgb, var(${tok}) 40%, transparent)">${label}</span>`;
  }

  /* ---- the two views ------------------------------------------------------
     A column is {key, label, num, cell}. `key` is also the sort key, so a
     column is sortable by construction and nothing has to be kept in step. */

  const COL = {
    run: { key: 'n', label: 'Run', num: true, cell: r => `<b>run_${r.n}</b>` },
    mode: {
      key: 'mode', label: 'Mode', num: false,
      // The scan badge rides in the same cell rather than taking a column of
      // its own: it qualifies the mode rather than competing with it, and the
      // table is already wide.
      cell: r => chip('mode', MODE[r.mode].tok, MODE[r.mode].label) +
        (r.hv ? `<span class="badge hv" title="HV scan — ${hvLabel(r)}">HV×${r.hv.p}</span>` : ''),
    },
    started: { key: 't', label: 'Started', num: false, cell: r => when(r.t), cls: 'dim' },
    ended: { key: 'end', label: 'Ended', num: false, cell: r => when(r.end), cls: 'dim' },
    nsub: { key: 'nsub', label: 'Sub-runs', num: true, cell: r => r.nsub },
    live: { key: 'h', label: 'Live', num: true, cell: r => hrs(r.h) },
    air: {
      key: 'hair', label: 'On air', num: true,
      cell: r => r.hair ? hrs(r.hair) : dash,
    },
    events: {
      key: 'ev', label: 'Events', num: true,
      cell: r => r.ev === null ? '<span class="dim">n/a</span>' : fmtM(r.ev),
    },
    rate: {
      key: 'rate', label: 'Events/h', num: true,
      cell: r => r.rate === null ? dash : fmtInt(r.rate),
    },
    off: {
      key: 'offps', label: 'Beam off', num: true,
      cell: r => (r.offps === null || r.offps === undefined) ? dash
        : `${r.offps.toFixed(1)} / ${r.offnt.toFixed(1)} h`,
    },
    size: { key: 'gb', label: 'On EOS', num: true, cell: r => gb(r.gb) },
    cov: {
      key: 'dec', label: 'Decoded', num: true,
      cell: r => r.st === 'empty' ? dash : r.st === 'raw only' ? '0 %'
        : `${pct(r.dec, r.raw)} %`,
    },
    status: {
      key: 'st', label: 'Status', num: false,
      cell: r => chip('st', STATUS[r.st].tok, STATUS[r.st].label),
    },
  };

  const VIEWS = {
    processing: {
      label: 'Processing',
      cap: 'Bar height is live hours; colour is how far the run got through ' +
           'processing. A run with no bar recorded no data.',
      cols: [COL.run, COL.mode, COL.started, COL.nsub, COL.live, COL.size,
             COL.cov, COL.status],
      colour: r => STATUS[r.st].tok,
      legend: Object.values(STATUS),
      // Which columns the footer sums, keyed by column key.
      sums: { nsub: 'int', h: 'hours', gb: 'gb' },
    },
    statistics: {
      label: 'Statistics',
      cap: 'One bar per sub-run on a real time axis: height is the event rate, ' +
           'colour is the run mode, and the gaps are the beam stops. The axis ' +
           'is set by sub-runs longer than a minute; shorter ones, where the ' +
           'rate is mostly start/stop overhead, are drawn clipped with a ' +
           'broken top edge.',
      cols: [COL.run, COL.mode, COL.started, COL.ended, COL.nsub, COL.live,
             COL.air, COL.events, COL.rate, COL.off],
      colour: r => MODE[r.mode].tok,
      legend: Object.values(MODE).map(m => ({ label: m.label, tok: m.tok })),
      sums: { nsub: 'int', h: 'hours', hair: 'hours', ev: 'int' },
    },
  };

  const state = { view: 'processing', mode: 'all', scan: 'all', q: '', sort: 'n', dir: -1 };
  let D = null, rows = [], view = [], subs = [], hover = -1, hoverSub = -1;

  /* ---- strip ------------------------------------------------------------- */

  // Mode and scan are independent axes: a run has one source (beam, cosmics or
  // pulser) and may or may not also be sweeping a voltage while it runs.
  function inView(r) {
    if (state.mode !== 'all' && r.mode !== state.mode) return false;
    if (state.scan === 'hv' && !r.hv) return false;
    if (state.scan === 'steady' && r.hv) return false;
    if (!state.q) return true;
    const hay = `run_${r.n} ${r.beam || ''} ${r.gas || ''} ${r.tgt || ''} ` +
      `${MODE[r.mode].label} ${STATUS[r.st].label} ${r.why || ''} ` +
      `${r.hv ? 'hv scan ' + Object.keys(r.hv.a).join(' ') : ''}`.toLowerCase();
    return state.q.split(/\s+/).filter(Boolean).every(w => hay.includes(w));
  }

  function hvLabel(r) {
    return `${Object.keys(r.hv.a).join(' + ')} · ${r.hv.p} setpoint` +
      (r.hv.p === 1 ? '' : 's');
  }

  function drawStrip() {
    if (state.view === 'statistics' && subs.length) return drawSubStrip();
    return drawRunStrip();
  }

  /* Statistics view: one bar per SUB-RUN, height in events, on a real time
     axis — so beam stops are the gaps between bars rather than something the
     plot has to draw, and the campaign's shape (short commissioning scans, then
     hour-long production sub-runs) is the shape of the plot. This is the shift
     dashboard's run plot, widened from its ten-day window to the whole
     campaign. Runs 1–66 are in it because their event counts were recovered
     from the RunCtrl logs on EOS; they are genuinely small, not missing. */
  function drawSubStrip() {
    const { ctx, w, h } = fitCanvas(canvas, 0.22);
    ctx.clearRect(0, 0, w, h);

    const x0 = PAD.l, x1 = w - PAD.r, y0 = h - PAD.b, y1 = PAD.t;
    const t0 = subs[0][0];
    const t1 = subs.reduce((m, s) => Math.max(m, s[0] + s[1]), t0);

    // Events per hour, not events: sub-runs ran for anything from five seconds
    // to eleven hours, and a raw count compares them only by how long they
    // lasted. The rate is what says whether the detector was doing well.
    //
    // Scale from sub-runs longer than a minute. Below that the rate is mostly
    // start/stop overhead -- a five-second pulser burst reads 3.5 M/h -- and
    // letting those 167 sub-runs (6 % of them) set the axis squashes the
    // production band, which sits at about 100 k/h, into the bottom thirtieth
    // of the plot. Everything is still drawn; what exceeds the axis is clipped
    // with a broken top edge and keeps its true value in the tooltip.
    const rate = s => s[1] > 0 ? s[2] / (s[1] / 3600) : 0;
    const settled = subs.filter(s => s[1] > MIN_RATE_SECS).map(rate)
      .sort((a, b) => a - b);
    const p98 = settled[Math.floor(0.98 * (settled.length - 1))] || 1;
    const step0 = tickStep(p98 * 1.08);
    const evMax = step0 * Math.ceil(p98 * 1.08 / step0);
    const X = t => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
    const Y = v => y0 - (Math.min(v, evMax) / evMax) * (y0 - y1);

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('events per hour, by sub-run', x0, 2);

    const step = tickStep(evMax);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= evMax; v += step) {
      const y = Y(v);
      ctx.strokeStyle = css('--grid');
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(y) + 0.5);
      ctx.lineTo(x1, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = css('--muted');
      ctx.fillText(v ? Math.round(v / 1000) + ' k' : '0', x0 - 7, y);
    }

    // Day boundaries, labelled where there is room. Local midnight, because
    // that is the boundary the shift crew worked to.
    const day0 = new Date(t0 * 1000);
    day0.setHours(0, 0, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = day0.getTime() / 1000; t <= t1; t += 86400) {
      if (t > t0) {
        ctx.strokeStyle = css('--grid');
        ctx.beginPath();
        ctx.moveTo(Math.round(X(t)) + 0.5, y1);
        ctx.lineTo(Math.round(X(t)) + 0.5, y0);
        ctx.stroke();
      }
      const d = new Date(t * 1000);
      if (d.getDate() % 4 === 1 && X(t) > x0 && X(t) < x1 - 20) {
        ctx.fillStyle = css('--muted');
        ctx.fillText(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          X(t), y0 + 6);
      }
    }

    const visible = new Set(rows.filter(inView).map(r => r.n));
    subs.forEach((s, i) => {
      const bx = X(s[0]);
      const bw = Math.max(1, X(s[0] + s[1]) - bx - 0.4);
      const v = rate(s);
      const clipped = v > evMax;
      const top = Y(v);
      ctx.fillStyle = css(MODE[D.mode_order[s[3]]].tok);
      ctx.globalAlpha = !visible.has(s[4]) ? 0.13
        : (hoverSub < 0 || hoverSub === i) ? 1 : 0.55;
      ctx.beginPath();
      ctx.roundRect(bx, top, bw, Math.max(1, y0 - top),
        [Math.min(2, bw / 2), Math.min(2, bw / 2), 0, 0]);
      ctx.fill();
      if (clipped) {
        // Break the bar's top edge so it cannot be read as "this is the value".
        ctx.fillStyle = css('--surface');
        ctx.fillRect(bx - 1, top + 3, bw + 2, 2);
        ctx.fillRect(bx - 1, top + 7, bw + 2, 2);
      }
      ctx.globalAlpha = 1;
    });

    ctx.strokeStyle = css('--axis');
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(y0) + 0.5);
    ctx.lineTo(x1, Math.round(y0) + 0.5);
    ctx.stroke();
  }

  function drawRunStrip() {
    const { ctx, w, h } = fitCanvas(canvas, 0.22);
    ctx.clearRect(0, 0, w, h);
    if (!rows.length) return;

    const V = VIEWS[state.view];
    const x0 = PAD.l, x1 = w - PAD.r, y0 = h - PAD.b, y1 = PAD.t;
    const yMax = Math.max(...rows.map(r => r.h)) * 1.1 || 1;
    const slot = (x1 - x0) / rows.length;

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('live hours per run', x0, 2);

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= yMax; v += 6) {
      const y = y0 - (v / yMax) * (y0 - y1);
      ctx.strokeStyle = css('--grid');
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(y) + 0.5);
      ctx.lineTo(x1, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = css('--muted');
      ctx.fillText(v ? v + ' h' : '0', x0 - 7, y);
    }

    // Runs are always drawn in run order, whatever the table is sorted by --
    // the strip is the campaign's timeline, not a view of the sort.
    rows.forEach((r, i) => {
      const shown = inView(r);
      const bh = Math.max(r.h ? 2 : 0, (r.h / yMax) * (y0 - y1));
      const bw = Math.max(1.5, slot - 1.5);
      ctx.fillStyle = css(V.colour(r));
      ctx.globalAlpha = !shown ? 0.15 : (hover < 0 || hover === i) ? 1 : 0.4;
      ctx.beginPath();
      ctx.roundRect(x0 + i * slot, y0 - bh, bw, bh, [2, 2, 0, 0]);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!r.h) {                       // a run that recorded nothing still gets
        ctx.fillStyle = css('--muted'); // a tick, or it reads as a missing run
        ctx.globalAlpha = shown ? 1 : 0.15;
        ctx.fillRect(x0 + i * slot, y0 - 2, bw, 2);
        ctx.globalAlpha = 1;
      }
    });

    ctx.strokeStyle = css('--axis');
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(y0) + 0.5);
    ctx.lineTo(x1, Math.round(y0) + 0.5);
    ctx.stroke();

    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    rows.forEach((r, i) => {
      if (r.n % 20 === 0) ctx.fillText('run ' + r.n, x0 + (i + 0.5) * slot, y0 + 6);
    });
  }

  function drawLegend() {
    const V = VIEWS[state.view];
    legendEl.innerHTML = V.legend.map(l =>
      `<span><i style="background:var(${l.tok})"></i>${l.label}</span>`).join('');
    capEl.textContent = V.cap;
  }

  /* ---- table ------------------------------------------------------------- */

  function detailHtml(r) {
    const bits = [];
    if (r.why) bits.push(`<p class="why">${esc(r.why)}</p>`);
    const facts = [
      ['Mode', MODE[r.mode].label + (r.phys ? '' : ' · not physics')],
      ['HV scan', r.hv ? hvLabel(r) : 'no — one setpoint throughout'],
      ['Beam type', r.beam], ['Gas', r.gas], ['Target', r.tgt],
      ['Sub-runs', r.nsub], ['FEUs', r.feus.length ? r.feus.join(' / ') : '—'],
      ['Live', hrs(r.h)], ['On air', r.hair ? hrs(r.hair) : '—'],
      ['Started', r.t ? r.t.replace('T', ' ') : '—'],
      ['Ended', r.end ? r.end.replace('T', ' ') : '—'],
      ['Events', r.ev === null ? 'n/a (before the ledger)' : fmtInt(r.ev)],
      ['Events/h', r.rate === null ? '—' : fmtInt(r.rate)],
      ['Beam off PS / nTOF', (r.offps === null || r.offps === undefined)
        ? '—' : `${r.offps.toFixed(2)} / ${r.offnt.toFixed(2)} h`],
      ['Raw files', fmtInt(r.raw)],
      ['Decoded', `${fmtInt(r.dec)} / ${fmtInt(r.raw)}`],
      ['Hits', `${fmtInt(r.hit)} / ${fmtInt(r.dec)}`],
      ['Combined', `${fmtInt(r.cmb)} / ${fmtInt(r.exp)}`],
      ['Pedestal files', r.ped ? fmtInt(r.ped) : '—'],
      ['On EOS', gb(r.gb)],
      ['Status', STATUS[r.st].label],
    ];
    bits.push('<ul class="facts">' + facts.map(([k, v]) =>
      `<li><span class="k">${k}</span><span class="v">` +
      `${v === null || v === undefined || v === '' ? '—' : esc(String(v))}` +
      `</span></li>`).join('') + '</ul>');

    if (r.n_bad) {
      const shown = r.bad.map(b =>
        `<li><code>${esc(b.s)}</code> — ${esc(b.w)}</li>`).join('');
      const more = r.n_bad > r.bad.length
        ? `<li class="dim">…and ${r.n_bad - r.bad.length} more</li>` : '';
      // Deliberately neutral: the list mixes short products (a processing gap,
      // fixable by reprocessing) with a missing hv_monitor.csv or run_time.txt
      // (a monitoring gap, not fixable at all). Calling the whole list one
      // thing would be wrong about half of it.
      bits.push(`<p class="why"><b>${r.n_bad} sub-run check${r.n_bad > 1 ? 's' : ''} ` +
        `not satisfied.</b> A short product means processing did not finish and ` +
        `can be re-run; a missing monitor file means it was never written. ` +
        `Neither means raw data is missing — that would show in the raw count ` +
        `above.</p><ul class="bad-list">${shown}${more}</ul>`);
    }
    if (r.cfg_err) {
      bits.push(`<p class="why"><b>No usable run_config.json</b> — ${esc(r.cfg_err)}</p>`);
    }
    return bits.join('');
  }

  function render() {
    const V = VIEWS[state.view];

    thead.innerHTML = '<tr>' + V.cols.map(c => {
      const on = c.key === state.sort;
      return `<th data-sort="${c.key}" tabindex="0" role="button"` +
        (on ? ` data-dir="${state.dir > 0 ? 'up' : 'down'}"` +
          ` aria-sort="${state.dir > 0 ? 'ascending' : 'descending'}"` : '') +
        `>${c.label}</th>`;
    }).join('') + '</tr>';

    const col = V.cols.find(c => c.key === state.sort) || V.cols[0];
    view = rows.filter(inView).sort((a, b) => {
      let x = a[col.key], y = b[col.key];
      if (x === null || x === undefined) x = col.num ? -Infinity : '';
      if (y === null || y === undefined) y = col.num ? -Infinity : '';
      if (x === y) return b.n - a.n;
      return (x > y ? 1 : -1) * state.dir;
    });

    tbody.innerHTML = view.length ? view.map(r =>
      `<tr class="run-row" data-run="${r.n}" tabindex="0">` +
      V.cols.map(c => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.cell(r)}</td>`).join('') +
      '</tr>' +
      `<tr class="run-detail" data-detail="${r.n}" hidden>` +
      `<td colspan="${V.cols.length}">${detailHtml(r)}</td></tr>`).join('')
      : `<tr><td class="empty" colspan="${V.cols.length}">No run matches that filter.</td></tr>`;

    renderFoot(V);
    countEl.textContent = view.length === rows.length
      ? `${rows.length} runs`
      : `${view.length} of ${rows.length} runs`;
  }

  function renderFoot(V) {
    // Non-physics runs are excluded from every total, the same rule the DAQ's
    // own statistics use -- a saturating-pulser ladder would otherwise post a
    // million events an hour and wreck the average.
    const shown = view.filter(r => r.phys);
    if (!view.length) { tfoot.innerHTML = ''; return; }
    if (!shown.length) {
      tfoot.innerHTML = `<tr><td colspan="${V.cols.length}" class="foot-note">` +
        'Not counted — non-physics runs are excluded from the totals.</td></tr>';
      return;
    }
    const sum = k => shown.reduce((a, r) => a + (r[k] || 0), 0);
    tfoot.innerHTML = '<tr>' + V.cols.map((c, i) => {
      if (i === 0) return `<td>${shown.length} run${shown.length > 1 ? 's' : ''}</td>`;
      const how = V.sums[c.key];
      if (!how) return '<td></td>';
      const v = sum(c.key);
      return `<td>${how === 'hours' ? v.toFixed(1) + ' h'
        : how === 'gb' ? gb(v) : fmtInt(v)}</td>`;
    }).join('') + '</tr>';
  }

  /* ---- wiring ------------------------------------------------------------ */

  function setView(name, push) {
    if (!VIEWS[name]) return;
    state.view = name;
    document.querySelectorAll('[data-view]').forEach(b => {
      const on = b.dataset.view === name;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (push && location.hash.slice(1) !== name) {
      history.replaceState(null, '', '#' + name);
    }
    drawLegend();
    render();
    drawStrip();
  }

  function fillStats() {
    const s = D.summary;
    const shown = { runs: s.runs, subruns: s.subruns,
                    hours: Math.round(s.hours), tb: s.tb.toFixed(2),
                    events: fmtM(s.events), hv_scans: s.hv_scans };
    document.querySelectorAll('[data-run-stat]').forEach(el => {
      const v = shown[el.dataset.runStat];
      if (v !== undefined) el.textContent = typeof v === 'number' ? fmtInt(v) : v;
    });
  }

  function init() {
    rows = D.runs;
    subs = D.subs || [];
    fillStats();

    document.querySelectorAll('[data-view]').forEach(b =>
      b.addEventListener('click', () => setView(b.dataset.view, true)));
    const group = (attr, key) =>
      document.querySelectorAll(`[data-${attr}]`).forEach(b =>
        b.addEventListener('click', () => {
          state[key] = b.dataset[attr];
          document.querySelectorAll(`[data-${attr}]`).forEach(o =>
            o.setAttribute('aria-pressed', o === b ? 'true' : 'false'));
          render();
          drawStrip();   // the strip dims what the filter excludes, so both
        }));
    group('mode', 'mode');
    group('scan', 'scan');

    filterEl.addEventListener('input', () => {
      state.q = (filterEl.value || '').toLowerCase();
      render();
      drawStrip();
    });
    filterEl.hidden = false;

    // Delegated: render() replaces the whole header and body on every change.
    thead.addEventListener('click', e => sortBy(e.target.closest('th')));
    thead.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        sortBy(e.target.closest('th'));
      }
    });
    tbody.addEventListener('click', e => toggle(e.target.closest('.run-row')));
    tbody.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle(e.target.closest('.run-row'));
      }
    });

    const tip = makeTip(canvas.parentElement);
    canvas.addEventListener('mousemove', e => {
      const box = canvas.getBoundingClientRect();
      const mx = e.clientX - box.left, my = e.clientY - box.top;
      const x0 = PAD.l, x1 = canvas.clientWidth - PAD.r;

      if (state.view === 'statistics' && subs.length) {
        // Nearest bar by centre, not a hit test: an hour-long sub-run is about
        // one pixel wide over a 39-day axis and would be unhittable otherwise.
        const t0 = subs[0][0];
        const t1 = subs.reduce((m, s) => Math.max(m, s[0] + s[1]), t0);
        const t = t0 + ((mx - x0) / (x1 - x0)) * (t1 - t0);
        let best = -1, bd = Infinity;
        subs.forEach((s, i) => {
          const d = Math.abs(s[0] + s[1] / 2 - t);
          if (d < bd) { bd = d; best = i; }
        });
        if (best < 0) { tip.hide(); return; }
        hoverSub = best;
        drawStrip();
        const s = subs[best];
        const when = new Date(s[0] * 1000);
        const mode = MODE[D.mode_order[s[3]]];
        const rt = s[1] > 0 ? s[2] / (s[1] / 3600) : null;
        tip.show(
          `<div class="tt-title">run_${s[4]} · sub-run</div>` +
          `<b>${rt === null ? '—' : fmtInt(rt) + ' /h'}</b>` +
          ` · ${fmtInt(s[2])} events in ${hoursText(s[1] / 3600)}` +
          `${s[1] <= MIN_RATE_SECS ? ' <span style="color:var(--muted)">(too short to rate)</span>' : ''}<br>` +
          `${when.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` +
          ` · <span style="color:var(${mode.tok})">■</span> ${mode.label}`,
          mx, my);
        return;
      }

      const i = Math.floor(((mx - x0) / (x1 - x0)) * rows.length);
      if (i < 0 || i >= rows.length) { tip.hide(); hover = -1; drawStrip(); return; }
      hover = i;
      drawStrip();
      const d = rows[i];
      tip.show(
        `<div class="tt-title">run_${d.n} · ${d.t ? d.t.slice(5, 10) : 'no date'}</div>` +
        `<b>${d.h ? d.h.toFixed(1) + ' h' : 'no data'}</b> · ${d.nsub} sub-runs` +
        `${d.ev === null ? '' : ' · ' + fmtM(d.ev) + ' events'}<br>` +
        `<span style="color:var(${MODE[d.mode].tok})">■</span> ${MODE[d.mode].label}` +
        ` · <span style="color:var(${STATUS[d.st].tok})">■</span> ${STATUS[d.st].label}`,
        mx, my);
    });
    canvas.addEventListener('mouseleave', () => {
      tip.hide(); hover = -1; hoverSub = -1; drawStrip();
    });

    window.addEventListener('hashchange', () => setView(location.hash.slice(1), false));
    setView(VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'processing', false);
    register(drawStrip);
  }

  function sortBy(th) {
    if (!th || !th.dataset.sort) return;
    const key = th.dataset.sort;
    // A new column starts descending for numbers (biggest first is what you
    // want from "Events") and ascending for text.
    const col = VIEWS[state.view].cols.find(c => c.key === key);
    state.dir = key === state.sort ? -state.dir : (col && col.num ? -1 : 1);
    state.sort = key;
    render();
  }

  function toggle(tr) {
    if (!tr) return;
    const d = tbody.querySelector(`[data-detail="${tr.dataset.run}"]`);
    if (d) d.hidden = !d.hidden;
  }

  fetch('../data/x17-runs.json')
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(payload => { D = payload; init(); })
    .catch(() => {
      const f = document.getElementById('runs-fallback');
      if (f) f.hidden = false;
    });
})();
