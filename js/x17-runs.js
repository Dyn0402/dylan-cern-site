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
  const { fmt, esc, chip, facts, subTable, tickStep, switchGroup,
          makeTable, load } = window.x17;

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

  const { int: fmtInt, M: fmtM, gb, pct, hrs, hoursText, dash } = fmt;
  // Shared with the n_TOF and match tables: one format, one clock.
  const { stamp: when, utcDay } = fmt;

  /* ---- the two views ------------------------------------------------------
     Columns, sorting and row expansion come from js/x17-table.js. */

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
    started: { key: 't', label: 'Started', num: true, cell: r => when(r.t), cls: 'dim' },
    ended: { key: 'end', label: 'Ended', num: true, cell: r => when(r.end), cls: 'dim' },
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
      legend: STATUS,
      legendKey: r => r.st,
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
      legend: MODE,
      legendKey: r => r.mode,
      sums: { nsub: 'int', h: 'hours', hair: 'hours', ev: 'int' },
    },
  };

  // Sort column and direction live in the table, not here.
  const state = { view: 'processing', mode: 'all', scan: 'all', q: '' };
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

    // Day boundaries, labelled where there is room. Midnight UTC, the same
    // clock every timestamp on these pages is on -- drawing them at the
    // reader's local midnight would put the gridlines somewhere other than
    // where the dates beside them say.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = Math.ceil(t0 / 86400) * 86400 - 86400; t <= t1; t += 86400) {
      if (t > t0) {
        ctx.strokeStyle = css('--grid');
        ctx.beginPath();
        ctx.moveTo(Math.round(X(t)) + 0.5, y1);
        ctx.lineTo(Math.round(X(t)) + 0.5, y0);
        ctx.stroke();
      }
      if (new Date(t * 1000).getUTCDate() % 4 === 1
          && X(t) > x0 && X(t) < x1 - 20) {
        ctx.fillStyle = css('--muted');
        ctx.fillText(when(t, utcDay), X(t), y0 + 6);
      }
    }

    const visible = new Set(rows.filter(inView).map(r => r.n));
    subs.forEach((s, i) => {
      const bx = X(s[0]);
      const bw = Math.max(1, X(s[0] + s[1]) - bx - 0.4);
      const v = rate(s);
      const clipped = v > evMax;
      const top = Y(v);
      ctx.fillStyle = css(MODE[s[3]].tok);
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

  /* Only the categories that actually occur. Since the 0-byte acquisitions
     stopped being counted as processing gaps there are no partly-processed
     runs left, and a swatch for a colour that is nowhere on the plot sends a
     reader hunting for one. */
  function drawLegend() {
    const V = VIEWS[state.view];
    const present = new Set(rows.map(V.legendKey));
    legendEl.innerHTML = Object.entries(V.legend)
      .filter(([k]) => present.has(k))
      .map(([, l]) => `<span><i style="background:var(${l.tok})"></i>${l.label}</span>`)
      .join('');
    capEl.textContent = V.cap;
  }

  /* ---- the nested sub-run table ------------------------------------------

     A run's rows in `sr` are the sub-runs it is made of, positional to keep
     2,702 of them affordable:

       0 name  1 start  2 seconds  3 events  4 raw  5 decoded  6 hits
       7 combined  8 acquisitions  9 GB  10 FEUs  11 missing-file flags

     Status is DERIVED here from the counts, by the same three rules the run's
     own status uses, rather than being carried in the data a second time --
     so a sub-run cannot be green inside a run that is amber for its sake. */

  const SUB = { name: 0, t: 1, secs: 2, ev: 3, raw: 4, dec: 5, hit: 6, cmb: 7,
                exp: 8, gb: 9, feus: 10, flags: 11 };

  const MISSING = [[1, 'hv_monitor.csv'], [2, 'run_time.txt'],
                   [4, 'n1081b_config.json']];

  function subStatus(s) {
    if (!s[SUB.raw]) return 'empty';
    if (!s[SUB.dec]) return 'raw only';
    if (s[SUB.dec] !== s[SUB.raw] || s[SUB.hit] !== s[SUB.dec]
        || s[SUB.cmb] !== s[SUB.exp]) return 'partial';
    return 'complete';
  }

  /* The same wording the run-level exception list used to carry, generated
     from the counts instead of stored beside them. A count ABOVE the expected
     one is a different animal from one below it -- it means products with no
     surviving raw behind them, or the same data combined twice -- so it is
     never called "short". */
  function subNotes(s) {
    const out = [];
    const cmp = (kind, got, want) => {
      if (got !== want) {
        out.push(`${kind} ${fmtInt(got)}/${fmtInt(want)}` +
          (got > want ? ' — more products than acquisitions' : ''));
      }
    };
    if (s[SUB.raw]) cmp('decoded', s[SUB.dec], s[SUB.raw]);
    if (s[SUB.dec]) cmp('hits', s[SUB.hit], s[SUB.dec]);
    if (s[SUB.dec]) cmp('combined', s[SUB.cmb], s[SUB.exp]);
    if (s[SUB.raw]) {
      MISSING.forEach(([bit, file]) => {
        if (s[SUB.flags] & bit) out.push('no ' + file);
      });
    }
    return out;
  }

  const subRate = s => s[SUB.secs] > 0 && s[SUB.ev] !== null
    ? s[SUB.ev] / (s[SUB.secs] / 3600) : null;

  const SUBCOL = {
    name: { label: 'Sub-run', cell: s => `<code>${esc(s[SUB.name])}</code>` },
    started: { label: 'Started', cls: 'dim', cell: s => when(s[SUB.t]) },
    live: { label: 'Live', num: true,
            cell: s => s[SUB.secs] ? hoursText(s[SUB.secs] / 3600) : dash },
    size: { label: 'On EOS', num: true, cell: s => gb(s[SUB.gb]) },
    files: {
      label: 'Files', num: true,
      cell: s => `${fmtInt(s[SUB.raw])} <span class="dim">raw</span>`,
    },
    cov: {
      label: 'Decoded', num: true,
      cell: s => !s[SUB.raw] ? dash : `${pct(s[SUB.dec], s[SUB.raw])} %`,
    },
    feus: {
      label: 'FEUs', num: true,
      cell: s => s[SUB.feus] ? s[SUB.feus] : dash,
    },
    events: {
      label: 'Events', num: true,
      cell: s => s[SUB.ev] === null ? '<span class="dim">n/a</span>'
        : fmtInt(s[SUB.ev]),
    },
    rate: {
      label: 'Events/h', num: true,
      cell: s => {
        const v = subRate(s);
        return v === null ? dash
          : s[SUB.secs] <= MIN_RATE_SECS
            ? `<span class="dim" title="under a minute — mostly start/stop overhead">${fmtInt(v)}</span>`
            : fmtInt(v);
      },
    },
    status: {
      label: 'Status', num: false,
      cell: s => {
        const st = subStatus(s);
        const notes = subNotes(s);
        return chip('st', STATUS[st].tok, STATUS[st].label) +
          (notes.length ? ` <span class="badge warn" title="${esc(notes.join('; '))}">` +
            `${notes.length}</span>` : '');
      },
    },
  };

  const SUBVIEW = {
    processing: [SUBCOL.name, SUBCOL.started, SUBCOL.live, SUBCOL.files,
                 SUBCOL.feus, SUBCOL.size, SUBCOL.cov, SUBCOL.status],
    statistics: [SUBCOL.name, SUBCOL.started, SUBCOL.live, SUBCOL.events,
                 SUBCOL.rate, SUBCOL.status],
  };

  /* ---- table ------------------------------------------------------------- */

  function detailHtml(r) {
    const bits = [];
    if (r.why) bits.push(`<p class="why">${esc(r.why)}</p>`);
    const rowFacts = [
      ['Mode', MODE[r.mode].label + (r.phys ? '' : ' · not physics')],
      ['HV scan', r.hv ? hvLabel(r) : 'no — one setpoint throughout'],
      ['Beam type', r.beam], ['Gas', r.gas], ['Target', r.tgt],
      ['Sub-runs', r.nsub], ['FEUs', r.feus.length ? r.feus.join(' / ') : '—'],
      ['Live', hrs(r.h)], ['On air', r.hair ? hrs(r.hair) : '—'],
      ['Started (UTC)', r.t ? when(r.t) : '—'],
      ['Ended (UTC)', r.end ? when(r.end) : '—'],
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
    bits.push(facts(rowFacts));

    const flagged = r.sr.filter(x => subNotes(x).length).length;
    if (flagged) {
      // Deliberately neutral: the list mixes short products (a processing gap,
      // fixable by reprocessing) with a missing hv_monitor.csv or run_time.txt
      // (a monitoring gap, not fixable at all). Calling the whole thing one
      // thing would be wrong about half of it.
      bits.push(`<p class="why"><b>${flagged} of ${r.sr.length} sub-run${
        r.sr.length > 1 ? 's have' : ' has'} a check not satisfied.</b> ` +
        'A short product means processing did not finish and can be re-run; a ' +
        'missing monitor file means it was never written. Neither means raw ' +
        'data is missing — that would show in the raw count.</p>');
    }
    if (r.cfg_err) {
      bits.push(`<p class="why"><b>No usable run_config.json</b> — ${esc(r.cfg_err)}</p>`);
    }
    // Every sub-run the run is made of, in the order they were taken, with the
    // columns following the view the same way the outer table's do.
    bits.push(subTable(SUBVIEW[state.view], r.sr,
      `${r.sr.length} sub-run${r.sr.length > 1 ? 's' : ''}, in order`));
    return bits.join('');
  }

  // Non-physics runs are excluded from every total, the same rule the DAQ's own
  // statistics use -- a saturating-pulser ladder would otherwise post a million
  // events an hour and wreck the average.
  function total(shownRows) {
    const V = VIEWS[state.view];
    const shown = shownRows.filter(r => r.phys);
    if (!shown.length) return null;
    const sum = k => shown.reduce((a, r) => a + (r[k] || 0), 0);
    return V.cols.map((c, i) => {
      if (i === 0) return `${shown.length} run${shown.length > 1 ? 's' : ''}`;
      const how = V.sums[c.key];
      if (!how) return '';
      const v = sum(c.key);
      return how === 'hours' ? v.toFixed(1) + ' h' : how === 'gb' ? gb(v) : fmtInt(v);
    });
  }

  const table = makeTable({
    head: thead, body: tbody, foot: tfoot, count: countEl, noun: 'runs',
    cols: VIEWS.processing.cols, sort: 'n', dir: -1,
    detail: detailHtml,
    total,
    footNote: 'Not counted — non-physics runs are excluded from the totals.',
    empty: 'No run matches that filter.',
    tie: (a, b) => b.n - a.n,
    onSort: () => render(),
  });

  function render() {
    const V = VIEWS[state.view];
    table.setCols(V.cols);
    view = rows.filter(inView);
    table.render(view, rows.length);
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
    // The statistics strip wants one entry per sub-run across the whole
    // campaign, sorted by time. That used to be a second copy in the JSON;
    // it is assembled from the per-run rows instead, so the plot and the
    // nested tables are the same numbers by construction.
    subs = [];
    rows.forEach(r => r.sr.forEach(x => {
      if (x[SUB.t] && x[SUB.ev] !== null) {
        subs.push([x[SUB.t], x[SUB.secs], x[SUB.ev], r.mode, r.n, x[SUB.name]]);
      }
    }));
    subs.sort((a, b) => a[0] - b[0]);
    fillStats();

    document.querySelectorAll('[data-view]').forEach(b =>
      b.addEventListener('click', () => setView(b.dataset.view, true)));
    // The strip dims what the filter excludes, so every filter redraws both.
    const both = () => { render(); drawStrip(); };
    switchGroup('mode', v => { state.mode = v; both(); });
    switchGroup('scan', v => { state.scan = v; both(); });

    filterEl.addEventListener('input', () => {
      state.q = (filterEl.value || '').toLowerCase();
      both();
    });
    filterEl.hidden = false;

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
        const mode = MODE[s[3]];
        const rt = s[1] > 0 ? s[2] / (s[1] / 3600) : null;
        tip.show(
          `<div class="tt-title">run_${s[4]} · ${esc(s[5])}</div>` +
          `<b>${rt === null ? '—' : fmtInt(rt) + ' /h'}</b>` +
          ` · ${fmtInt(s[2])} events in ${hoursText(s[1] / 3600)}` +
          `${s[1] <= MIN_RATE_SECS ? ' <span style="color:var(--muted)">(too short to rate)</span>' : ''}<br>` +
          `${when(s[0])}` +
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
        `<div class="tt-title">run_${d.n} · ${d.t ? when(d.t, utcDay) : 'no date'}</div>` +
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

  load('../data/x17-runs.json', 'runs-fallback', payload => { D = payload; init(); });
})();
