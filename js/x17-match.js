/* /x17/qa-match.html — the DREAM <-> n_TOF join, from data/x17-match.json.

   The unit is a SEGMENT: one DREAM sub-run crossed with the n_TOF run that was
   taking beam at the same moment. A segment is the smallest thing that can have
   its own clock fit, because the DREAM timestamp clock wanders about a ppm from
   burst to burst and the correction that removes that drift is fitted per
   bunch, inside a segment.

   Two views, and the second exists because of a trap the campaign write-up is
   explicit about:

     quality    the 170 segments that produced a file, and how good each is
     coverage   all 420 segments, including the ones that produced nothing

   A mis-joined segment fails its clock fit and writes no file, so the QA layer
   never sees it. Showing only `quality` would give a page on which everything
   passes — which is true, and would be a lie by omission. The default is
   therefore `coverage`.

   Two plots: the campaign residual histogram, which is fixed and says the match
   is a real 6 ns peak rather than a window full of accidentals, and a
   per-segment strip that follows the view.

   Frozen by scripts/freeze_x17_match.py. */

(() => {
  'use strict';
  const { css, fitCanvas, register, makeTip } = window.viz;
  const { fmt, esc, chip, facts, subTable, tickStep, switchGroup,
          makeTable, load } = window.x17;
  const { int: fmtInt, mins, dash } = fmt;

  const tbody = document.getElementById('run-rows');
  if (!tbody) return;

  const canvas = document.getElementById('strip-canvas');
  const histEl = document.getElementById('hist-canvas');
  const thead = document.getElementById('run-head');
  const tfoot = document.getElementById('run-foot');
  const filterEl = document.getElementById('run-filter');
  const countEl = document.getElementById('run-count');
  const legendEl = document.getElementById('strip-legend');
  const capEl = document.getElementById('strip-cap');

  // `chip` is short because it is on every one of 420 rows; `label` is the
  // legend and tooltip wording, where there is room to be plain.
  const ST = {
    ok: { chip: 'joined', label: 'joined', tok: '--good' },
    failed: { chip: 'failed', label: 'join failed', tok: '--critical' },
    skipped: { chip: 'low overlap', label: 'too little overlap to fit', tok: '--muted' },
    pending: { chip: 'to do', label: 'not attempted yet', tok: '--series-1' },
  };
  const VERDICT = {
    PASS: { label: 'pass', tok: '--good' },
    WARN: { label: 'warn', tok: '--warning' },
    FAIL: { label: 'fail', tok: '--critical' },
    'NO RECORD': { label: 'no QA record', tok: '--warning' },
  };

  const PAD = { l: 52, r: 14, t: 22, b: 24 };
  const HPAD = { l: 58, r: 16, t: 20, b: 30 };

  const pc = (v, n = 2) => v === null || v === undefined ? dash
    : (100 * v).toFixed(n) + ' %';
  const ns = (v, n = 1) => v === null || v === undefined ? dash : v.toFixed(n) + ' ns';
  const segId = r => `${r.d}/${r.s}×${r.n}`;

  const COL = {
    seg: {
      key: 'id', label: 'Segment', num: false,
      cell: r => `<b>${esc(r.d)}</b><span class="dim">/</span>${esc(r.s)}` +
        `<span class="dim"> × </span>${r.n}`,
    },
    st: {
      key: 'st', label: 'Join', num: false,
      cell: r => chip('st', ST[r.st].tok, ST[r.st].chip),
    },
    verdict: {
      key: 'v', label: 'QA', num: false,
      cell: r => r.v ? chip('st', (VERDICT[r.v] || VERDICT.WARN).tok,
        `${(VERDICT[r.v] || VERDICT.WARN).label}${r.nchk ? ' ' + r.nchk + '/' + r.nchk : ''}`) : dash,
    },
    kind: {
      key: 'kind', label: 'Kind', num: false, cls: 'dim',
      title: 'whole — the sub-run sits inside one n_TOF run; sliver — it straddles two',
      cell: r => r.kind || (r.st === 'pending' ? 'to slim' : dash),
    },
    min: {
      key: 'min', label: 'Beam', num: true,
      cell: r => r.min ? mins(r.min) : dash,
    },
    bunches: {
      key: 'nb', label: 'Bunches', num: true,
      cell: r => r.nb ? fmtInt(r.nb) : r.jb ? `<span class="dim">${fmtInt(r.jb)}</span>` : dash,
    },
    events: {
      key: 'nph', label: 'Triggers', num: true,
      cell: r => r.nph ? fmtInt(r.nph) : r.je ? `<span class="dim">${fmtInt(r.je)}</span>` : dash,
    },
    eff: {
      key: 'eff', label: 'Efficiency', num: true,
      title: 'physics triggers given an n_TOF partner inside the ±25 ns window',
      cell: r => pc(r.eff),
    },
    acc: {
      key: 'acc', label: 'Accidental', num: true,
      title: 'measured on a control window 100 µs later — not modelled',
      cell: r => r.acc === undefined ? dash : (100 * r.acc).toFixed(3) + ' %',
    },
    rms: { key: 'rms', label: 'Residual', num: true, cell: r => ns(r.rms, 2) },
    T0: {
      key: 'T0', label: 'T₀', num: true,
      title: 'fitted offset between the two clocks; per (DREAM run, n_TOF processing) pair',
      cell: r => r.T0 === undefined ? dash : r.T0.toFixed(1),
    },
    da: {
      key: 'da', label: 'Per-bunch', num: true,
      title: 'RMS of the per-bunch offset correction — the clock drift being removed',
      cell: r => ns(r.da, 1),
    },
    mb: {
      key: 'mb', label: 'Size', num: true,
      cell: r => r.mb ? r.mb.toFixed(0) + ' MB' : dash,
    },
  };

  const VIEWS = {
    coverage: {
      cap: 'One bar per segment, in campaign order: height is the beam time it ' +
        'covers, colour is what became of it. The red bars produced no file at ' +
        'all — they are here because a page built only from QA records would ' +
        'not know they existed.',
      cols: [COL.seg, COL.st, COL.kind, COL.min, COL.bunches, COL.events],
      colour: r => ST[r.st].tok,
      legend: ST,
      legendKey: r => r.st,
      sums: { min: 'mins' },
      mark: 'bar',
      axis: 'minutes of beam per segment',
      value: r => r.min || 0,
    },
    quality: {
      cap: 'One dot per joined segment: the fraction of DREAM physics triggers ' +
        'that found an n_TOF partner. The dashed line is the fleet median. The ' +
        'axis does not start at zero, which is why these are dots and not bars.',
      cols: [COL.seg, COL.verdict, COL.min, COL.eff, COL.acc, COL.rms, COL.T0,
             COL.da, COL.mb],
      colour: r => (VERDICT[r.v] || VERDICT.WARN).tok,
      legend: VERDICT,
      legendKey: r => r.v,
      sums: { min: 'mins', mb: 'mb' },
      mark: 'dot',
      axis: 'match efficiency per segment',
      value: r => r.eff,
      only: r => r.st === 'ok' && r.eff !== undefined,
    },
  };

  const state = { view: 'coverage', st: 'all', q: '' };
  let D = null, rows = [], hover = -1;

  function inView(r) {
    if (state.st !== 'all' && r.st !== state.st) return false;
    if (!state.q) return true;
    const hay = `${segId(r)} ${ST[r.st].label} ${r.v} ${r.kind}`.toLowerCase();
    return state.q.split(/\s+/).filter(Boolean).every(w => hay.includes(w));
  }

  /* ---- the residual histogram --------------------------------------------

     Summed over every joined segment. It is drawn once and never filtered: it
     is the campaign's evidence that the accept window contains a peak, and
     slicing it by whatever the table is showing would turn evidence into
     decoration. */
  function drawHist() {
    const H = D.hist;
    const { ctx, w, h } = fitCanvas(histEl, 0.32);
    ctx.clearRect(0, 0, w, h);

    const x0 = HPAD.l, x1 = w - HPAD.r, y0 = h - HPAD.b, y1 = HPAD.t;
    const peak = Math.max(...H.counts);
    const step = tickStep(peak);
    const yMax = step * Math.ceil(peak / step);
    const X = v => x0 + ((v - H.lo) / (H.hi - H.lo)) * (x1 - x0);
    const Y = v => y0 - (v / yMax) * (y0 - y1);

    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= yMax; v += step) {
      ctx.strokeStyle = css('--grid');
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(Y(v)) + 0.5);
      ctx.lineTo(x1, Math.round(Y(v)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = css('--muted');
      ctx.fillText(v ? (v / 1e6).toFixed(1) + ' M' : '0', x0 - 7, Y(v));
    }

    const bw = (x1 - x0) / H.counts.length;
    H.counts.forEach((c, i) => {
      const x = X(H.lo + i * H.bin);
      const top = Y(c);
      ctx.fillStyle = css('--series-1');
      ctx.beginPath();
      // A 2px surface gap between neighbours, so the bars read as bars rather
      // than as one filled area.
      ctx.roundRect(x + 1, top, Math.max(1, bw - 2), y0 - top, [2, 2, 0, 0]);
      ctx.fill();
    });

    ctx.strokeStyle = css('--axis');
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(y0) + 0.5);
    ctx.lineTo(x1, Math.round(y0) + 0.5);
    ctx.stroke();

    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let v = H.lo; v <= H.hi; v += 10) ctx.fillText(String(v), X(v), y0 + 6);
    ctx.fillText('DREAM trigger − n_TOF hit, after the fit (ns)',
      (x0 + x1) / 2, y0 + 18);

    ctx.textAlign = 'left';
    ctx.fillText(`${(H.counts.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} M ` +
      `matched hits, ${H.bin} ns bins`, x0, 2);
  }

  /* ---- the per-segment strip ---------------------------------------------- */

  function stripRows() {
    const V = VIEWS[state.view];
    return V.only ? rows.filter(V.only) : rows;
  }

  function drawStrip() {
    const V = VIEWS[state.view];
    const list = stripRows();
    const { ctx, w, h } = fitCanvas(canvas, 0.2);
    ctx.clearRect(0, 0, w, h);
    if (!list.length) return;

    const x0 = PAD.l, x1 = w - PAD.r, y0 = h - PAD.b, y1 = PAD.t;
    const vals = list.map(V.value);
    const dot = V.mark === 'dot';
    // Bars are anchored at zero, always. Dots are not, and that is exactly why
    // the efficiency view uses dots: its whole range is 93.5–97.4 %.
    const lo = dot ? Math.floor(Math.min(...vals) * 200) / 200 : 0;
    const hi = dot ? Math.ceil(Math.max(...vals) * 200) / 200
      : (() => { const s = tickStep(Math.max(...vals));
                 return s * Math.ceil(Math.max(...vals) / s); })();
    const Y = v => y0 - ((v - lo) / (hi - lo || 1)) * (y0 - y1);
    const slot = (x1 - x0) / list.length;

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(V.axis, x0, 2);

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const gstep = dot ? (hi - lo) / 4 : tickStep(hi);
    for (let v = lo; v <= hi + 1e-9; v += gstep) {
      ctx.strokeStyle = css('--grid');
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(Y(v)) + 0.5);
      ctx.lineTo(x1, Math.round(Y(v)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = css('--muted');
      // Minutes all the way up, because the axis label says minutes: mixing in
      // an "h" at 60 produced two ticks both reading "1 h".
      ctx.fillText(dot ? (100 * v).toFixed(1) + ' %' : String(Math.round(v)),
        x0 - 7, Y(v));
    }

    if (dot) {
      const med = D.eff_median;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = css('--axis');
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(Y(med)) + 0.5);
      ctx.lineTo(x1, Math.round(Y(med)) + 0.5);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = css('--muted');
      ctx.textAlign = 'left';
      ctx.fillText('median ' + (100 * med).toFixed(2) + ' %', x0 + 4, Y(med) - 9);
    }

    list.forEach((r, i) => {
      const shown = inView(r);
      ctx.globalAlpha = !shown ? 0.13 : (hover < 0 || hover === i) ? 1 : 0.45;
      ctx.fillStyle = css(V.colour(r));
      const cx = x0 + (i + 0.5) * slot;
      if (dot) {
        ctx.beginPath();
        ctx.arc(cx, Y(V.value(r)), 4, 0, 2 * Math.PI);
        ctx.fill();
        // A 2px surface ring, so overlapping dots stay countable.
        ctx.strokeStyle = css('--surface');
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        const v = V.value(r);
        const bh = Math.max(v > 0 ? 2 : 1, Y(0) - Y(v));
        const bw = Math.max(1.2, slot - 0.8);
        ctx.beginPath();
        ctx.roundRect(x0 + i * slot, y0 - bh, bw, bh,
          [Math.min(2, bw / 2), Math.min(2, bw / 2), 0, 0]);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    });

    ctx.strokeStyle = css('--axis');
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(y0) + 0.5);
    ctx.lineTo(x1, Math.round(y0) + 0.5);
    ctx.stroke();

    // Label where the DREAM run changes: the x axis is segments, but what a
    // reader wants to locate is a run.
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let last = null, lastX = -99;
    list.forEach((r, i) => {
      const cx = x0 + (i + 0.5) * slot;
      if (r.d !== last && cx - lastX > 42) {
        ctx.fillText(r.d.replace('run_', ''), cx, y0 + 6);
        lastX = cx;
      }
      last = r.d;
    });
  }

  /* Only the categories that actually occur. All 170 joined segments are at
     PASS, and a legend swatch for a `fail` colour that appears nowhere on the
     plot sends a reader hunting for one. */
  function drawLegend() {
    const V = VIEWS[state.view];
    const present = new Set(stripRows().map(V.legendKey));
    legendEl.innerHTML = Object.entries(V.legend)
      .filter(([k]) => present.has(k))
      .map(([, l]) => `<span><i style="background:var(${l.tok})"></i>${l.label}</span>`)
      .join('');
    capEl.textContent = V.cap;
  }

  function drawAll() { drawHist(); drawStrip(); }

  /* ---- the nested tables --------------------------------------------------

     A segment has two natural sets of parts, and both are worth expanding into:
     the nineteen QA checks it was judged against, and the four scintillator
     arms its matched triggers divided between.

     The checks matter most. "All 170 segments pass" is a claim about the
     checks, and it is far more convincing when a reader can open one and see
     what the nineteen actually were and what number each one saw -- rather
     than a page that only ever shows the ones that failed, of which there are
     none.

     `lv` is one letter per check, positional against the shared list; `chkv`
     is the value each one measured. */

  const LEVEL = {
    P: { label: 'pass', tok: '--good' },
    W: { label: 'warn', tok: '--warning' },
    F: { label: 'fail', tok: '--critical' },
    N: { label: 'n/a', tok: '--muted' },
  };

  const CHKCOL = [
    { label: 'Check', cell: c => esc(c.name) },
    { label: 'Result',
      cell: c => chip('st', (LEVEL[c.lv] || LEVEL.N).tok,
        (LEVEL[c.lv] || LEVEL.N).label) },
    { label: 'Value', num: true,
      cell: c => c.v === null || c.v === undefined ? dash
        // Six orders of magnitude live in this column -- a clock rate ratio of
        // 1.1e-4 beside a bunch count of 1,128 -- so the format follows the
        // number rather than being fixed.
        : Math.abs(c.v) >= 1e4 || (c.v !== 0 && Math.abs(c.v) < 1e-3)
          ? c.v.toExponential(3)
          : Number(c.v.toFixed(4)).toLocaleString('en-GB') },
  ];

  /* The sentence clock_qa wrote is only frozen for checks that did NOT pass,
     because carrying it for all nineteen of all 170 segments would double the
     file for text that reads "94.74% of physics triggers matched" beside a
     column already showing 0.947. So the column exists only when there is
     something in it — which, on a fleet that passes everything, is never. */
  const CHK_NOTE = { label: 'What it saw',
                     cell: c => `<span class="dim">${esc(c.d)}</span>` };

  const ARMCOL = [
    { label: 'Arm', cell: a => `<b>${a.name}</b>` },
    { label: 'Triggers', num: true, cell: a => fmtInt(a.r[0]) },
    { label: 'Share', num: true, cell: a => (100 * a.r[1]).toFixed(1) + ' %' },
    { label: 'Mean residual', num: true, cell: a => a.r[2].toFixed(2) + ' ns' },
    { label: 'Fitted offset', num: true, cell: a => a.r[3].toFixed(2) + ' ns' },
    { label: 'vs run_79', num: true,
      title: 'against the reference pair the calibration was derived on',
      cell: a => (a.r[4] > 0 ? '+' : '') + a.r[4].toFixed(2) + ' ns' },
  ];

  /* ---- table -------------------------------------------------------------- */

  function detailHtml(r) {
    const bits = [];
    if (r.st === 'ok' && r.arm) {
      bits.push(facts([
        ['Join', 'produced a file'],
        ['QA verdict', `${r.v} — ${r.nchk} checks`],
        ['Beam covered', mins(r.min)],
        ['Bunches', `${fmtInt(r.nfit)} fitted of ${fmtInt(r.nb)}`],
        ['Triggers', `${fmtInt(r.nph)} physics, ${fmtInt(r.nev - r.nph)} flash`],
        ['Efficiency', `${pc(r.eff)} (held out ${pc(r.eff - r.cv)})`],
        ['Accidental', (100 * r.acc).toFixed(4) + ' %'],
        ['Purity', pc(r.pur, 3)],
        ['Residual', `RMS ${r.rms} ns, mean ${r.mean} ns`],
        ['Clock rate K', r.K.toExponential(4)],
        ['T₀', r.T0 + ' ns'],
        ['Arm offsets', `A ${r.arm[0]}  B ${r.arm[1]}  C ${r.arm[2]}  D ${r.arm[3]} ns`],
        ['Per-bunch scatter', `${r.da} ns offset, ${r.dk} ppm rate`],
        ['Coarse peak S/N', fmtInt(r.snr)],
        ['Beam availability', pc(r.beamav, 1) + ` · ${pc(r.para, 0)} parasitic`],
        ['Median intensity', fmtInt(r.int) + ' ×10¹⁰ protons'],
        ['Slim file', r.mb + ' MB'],
      ]));
      bits.push(subTable(ARMCOL,
        ['A', 'B', 'C', 'D'].map((name, i) => ({ name, r: r.arms[i] })),
        'The four arms'));
      if (r.lv) {
        const checks = D.checks.map((c, i) => ({
          name: c.n, lv: r.lv[i], v: r.chkv[i],
          d: (r.flags.find(f => f.n === c.n) || {}).d,
        }));
        const na = [...r.lv].filter(x => x === 'N').length;
        bits.push(subTable(
          checks.some(c => c.d) ? [...CHKCOL, CHK_NOTE] : CHKCOL, checks,
          `All ${r.lv.length} checks — ` +
          `${[...r.lv].filter(x => x === 'P').length} pass` +
          (na ? `, ${na} not applicable` : '')));
      }
    } else if (r.st === 'ok') {
      // Shipped, but its clock_qa.json was not in the records tree. There are
      // none today; the freeze script says so loudly if that changes, and this
      // exists so such a row cannot quietly render as "not attempted yet".
      bits.push(facts([
        ['Join', 'produced a file'],
        ['QA record', 'missing — nothing to report for this segment'],
        ['Beam covered', mins(r.min)],
      ]));
    } else if (r.st === 'skipped') {
      bits.push(facts([
        ['Join', 'skipped — too little joined beam to fit'],
        ['Overlap', mins(r.min)],
        ['Bunches joined', fmtInt(r.jb)],
      ]));
    } else {
      bits.push(facts([
        ['Join', 'not attempted yet'],
        ['n_TOF source', r.src === 'merged' ? 'merged file' : 'partial set'],
        ['Beam to recover', mins(r.min)],
        ['Sub-run', r.s === '?' ? 'not named in the todo list' : r.s],
      ]));
    }
    return bits.join('');
  }

  function total(shown) {
    const V = VIEWS[state.view];
    const sum = k => shown.reduce((a, r) => a + (r[k] || 0), 0);
    return V.cols.map((c, i) => {
      if (i === 0) return `${shown.length} segment${shown.length > 1 ? 's' : ''}`;
      const how = V.sums[c.key];
      if (!how) return '';
      const v = sum(c.key);
      return how === 'mins' ? mins(v)
        : how === 'mb' ? (v / 1000).toFixed(1) + ' GB' : fmtInt(v);
    });
  }

  const table = makeTable({
    head: thead, body: tbody, foot: tfoot, count: countEl, noun: 'segments',
    cols: VIEWS.coverage.cols, sort: 'id', dir: 1,
    detail: detailHtml,
    total,
    empty: 'No segment matches that filter.',
    tie: (a, b) => a.n - b.n,
    onSort: () => render(),
  });

  function render() {
    const V = VIEWS[state.view];
    table.setCols(V.cols);
    const base = V.only ? rows.filter(V.only) : rows;
    table.render(base.filter(inView), base.length);
  }

  /* ---- wiring ------------------------------------------------------------- */

  function setView(name, push) {
    if (!VIEWS[name]) return;
    state.view = name;
    document.querySelectorAll('[data-view]').forEach(b =>
      b.setAttribute('aria-pressed', b.dataset.view === name ? 'true' : 'false'));
    // The join filter is meaningless in the quality view, which is by
    // definition the joined ones; disable it rather than leave it lying.
    document.querySelectorAll('[data-st]').forEach(b => {
      b.disabled = name === 'quality';
    });
    if (push && location.hash.slice(1) !== name) {
      history.replaceState(null, '', '#' + name);
    }
    drawLegend();
    render();
    drawStrip();
  }

  function fillStats() {
    const ok = rows.filter(r => r.st === 'ok');
    const by = s => rows.filter(r => r.st === s).length;
    const beam = k => rows.filter(k).reduce((a, r) => a + (r.min || 0), 0);
    const shown = {
      segments: fmtInt(rows.length),
      joined: fmtInt(ok.length),
      eff: (100 * D.eff_median).toFixed(1),
      acc: (100 * median(ok.map(r => r.acc))).toFixed(3),
      rms: median(ok.map(r => r.rms)).toFixed(1),
      hours: (beam(r => r.st === 'ok') / 60).toFixed(0),
      recover: fmtInt(by('failed') + by('pending')),
      window: '±' + D.accept_ns,
    };
    document.querySelectorAll('[data-match-stat]').forEach(el => {
      const v = shown[el.dataset.matchStat];
      if (v !== undefined) el.textContent = v;
    });
    document.querySelectorAll('[data-as-of]').forEach(el => {
      el.textContent = D.as_of;
    });
  }

  function median(a) {
    const s = a.filter(v => v !== undefined && v !== null).sort((x, y) => x - y);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
  }

  function init() {
    rows = D.segs;
    rows.forEach(r => { r.id = segId(r); });
    fillStats();

    document.querySelectorAll('[data-view]').forEach(b =>
      b.addEventListener('click', () => setView(b.dataset.view, true)));
    const both = () => { render(); drawStrip(); };
    switchGroup('st', v => { state.st = v; both(); });

    filterEl.addEventListener('input', () => {
      state.q = (filterEl.value || '').toLowerCase();
      both();
    });
    filterEl.hidden = false;

    const tip = makeTip(canvas.parentElement);
    canvas.addEventListener('mousemove', e => {
      const list = stripRows();
      const box = canvas.getBoundingClientRect();
      const mx = e.clientX - box.left, my = e.clientY - box.top;
      const x0 = PAD.l, x1 = canvas.clientWidth - PAD.r;
      const i = Math.floor(((mx - x0) / (x1 - x0)) * list.length);
      if (i < 0 || i >= list.length) { tip.hide(); hover = -1; drawStrip(); return; }
      hover = i;
      drawStrip();
      const r = list[i];
      tip.show(
        `<div class="tt-title">${esc(segId(r))}</div>` +
        (r.st === 'ok'
          ? `<b>${pc(r.eff)}</b> matched · ${pc(r.acc, 3)} accidental<br>` +
            `${mins(r.min)} of beam · residual ${r.rms} ns`
          : `<b>${ST[r.st].label}</b> · ${mins(r.min || 0)} of beam`) +
        `<br><span style="color:var(${ST[r.st].tok})">■</span> ${ST[r.st].label}`,
        mx, my);
    });
    canvas.addEventListener('mouseleave', () => {
      tip.hide(); hover = -1; drawStrip();
    });

    const htip = makeTip(histEl.parentElement);
    histEl.addEventListener('mousemove', e => {
      const H = D.hist;
      const box = histEl.getBoundingClientRect();
      const mx = e.clientX - box.left, my = e.clientY - box.top;
      const x0 = HPAD.l, x1 = histEl.clientWidth - HPAD.r;
      const i = Math.floor(((mx - x0) / (x1 - x0)) * H.counts.length);
      if (i < 0 || i >= H.counts.length) { htip.hide(); return; }
      const a = H.lo + i * H.bin;
      htip.show(`<div class="tt-title">${a} to ${a + H.bin} ns</div>` +
        `<b>${fmtInt(H.counts[i])}</b> matched hits`, mx, my);
    });
    histEl.addEventListener('mouseleave', () => htip.hide());

    window.addEventListener('hashchange', () => setView(location.hash.slice(1), false));
    setView(VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'coverage', false);
    register(drawAll);   // fires once immediately, and on theme/resize after
  }

  load('../data/x17-match.json', 'runs-fallback', p => { D = p; init(); });
})();
