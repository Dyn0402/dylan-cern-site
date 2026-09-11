/* /x17/qa-tracks.html — the per-track tracking QA, drilled down four levels.

   The other four QA pages answer "is the data there and is it intact". This
   one answers "is the RECONSTRUCTION sound", which is a different shape of
   question: the campaign summary says arm D's chi2/dof moved in run_116 and
   stops there, and the next thing anyone wants is the tracks that moved it.
   So the page is a drill-down, and each level is a different file:

     campaign   data/x17-trackqa.json      36 runs x 4 arms, always loaded
     run        data/trackqa/<run>.json.gz every file tag as a time series
     sub-run    x17/trackqa/tracks/*.parquet  the tracks themselves, read in
                                            the browser over range requests
     track      one row of that shard, every column

   THE THIRD LEVEL IS THE UNUSUAL ONE. The shards are 10-20 MB each and the
   page never downloads one. hyparquet reads the footer, works out which byte
   ranges hold the columns being plotted, and asks CERN's Apache for those --
   which it serves, because it honours Range. A histogram therefore costs the
   columns it plots, not the size of the file, and changing a cut costs nothing
   at all because the columns are already in memory as typed arrays.

   WHAT IS COMPUTED WHERE, and why it matters: levels 1 and 2 are quantiles
   frozen by `sept26_prelim_analysis.tracking_qa`; level 3 is computed here,
   in the browser, from the same columns that script profiled. That is
   deliberate -- the two can be checked against each other, and the page shows
   the frozen p50 as a tick on the live histogram so a disagreement is visible
   rather than merely possible.

   Colour is arm identity and nothing else: --det-a..--det-d, fixed, never
   cycled, and every series is direct-labelled so identity never rests on hue.

   ANGLES CARRY A WARNING. `k` is the open blocker of 2026-09-10 and it varies
   run to run, so any panel showing an angle also shows the scale it used. */

