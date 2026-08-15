/* /x17/qa-match.html — the DREAM <-> n_TOF join, from data/x17-match.json.

   The unit is a SEGMENT: one DREAM sub-run crossed with the n_TOF run that was
   taking beam at the same moment. A segment is the smallest thing that can have
   its own clock fit, because the DREAM timestamp clock wanders about a ppm from
   burst to burst and the correction that removes that drift is fitted per
   bunch, inside a segment.

   Two units. The PULSE (one proton pulse = one DREAM burst) is what the
   physics is counted in: since run_79 every burst has one terminal state in
   the pulse ledger, MATCHED or a named reason. The SEGMENT is what carries a
   clock fit. The page leads with pulses and shows the segments behind them.

   Two segment views, and the second exists because of a trap the campaign
   write-up is explicit about:

     quality    the segments that produced a file, and how good each is
     coverage   every segment with beam overlap, including the ones that
                produced nothing

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
  const fracEl = document.getElementById('frac-canvas');
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
    na: { chip: 'no coinc.', label: 'not coincidence-triggered', tok: '--series-3' },
  };
  // Pulse-ledger states, coloured. Keys as the ledger names them.
  const PST = {
    MATCHED: '--good', LOW_COINC: '--warning', UNKNOWN_COINC: '--series-2',
    TOO_FEW_TRIGGERS: '--series-2', NTOF_NO_BUNCH: '--series-1',
    UNJOINED: '--critical', SEGMENT_FAILED: '--critical',
    NOT_ATTEMPTED: '--series-3', EMPTY_PULSE: '--muted',
    NO_BEAM_PULSE: '--muted', NOT_COINC_TRIGGERED: '--muted',
  };
  const PHYS_RUN = 79;   // the trigger was locked to the coincidence here
  const runNo = d => parseInt(String(d).split('_')[1], 10);
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
      key: 'ord', label: 'Segment', num: false,
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
    pulses: {
      key: 'pd', label: 'Pulses', num: true,
      title: 'beam pulses of the sub-run that fall in this n_TOF run, from the pulse ledger (since run_79 only)',
      cell: r => r.pd === undefined ? dash : fmtInt(r.pd),
    },
    unm: {
      key: 'pu', label: 'Unmatched', num: true,
      title: 'pulses of this segment not confidently matched',
      cell: r => r.pd === undefined ? dash
        : r.pu ? `<span style="color:var(--critical)">${fmtInt(r.pu)}</span>`
        : '<span class="dim">0</span>',
    },
    lock: {
      key: 'lock', label: 'Lock', num: false, cls: 'dim',
      title: 'how the burst-to-pulse lock was chosen: count scan, intensity tie-break, the coincidence arbiter, or a hand-verified scan',
      cell: r => r.lock ? esc(r.lock) + (r.srch ? ` ±${r.srch} s` : '') : dash,
    },
  };

  const VIEWS = {
    coverage: {
      cap: 'One bar per segment, in campaign order: height is the beam time it ' +
        'covers, colour is what became of it. The red bars produced no file at ' +
        'all — they are here because a page built only from QA records would ' +
        'not know they existed.',
      cols: [COL.seg, COL.st, COL.kind, COL.min, COL.pulses, COL.unm, COL.lock,
             COL.bunches, COL.events],
      colour: r => ST[r.st].tok,
      legend: ST,
      legendKey: r => r.st,
      sums: { min: 'mins', pd: 'int', pu: 'int' },
      mark: 'bar',
      axis: 'minutes of beam per segment',
      value: r => r.min || 0,
    },
    quality: {
      cap: 'One dot per joined segment: the fraction of DREAM physics triggers ' +
        'that found an n_TOF partner. The dashed line is the fleet median. The ' +
        'axis does not start at zero, which is why these are dots and not bars.',
      cols: [COL.seg, COL.verdict, COL.min, COL.pulses, COL.unm, COL.eff,
             COL.acc, COL.rms, COL.T0, COL.da, COL.mb],
      colour: r => (VERDICT[r.v] || VERDICT.WARN).tok,
      legend: VERDICT,
      legendKey: r => r.v,
      sums: { min: 'mins', mb: 'mb', pd: 'int', pu: 'int' },
      mark: 'dot',
      axis: 'match efficiency per segment',
      value: r => r.eff,
      only: r => r.st === 'ok' && r.eff !== undefined,
    },
  };

  const state = { view: 'coverage', st: 'all', q: '', scope: 'physics',
                  pst: 'all', pq: '' };
  const inScope = r => state.scope === 'all' || runNo(r.d) >= PHYS_RUN;
  let D = null, rows = [], hover = -1;

  function inView(r) {
    if (!inScope(r)) return false;
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

  /* ---- coincidence fraction per pulse ------------------------------------

     The distribution the 80 % acceptance bar cuts. Log y, because the question
     is the shape of the tail: a smooth fall-off below the bar means the
     sub-80 % pulses are the same population undersampled (small bursts); a
     detached bump would mean a distinct failure. */
  function drawFrac() {
    if (!fracEl || !D.pulses || !D.pulses.frac_hist) return;
    const F = D.pulses.frac_hist;
    const C = F.all;
    const A = F.accept || 0.8;
    const { ctx, w, h } = fitCanvas(fracEl, 0.32);
    ctx.clearRect(0, 0, w, h);
    const x0 = HPAD.l, x1 = w - HPAD.r, y0 = h - HPAD.b, y1 = HPAD.t;
    const peak = Math.max(...C);
    const lmax = Math.ceil(Math.log10(peak));
    const X = v => x0 + v * (x1 - x0);           // v in 0..1
    const Y = c => c <= 0 ? y0 : y0 - (Math.log10(c) / lmax) * (y0 - y1);

    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let e = 0; e <= lmax; e++) {
      const v = 10 ** e;
      ctx.strokeStyle = css('--grid');
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(Y(v)) + 0.5);
      ctx.lineTo(x1, Math.round(Y(v)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = css('--muted');
      ctx.fillText(v >= 1000 ? (v / 1000) + ' k' : String(v), x0 - 7, Y(v));
    }
    const bw = (x1 - x0) / F.n;
    C.forEach((c, i) => {
      if (!c) return;
      const x = X(i * F.bin);
      const top = Y(c);
      const below = (i + 1) * F.bin <= A + 1e-9;
      ctx.fillStyle = css(below ? '--warning' : '--series-1');
      ctx.beginPath();
      ctx.roundRect(x + 0.5, top, Math.max(1, bw - 1), y0 - top, [1, 1, 0, 0]);
      ctx.fill();
    });
    // the bar
    ctx.strokeStyle = css('--critical');
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(X(A)) + 0.5, y1);
    ctx.lineTo(Math.round(X(A)) + 0.5, y0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = css('--axis');
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(y0) + 0.5);
    ctx.lineTo(x1, Math.round(y0) + 0.5);
    ctx.stroke();
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let v = 0; v <= 100; v += 10) ctx.fillText(v + ' %', X(v / 100), y0 + 6);
    ctx.fillText('triggers of the pulse with a wall+plastic partner inside ±25 ns',
      (x0 + x1) / 2, y0 + 18);
    ctx.textAlign = 'left';
    const tot = C.reduce((a, b) => a + b, 0);
    ctx.fillText(`${fmtInt(tot)} pulses, 1 % bins, log scale`, x0, 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = css('--critical');
    ctx.fillText(`${Math.round(100 * A)} % bar`, X(A) - 4, y1 + 2);
  }

  function fracNote() {
    const el = document.getElementById('frac-note');
    if (!el || !D.pulses || !D.pulses.frac_hist) return;
    const F = D.pulses.frac_hist, C = F.all;
    const A = F.accept || 0.8, pctA = Math.round(100 * A);
    const tot = C.reduce((a, b) => a + b, 0);
    const below = lim => C.slice(0, Math.round(lim / F.bin)).reduce((a, b) => a + b, 0);
    let cum = 0, med = 0;
    for (let i = 0; i < C.length; i++) { cum += C[i]; if (cum >= tot / 2) { med = i; break; } }
    const bA = below(A), b80 = below(0.8), b70 = below(0.7), b50 = below(0.5);
    el.innerHTML = `Median pulse: <b>${med}–${med + 1} %</b> of its triggers coincident. ` +
      `Below 80 %: ${fmtInt(b80)} pulses (${(100 * b80 / tot).toFixed(2)} %); ` +
      `below 70 %: ${fmtInt(b70)}; below 50 %: ${fmtInt(b50)}. ` +
      `<b>Below the ${pctA} % bar: ${fmtInt(bA)}</b> (${(100 * bA / tot).toFixed(3)} %). ` +
      `The tail below 80 % falls smoothly, about ×1.4 per percent bin, and its pulses ` +
      `are thinner bursts (median ${F.low_ntrig_median || '—'} triggers against ~82 ` +
      `for the fleet) — the same population undersampled, not a second failure ` +
      `mode. That is why the bar was moved from 80 % to ${pctA} % on 15 August: ` +
      `what remains below it is a handful of genuine outliers, and the lock ` +
      `decision (taken on the median of 32 sampled pulses, ~96 % right vs 0.00 % ` +
      `wrong) is unaffected.`;
  }

  /* ---- the per-segment strip ---------------------------------------------- */

  function stripRows() {
    const V = VIEWS[state.view];
    const base = rows.filter(inScope);
    return V.only ? base.filter(V.only) : base;
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

  function drawAll() { drawHist(); drawFrac(); drawStrip(); }

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
    const pul = r.pd === undefined ? null
      : ['Pulses', `${fmtInt(r.pd)} in this segment, ${fmtInt(r.pu)} not matched` +
        (r.pl ? ` (${fmtInt(r.pl)} below the coincidence bar)` : '')];
    if (r.st === 'ok' && r.arm) {
      bits.push(facts([
        ['Join', 'produced a file'],
        pul,
        ['Lock chosen by', r.lock ? r.lock + (r.off !== null && r.off !== undefined
          ? ` at ${r.off > 0 ? '+' : ''}${r.off} s` : '') +
          (r.srch ? `, enumeration ±${r.srch} s` : '') : null],
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
        pul,
      ]));
    } else if (r.st === 'failed') {
      bits.push(facts([
        ['Join', 'failed — no file written'],
        ['Why', r.err || 'no reason recorded'],
        ['Beam covered', mins(r.min || 0)],
        pul,
      ]));
    } else if (r.st === 'na') {
      bits.push(facts([
        ['Join', 'not attempted — this trigger mode carries no wall+plastic ' +
          'coincidence (cosmic-bounce block, scintillator-only or mesh scan)'],
        ['Beam covered', mins(r.min || 0)],
      ]));
    } else {
      bits.push(facts([
        ['Join', 'not attempted yet'],
        ['Beam to recover', mins(r.min || 0)],
        pul,
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
    cols: VIEWS.coverage.cols, sort: 'ord', dir: 1,
    detail: detailHtml,
    total,
    empty: 'No segment matches that filter.',
    tie: (a, b) => a.n - b.n,
    onSort: () => render(),
  });

  function render() {
    const V = VIEWS[state.view];
    table.setCols(V.cols);
    const scoped = rows.filter(inScope);
    const base = V.only ? scoped.filter(V.only) : scoped;
    table.render(base.filter(inView), base.length);
  }

  /* ---- pulses -------------------------------------------------------------

     The pulse ledger, sub-run by sub-run. `D.pulses.subs` rows carry
     {d, s, n, den, m, st:{STATE:n}, lock:[off_s, by], segs:[[ntof, den, m,
     low]], why:[[state, reason, count]]}. `den` counts only the states that
     are ours to match; `n` is every burst of the sub-run. */
  const pbody = document.getElementById('pulse-rows');
  const stateInfo = () => Object.fromEntries(D.pulses.states.map(x => [x.k, x]));

  function pulseStatesHtml() {
    const S = D.pulses.states, info = stateInfo();
    const all = S.reduce((a, x) => a + x.n, 0);
    const ours = S.filter(x => x.grp === 'ours');
    const ntof = S.filter(x => x.grp === 'ntof');
    const not = S.filter(x => x.grp === 'notours');
    const den = ours.reduce((a, x) => a + x.n, 0);
    const nto = ntof.reduce((a, x) => a + x.n, 0);
    const beam = den + nto;
    const bar = list => '<div class="pbar">' + list.filter(x => x.n).map(x =>
      `<i title="${esc(x.label)}: ${fmtInt(x.n)}" style="flex:${x.n};` +
      `background:var(${PST[x.k] || '--muted'})"></i>`).join('') + '</div>';
    const legend = list => '<div class="legend">' + list.filter(x => x.n).map(x =>
      `<span><i style="background:var(${PST[x.k] || '--muted'})"></i>` +
      `<b>${fmtInt(x.n)}</b>&nbsp;${esc(x.label)}` +
      (x.k !== 'MATCHED' && den ? ` <span class="dim">(${(100 * x.n / den).toFixed(2)} %)</span>` : '') +
      `</span>`).join('') + '</div>';
    const rowsHtml = list => list.filter(x => x.n).map(x =>
      `<tr><td><span style="color:var(${PST[x.k] || '--muted'})">■</span> ` +
      `<b>${esc(x.label)}</b><br><span class="dim">${esc(x.d)}</span></td>` +
      `<td class="num">${fmtInt(x.n)}</td>` +
      `<td class="num">${den ? (100 * x.n / den).toFixed(2) + ' %' : dash}</td></tr>`)
      .join('');
    return `<p class="cap">Of ${fmtInt(all)} DREAM bursts since run_${D.pulses.since_run}, ` +
      `${fmtInt(all - beam)} had no beam behind them or no coincidence trigger and are ` +
      `not ours to match. Of the ${fmtInt(beam)} beam pulses, ` +
      `<b>${fmtInt(nto)} (${(100 * nto / beam).toFixed(2)} %) fell where n_TOF was not ` +
      `recording</b> — no data exists for them. Of the ${fmtInt(den)} left, ` +
      `<b>${fmtInt(info.MATCHED.n)} (${(100 * info.MATCHED.n / den).toFixed(2)} %)</b> ` +
      `are confidently matched. Percentages below are of the ${fmtInt(den)}.</p>` +
      bar(ours) + legend(ours) +
      '<div class="sub-scroll"><table class="sub-table"><thead><tr><th>State</th>' +
      '<th class="num">Pulses</th><th class="num">of ours</th></tr></thead><tbody>' +
      rowsHtml(ours) +
      `<tr><td colspan="3" class="dim">n_TOF not recording — real beam, no n_TOF data; ` +
      `understood and irrecoverable, outside the denominator ` +
      `(${(100 * nto / beam).toFixed(2)} % of beam pulses)</td></tr>` +
      rowsHtml(ntof) +
      `<tr><td colspan="3" class="dim">Not ours to match — outside the denominator</td></tr>` +
      rowsHtml(not) + '</tbody></table></div>';
  }

  const PCOL = [
    { key: 'ord', label: 'Sub-run', num: false,
      cell: r => `<b>${esc(r.d)}</b><span class="dim">/</span>${esc(r.s)}` },
    { key: 'ntof', label: 'n_TOF run(s)', num: false, cls: 'dim',
      cell: r => r.segs.length ? r.segs.map(x => x[0]).join(', ') : dash },
    { key: 'den', label: 'Pulses', num: true,
      title: 'beam pulses that are ours to match', cell: r => fmtInt(r.den) },
    { key: 'unm', label: 'Unmatched', num: true,
      cell: r => r.unm ? `<span style="color:var(--critical)">${fmtInt(r.unm)}</span>`
        : `<span class="dim">0</span>` },
    { key: 'frac', label: 'Matched', num: true,
      cell: r => r.den ? `<span style="white-space:nowrap">${(100 * r.frac).toFixed(2)} %</span>` : dash },
    { key: 'nt', label: 'n_TOF off', num: true, cls: 'dim',
      title: 'beam pulses of this sub-run with no n_TOF data (run transition / DAQ reset) — outside the denominator',
      cell: r => r.nt ? fmtInt(r.nt) : '<span class="dim">0</span>' },
    { key: 'why', label: 'Why not', num: false,
      cell: r => Object.entries(r.st).filter(([k, v]) => k !== 'MATCHED' &&
        stateInfo()[k] && stateInfo()[k].ours && v)
        .map(([k, v]) => chip('st', PST[k] || '--muted',
          `${fmtInt(v)} ${stateInfo()[k].label}`)).join(' ') || dash },
    { key: 'lockby', label: 'Lock', num: false, cls: 'dim',
      cell: r => r.lock ? esc(r.lock[1] || '?') : (r.pend ? 'pending' : dash) },
  ];

  function pulseDetail(r) {
    const info = stateInfo();
    const bits = [facts([
      ['Bursts in the sub-run', `${fmtInt(r.n)} (${fmtInt(r.n - r.den)} not ours to match)`],
      ['Ours to match', fmtInt(r.den)],
      ['n_TOF not recording', r.nt ? `${fmtInt(r.nt)} — no n_TOF data, outside the denominator` : '0'],
      ['Confidently matched', `${fmtInt(r.m)} — ${r.den ? (100 * r.m / r.den).toFixed(2) : '—'} %`],
      ['Lock', r.lock ? `${r.lock[0] > 0 ? '+' : ''}${r.lock[0]} s, chosen by ${r.lock[1]}`
        : (r.pend ? 'pending — ' + r.pend : 'none')],
    ])];
    if (r.segs.length) {
      bits.push(subTable([
        { label: 'n_TOF run', cell: x => `<b>${x[0]}</b>` },
        { label: 'Pulses', num: true, cell: x => fmtInt(x[1]) },
        { label: 'Matched', num: true, cell: x => fmtInt(x[2]) },
        { label: 'Low coinc.', num: true, cell: x => x[3] ? fmtInt(x[3]) : '<span class="dim">0</span>' },
        { label: 'Unmatched', num: true, cell: x => x[1] - x[2]
          ? `<span style="color:var(--critical)">${fmtInt(x[1] - x[2])}</span>` : '<span class="dim">0</span>' },
      ], r.segs, 'By n_TOF run'));
    }
    if (r.why.length) {
      bits.push(subTable([
        { label: 'State', cell: w => `<span style="color:var(${PST[w[0]] || '--muted'})">■</span> ` +
          esc((info[w[0]] || { label: w[0] }).label) },
        { label: 'Reason', cell: w => esc(w[1]) },
        { label: 'Pulses', num: true, cell: w => fmtInt(w[2]) },
      ], r.why, 'Every unmatched pulse, by reason'));
    }
    return bits.join('');
  }

  function pulseTotal(shown) {
    const den = shown.reduce((a, r) => a + r.den, 0);
    const m = shown.reduce((a, r) => a + r.m, 0);
    const nt = shown.reduce((a, r) => a + (r.nt || 0), 0);
    return [`${shown.length} sub-run${shown.length > 1 ? 's' : ''}`, '',
      fmtInt(den), fmtInt(den - m), den ? (100 * m / den).toFixed(2) + ' %' : '',
      fmtInt(nt), '', ''];
  }

  let ptable = null, prows = [];
  function pulseInView(r) {
    // Sub-runs with nothing to match (cosmic-bounce blocks, calibration
    // modes: every burst NO_BEAM / NOT_COINC_TRIGGERED) stay in the state
    // totals above but are noise in a table about unmatched pulses.
    if (state.pst !== 'nobeam' && !r.den) return false;
    if (state.pst === 'nobeam' && r.den) return false;
    if (state.pst === 'miss' && !r.unm) return false;
    if (state.pst === 'bad' && (r.den === 0 || r.frac >= 0.99)) return false;
    if (!state.pq) return true;
    const hay = `${r.d}/${r.s} ${r.segs.map(x => x[0]).join(' ')} ` +
      `${Object.keys(r.st).join(' ')}`.toLowerCase();
    return state.pq.split(/\s+/).filter(Boolean).every(w => hay.includes(w));
  }
  function renderPulses() {
    ptable.render(prows.filter(pulseInView), prows.filter(r => r.den).length);
  }
  function fillSummaries() {
    const ps = document.getElementById('pulse-summary');
    if (ps && D.pulses) {
      const withPulses = prows.filter(r => r.den);
      const miss = withPulses.filter(r => r.unm).length;
      ps.textContent = `— ${fmtInt(withPulses.length)} sub-runs with beam pulses, ` +
        `${fmtInt(miss)} of them with unmatched pulses · click to expand`;
    }
    const ss = document.getElementById('segment-summary');
    if (ss) {
      const phys = rows.filter(r => runNo(r.d) >= PHYS_RUN);
      const by = s => phys.filter(r => r.st === s).length;
      ss.textContent = `— ${fmtInt(phys.length)} segments since run_79: ` +
        `${fmtInt(by('ok'))} joined, ${fmtInt(by('failed'))} failed, ` +
        `${fmtInt(by('pending'))} not attempted, ${fmtInt(by('na'))} not ` +
        `coincidence-triggered · click to expand`;
    }
  }

  function initPulses() {
    if (!pbody || !D.pulses) return;
    prows = D.pulses.subs.map(r => ({
      ...r, id: `${r.d}/${r.s}`, unm: r.den - r.m,
      ord: `${String(runNo(r.d)).padStart(4, '0')}/${r.s}`,
      frac: r.den ? r.m / r.den : null,
      ntof: r.segs.length ? r.segs[0][0] : 0,
      lockby: r.lock ? r.lock[1] : (r.pend ? 'pending' : ''),
    }));
    document.getElementById('pulse-states').innerHTML = pulseStatesHtml();
    ptable = makeTable({
      head: document.getElementById('pulse-head'), body: pbody,
      foot: document.getElementById('pulse-foot'),
      count: document.getElementById('pulse-count'), noun: 'sub-runs',
      cols: PCOL, sort: 'ord', dir: 1, detail: pulseDetail, total: pulseTotal,
      empty: 'No sub-run matches that filter.',
      tie: (a, b) => a.ord < b.ord ? -1 : 1,
      onSort: renderPulses,
    });
    switchGroup('pst', v => { state.pst = v; renderPulses(); });
    const pf = document.getElementById('pulse-filter');
    if (pf) {
      pf.hidden = false;
      pf.addEventListener('input', () => {
        state.pq = (pf.value || '').toLowerCase(); renderPulses();
      });
    }
    const un = document.getElementById('pulse-unclassified');
    const u = D.pulses.unclassified || [];
    if (un && u.length) {
      // "run_116/stat090_0026 [lock pending: 1251 bursts]" -> compact: the
      // big ones by name, the rest grouped per run.
      const parsed = u.map(t => {
        const m = /^(run_\d+)\/(\S+) \[.*?(\d+) bursts?\]/.exec(t);
        return m ? { d: m[1], s: m[2].replace(/^stat090_/, ''), n: +m[3] } : { d: t, s: '', n: 0 };
      });
      const total = parsed.reduce((a, x) => a + x.n, 0);
      const big = parsed.filter(x => x.n >= 100);
      const rest = parsed.filter(x => x.n < 100);
      const byRun = {};
      rest.forEach(x => { (byRun[x.d] = byRun[x.d] || []).push(x); });
      const parts = big.map(x => `${x.d}/${x.s} (${fmtInt(x.n)})`).concat(
        Object.entries(byRun).map(([d, xs]) =>
          `${d} × ${xs.length} sub-runs (${fmtInt(xs.reduce((a, x) => a + x.n, 0))})`));
      un.textContent = `${u.length} sub-runs with ${fmtInt(total)} bursts are not yet ` +
        `in the ledger and are outside every total above — no slim product exists ` +
        `and no lock could be found for them off-site: ${parts.join(', ')}.`;
    }
    renderPulses();
    fracNote();
    fillSummaries();
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
    // Headline segment counts are the physics scope (since run_79), which is
    // what the pulse ledger covers; the whole-run scope is a table toggle.
    const phys = rows.filter(r => runNo(r.d) >= PHYS_RUN && r.st !== 'na');
    const ok = phys.filter(r => r.st === 'ok');
    const by = s => phys.filter(r => r.st === s).length;
    const beam = k => phys.filter(k).reduce((a, r) => a + (r.min || 0), 0);
    const P = D.pulses;
    const all = P.states.reduce((a, x) => a + x.n, 0);
    const shown = {
      segments: fmtInt(phys.length),
      joined: fmtInt(ok.length),
      eff: (100 * D.eff_median).toFixed(1),
      acc: (100 * median(ok.map(r => r.acc))).toFixed(3),
      rms: median(ok.map(r => r.rms)).toFixed(1),
      hours: (beam(r => r.st === 'ok') / 60).toFixed(0),
      recover: fmtInt(by('failed') + by('pending')),
      window: '±' + D.accept_ns,
      pden: fmtInt(P.den),
      pmatched: fmtInt(P.matched),
      punmatched: fmtInt(P.den - P.matched),
      pfrac: (100 * P.matched / P.den).toFixed(2),
      pall: fmtInt(all),
      pntof: (100 * (P.ntof_off || 0) / (P.beam || 1)).toFixed(2),
      accept: String(Math.round(100 * (P.accept_frac || 0.8))),
      pntofn: fmtInt(P.ntof_off || 0),
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
    rows.forEach(r => {
      r.id = segId(r);
      // sort key: run number zero-padded so run_79 precedes run_100
      r.ord = `${String(runNo(r.d)).padStart(4, '0')}/${r.s}×${r.n}`;
      if (r.pd !== undefined) r.pu = r.pd - r.pm;
    });
    fillStats();

    document.querySelectorAll('[data-view]').forEach(b =>
      b.addEventListener('click', () => setView(b.dataset.view, true)));
    const both = () => { render(); drawStrip(); };
    switchGroup('st', v => { state.st = v; both(); });
    switchGroup('scope', v => { state.scope = v; both(); });
    initPulses();

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
        (r.pd !== undefined ? `<br>${fmtInt(r.pd)} pulses, ${fmtInt(r.pu)} unmatched` : '') +
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
