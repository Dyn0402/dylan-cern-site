/* /x17/qa-ntof.html — the n_TOF facility runs, from data/x17-ntof-runs.json.

   The DREAM table asks "did we record it and is it on EOS". This asks the same
   of the other DAQ: n_TOF ran its own acquisition over the same beam, and a
   DREAM sub-run is useless for physics without the n_TOF run underneath it.

   Two views, because a run has two independent ways of being fit to use:

     reconstruction  is there a complete product, made with the campaign recipe
     match           has the beam it shares with DREAM been joined yet

   A run can be perfectly reconstructed and not yet joined; most of the 445 have
   no DREAM overlap at all, which is not a fault of anything and gets its own
   category rather than being drawn as a failure.

   Frozen by scripts/freeze_x17_ntof.py. */

(() => {
  'use strict';
  const { css, fitCanvas, register, makeTip } = window.viz;
  const { fmt, esc, chip, facts, subTable, tickStep, switchGroup,
          makeTable, load } = window.x17;
  const { int: fmtInt, mins, dash } = fmt;

  const tbody = document.getElementById('run-rows');
  if (!tbody) return;

  const canvas = document.getElementById('strip-canvas');
  const thead = document.getElementById('run-head');
  const tfoot = document.getElementById('run-foot');
  const filterEl = document.getElementById('run-filter');
  const countEl = document.getElementById('run-count');
  const legendEl = document.getElementById('strip-legend');
  const capEl = document.getElementById('strip-cap');

  /* Coverage is deliberately not "did it merge". A merged file can be a stub
     and a complete partial set is the same processing, so the ledger judges
     bunch coverage from the `index` tree and only then says who provided it. */
  // `chip` is short because it sits on every one of 445 rows; `label` is the
  // legend and tooltip wording, where there is room to be plain.
  const COV = {
    official: { chip: 'n_TOF', label: 'n_TOF production', tok: '--good' },
    ours: { chip: 'ours', label: 'our reprocessing', tok: '--series-1' },
    'merged only': { chip: 'merged only', label: 'merged file only', tok: '--warning' },
    'off recipe': { chip: 'off recipe', label: 'off recipe', tok: '--warning' },
    short: { chip: 'short', label: 'short of the run', tok: '--critical' },
  };
  const SLIM = {
    done: { chip: 'joined', label: 'joined to DREAM', tok: '--good' },
    partial: { chip: 'partly', label: 'partly joined', tok: '--warning' },
    failed: { chip: 'failed', label: 'join failed', tok: '--critical' },
    pending: { chip: 'to do', label: 'not attempted yet', tok: '--series-1' },
    none: { chip: 'no overlap', label: 'no DREAM overlap', tok: '--muted' },
  };
  const SETTLED = {
    finished: 'finished', unmerged: 'stable but unmerged',
    moving: 'still being written', unknown: 'unlisted',
  };

  const PAD = { l: 52, r: 14, t: 22, b: 24 };

  const { utcDay: utc, utcMin: hm, stamp: when } = fmt;

  const COL = {
    run: { key: 'n', label: 'Run', num: true, cell: r => `<b>${r.n}</b>` },
    cov: {
      key: 'cov', label: 'Reconstruction', num: false,
      cell: r => chip('st', COV[r.cov].tok, COV[r.cov].chip),
    },
    parts: {
      key: 'offp', label: 'Partials', num: true,
      title: 'Files n_TOF’s production wrote for this run',
      cell: r => r.offp ? fmtInt(r.offp) + (r.contig ? '' :
        ' <span class="badge warn" title="the partial indices have a gap">gap</span>') : dash,
    },
    bunches: {
      key: 'last', label: 'Bunches', num: true,
      cell: r => r.last ? fmtInt(r.last) : dash,
    },
    ours: {
      key: 'prod', label: 'Ours', num: false,
      title: 'Whether we also reprocessed this run, and at which recipe',
      cell: r => r.prod
        ? `<code>${esc(r.prod)}</code>${r.ours === 'OFF_RECIPE'
          ? ' <span class="badge warn" title="made with a different UserInput — not counted as coverage">off recipe</span>' : ''}`
        : dash,
    },
    size: {
      key: 'mb', label: 'Merged', num: true,
      title: 'the merged file; a dash means the run has none, which is not a fault',
      cell: r => r.mb === null || r.mb === undefined ? dash
        : r.mb >= 1000 ? (r.mb / 1000).toFixed(1) + ' GB'
        : r.mb >= 1 ? r.mb.toFixed(0) + ' MB'
        : Math.round(r.mb * 1000) + ' kB',
    },
    settled: {
      key: 'settled', label: 'State', num: false, cls: 'dim',
      cell: r => SETTLED[r.settled],
    },
    started: {
      key: 't0', label: 'Started', num: true, cls: 'dim',
      title: 'UTC, from the run’s own index tree',
      cell: r => when(r.t0, hm),
    },
    ended: {
      key: 't1', label: 'Ended', num: true, cls: 'dim',
      cell: r => when(r.t1, hm),
    },
    // Seconds below a minute: the campaign's tail is full of 4-to-16-bunch
    // runs that really did last 7 to 30 s, and "0 min" reads as a missing
    // value rather than as a very short run.
    dur: {
      key: 'dur', label: 'Duration', num: true,
      cell: r => r.dur === undefined ? dash
        : (r.dur < 1 ? Math.round(r.dur * 60) + ' s' : mins(r.dur)) +
        (r.tsrc === 'raw'
          ? ' <span class="badge warn" title="no index tree for this run — taken from the raw file times instead">raw</span>'
          : ''),
    },
    dream: {
      key: 'dreamn', label: 'DREAM', num: false,
      cell: r => r.dreams.length
        ? r.dreams.map(d => esc(d)).join(', ') : dash,
    },
    overlap: {
      key: 'minall', label: 'Shared beam', num: true,
      title: 'Beam time this run and a DREAM sub-run were both taking',
      cell: r => r.minall ? mins(r.minall) : dash,
    },
    joined: {
      key: 'minj', label: 'Joined', num: true,
      cell: r => r.minall ? `${mins(r.minj)} <span class="dim">(${
        Math.round(100 * r.minj / r.minall)} %)</span>` : dash,
    },
    segs: {
      key: 'nok', label: 'Segments', num: true,
      title: 'joined / failed / not attempted',
      cell: r => r.slim === 'none' ? dash
        : `${r.nok} <span class="dim">/ ${r.nbad + r.nskip} / ${r.npend}</span>`,
    },
    eff: {
      key: 'eff', label: 'Efficiency', num: true,
      cell: r => r.eff === null ? dash : (100 * r.eff).toFixed(2) + ' %',
    },
    slim: {
      key: 'slim', label: 'Match', num: false,
      cell: r => chip('st', SLIM[r.slim].tok, SLIM[r.slim].chip),
    },
  };

  const VIEWS = {
    reconstruction: {
      cap: 'Bar height is the run’s length in beam bunches; colour is ' +
        'whose processing covers it. Every bar is a run n_TOF took, in order, ' +
        'so the campaign’s shape is the plot’s shape.',
      cols: [COL.run, COL.cov, COL.bunches, COL.parts, COL.ours, COL.size,
             COL.settled],
      colour: r => COV[r.cov].tok,
      bar: r => r.last,
      axis: 'bunches per run',
      legend: COV,
      sums: { last: 'int', offp: 'int', mb: 'mb' },
    },
    match: {
      cap: 'Only the runs that overlap DREAM beam have a bar: height is the ' +
        'beam time the two DAQs shared, colour is how far that beam has got ' +
        'through the join. The empty stretch on the left is the six weeks ' +
        'before the Micromegas were in the beam.',
      cols: [COL.run, COL.slim, COL.started, COL.ended, COL.dream, COL.overlap,
             COL.joined, COL.segs, COL.eff],
      colour: r => SLIM[r.slim].tok,
      bar: r => r.minall,
      axis: 'minutes of beam shared with DREAM',
      legend: SLIM,
      sums: { minall: 'mins', minj: 'mins', nok: 'int' },
    },
    // The same runs against the clock instead of against each other. Run number
    // is monotonic in time, so the ordinal views are not misleading -- but they
    // are evenly spaced, and the beam was not: this is where the stops, the
    // night shifts and the six-week wait before the walls went in are visible.
    timeline: {
      cap: 'Every run on a real time axis: each block starts when the run ' +
        'started and is as wide as it lasted, so the gaps are the beam stops. ' +
        'Height is the run’s length in bunches. Colour is how far its beam has ' +
        'got through the join to DREAM.',
      cols: [COL.run, COL.started, COL.ended, COL.dur, COL.bunches, COL.slim,
             COL.dream, COL.overlap],
      colour: r => SLIM[r.slim].tok,
      bar: r => r.last,
      axis: 'bunches per run, on a real time axis (UTC)',
      legend: SLIM,
      sums: { dur: 'mins', last: 'int', minall: 'mins' },
      time: true,
    },
  };

  const state = { view: 'reconstruction', cov: 'all', slim: 'all', q: '' };
  let D = null, rows = [], hover = -1;

  function inView(r) {
    if (state.cov !== 'all' && r.cov !== state.cov) return false;
    if (state.slim === 'overlap' && r.slim === 'none') return false;
    if (state.slim === 'todo' && !(r.npend || r.nbad || r.nskip)) return false;
    if (state.slim === 'none' && r.slim !== 'none') return false;
    if (!state.q) return true;
    const hay = `${r.n} ${COV[r.cov].label} ${SLIM[r.slim].label} ` +
      `${SETTLED[r.settled]} ${r.prod} ${r.dreams.join(' ')}`.toLowerCase();
    return state.q.split(/\s+/).filter(Boolean).every(w => hay.includes(w));
  }

  /* ---- strip -------------------------------------------------------------- */

  function drawStrip() {
    const V = VIEWS[state.view];
    const { ctx, w, h } = fitCanvas(canvas, 0.2);
    ctx.clearRect(0, 0, w, h);
    if (!rows.length) return;

    const x0 = PAD.l, x1 = w - PAD.r, y0 = h - PAD.b, y1 = PAD.t;
    const peak = Math.max(...rows.map(V.bar)) || 1;
    const step = tickStep(peak);
    const yMax = step * Math.ceil(peak / step);
    const slot = (x1 - x0) / rows.length;

    // In the timeline view a run's x position and width are its real start and
    // duration; everywhere else runs are evenly spaced in run order. Runs with
    // no time at all are drawn nowhere rather than at the origin.
    const timed = V.time ? rows.filter(r => r.t0 !== undefined) : rows;
    const T0 = V.time && timed.length ? Math.min(...timed.map(r => r.t0)) : 0;
    const T1 = V.time && timed.length ? Math.max(...timed.map(r => r.t1)) : 1;
    const X = t => x0 + ((t - T0) / (T1 - T0)) * (x1 - x0);

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(V.axis, x0, 2);

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= yMax; v += step) {
      const y = y0 - (v / yMax) * (y0 - y1);
      ctx.strokeStyle = css('--grid');
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(y) + 0.5);
      ctx.lineTo(x1, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = css('--muted');
      ctx.fillText(v ? (v >= 1000 ? (v / 1000) + ' k' : String(v)) : '0', x0 - 7, y);
    }

    // Day gridlines behind the bars, in the timeline view only. Midnight UTC,
    // which is what the n_TOF index tree is stamped in once corrected.
    if (V.time && timed.length) {
      const day = 86400;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let t = Math.ceil(T0 / day) * day; t <= T1; t += day) {
        ctx.strokeStyle = css('--grid');
        ctx.beginPath();
        ctx.moveTo(Math.round(X(t)) + 0.5, y1);
        ctx.lineTo(Math.round(X(t)) + 0.5, y0);
        ctx.stroke();
      }
    }

    // Always in run order: the strip is the campaign's timeline, not a view of
    // whatever the table happens to be sorted by.
    rows.forEach((r, i) => {
      const shown = inView(r);
      const val = V.bar(r);
      const bh = (val / yMax) * (y0 - y1);
      if (V.time && r.t0 === undefined) return;      // nowhere to put it
      const bx = V.time ? X(r.t0) : x0 + i * slot;
      const bw = V.time ? Math.max(1, X(r.t1) - X(r.t0) - 0.4)
        : Math.max(1.2, slot - 0.8);
      ctx.globalAlpha = !shown ? 0.13 : (hover < 0 || hover === i) ? 1 : 0.45;
      if (val > 0) {
        ctx.fillStyle = css(V.colour(r));
        ctx.beginPath();
        ctx.roundRect(bx, y0 - Math.max(2, bh), bw, Math.max(2, bh),
          [Math.min(2, bw / 2), Math.min(2, bw / 2), 0, 0]);
        ctx.fill();
      } else {
        // A zero still gets a tick, or it reads as a run that is not there.
        ctx.fillStyle = css('--muted');
        ctx.fillRect(bx, y0 - 2, bw, 2);
      }
      ctx.globalAlpha = 1;
    });

    ctx.strokeStyle = css('--axis');
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(y0) + 0.5);
    ctx.lineTo(x1, Math.round(y0) + 0.5);
    ctx.stroke();

    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let lastX = -1e9;
    if (V.time && timed.length) {
      // Dates, thinned to whatever fits: 40 days of campaign against ~1000px.
      for (let t = Math.ceil(T0 / 86400) * 86400; t <= T1; t += 86400) {
        if (X(t) - lastX < 52 || X(t) > x1 - 18) continue;
        ctx.fillText(when(t, utc), X(t), y0 + 6);
        lastX = X(t);
      }
      return;
    }
    // Every 50th run, thinned further if that would not leave room: a six-digit
    // n_TOF run number is about 44px, and on a phone the 50-run spacing runs
    // them together.
    rows.forEach((r, i) => {
      const cx = x0 + (i + 0.5) * slot;
      if (r.n % 50 === 0 && cx - lastX > 56) {
        ctx.fillText(String(r.n), cx, y0 + 6);
        lastX = cx;
      }
    });
  }

  /* Only the categories that actually occur. `off recipe` is a real class the
     ledger can produce and did not this time -- n_TOF's own production covers
     every run our prod_v11 copies touch -- and a legend entry for a colour that
     is nowhere on the plot invites a hunt for it. */
  function drawLegend() {
    const V = VIEWS[state.view];
    const key = V === VIEWS.reconstruction ? 'cov' : 'slim';
    const present = new Set(rows.map(r => r[key]));
    legendEl.innerHTML = Object.entries(V.legend)
      .filter(([k]) => present.has(k))
      .map(([, l]) => `<span><i style="background:var(${l.tok})"></i>${l.label}</span>`)
      .join('');
    capEl.textContent = V.cap;
  }

  /* ---- the nested segment table -------------------------------------------

     What an n_TOF run is made of, for the purpose this site cares about: the
     pieces of DREAM beam it underlies. Its own reconstruction partials would be
     the other natural nesting, and the ledger does not carry them -- it checks
     whether the SET covers the run, not what each partial holds, so there is
     nothing to list without a survey of its own.

       0 DREAM run  1 sub-run  2 status  3 minutes  4 efficiency               */

  const SEG_ST = {
    OK: { label: 'joined', tok: '--good' },
    FAILED: { label: 'failed', tok: '--critical' },
    SKIPPED_LOW_JOIN: { label: 'low overlap', tok: '--muted' },
    PENDING: { label: 'to do', tok: '--series-1' },
  };

  const SEGCOL = [
    { label: 'DREAM run', cell: g => g[0] ? `<b>${esc(g[0])}</b>` : dash },
    { label: 'Sub-run',
      cell: g => g[1] && g[1] !== '?' ? `<code>${esc(g[1])}</code>`
        : '<span class="dim">not named</span>' },
    { label: 'Join',
      cell: g => chip('st', (SEG_ST[g[2]] || SEG_ST.PENDING).tok,
        (SEG_ST[g[2]] || SEG_ST.PENDING).label) },
    { label: 'Shared beam', num: true, cell: g => g[3] ? mins(g[3]) : dash },
    { label: 'Efficiency', num: true,
      cell: g => g[4] === null ? dash : (100 * g[4]).toFixed(2) + ' %' },
  ];

  /* ---- table -------------------------------------------------------------- */

  function detailHtml(r) {
    const bits = [];
    const pct = r.minall ? Math.round(100 * r.minj / r.minall) : null;
    bits.push(facts([
      ['Started (UTC)', r.t0 === undefined ? '—' : when(r.t0, hm)],
      ['Ended (UTC)', r.t1 === undefined ? '—' : when(r.t1, hm)],
      ['Duration', r.dur === undefined ? '—'
        : (r.dur < 1 ? Math.round(r.dur * 60) + ' s' : mins(r.dur)) +
          (r.tsrc === 'raw' ? ' (from raw file times)' : '')],
      ['Reconstruction', COV[r.cov].label],
      ['n_TOF partials', `${fmtInt(r.offp)}${r.contig ? ' · contiguous' : ' · INDEX GAP'}`],
      ['Bunch range', r.first || r.last ? `${fmtInt(r.first)} – ${fmtInt(r.last)}` : '—'],
      ['Covered to bunch', r.off === 'SHORT' ? 'short — see below' : fmtInt(r.last)],
      ['Merged file', r.mb === null || r.mb === undefined ? 'none — partials only'
        : r.mb >= 1 ? (r.mb / 1000).toFixed(2) + ' GB' : Math.round(r.mb * 1000) + ' kB'],
      ['State', SETTLED[r.settled]],
      ['Our processing', r.prod ? `${r.prod} · ${r.ours.toLowerCase()} · ${r.oursp} partials` : 'not reprocessed'],
      ['DREAM overlap', r.dreams.length ? r.dreams.join(', ') : 'none'],
      ['Shared beam', r.minall ? mins(r.minall) : '—'],
      ['Joined', r.minall ? `${mins(r.minj)} (${pct} %)` : '—'],
      ['Segments', r.slim === 'none' ? '—'
        : `${r.nok} joined · ${r.nbad} failed · ${r.nskip} skipped · ${r.npend} not attempted`],
      ['Mean efficiency', r.eff === null ? '—' : (100 * r.eff).toFixed(2) + ' %'],
      r.beam && ['Beam', `${r.beam.beam_pct} % of ${fmtInt(r.beam.bunches)} bunches · ` +
        `${fmtInt(r.beam.protons)} ×10¹² protons`],
    ]));

    if (r.t0 === undefined) {
      // The time listing is built from beam bunches in the merged files, so a
      // run is absent from it for one of two unrelated reasons — and saying
      // the wrong one is worse than saying neither.
      bits.push('<p class="why"><b>No start or end time.</b> ' + (r.mb === null
        ? 'This run has no merged file for the time listing to read; its ' +
          'partials are complete and the run itself is fine.'
        : 'This run recorded too few bunches to carry a usable timestamp — ' +
          'it is an end-of-run or stub acquisition, not a gap in the data.') +
        '</p>');
    }
    if (r.off === 'SHORT') {
      bits.push('<p class="why"><b>The product does not cover the run.</b> ' +
        'Raw files had expired from the EOS disk buffer when this run was ' +
        'reprocessed, and the job built its file list from what was left. ' +
        'The raw data is not lost — it is on CTA tape and can be recalled.</p>');
    }
    if (r.off === 'MERGED_ONLY') {
      bits.push('<p class="why">Covered only by its merged file: the partials ' +
        'were cleaned up after the merge, so the per-partial coverage check ' +
        'has nothing to read. Not a fault, but it cannot be verified the same way.</p>');
    }
    if (r.ours === 'OFF_RECIPE') {
      bits.push('<p class="why">Our copy was made with a different ' +
        '<code>UserInput</code> and is deliberately <b>not</b> counted as ' +
        'coverage. Mixing recipes inside one campaign is the mistake this ' +
        'ledger exists to prevent.</p>');
    }
    if (r.segs && r.segs.length) {
      bits.push(subTable(SEGCOL, r.segs,
        `${r.segs.length} segment${r.segs.length > 1 ? 's' : ''} shared with ` +
        `DREAM — see <a href="qa-match.html">the match page</a>`));
    }
    if (r.nbad) {
      bits.push(`<p class="why"><b>${r.nbad} segment${r.nbad > 1 ? 's' : ''} ` +
        'failed to join.</b> The cause is known and is ours, not the data’s ' +
        '— a degenerate tie-break in the pulse matcher locked onto the wrong ' +
        'accelerator supercycle. The affected beam is recoverable; see ' +
        '<a href="qa-match.html">the match page</a>.</p>');
    }
    return bits.join('');
  }

  function total(shown) {
    const V = VIEWS[state.view];
    const sum = k => shown.reduce((a, r) => a + (r[k] || 0), 0);
    return V.cols.map((c, i) => {
      if (i === 0) return `${shown.length} run${shown.length > 1 ? 's' : ''}`;
      const how = V.sums[c.key];
      if (!how) return '';
      const v = sum(c.key);
      return how === 'mins' ? mins(v)
        : how === 'mb' ? (v / 1000).toFixed(1) + ' GB' : fmtInt(v);
    });
  }

  const table = makeTable({
    head: thead, body: tbody, foot: tfoot, count: countEl, noun: 'runs',
    cols: VIEWS.reconstruction.cols, sort: 'n', dir: -1,
    detail: detailHtml,
    total,
    empty: 'No run matches that filter.',
    tie: (a, b) => b.n - a.n,
    onSort: () => render(),
  });

  function render() {
    const V = VIEWS[state.view];
    table.setCols(V.cols);
    table.render(rows.filter(inView), rows.length);
  }

  /* ---- wiring ------------------------------------------------------------- */

  function setView(name, push) {
    if (!VIEWS[name]) return;
    state.view = name;
    document.querySelectorAll('[data-view]').forEach(b =>
      b.setAttribute('aria-pressed', b.dataset.view === name ? 'true' : 'false'));
    if (push && location.hash.slice(1) !== name) {
      history.replaceState(null, '', '#' + name);
    }
    drawLegend();
    render();
    drawStrip();
  }

  function fillStats() {
    const n = rows.length;
    const cov = c => rows.filter(r => r.cov === c).length;
    const over = rows.filter(r => r.slim !== 'none');
    const shared = over.reduce((a, r) => a + r.minall, 0);
    const joined = over.reduce((a, r) => a + r.minj, 0);
    const timed = rows.filter(r => r.t0 !== undefined);
    const first = Math.min(...timed.map(r => r.t0));
    const last = Math.max(...timed.map(r => r.t1));
    const shown = {
      runs: fmtInt(n),
      covered: fmtInt(cov('official') + cov('ours')),
      ours: fmtInt(rows.filter(r => r.prod).length),
      overlap: fmtInt(over.length),
      shared: (shared / 60).toFixed(0),
      joined: Math.round(100 * joined / shared) + ' %',
      // Wall-clock days end to end, against the hours the DAQ was actually
      // running inside them -- the gap between the two is the beam stops.
      span: Math.round((last - first) / 86400),
      first: when(first, utc),
      last: when(last, utc),
      live: fmtInt(timed.reduce((a, r) => a + (r.t1 - r.t0), 0) / 3600),
    };
    document.querySelectorAll('[data-ntof-stat]').forEach(el => {
      const v = shown[el.dataset.ntofStat];
      if (v !== undefined) el.textContent = v;
    });
    document.querySelectorAll('[data-as-of]').forEach(el => {
      el.textContent = D.as_of;
    });
  }

  function init() {
    rows = D.runs;
    // Sortable text for the DREAM column, which is otherwise an array.
    rows.forEach(r => {
      r.dreamn = r.dreams.join(',');
      // Derived, not stored: see freeze_x17_ntof.py. Minutes, to match the
      // shared-beam columns it sits beside.
      if (r.t0 !== undefined) r.dur = (r.t1 - r.t0) / 60;
    });
    fillStats();

    document.querySelectorAll('[data-view]').forEach(b =>
      b.addEventListener('click', () => setView(b.dataset.view, true)));
    const both = () => { render(); drawStrip(); };
    switchGroup('cov', v => { state.cov = v; both(); });
    switchGroup('slim', v => { state.slim = v; both(); });

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
      let i;
      if (VIEWS[state.view].time) {
        // Nearest run by midpoint in time, not a hit test: a ten-minute run is
        // well under a pixel wide over a forty-day axis.
        const timed = rows.filter(r => r.t0 !== undefined);
        if (!timed.length) { tip.hide(); return; }
        const T0 = Math.min(...timed.map(r => r.t0));
        const T1 = Math.max(...timed.map(r => r.t1));
        const t = T0 + ((mx - x0) / (x1 - x0)) * (T1 - T0);
        let bd = Infinity;
        rows.forEach((r, k) => {
          if (r.t0 === undefined) return;
          const d = Math.abs((r.t0 + r.t1) / 2 - t);
          if (d < bd) { bd = d; i = k; }
        });
      } else {
        i = Math.floor(((mx - x0) / (x1 - x0)) * rows.length);
      }
      if (i === undefined || i < 0 || i >= rows.length) {
        tip.hide(); hover = -1; drawStrip(); return;
      }
      hover = i;
      drawStrip();
      const r = rows[i];
      tip.show(
        `<div class="tt-title">run ${r.n}${r.t0 === undefined ? ''
          : ' · ' + when(r.t0, hm) + ' UTC'}</div>` +
        `<b>${fmtInt(r.last)} bunches</b> · ${fmtInt(r.offp)} partials` +
        `${r.dur === undefined ? '' : ' · ' + mins(r.dur)}` +
        `${r.minall ? ' · ' + mins(r.minall) + ' with DREAM' : ''}<br>` +
        `<span style="color:var(${COV[r.cov].tok})">■</span> ${COV[r.cov].label}` +
        ` · <span style="color:var(${SLIM[r.slim].tok})">■</span> ${SLIM[r.slim].label}`,
        mx, my);
    });
    canvas.addEventListener('mouseleave', () => {
      tip.hide(); hover = -1; drawStrip();
    });

    window.addEventListener('hashchange', () => setView(location.hash.slice(1), false));
    setView(VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'reconstruction', false);
    register(drawStrip);
  }

  load('../data/x17-ntof-runs.json', 'runs-fallback', p => { D = p; init(); });
})();