(() => {
  'use strict';
  const { css, fitCanvas, register, makeTip } = window.viz;
  const { fmt, esc, chip, subTable, makeTable } = window.x17;

  const root = document.getElementById('trackqa');
  if (!root) return;

  /* Where this script was loaded from fixes every other URL. The page sits at
     /x17/ and the data at /data/, so a hardcoded absolute path would break any
     preview that is not served from the site root. */
  const SELF = (document.currentScript && document.currentScript.src) ||
    new URL('js/x17-trackqa.js', location.href).href;
  const JS_DIR = SELF.slice(0, SELF.lastIndexOf('/') + 1);
  const SITE = new URL('../', JS_DIR).href;
  const url = p => new URL(p, SITE).href;

  const ARMS = ['A', 'B', 'C', 'D'];
  const armColor = a => css('--det-' + a.toLowerCase());

  /* ---- state -------------------------------------------------------------
     One object, and every panel reads it. `sel` is the drill-down position;
     everything else is a control. Panels below the current position are torn
     down when it moves up, so the page can never show a run's timeline beside
     a different run's tracks. */
  const S = {
    D: null,                 // tier 1
    varKey: 'chi2dof_x',     // the variable every panel plots
    arm: 'all',
    run: null, runData: null,      // tier 2
    subrun: null, shard: null,     // tier 3
    absent: null,                  // optional columns this shard lacks
    cols: null, n: 0,              // decoded columns of the current shard
    gate: 'all',                   // all | gated | rejected
    brush: null,                   // [lo, hi] on the current variable
    // A VARS *key*, not a column name: VAR() looks up by key, and setting this
    // to 'x_n_strips' (the column) silently left the density plot blank.
    yKey: 'n_strips_x',            // the density plot's second axis
    busy: false,
  };

  const el = id => document.getElementById(id);
  const show = (id, on) => { const e = el(id); if (e) e.hidden = !on; };
  const VAR = k => (S.D.vars.concat(S.D.extra_vars)).find(v => v.key === k);
  const frozenVar = k => S.D.vars.find(v => v.key === k);   // has quantiles

  /* ---- the worker ---------------------------------------------------------
     Created once, lazily: someone who only reads the run table should never
     pay for it. */
  let worker = null, seq = 0;
  const pending = new Map();
  function ask(op, payload) {
    if (!worker) {
      worker = new Worker(JS_DIR + 'x17-trackqa-worker.js', { type: 'module' });
      worker.onmessage = e => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error));
      };
      worker.onerror = e => {
        // A module worker that cannot even start (an old browser, a blocked
        // file) must not leave the page spinning forever.
        pending.forEach(p => p.rej(new Error(e.message || 'worker failed')));
        pending.clear();
      };
    }
    const id = ++seq;
    return new Promise((res, rej) => {
      pending.set(id, { res, rej });
      worker.postMessage({ id, op, ...payload });
    });
  }

  /* ---- small helpers ------------------------------------------------------ */
  const num = (v, d = 3) => (v === null || v === undefined || !isFinite(v))
    ? fmt.dash : (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0)
      ? v.toExponential(1) : String(+v.toFixed(d)));
  const pct = v => (v === null || v === undefined) ? fmt.dash
    : (100 * v).toFixed(1) + '%';

  /* Quantile index inside a frozen row: p05 p25 p50 p75 p95 at tier 1,
     p25 p50 p75 at tier 2. Read from the payload, never assumed. */
  const qi = (list, want) => list.indexOf(want);

  function niceTicks(lo, hi, log) {
    const out = [];
    if (log) {
      for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
        const v = 10 ** e;
        if (v >= lo && v <= hi) out.push(v);
      }
      return out.length > 1 ? out : [lo, hi];
    }
    const step = window.x17.tickStep(hi - lo);
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
    return out;
  }

  function axes(ctx, g, opts) {
    const { x0, x1, y0, y1 } = g;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (const v of niceTicks(opts.ylo, opts.yhi, opts.ylog)) {
      const y = Math.round(g.Y(v)) + 0.5;
      ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.fillStyle = css('--muted');
      ctx.fillText(opts.ylog ? shortExp(v) : String(+v.toPrecision(3)), x0 - 7, y);
    }
    ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y1); ctx.lineTo(x0 + 0.5, y0); ctx.lineTo(x1, y0);
    ctx.stroke();
    if (opts.ylabel) {
      ctx.fillStyle = css('--muted'); ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(opts.ylabel, x0, 1);
    }
  }
  const shortExp = v => {
    const e = Math.round(Math.log10(v));
    return (e >= -2 && e <= 3) ? String(+v.toPrecision(3)) : '1e' + e;
  };

  /* ====================================================================== */
  /* PANEL 1 — the campaign: every run, every arm, one variable              */
  /* ====================================================================== */
  const runCanvas = el('run-canvas');
  const runTip = runCanvas ? makeTip(runCanvas.parentElement) : null;
  let runHover = -1;

  function drawRuns() {
    if (!S.D || !runCanvas) return;
    const V = frozenVar(S.varKey);
    const { ctx, w, h } = fitCanvas(runCanvas, 0.34);
    ctx.clearRect(0, 0, w, h);
    const cap = el('run-chart-cap');

    if (!V) {
      // An EXTRA var has no frozen quantiles; say so rather than drawing
      // an empty box that looks like "no data".
      ctx.fillStyle = css('--muted');
      ctx.font = '12.5px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Not summarised per run — open a sub-run to histogram it.',
        w / 2, h / 2);
      if (cap) cap.textContent = 'tracking_qa profiles twenty variables per run;'
        + ' this one is only in the per-track shards.';
      return;
    }

    const runs = S.D.runs;
    const PAD = { l: 52, r: 12, t: 18, b: 34 };
    const x0 = PAD.l, x1 = w - PAD.r, y0 = h - PAD.b, y1 = PAD.t;
    const arms = S.arm === 'all' ? ARMS : [S.arm];

    let lo = Infinity, hi = -Infinity;
    for (const r of runs) for (const a of arms) {
      const q = r.arms[a] && r.arms[a][S.varKey];
      if (!q) continue;
      for (const v of q) if (v !== null && isFinite(v)) {
        lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
    }
    if (!isFinite(lo)) return;
    const log = V.log && lo > 0;
    if (log) { lo /= 1.6; hi *= 1.6; } else { const m = (hi - lo) * 0.08 || 1; lo -= m; hi += m; }

    const T = v => log ? Math.log10(Math.max(v, 1e-12)) : v;
    const Y = v => y0 - (T(v) - T(lo)) / (T(hi) - T(lo) || 1) * (y0 - y1);
    const bw = (x1 - x0) / runs.length;
    const X = i => x0 + bw * (i + 0.5);
    const g = { x0, x1, y0, y1, Y, X };
    axes(ctx, g, { ylo: lo, yhi: hi, ylog: log, ylabel: V.label });

    // The campaign reference band, behind everything: p25-p75 of the arm over
    // the whole campaign. A run inside it is ordinary by construction.
    if (arms.length === 1) {
      const ref = S.D.arm[arms[0]] && S.D.arm[arms[0]][S.varKey];
      if (ref) {
        const i25 = qi(S.D.quants, 'p25'), i75 = qi(S.D.quants, 'p75');
        ctx.fillStyle = css('--wash-1');
        ctx.fillRect(x0, Y(ref[i75]), x1 - x0, Y(ref[i25]) - Y(ref[i75]));
      }
    }

    const i05 = qi(S.D.quants, 'p05'), i25 = qi(S.D.quants, 'p25');
    const i50 = qi(S.D.quants, 'p50'), i75 = qi(S.D.quants, 'p75');
    const i95 = qi(S.D.quants, 'p95');
    const wq = Math.min(bw / (arms.length + 0.8), 9);

    runs.forEach((r, i) => {
      arms.forEach((a, k) => {
        const q = r.arms[a] && r.arms[a][S.varKey];
        if (!q || q[i50] === null) return;
        const cx = X(i) + (k - (arms.length - 1) / 2) * wq;
        const col = armColor(a);
        const dim = (S.run && S.run !== r.run) ? 0.32 : 1;
        ctx.globalAlpha = dim;
        // p05-p95 as a hairline, p25-p75 as the body, p50 as a cap: a box plot
        // without the furniture, which at 36 x 4 boxes would be all furniture.
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, Y(q[i05]));
        ctx.lineTo(Math.round(cx) + 0.5, Y(q[i95]));
        ctx.stroke();
        ctx.fillStyle = col; ctx.globalAlpha = dim * 0.35;
        ctx.fillRect(cx - wq / 2 + 0.5, Y(q[i75]), wq - 1, Y(q[i25]) - Y(q[i75]));
        ctx.globalAlpha = dim;
        ctx.fillRect(cx - wq / 2 + 0.5, Math.round(Y(q[i50])) - 0.5, wq - 1, 1.6);
      });
      ctx.globalAlpha = 1;
      if (i === runHover) {
        ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(X(i), y1); ctx.lineTo(X(i), y0); ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // Run labels: every run if they fit, else every third.
    ctx.fillStyle = css('--muted'); ctx.textAlign = 'center';
    ctx.textBaseline = 'top'; ctx.font = '10px system-ui, sans-serif';
    const every = bw < 22 ? Math.ceil(22 / bw) : 1;
    runs.forEach((r, i) => {
      if (i % every) return;
      ctx.fillStyle = (S.run === r.run) ? css('--ink') : css('--muted');
      ctx.fillText(String(r.no), X(i), y0 + 5);
    });
    // The 27 July access, which is a condition boundary in this table.
    const bIdx = runs.findIndex(r => r.condition === 'post_access_27jul');
    if (bIdx > 0) {
      const bx = Math.round(x0 + bw * bIdx) + 0.5;
      ctx.strokeStyle = css('--critical'); ctx.lineWidth = 1.1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(bx, y1); ctx.lineTo(bx, y0); ctx.stroke();
      ctx.setLineDash([]);
    }
    runCanvas._geom = { X, Y, x0, x1, y0, y1, bw, runs };
    if (cap) {
      cap.innerHTML = `Box is p25–p75, cap is the median, hairline p05–p95, for ` +
        `<b>${esc(V.label)}</b>. ` + (arms.length === 1
          ? `The band behind is arm ${arms[0]}'s campaign p25–p75. `
          : 'Colour is the arm. ') +
        `The dashed line is the 27 July access, which is a condition boundary — ` +
        `runs either side are not the same detector. Click a run to open it.`;
    }
  }

  function runHoverMove(ev) {
    const g = runCanvas._geom;
    if (!g) return;
    const r = runCanvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    if (mx < g.x0 || mx > g.x1 || my > g.y0 + 12) {
      if (runHover !== -1) { runHover = -1; runTip.hide(); drawRuns(); }
      return;
    }
    const i = Math.max(0, Math.min(g.runs.length - 1,
      Math.floor((mx - g.x0) / g.bw)));
    if (i !== runHover) { runHover = i; drawRuns(); }
    const row = g.runs[i], V = frozenVar(S.varKey);
    const i50 = qi(S.D.quants, 'p50');
    const lines = ARMS.filter(a => row.arms[a]).map(a => {
      const q = row.arms[a][S.varKey];
      return `<div class="row"><i style="background:${armColor(a)}"></i>${a}` +
        `<b style="margin-left:auto">${q ? num(q[i50]) : fmt.dash}</b></div>`;
    }).join('');
    runTip.show(`<div class="tt-title">${row.run} · ${esc(V.label)} median` +
      `</div>${lines}<div class="row dim">${fmt.M(row.n)} tracks · ` +
      `${row.n_subruns} sub-runs · ${row.n_tags} tags</div>`, mx, my);
  }

  function runClick(ev) {
    const g = runCanvas._geom;
    if (!g) return;
    const r = runCanvas.getBoundingClientRect();
    const i = Math.floor((ev.clientX - r.left - g.x0) / g.bw);
    if (i >= 0 && i < g.runs.length) selectRun(g.runs[i].run);
  }

  /* ====================================================================== */
  /* PANEL 2 — the run table                                                */
  /* ====================================================================== */
  let table = null;

  function armCell(r, a, stat) {
    const row = r.arms[a];
    if (!row) return fmt.dash;
    if (stat === 'n') return fmt.M(row.n);
    const q = row[S.varKey];
    if (!q) return fmt.dash;
    return num(q[qi(S.D.quants, 'p50')]);
  }

  function runDetail(r) {
    const i50 = qi(S.D.quants, 'p50');
    const cols = [
      { label: 'Arm', cell: x => `<span class="det-${x.a.toLowerCase()}">${x.a}</span>` },
      { label: 'Tracks', num: true, cell: x => fmt.M(x.row.n) },
      { label: 'Gated', num: true, cell: x => pct(x.row.f[S.D.flags.indexOf('gated')]) },
      ...S.D.quants.map((q, i) => ({
        label: q, num: true,
        cell: x => x.row[S.varKey] ? num(x.row[S.varKey][i]) : fmt.dash,
      })),
      { label: 'chi2>100', num: true,
        cell: x => pct(x.row.p[S.D.pathology.indexOf('frac_chi2_gt_100')]) },
      { label: 'tan unsane', num: true,
        cell: x => pct(1 - x.row.f[S.D.flags.indexOf('tan_sane')]) },
      { label: 'railed', num: true,
        cell: x => pct(x.row.f[S.D.flags.indexOf('drift_railed')]) },
    ];
    const rows = ARMS.filter(a => r.arms[a]).map(a => ({ a, row: r.arms[a] }));
    const V = frozenVar(S.varKey);

    const shards = r.shards.length ? subTable([
      { label: 'Sub-run', cell: s => esc(s.subrun) },
      { label: 'Tracks', num: true, cell: s => fmt.M(s.n) },
      { label: 'Gated', num: true, cell: s => pct(s.n_gated / s.n) },
      { label: 'Events', num: true, cell: s => fmt.M(s.n_events) },
      { label: 'Tags', num: true, cell: s => String(s.n_tags) },
      { label: 'Shard', num: true, cell: s => (s.bytes / 1e6).toFixed(1) + ' MB' },
      { label: '', cell: s => `<button type="button" class="mini" ` +
          `data-open-shard="${esc(r.run)}|${esc(s.subrun)}">tracks →</button>` },
    ], r.shards, 'Its sub-runs. Opening one reads that shard\'s columns straight '
      + 'from EOS — only the columns being plotted, not the file.')
      : `<p class="sub-cap">No per-track shard has been pushed for this run yet, so
         the drill-down stops at the tags. The summaries above are complete.</p>`;

    return `<p class="sub-cap">Quantiles are of <b>${esc(V ? V.label : S.varKey)}</b>,
      over the run's gated tracks.</p>` +
      subTable(cols, rows) + shards +
      `<p class="sub-cap" style="margin-top:12px">
        <button type="button" class="mini" data-open-run="${esc(r.run)}">
        open the tag timeline →</button></p>`;
  }

  function renderTable() {
    if (!table) return;
    const V = frozenVar(S.varKey);
    const med = V ? `${V.label} p50` : 'median';
    const cols = [
      { key: 'no', label: 'Run', cell: r =>
        `<b>${esc(r.run)}</b>${S.run === r.run ? ' <span class="dim">·open</span>' : ''}` },
      { key: 't0', label: 'Started', num: true, cell: r => fmt.stamp(r.t0) },
      { key: 'n', label: 'Tracks', num: true, cell: r => fmt.M(r.n) },
      { key: 'n_subruns', label: 'Sub-runs', num: true, cell: r => String(r.n_subruns) },
      { key: 'n_tags', label: 'Tags', num: true, cell: r => String(r.n_tags) },
      ...ARMS.map(a => ({
        key: 'q' + a, label: `${a} · ${med}`, num: true,
        cell: r => `<span class="det-${a.toLowerCase()}">${armCell(r, a)}</span>`,
      })),
      { key: 'shard_bytes', label: 'Shards', num: true, cell: r =>
        r.shard_bytes ? (r.shard_bytes / 1e6).toFixed(0) + ' MB'
          : '<span class="dim">—</span>' },
    ];
    // The per-arm sort keys are derived, not stored: a column is sortable by
    // construction only if `key` reads a real field, so make it one.
    const rows = S.D.runs.map(r => {
      const o = Object.create(r);
      for (const a of ARMS) {
        const q = r.arms[a] && r.arms[a][S.varKey];
        o['q' + a] = q ? q[qi(S.D.quants, 'p50')] : null;
      }
      return o;
    });
    table.setCols(cols);
    table.render(rows);
  }

  /* ====================================================================== */
  /* PANEL 3 — one run's tags, as a time series                             */
  /* ====================================================================== */
  const tagCanvas = el('tag-canvas');
  const tagTip = tagCanvas ? makeTip(tagCanvas.parentElement) : null;
  let tagHover = -1;

  async function selectRun(run) {
    if (S.run === run) { drawRuns(); return; }
    S.run = run; S.runData = null;
    S.subrun = null; S.shard = null; S.cols = null; S.brush = null;
    show('tag-panel', true); show('track-panel', false);
    el('tag-title').textContent = run;
    el('tag-status').textContent = 'loading the tag table…';
    drawRuns(); renderTable(); breadcrumb();
    try {
      const r = await fetch(url(`data/trackqa/${run}.json.gz`));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      // Served as application/x-gzip and NOT transparently decoded -- see the
      // note in scripts/freeze_x17_trackqa.py. Inflate it here.
      const ds = new DecompressionStream('gzip');
      const text = await new Response(r.body.pipeThrough(ds)).text();
      const d = JSON.parse(text);
      const ix = {}; d.cols.forEach((c, i) => { ix[c] = i; });
      S.runData = { ...d, ix };
      el('tag-status').textContent = '';
      drawTags();
      renderSubrunList();
    } catch (e) {
      el('tag-status').innerHTML = `The tag table for ${esc(run)} could not be ` +
        `loaded (${esc(String(e.message))}). It is a static file — ` +
        `<code>data/trackqa/${esc(run)}.json.gz</code> — so a failure here ` +
        `means the freeze did not ship it, not that the tags are missing.`;
    }
    document.getElementById('tag-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function drawTags() {
    if (!S.runData || !tagCanvas) return;
    const D = S.runData, V = frozenVar(S.varKey);
    const { ctx, w, h } = fitCanvas(tagCanvas, 0.30);
    ctx.clearRect(0, 0, w, h);
    if (!V) {
      ctx.fillStyle = css('--muted'); ctx.font = '12.5px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Not summarised per tag — open a sub-run to histogram it.', w / 2, h / 2);
      return;
    }
    const arms = S.arm === 'all' ? ARMS : [S.arm];
    const key = q => D.ix[`${S.varKey}_${q}`];
    const iT = D.ix.t, iArm = D.ix.arm, iN = D.ix.n;

    const pts = {};
    let lo = Infinity, hi = -Infinity, tMin = Infinity, tMax = -Infinity;
    for (const a of arms) pts[a] = [];
    for (const row of D.rows) {
      const a = row[iArm];
      if (!pts[a]) continue;
      const t = row[iT], m = row[key('p50')];
      if (t === null || m === null) continue;
      const q25 = row[key('p25')], q75 = row[key('p75')];
      pts[a].push({ t, m, q25, q75, n: row[iN], tag: row[D.ix.tag], sub: row[D.ix.subrun] });
      tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
      for (const v of [m, q25, q75]) if (v !== null && isFinite(v)) {
        lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
    }
    if (!isFinite(lo)) return;
    const log = V.log && lo > 0;
    if (log) { lo /= 1.3; hi *= 1.3; } else { const m = (hi - lo) * 0.08 || 1; lo -= m; hi += m; }
    if (tMax === tMin) { tMax = tMin + 60; }

    const PAD = { l: 52, r: 44, t: 18, b: 30 };
    const x0 = PAD.l, x1 = w - PAD.r, y0 = h - PAD.b, y1 = PAD.t;
    const T = v => log ? Math.log10(Math.max(v, 1e-12)) : v;
    const X = t => x0 + (t - tMin) / (tMax - tMin) * (x1 - x0);
    const Y = v => y0 - (T(v) - T(lo)) / (T(hi) - T(lo) || 1) * (y0 - y1);
    axes(ctx, { x0, x1, y0, y1, Y }, { ylo: lo, yhi: hi, ylog: log, ylabel: V.label });

    const ends = [];
    for (const a of arms) {
      const p = pts[a];
      if (!p.length) continue;
      p.sort((u, v) => u.t - v.t);
      const col = armColor(a);
      // the quartile band first, so the medians sit on top of it
      ctx.fillStyle = col; ctx.globalAlpha = 0.14;
      ctx.beginPath();
      p.forEach((q, i) => i ? ctx.lineTo(X(q.t), Y(q.q75)) : ctx.moveTo(X(q.t), Y(q.q75)));
      for (let i = p.length - 1; i >= 0; i--) ctx.lineTo(X(p[i].t), Y(p[i].q25));
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = 1.8;
      ctx.beginPath();
      p.forEach((q, i) => i ? ctx.lineTo(X(q.t), Y(q.m)) : ctx.moveTo(X(q.t), Y(q.m)));
      ctx.stroke();
      ends.push({ y: Y(p[p.length - 1].m), label: a, col });
    }
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].y - ends[i - 1].y < 12.5) ends[i].y = ends[i - 1].y + 12.5;
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '600 11px system-ui, sans-serif';
    for (const e of ends) { ctx.fillStyle = e.col; ctx.fillText(e.label, x1 + 6, e.y); }

    ctx.fillStyle = css('--muted'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '10px system-ui, sans-serif';
    for (let k = 0; k <= 4; k++) {
      const t = tMin + (tMax - tMin) * k / 4;
      ctx.fillText(fmt.stamp(t, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }),
        X(t), y0 + 5);
    }
    tagCanvas._geom = { X, Y, x0, x1, y0, y1, pts, arms, tMin, tMax };
    const capEl = el('tag-cap');
    if (capEl) capEl.innerHTML = `Median and quartile band of <b>${esc(V.label)}</b>` +
      ` per file tag — each point is two to six minutes of beam. Times are UTC.` +
      ` This is the finest slice that exists, and the only one that can resolve` +
      ` a transient.`;
  }

  function tagHoverMove(ev) {
    const g = tagCanvas._geom;
    if (!g) return;
    const r = tagCanvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    if (mx < g.x0 || mx > g.x1) { tagTip.hide(); return; }
    const t = g.tMin + (mx - g.x0) / (g.x1 - g.x0) * (g.tMax - g.tMin);
    let best = null, bd = Infinity;
    for (const a of g.arms) for (const p of (g.pts[a] || [])) {
      const d = Math.abs(p.t - t);
      if (d < bd) { bd = d; best = { a, p }; }
    }
    if (!best) return;
    const V = frozenVar(S.varKey);
    const lines = g.arms.map(a => {
      const p = (g.pts[a] || []).find(q => q.tag === best.p.tag);
      return p ? `<div class="row"><i style="background:${armColor(a)}"></i>${a}` +
        `<b style="margin-left:auto">${num(p.m)}</b></div>` : '';
    }).join('');
    tagTip.show(`<div class="tt-title">${esc(best.p.tag)} · ${esc(V.label)}</div>` +
      lines + `<div class="row dim">${esc(best.p.sub)} · ${fmt.stamp(best.p.t)} UTC</div>`,
      mx, my);
  }

  function renderSubrunList() {
    const host = el('subrun-list');
    if (!host || !S.D) return;
    const r = S.D.runs.find(x => x.run === S.run);
    if (!r || !r.shards.length) {
      host.innerHTML = `<p class="note-summary">No per-track shard has been pushed
        for ${esc(S.run)} yet — the drill-down stops here.</p>`;
      return;
    }
    host.innerHTML = `<p class="note-summary">Open a sub-run to read its tracks.
      The page fetches only the columns it plots, so this costs a few MB, not the
      ${(r.shard_bytes / 1e6).toFixed(0)} MB the shards weigh.</p>` +
      '<div class="subrun-chips">' + r.shards.map(s =>
        `<button type="button" class="mini${S.subrun === s.subrun ? ' on' : ''}"
          data-open-shard="${esc(S.run)}|${esc(s.subrun)}">${esc(s.subrun)}
          <span class="dim">${fmt.M(s.n)}</span></button>`).join('') + '</div>';
  }

  /* ====================================================================== */
  /* PANEL 4 — the tracks themselves                                        */
  /* ====================================================================== */
  const histCanvas = el('hist-canvas');
  const denCanvas = el('den-canvas');
  const histTip = histCanvas ? makeTip(histCanvas.parentElement) : null;

  /* Every column the track panel needs, whatever is being plotted. Asked for
     in one go so the shard is read once rather than once per panel. */
  const BASE_COLS = ['arm', 'gated', 'event_id', 'track_id', 'tag'];

  async function selectShard(run, subrun) {
    if (S.busy) return;
    if (S.run !== run) await selectRun(run);
    S.subrun = subrun; S.cols = null; S.brush = null;
    const r = S.D.runs.find(x => x.run === run);
    const s = r && r.shards.find(x => x.subrun === subrun);
    if (!s) return;
    S.shard = url(`x17/trackqa/tracks/${s.file}`);
    S.absent = new Set(s.absent || []);
    show('track-panel', true);
    el('track-title').textContent = `${run} / ${subrun}`;
    el('track-status').textContent =
      `reading ${subrun} — only the columns being plotted…`;
    renderSubrunList(); breadcrumb();
    el('track-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await loadCols();
  }

  async function loadCols() {
    const want = new Set(BASE_COLS);
    const vx = VAR(S.varKey), vy = VAR(S.yKey);
    if (vx) want.add(vx.col);
    if (vy) want.add(vy.col);
    // A column this sub-run does not carry is written all-null in the shard, so
    // asking for it works and returns nothing. Reading it anyway keeps the
    // request shape uniform; the warning below is what stops an empty
    // distribution being read as a measurement.
    const gone = [...want].filter(c => S.absent && S.absent.has(c));
    const need = [...want].filter(c => !S.cols || !S.cols[c]);
    if (!need.length) { drawTracks(); return; }
    S.busy = true;
    const t0 = performance.now();
    try {
      const res = await ask('columns', { url: S.shard, columns: need });
      S.n = res.n;
      S.cols = Object.assign(S.cols || {}, res.columns);
      el('track-status').innerHTML =
        `${fmt.M(res.n)} tracks · ${need.length} column${need.length > 1 ? 's' : ''}` +
        ` read in ${Math.round(performance.now() - t0)} ms` +
        (gone.length ? ` · <span class="bad">this sub-run does not carry ` +
          `${gone.map(esc).join(', ')}</span> — it predates the column, and it ` +
          `is empty here rather than zero.` : '');
      drawTracks();
    } catch (e) {
      el('track-status').innerHTML = `<span class="bad">Could not read the shard:
        ${esc(String(e.message))}.</span> The shards are served straight from EOS
        as static parquet; a failure here usually means that sub-run has not been
        pushed yet.`;
      S.cols = null;
      drawTracks();
    } finally { S.busy = false; }
  }

  /* The rows the current gate + arm + brush keep. An index array, rebuilt on
     every control change -- 120 k Uint32 is nothing and it keeps every panel
     reading exactly the same selection. */
  function selection() {
    if (!S.cols) return new Uint32Array(0);
    const arm = S.cols.arm ? S.cols.arm.data : null;
    const gated = S.cols.gated ? S.cols.gated.data : null;
    const vx = VAR(S.varKey), col = vx && S.cols[vx.col];
    const out = new Uint32Array(S.n);
    let k = 0;
    for (let i = 0; i < S.n; i++) {
      if (S.arm !== 'all' && arm && arm[i] !== S.arm) continue;
      if (S.gate === 'gated' && gated && !gated[i]) continue;
      if (S.gate === 'rejected' && gated && gated[i]) continue;
      if (S.brush && col) {
        const v = col.data[i];
        if (!(v >= S.brush[0] && v <= S.brush[1])) continue;
      }
      out[k++] = i;
    }
    return out.subarray(0, k);
  }

  /* The same, but ignoring the brush: the histogram draws the brushed subset
     against this, so you can see what a cut removed rather than only what it
     kept. */
  function population() {
    const save = S.brush; S.brush = null;
    const s = selection(); S.brush = save;
    return s;
  }

  const NB = 72;
  function histogram(idx, v) {
    const col = S.cols[v.col];
    if (!col || col.kind !== 'num') return null;
    const d = col.data;
    let lo = v.lo, hi = v.hi;
    const log = v.log && lo > 0;
    const T = x => log ? Math.log10(x) : x;
    const tl = T(lo), th = T(hi);
    const h = new Float64Array(NB);
    let under = 0, over = 0, n = 0;
    for (let j = 0; j < idx.length; j++) {
      const x = d[idx[j]];
      if (!isFinite(x)) continue;
      n++;
      if (x < lo || (log && x <= 0)) { under++; continue; }
      if (x > hi) { over++; continue; }
      const b = Math.min(NB - 1, Math.floor((T(x) - tl) / (th - tl) * NB));
      h[b]++;
    }
    return { h, lo, hi, log, tl, th, under, over, n };
  }

  function drawTracks() {
    drawHist(); drawDensity(); renderTrackTable();
  }

  function drawHist() {
    if (!histCanvas) return;
    // Same aspect as the density plot beside it: they are a pair, read
    // together, and two different heights made the row look broken.
    const { ctx, w, h } = fitCanvas(histCanvas, 0.62);
    ctx.clearRect(0, 0, w, h);
    const V = VAR(S.varKey);
    if (!S.cols || !V) return;
    const all = population(), sel = selection();
    const H = histogram(all, V);
    if (!H) return;
    const Hs = S.brush ? histogram(sel, V) : null;

    const PAD = { l: 52, r: 12, t: 18, b: 32 };
    const x0 = PAD.l, x1 = w - PAD.r, y0 = h - PAD.b, y1 = PAD.t;
    let mx = 0; for (const v of H.h) mx = Math.max(mx, v);
    if (!mx) return;
    const X = t => x0 + (t - H.tl) / (H.th - H.tl) * (x1 - x0);
    const Y = c => y0 - c / mx * (y0 - y1);
    const bw = (x1 - x0) / NB;

    // Count gridlines. A histogram with no y scale can only be read as a
    // shape, and half the questions here ("is that shoulder a thousand tracks
    // or ten?") are about the height.
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const cstep = window.x17.tickStep(mx);
    for (let c = 0; c <= mx; c += cstep) {
      const y = Math.round(Y(c)) + 0.5;
      ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      if (c) { ctx.fillStyle = css('--muted'); ctx.fillText(fmt.M(c), x0 - 7, y); }
    }
    ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y1); ctx.lineTo(x0 + 0.5, y0); ctx.lineTo(x1, y0);
    ctx.stroke();

    const col = S.arm === 'all' ? css('--series-1') : armColor(S.arm);
    for (let b = 0; b < NB; b++) {
      if (!H.h[b]) continue;
      ctx.fillStyle = col; ctx.globalAlpha = S.brush ? 0.22 : 0.75;
      ctx.fillRect(x0 + b * bw, Y(H.h[b]), Math.max(bw - 0.6, 0.6), y0 - Y(H.h[b]));
    }
    ctx.globalAlpha = 1;
    if (Hs) {
      for (let b = 0; b < NB; b++) {
        if (!Hs.h[b]) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x0 + b * bw, Y(Hs.h[b]), Math.max(bw - 0.6, 0.6), y0 - Y(Hs.h[b]));
      }
    }

    // The frozen median from tracking_qa, as a tick. The point of drawing it is
    // that this histogram was computed here, in the browser, from the same
    // column that script profiled -- so if the two disagree, that is visible.
    const fv = frozenVar(S.varKey);
    if (fv && S.arm !== 'all' && S.gate === 'gated' && !S.brush) {
      const r = S.D.runs.find(x => x.run === S.run);
      const q = r && r.arms[S.arm] && r.arms[S.arm][S.varKey];
      if (q) {
        const m = q[qi(S.D.quants, 'p50')];
        if (m !== null && m >= H.lo && m <= H.hi) {
          const px = Math.round(X(H.log ? Math.log10(m) : m)) + 0.5;
          ctx.strokeStyle = css('--critical'); ctx.lineWidth = 1.4;
          ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(px, y1); ctx.lineTo(px, y0); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = css('--critical'); ctx.textAlign = 'left';
          ctx.textBaseline = 'top'; ctx.font = '10px system-ui, sans-serif';
          ctx.fillText(' run p50 (frozen)', px, y1 + 1);
        }
      }
    }

    if (S.brush) {
      const a = X(H.log ? Math.log10(Math.max(S.brush[0], 1e-12)) : S.brush[0]);
      const b = X(H.log ? Math.log10(Math.max(S.brush[1], 1e-12)) : S.brush[1]);
      ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      ctx.strokeRect(Math.min(a, b) + 0.5, y1 + 0.5, Math.abs(b - a), y0 - y1);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of niceTicks(H.lo, H.hi, H.log)) {
      ctx.fillText(H.log ? shortExp(v) : String(+v.toPrecision(3)),
        X(H.log ? Math.log10(v) : v), y0 + 5);
    }
    ctx.textAlign = 'left'; ctx.fillText(V.label, x0, 1);
    ctx.textAlign = 'right';
    ctx.fillText(`${fmt.M(sel.length)} of ${fmt.M(all.length)} tracks` +
      (H.under || H.over ? ` · ${fmt.M(H.under + H.over)} off-scale` : ''), x1, 1);
    histCanvas._geom = { X, x0, x1, y0, y1, H };
  }

  /* ---- density: the chosen variable against a second one ------------------
     A histogram says a distribution moved; a correlation says what moved it.
     Counts per cell on a log colour ramp, because occupancy here spans four
     orders of magnitude and a linear ramp shows one blob. */
  function drawDensity() {
    if (!denCanvas) return;
    const { ctx, w, h } = fitCanvas(denCanvas, 0.62);
    ctx.clearRect(0, 0, w, h);
    const VX = VAR(S.varKey), VY = VAR(S.yKey);
    if (!S.cols || !VX || !VY) return;
    const cx = S.cols[VX.col], cy = S.cols[VY.col];
    if (!cx || !cy || cx.kind !== 'num' || cy.kind !== 'num') return;
    const idx = selection();

    const PAD = { l: 54, r: 12, t: 16, b: 34 };
    const x0 = PAD.l, x1 = w - PAD.r, y0 = h - PAD.b, y1 = PAD.t;
    const NX = 64, NY = 48;
    const lx = VX.log && VX.lo > 0, ly = VY.log && VY.lo > 0;
    const TX = v => lx ? Math.log10(v) : v, TY = v => ly ? Math.log10(v) : v;
    const xa = TX(VX.lo), xb = TX(VX.hi), ya = TY(VY.lo), yb = TY(VY.hi);
    const grid = new Float64Array(NX * NY);
    let mx = 0;
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j], u = cx.data[i], v = cy.data[i];
      if (!isFinite(u) || !isFinite(v)) continue;
      if (u < VX.lo || u > VX.hi || v < VY.lo || v > VY.hi) continue;
      if ((lx && u <= 0) || (ly && v <= 0)) continue;
      const bx = Math.min(NX - 1, Math.floor((TX(u) - xa) / (xb - xa) * NX));
      const by = Math.min(NY - 1, Math.floor((TY(v) - ya) / (yb - ya) * NY));
      const k = by * NX + bx;
      if (++grid[k] > mx) mx = grid[k];
    }
    if (!mx) {
      ctx.fillStyle = css('--muted'); ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('nothing in range', w / 2, h / 2);
      return;
    }
    const cw = (x1 - x0) / NX, ch = (y0 - y1) / NY;
    const base = S.arm === 'all' ? css('--series-1') : armColor(S.arm);
    for (let by = 0; by < NY; by++) for (let bx = 0; bx < NX; bx++) {
      const c = grid[by * NX + bx];
      if (!c) continue;
      ctx.globalAlpha = 0.10 + 0.9 * (Math.log10(c + 1) / Math.log10(mx + 1));
      ctx.fillStyle = base;
      ctx.fillRect(x0 + bx * cw, y0 - (by + 1) * ch, cw + 0.5, ch + 0.5);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y1); ctx.lineTo(x0 + 0.5, y0); ctx.lineTo(x1, y0);
    ctx.stroke();
    ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of niceTicks(VX.lo, VX.hi, lx)) {
      ctx.fillText(lx ? shortExp(v) : String(+v.toPrecision(3)),
        x0 + (TX(v) - xa) / (xb - xa) * (x1 - x0), y0 + 5);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of niceTicks(VY.lo, VY.hi, ly)) {
      ctx.fillText(ly ? shortExp(v) : String(+v.toPrecision(3)), x0 - 7,
        y0 - (TY(v) - ya) / (yb - ya) * (y0 - y1));
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(VY.label, x0, 0);
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(VX.label, x1, y0 + 28);
  }

  /* ---- brushing ---------------------------------------------------------- */
  let dragFrom = null;
  function histX2v(px) {
    const g = histCanvas._geom;
    if (!g) return null;
    const t = g.H.tl + (px - g.x0) / (g.x1 - g.x0) * (g.H.th - g.H.tl);
    return g.H.log ? 10 ** t : t;
  }
  function histDown(ev) {
    const r = histCanvas.getBoundingClientRect();
    dragFrom = histX2v(ev.clientX - r.left);
  }
  function histMove(ev) {
    const g = histCanvas._geom;
    if (!g || !S.cols) return;
    const r = histCanvas.getBoundingClientRect();
    const mxp = ev.clientX - r.left, v = histX2v(mxp);
    if (dragFrom !== null) {
      S.brush = [Math.min(dragFrom, v), Math.max(dragFrom, v)];
      drawTracks();
      return;
    }
    if (mxp < g.x0 || mxp > g.x1) { histTip.hide(); return; }
    const V = VAR(S.varKey);
    const b = Math.min(NB - 1, Math.max(0,
      Math.floor((mxp - g.x0) / (g.x1 - g.x0) * NB)));
    const edge = t => g.H.log ? 10 ** t : t;
    const e0 = edge(g.H.tl + (g.H.th - g.H.tl) * b / NB);
    const e1 = edge(g.H.tl + (g.H.th - g.H.tl) * (b + 1) / NB);
    histTip.show(`<div class="tt-title">${esc(V.label)}</div>` +
      `<div class="row">${num(e0)} – ${num(e1)}` +
      `<b style="margin-left:auto">${fmt.M(g.H.h[b])}</b></div>` +
      `<div class="row dim">drag to select a range</div>`,
      mxp, ev.clientY - r.top);
  }
  function histUp() {
    if (dragFrom !== null && S.brush &&
      Math.abs(S.brush[1] - S.brush[0]) < 1e-12) S.brush = null;
    dragFrom = null;
    drawTracks();
  }

  /* ---- the track table --------------------------------------------------- */
  const MAX_ROWS = 200;
  function renderTrackTable() {
    const host = el('track-rows');
    if (!host) return;
    if (!S.cols) { host.innerHTML = ''; return; }
    const idx = selection();
    const V = VAR(S.varKey), VY = VAR(S.yKey);
    const cv = V && S.cols[V.col], cy = VY && S.cols[VY.col];
    const arm = S.cols.arm.data, ev = S.cols.event_id.data;
    const tid = S.cols.track_id.data, gated = S.cols.gated.data;
    const tag = S.cols.tag.data;
    const rows = [];
    for (let j = 0; j < Math.min(idx.length, MAX_ROWS); j++) {
      const i = idx[j];
      rows.push(`<tr class="run-row" data-track="${i}" tabindex="0">` +
        `<td class="det-${String(arm[i]).toLowerCase()}">${esc(arm[i])}</td>` +
        `<td class="num">${ev[i]}</td><td class="num">${tid[i]}</td>` +
        `<td>${esc(tag[i])}</td>` +
        `<td class="num">${cv ? num(cv.data[i]) : fmt.dash}</td>` +
        `<td class="num">${cy ? num(cy.data[i]) : fmt.dash}</td>` +
        `<td>${gated[i] ? chip('ok', '--good', 'gated')
          : chip('no', '--muted', 'rejected')}</td></tr>` +
        `<tr class="run-detail" data-track-detail="${i}" hidden>` +
        `<td colspan="7"><div class="track-detail">click again to load…</div></td></tr>`);
    }
    host.innerHTML = rows.join('') || `<tr><td class="empty" colspan="7">
      Nothing passes the current arm, gate and range.</td></tr>`;
    const cap = el('track-table-cap');
    if (cap) cap.innerHTML = idx.length > MAX_ROWS
      ? `The first ${MAX_ROWS} of <b>${fmt.M(idx.length)}</b> tracks in the
         current selection. Narrow it by dragging on the histogram.`
      : `<b>${fmt.M(idx.length)}</b> track${idx.length === 1 ? '' : 's'} in the
         current selection.`;
    const head = el('track-head');
    if (head) head.innerHTML = `<tr><th>Arm</th><th class="num">Event</th>
      <th class="num">Track</th><th>Tag</th>
      <th class="num">${esc(V ? V.label : '')}</th>
      <th class="num">${esc(VY ? VY.label : '')}</th><th>Gate</th></tr>`;
  }

  /* One track, every column: a single range request for its row group. */
  async function openTrack(i, tr) {
    const box = tr.querySelector('.track-detail');
    if (!box || box.dataset.done) { return; }
    box.textContent = 'reading the row…';
    try {
      const res = await ask('rows', { url: S.shard, start: i, end: i + 1 });
      const r = res.rows[0] || {};
      box.dataset.done = '1';
      box.innerHTML = trackDetail(r);
    } catch (e) {
      box.innerHTML = `<span class="bad">could not read the row: ${esc(String(e.message))}</span>`;
    }
  }

  const GROUPS = [
    ['Identity', ['tag', 'event_id', 'arm', 'track_id', 'event_class',
      'select_reason', 'bunch']],
    ['Gates', ['gated', 'x_quality_ok', 'y_quality_ok', 'x_plausible',
      'y_plausible', 'x_slope_reliable', 'y_slope_reliable', 'tan_sane',
      'drift_railed', 'x_isochronous', 'y_isochronous']],
    ['x view', ['chi2dof_x', 'x_n_strips', 'x_n_dropped', 'x_tan_err',
      'x_p0_err', 'x_t0_err', 'x_t0', 'x_q_u50', 'n_cand_x', 'tanx']],
    ['y view', ['chi2dof_y', 'y_n_strips', 'y_n_dropped', 'y_tan_err',
      'y_p0_err', 'y_t0', 'y_q_u50', 'n_cand_y', 'tany']],
    ['Geometry', ['x_local', 'y_local', 'drift_len_mm', 'drift_t_end_ns',
      'path_len_mm', 'angle_to_beam_deg', 'dca_axis_mm',
      'target_x_mm', 'target_y_mm', 'target_z_mm', 'in_bore']],
    ['Charge', ['q_total', 'q_per_len']],
    ['Calibration', ['k_arm', 'v_drift_um_ns', 'angle_calibrated',
      'depth_grid_edge_ns']],
    ['n_TOF', ['t_since_flash_ns', 'e_neutron_keV', 'is_flash',
      'n_coinc_arms', 'arms_lit']],
  ];

  function trackDetail(r) {
    // An absent column and a null value both read as "—", and they are not the
    // same thing: one is a track with no value, the other a SUB-RUN that never
    // recorded the column. Only the shard index knows which, so say so here --
    // this is the one place a reader actually looks at select_reason.
    const cell = (k, v) => (S.absent && S.absent.has(k))
      ? '<span class="dim" title="this sub-run predates the column">not recorded</span>'
      : v === null || v === undefined ? fmt.dash
        : typeof v === 'boolean' ? (v ? 'yes' : 'no')
          : typeof v === 'number' ? num(v, 4) : esc(String(v));
    const groups = GROUPS.map(([name, keys]) => {
      const have = keys.filter(k => k in r);
      if (!have.length) return '';
      return `<div class="tg"><h5>${name}</h5><ul class="facts">` +
        have.map(k => `<li><span class="k">${k}</span>` +
          `<span class="v">${cell(k, r[k])}</span></li>`).join('') + '</ul></div>';
    }).join('');
    return `<div class="track-grid">${groups}</div>` + trackSketch(r) +
      `<p class="sub-cap">Every column the shard carries, for this one track.
       The sketch is the <b>fitted</b> track — the reconstruction's answer, not a
       hit display: the strip charges it was fitted to are not in this table, and
       recovering them means re-reading the waveforms on EOS.</p>`;
  }

  /* Two projections of the fitted line through the drift gap. Small, and
     honest about what it is: a line, drawn from p0 and d. */
  function trackSketch(r) {
    const gap = 30, half = 100;
    const p = ['p0_x', 'p0_y', 'p0_z', 'd_x', 'd_y', 'd_z'].map(k => r[k]);
    if (p.some(v => v === null || v === undefined || !isFinite(v))) {
      // Common and not an error: a track whose fit failed in one view has no
      // direction to draw. Saying so beats a panel that is silently absent,
      // which reads as a rendering bug.
      return '<p class="sub-cap">No sketch: this track has no finite 3D ' +
        'direction, so one of the two view fits did not return a slope. ' +
        'The per-view numbers above still say what each one did.</p>';
    }
    const [px, py, pz, dx, dy, dz] = p;
    const span = Math.abs(dz) > 1e-6 ? gap / Math.abs(dz) : gap;
    const A = [px - dx * span / 2, py - dy * span / 2, pz - dz * span / 2];
    const B = [px + dx * span / 2, py + dy * span / 2, pz + dz * span / 2];
    const view = (ai, label, unit) => {
      const W = 168, H = 92, m = 16;
      const sx = v => m + (v + half) / (2 * half) * (W - 2 * m);
      const zs = [A[2], B[2]], zlo = Math.min(...zs) - 4, zhi = Math.max(...zs) + 4;
      const sy = v => m + (v - zlo) / ((zhi - zlo) || 1) * (H - 2 * m);
      return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"
        role="img" aria-label="${label}">
        <rect x="${m}" y="${m}" width="${W - 2 * m}" height="${H - 2 * m}"
          fill="none" stroke="var(--grid)"/>
        <line x1="${sx(A[ai]).toFixed(1)}" y1="${sy(A[2]).toFixed(1)}"
              x2="${sx(B[ai]).toFixed(1)}" y2="${sy(B[2]).toFixed(1)}"
              stroke="var(--det-${String(r.arm).toLowerCase()})" stroke-width="2"/>
        <circle cx="${sx(px).toFixed(1)}" cy="${sy(pz).toFixed(1)}" r="2.4"
          fill="var(--ink)"/>
        <text x="${m}" y="${H - 4}" font-size="9" fill="var(--muted)">${label}</text>
      </svg>`;
    };
    return `<div class="track-sketch">${view(0, 'x – drift depth')}
      ${view(1, 'y – drift depth')}</div>`;
  }

  /* ---- breadcrumb --------------------------------------------------------- */
  function breadcrumb() {
    const b = el('tq-crumb');
    if (!b) return;
    const bits = [`<button type="button" data-crumb="campaign">Campaign</button>`];
    if (S.run) bits.push(`<button type="button" data-crumb="run">${esc(S.run)}</button>`);
    if (S.subrun) bits.push(`<span>${esc(S.subrun)}</span>`);
    b.innerHTML = bits.join('<i>›</i>');
  }

  /* ---- controls ----------------------------------------------------------- */
  function fillPickers() {
    const v = el('var-pick'), y = el('y-pick');
    // The defaults above are VARS *keys*, and a key that is not in the payload
    // draws nothing and says nothing about why -- which is exactly how the
    // density plot shipped blank once. Fail loudly into a working default
    // instead, and keep the page usable.
    const known = new Set(S.D.vars.concat(S.D.extra_vars).map(o => o.key));
    for (const [field, fallback] of [['varKey', S.D.vars[0].key],
                                     ['yKey', S.D.vars[2].key]]) {
      if (!known.has(S[field])) {
        console.warn(`x17-trackqa: unknown ${field} "${S[field]}"; using ${fallback}`);
        S[field] = fallback;
      }
    }
    const opt = o => `<option value="${o.key}">${esc(o.label)}</option>`;
    const grouped =
      `<optgroup label="Summarised per run and per tag">` +
      S.D.vars.map(opt).join('') + `</optgroup>` +
      `<optgroup label="Per-track only">` +
      S.D.extra_vars.map(opt).join('') + `</optgroup>`;
    if (v) { v.innerHTML = grouped; v.value = S.varKey; }
    if (y) { y.innerHTML = grouped; y.value = S.yKey; }
  }

  function wire() {
    el('var-pick').addEventListener('change', e => {
      S.varKey = e.target.value; S.brush = null;
      drawRuns(); renderTable(); drawTags();
      if (S.cols) loadCols(); else drawTracks();
    });
    el('y-pick').addEventListener('change', e => {
      S.yKey = e.target.value;
      if (S.cols) loadCols();
    });
    window.x17.switchGroup('arm', a => {
      S.arm = a; drawRuns(); drawTags(); drawTracks();
    });
    window.x17.switchGroup('gate', g => { S.gate = g; drawTracks(); });
    el('clear-brush').addEventListener('click', () => { S.brush = null; drawTracks(); });

    if (runCanvas) {
      runCanvas.addEventListener('mousemove', runHoverMove);
      runCanvas.addEventListener('mouseleave', () => {
        runHover = -1; runTip.hide(); drawRuns();
      });
      runCanvas.addEventListener('click', runClick);
    }
    if (tagCanvas) {
      tagCanvas.addEventListener('mousemove', tagHoverMove);
      tagCanvas.addEventListener('mouseleave', () => tagTip.hide());
    }
    if (histCanvas) {
      histCanvas.addEventListener('mousedown', histDown);
      histCanvas.addEventListener('mousemove', histMove);
      window.addEventListener('mouseup', histUp);
      histCanvas.addEventListener('mouseleave', () => histTip.hide());
    }
    // One delegated listener for every "open this" button on the page: they are
    // re-rendered constantly and rebinding each time is how a handler leaks.
    document.addEventListener('click', e => {
      const s = e.target.closest('[data-open-shard]');
      if (s) {
        const [run, sub] = s.dataset.openShard.split('|');
        e.stopPropagation(); selectShard(run, sub); return;
      }
      const r = e.target.closest('[data-open-run]');
      if (r) { e.stopPropagation(); selectRun(r.dataset.openRun); return; }
      const c = e.target.closest('[data-crumb]');
      if (c) {
        if (c.dataset.crumb === 'campaign') {
          S.run = S.subrun = S.cols = null; S.brush = null;
          show('tag-panel', false); show('track-panel', false);
          drawRuns(); renderTable(); breadcrumb();
        } else { show('track-panel', false); S.subrun = null; breadcrumb(); }
      }
    });
    const rows = el('track-rows');
    if (rows) {
      const hit = e => {
        const tr = e.target.closest('.run-row');
        if (!tr) return;
        const d = rows.querySelector(`[data-track-detail="${tr.dataset.track}"]`);
        if (!d) return;
        d.hidden = !d.hidden;
        if (!d.hidden) openTrack(+tr.dataset.track, d);
      };
      rows.addEventListener('click', hit);
      rows.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit(e); }
      });
    }
  }

  /* ---- headline ----------------------------------------------------------- */
  function headline() {
    const m = S.D.source, sh = S.D.shards || {};
    const set = (k, v, s) => {
      const n = document.querySelector(`[data-tq="${k}"] .n`);
      const sub = document.querySelector(`[data-tq="${k}"] .s`);
      if (n) n.textContent = v;
      if (sub && s) sub.textContent = s;
    };
    set('tracks', fmt.M(m.n_tracks_ungated), `${fmt.M(m.n_tracks)} pass the 3D gate`);
    set('gate', (100 * m.n_tracks / m.n_tracks_ungated).toFixed(1) + '%',
      'of reconstructed tracks');
    set('runs', String(m.n_runs), `${m.n_subruns} sub-runs`);
    set('tags', fmt.M(m.n_tags), 'two to six minutes each');
    set('outliers', String((S.D.outliers || []).length),
      `|z| > ${m.z_cut} against the arm`);
    set('shards', sh.bytes ? (sh.bytes / 1e9).toFixed(2) + ' GB' : '—',
      sh.n_shards ? `${sh.n_shards} shards, read in place` : 'not pushed yet');
    const gen = el('tq-generated');
    if (gen) gen.textContent = m.generated ? m.generated.replace('T', ' ') + ' UTC' : '';
  }

  function outlierTable() {
    const host = el('outlier-rows');
    if (!host) return;
    const o = (S.D.outliers || []).slice()
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    host.innerHTML = o.length ? o.map(r =>
      `<tr><td class="det-${r.arm.toLowerCase()}">${r.arm}</td>` +
      `<td><button type="button" class="linky" data-open-run="${esc(r.run)}">${esc(r.run)}</button></td>` +
      `<td>${esc(r.variable)}</td><td class="num">${num(r.value)}</td>` +
      `<td class="num">${num(r.median)}</td><td class="num">${pct(r.effect)}</td>` +
      `<td class="num">${num(r.z, 1)}</td><td class="num">${fmt.M(r.n)}</td></tr>`).join('')
      : `<tr><td class="empty" colspan="8">No run sits more than
         ${S.D.source.z_cut} MAD z from its own arm.</td></tr>`;
  }

  function gapTable() {
    const host = el('gap-rows');
    if (!host || !S.D.gap.length) return;
    host.innerHTML = S.D.gap.map(g =>
      `<tr><td class="det-${g.arm.toLowerCase()}">${g.arm}</td>` +
      `<td class="num">${num(g.gap_mm)}</td><td class="num">${num(g.k_applied)}</td>` +
      `<td class="num">${num(g.v_um_ns)}</td><td class="num">${num(g.span_p50)}</td>` +
      `<td class="num">${pct(g.frac_over_gap)}</td>` +
      `<td class="num">${pct(g.frac_railed)}</td>` +
      `<td class="num">${num(g.k_min_for_gap)}</td></tr>`).join('');
  }

  /* ---- boot --------------------------------------------------------------- */
  fetch(url('data/x17-trackqa.json'))
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(D => {
      S.D = D;
      fillPickers();
      headline(); outlierTable(); gapTable();
      table = makeTable({
        head: el('run-head'), body: el('run-rows'), foot: null,
        count: el('run-count'), noun: 'runs', sort: 'no', dir: 1,
        cols: [], detail: runDetail, total: null,
        empty: 'No runs in this payload.',
        onSort: renderTable,
      });
      renderTable();
      wire();
      breadcrumb();
      // Unhide BEFORE the first draw. fitCanvas sizes the bitmap from
      // clientWidth, and a canvas inside a [hidden] element has none -- so
      // registering first produced a zero-height chart that only appeared
      // after a resize.
      show('trackqa', true);
      register(() => { drawRuns(); drawTags(); drawTracks(); });
    })
    .catch(() => {
      const f = el('trackqa-fallback');
      if (f) f.hidden = false;
    });
})();
