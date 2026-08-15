/* /x17/qa-pedestals.html — the DREAM pedestal history of the 2026 n_TOF
   campaign, drawn from the frozen data/x17-pedestals.json.

   Two plots and three tables, all from one payload:

   History     one line per FEU over the six weeks, switchable between the
               five quantities a pedestal gives. Log scale, because the eight
               FEUs sit an order of magnitude apart and the interesting thing
               is always a ratio.
   Chip map    every one of the 64 DREAM chips against every acquisition. The
               default is the CHANGE view — each chip against its own campaign
               median — because a chip that is always loud and a chip that is
               always quiet are both "stable", and only movement matters. The
               level view is there for comparing chambers with each other.

   Colour carries chamber identity and nothing else: fixed slots, never cycled,
   and every series is also direct-labelled so identity never rests on hue
   alone. The chip map is the one place colour encodes magnitude, and it uses a
   diverging scale for change (polarity: louder or quieter) and a single-hue
   sequential scale for level. */

(() => {
  'use strict';
  const { css, fitCanvas, register, makeTip } = window.viz;

  const histCanvas = document.getElementById('hist-canvas');
  const mapCanvas = document.getElementById('map-canvas');
  if (!histCanvas || !mapCanvas) return;

  const PAD = { l: 54, r: 46, t: 20, b: 26 };
  const MAP_PAD = { l: 40, r: 64, t: 8, b: 58 };

  const esc = s => String(s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const detColor = d => css('--det-' + d.toLowerCase());
  const day = iso => new Date(iso + 'Z').toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const stamp = iso => new Date(iso + 'Z').toLocaleString('en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const t_ = iso => new Date(iso + 'Z').getTime();

  /* The five things a pedestal measures. `log` because a quantity that spans
     8 to 200 ADC is only readable as a ratio; baseline is the exception and is
     linear about its own range. */
  const METRICS = {
    cm: { key: 'cm', label: 'Common mode', unit: 'ADC RMS', log: true,
          note: 'the coherent swing each 64-channel DREAM chip sees' },
    res: { key: 'res', label: 'Residual', unit: 'ADC RMS', log: true,
           note: 'per-channel noise once the common mode is subtracted — this is what sets the threshold' },
    raw: { key: 'raw', label: 'Raw', unit: 'ADC RMS', log: true,
           note: 'the total spread before anything is subtracted; coherent pickup dominates it' },
    mean: { key: 'mean', label: 'Baseline', unit: 'ADC', log: false,
            note: 'where the pedestal sat — flat all campaign, which is the point' },
    thr: { key: 'thr', label: '5σ threshold', unit: 'ADC above baseline', log: true,
           note: 'what the DAQ actually programmed into the FEUs' },
  };

  let D = null;
  let metric = 'cm';
  let mapMetric = 'cm';
  let mapView = 'change';
  let hoverHist = -1;
  let hoverCell = null;

  /* ---- shared axis furniture --------------------------------------------- */

  function niceTicks(lo, hi, log) {
    if (log) {
      const out = [];
      for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
        for (const m of [1, 2, 5]) {
          const v = m * 10 ** e;
          if (v >= lo && v <= hi) out.push(v);
        }
      }
      return out;
    }
    const raw = (hi - lo) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].find(m => m * mag >= raw) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  }

  /* ---- history ------------------------------------------------------------ */

  function drawHist() {
    const { ctx, w, h } = fitCanvas(histCanvas, 0.44);
    ctx.clearRect(0, 0, w, h);
    if (!D) return;

    const M = METRICS[metric];
    const ts = D.stamps.map(t_);
    const tMin = ts[0], tMax = ts[ts.length - 1];
    const vals = D.feus.flatMap(f => f[M.key]).filter(v => v != null && v > 0);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (M.log) { lo /= 1.25; hi *= 1.3; } else { const p = (hi - lo) * 0.12 || 1; lo -= p; hi += p; }

    const x0 = PAD.l, x1 = w - PAD.r, y0 = h - PAD.b, y1 = PAD.t;
    const X = t => x0 + ((t - tMin) / (tMax - tMin)) * (x1 - x0);
    const Y = M.log
      ? v => y0 - ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (y0 - y1)
      : v => y0 - ((v - lo) / (hi - lo)) * (y0 - y1);

    // clock epochs behind everything
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y1, x1 - x0, y0 - y1); ctx.clip();
    D.epochs.forEach((e, i) => {
      if (i % 2) {
        // the shading only has to be legible, not loud: this is context behind
        // the data, and --plane against --surface is too close to see
        ctx.fillStyle = window.viz.isDark()
          ? 'rgba(255,255,255,0.045)' : 'rgba(11,11,11,0.045)';
        ctx.fillRect(X(t_(e.start.slice(0, 16))), y1,
          X(t_(e.end.slice(0, 16))) - X(t_(e.start.slice(0, 16))), y0 - y1);
      }
    });
    ctx.restore();

    // gridlines + y ticks
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (const v of niceTicks(lo, hi, M.log)) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.fillStyle = css('--muted');
      ctx.fillText(String(+v.toFixed(2)), x0 - 8, y);
    }
    ctx.fillStyle = css('--muted'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(M.unit, x0, 2);

    // date ticks
    ctx.textAlign = 'center';
    for (let t = tMin; t <= tMax; t += 5 * 864e5) {
      ctx.fillText(day(new Date(t).toISOString().slice(0, 10)), X(t), y0 + 7);
    }

    // chamber A's excursion, behind the lines
    const aEv = D.events.find(e => e.kind === 'common-mode');
    if (aEv) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, y1, x1 - x0, y0 - y1); ctx.clip();
      ctx.fillStyle = css('--wash-1');
      ctx.fillRect(X(t_(aEv.start)), y1, X(t_(aEv.end)) - X(t_(aEv.start)), y0 - y1);
      ctx.restore();
    }

    // the 23 July configuration change
    const ck = t_(D.clock_step);
    ctx.save();
    ctx.setLineDash([3, 3]); ctx.strokeStyle = css('--critical'); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X(ck), y1); ctx.lineTo(X(ck), y0); ctx.stroke();
    ctx.restore();

    // one line per FEU; x view solid, y view dashed, so the pair is legible
    const ends = [];
    for (const f of D.feus) {
      const col = detColor(f.det);
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.setLineDash(f.view === 'y' ? [5, 3] : []);
      ctx.beginPath();
      let started = false, lastV = null;
      f[M.key].forEach((v, i) => {
        if (v == null) return;
        const px = X(ts[i]), py = Y(v);
        started ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        started = true; lastV = v;
      });
      ctx.stroke(); ctx.setLineDash([]);
      if (lastV != null) ends.push({ y: Y(lastV), label: f.label, col });
    }

    // direct labels, nudged apart so no two collide
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].y - ends[i - 1].y < 12.5) ends[i].y = ends[i - 1].y + 12.5;
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '600 11px system-ui, sans-serif';
    for (const e of ends) { ctx.fillStyle = e.col; ctx.fillText(e.label, x1 + 6, e.y); }

    // crosshair
    if (hoverHist >= 0) {
      const px = X(ts[hoverHist]);
      ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, y1); ctx.lineTo(px, y0); ctx.stroke();
      for (const f of D.feus) {
        const v = f[M.key][hoverHist];
        if (v == null) continue;
        ctx.beginPath(); ctx.arc(px, Y(v), 3.6, 0, 7);
        ctx.fillStyle = detColor(f.det); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = css('--surface'); ctx.stroke();
      }
    }
    histCanvas._geom = { X, Y, x0, x1, y0, y1, ts };
  }

  function histHover(ev) {
    const g = histCanvas._geom;
    if (!g || !D) return;
    const r = histCanvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    if (mx < g.x0 - 10 || mx > g.x1 + 10 || my < g.y1 || my > g.y0) {
      if (hoverHist !== -1) { hoverHist = -1; histTip.hide(); drawHist(); }
      return;
    }
    let best = 0, bd = Infinity;
    g.ts.forEach((t, i) => { const d = Math.abs(g.X(t) - mx); if (d < bd) { bd = d; best = i; } });
    if (best !== hoverHist) { hoverHist = best; drawHist(); }
    const M = METRICS[metric];
    const rows = D.feus.map(f => {
      const v = f[M.key][best];
      return `<div class="row"><i style="background:${detColor(f.det)}"></i>${f.label}` +
        `<b style="margin-left:auto">${v == null ? '—' : v}</b></div>`;
    }).join('');
    histTip.show(
      `<div class="tt-title">${stamp(D.stamps[best])} · ${M.label} (${M.unit})</div>${rows}`,
      mx, my);
  }

  /* ---- chip map ----------------------------------------------------------- */

  /* Diverging for change (polarity), single-hue sequential for level
     (magnitude). Both are stepped in sRGB between explicit endpoints so the
     midpoint of the diverging scale is a true neutral and never a hue. */
  const mix = (a, b, t) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},` +
    `${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  const COOL = [21, 76, 145], WARM = [160, 33, 33], MID_L = [242, 241, 236], MID_D = [58, 58, 55];
  const SEQ_L = [[247, 247, 243], [42, 120, 214], [12, 34, 66]];
  const SEQ_D = [[26, 26, 25], [57, 135, 229], [186, 216, 250]];

  function changeColor(ratio) {          // ratio = value / chip median
    const dark = window.viz.isDark();
    const mid = dark ? MID_D : MID_L;
    if (!(ratio > 0)) return css('--grid');
    const z = Math.max(-1, Math.min(1, Math.log2(ratio) / 2));   // +-4x saturates
    return z >= 0 ? mix(mid, WARM, z) : mix(mid, COOL, -z);
  }

  function levelColor(v, lo, hi) {
    const ramp = window.viz.isDark() ? SEQ_D : SEQ_L;
    if (!(v > 0)) return css('--grid');
    const z = Math.max(0, Math.min(1,
      (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))));
    return z < 0.5 ? mix(ramp[0], ramp[1], z * 2) : mix(ramp[1], ramp[2], (z - 0.5) * 2);
  }

  const MAP_RANGE = { cm: [1, 250], res: [2, 30] };

  function drawMap() {
    const { ctx, w, h } = fitCanvas(mapCanvas, 0.62);
    ctx.clearRect(0, 0, w, h);
    if (!D) return;

    const g = D.grids[mapMetric];
    const nCol = D.stamps.length, nRow = 64;
    const x0 = MAP_PAD.l, x1 = w - MAP_PAD.r, y0 = MAP_PAD.t, y1 = h - MAP_PAD.b;
    const cw = (x1 - x0) / nCol, ch = (y1 - y0) / nRow;
    const [lo, hi] = MAP_RANGE[mapMetric];

    for (let r = 0; r < nRow; r++) {
      for (let c = 0; c < nCol; c++) {
        const v = g.values[r][c];
        ctx.fillStyle = mapView === 'change'
          ? changeColor(v == null ? 0 : v / g.median[r])
          : levelColor(v, lo, hi);
        ctx.fillRect(x0 + c * cw, y0 + r * ch, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
      }
    }

    // FEU separators and chamber labels
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    D.feus.forEach((f, k) => {
      if (k) {
        ctx.strokeStyle = css('--surface'); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, y0 + k * 8 * ch); ctx.lineTo(x1, y0 + k * 8 * ch); ctx.stroke();
      }
      ctx.fillStyle = detColor(f.det);
      ctx.fillText(f.label, x0 - 7, y0 + (k * 8 + 4) * ch);
    });

    // date ticks on the first acquisition of each day
    ctx.save();
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = css('--muted');
    ctx.translate(0, y1 + 6);
    let prev = '';
    D.stamps.forEach((s, c) => {
      const d = s.slice(0, 10);
      if (d === prev) return;
      prev = d;
      ctx.save();
      ctx.translate(x0 + (c + 0.5) * cw, 0);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(day(d), 0, 0);
      ctx.restore();
    });
    ctx.restore();

    // legend strip on the right
    const lx = x1 + 14, lw = 12, lh = y1 - y0;
    for (let i = 0; i < lh; i++) {
      const t = 1 - i / lh;
      ctx.fillStyle = mapView === 'change'
        ? changeColor(2 ** (4 * t - 2))
        : levelColor(10 ** (Math.log10(lo) + t * (Math.log10(hi) - Math.log10(lo))), lo, hi);
      ctx.fillRect(lx, y0 + i, lw, 1.5);
    }
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const marks = mapView === 'change'
      ? [['4×', 0], ['2×', 0.25], ['1×', 0.5], ['½×', 0.75], ['¼×', 1]]
      : [[String(hi), 0], ['', 0.5], [String(lo), 1]];
    for (const [label, t] of marks) {
      if (label) ctx.fillText(label, lx + lw + 4, y0 + t * lh);
    }

    if (hoverCell) {
      const { r, c } = hoverCell;
      ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + c * cw, y0 + r * ch, cw, ch);
    }
    mapCanvas._geom = { x0, y0, cw, ch, nCol, nRow };
  }

  function mapHover(ev) {
    const g = mapCanvas._geom;
    if (!g || !D) return;
    const rect = mapCanvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const c = Math.floor((mx - g.x0) / g.cw), r = Math.floor((my - g.y0) / g.ch);
    if (c < 0 || c >= g.nCol || r < 0 || r >= g.nRow) {
      if (hoverCell) { hoverCell = null; mapTip.hide(); drawMap(); }
      return;
    }
    if (!hoverCell || hoverCell.r !== r || hoverCell.c !== c) {
      hoverCell = { r, c }; drawMap();
    }
    const grid = D.grids[mapMetric];
    const f = D.feus[Math.floor(r / 8)], chip = r % 8;
    const v = grid.values[r][c], med = grid.median[r];
    const ratio = v && med ? v / med : null;
    mapTip.show(
      `<div class="tt-title">${stamp(D.stamps[c])}</div>` +
      `<div class="row"><i style="background:${detColor(f.det)}"></i>` +
      `chamber ${f.det} ${f.view} · chip D${chip} · channels ${chip * 64}–${chip * 64 + 63}</div>` +
      `<div class="row">${METRICS[mapMetric].label}<b style="margin-left:auto">` +
      `${v == null ? '—' : v + ' ADC'}</b></div>` +
      `<div class="row">vs its own median<b style="margin-left:auto">` +
      `${ratio == null ? '—' : ratio.toFixed(2) + '×'}</b></div>`,
      mx, my);
  }

  /* ---- tables ------------------------------------------------------------- */

  function fillTables() {
    const ev = document.querySelector('#event-table tbody');
    if (ev) {
      ev.innerHTML = D.events.map(e => {
        const where = e.det
          ? `<span style="color:${detColor(e.det)};font-weight:600">${esc(e.where)}</span>`
          : esc(e.where);
        return `<tr><td>${stamp(e.start)}</td><td>${where}</td><td>${esc(e.what)}</td>` +
          `<td>${e.end ? stamp(e.end) : '<span class="dim">never</span>'}</td>` +
          `<td>${esc(e.covers)}</td><td>${e.subruns}</td></tr>`;
      }).join('');
    }

    const st = document.querySelector('#step-table tbody');
    if (st) {
      st.innerHTML = D.step.map(r =>
        `<tr><td><span style="color:${detColor(r.det)};font-weight:600">${r.label}</span></td>` +
        `<td>${r.res_before}</td><td>${r.res_after}</td><td><b>×${r.res_step}</b></td>` +
        `<td>${r.cm_before}</td><td>${r.cm_after}</td><td>×${r.cm_step}</td></tr>`).join('');
    }

    const lt = document.querySelector('#last-table tbody');
    if (lt) {
      lt.innerHTML = D.last.map(r =>
        `<tr><td><span style="color:${detColor(r.det)};font-weight:600">${r.label}</span>` +
        ` <span class="dim">FEU ${r.feu}</span></td>` +
        `<td>${r.mean}</td><td>${r.spread}</td><td>${r.raw}</td><td>${r.cm}</td>` +
        `<td>${r.res}</td><td>${r.coherent}×</td><td>${r.thr}</td>` +
        `<td>${r.dead}</td><td>${r.noisy}</td></tr>`).join('');
    }

    const ep = document.querySelector('#epoch-table tbody');
    if (ep) {
      ep.innerHTML = D.epochs.map(e =>
        `<tr><td>${esc(e.name)}</td><td>${e.n}</td>` +
        `<td>${day(e.start.slice(0, 10))} – ${day(e.end.slice(0, 10))}</td>` +
        `<td>${e.raw}</td><td>${e.cm}</td><td>${e.res}</td></tr>`).join('');
    }
  }

  function fillStats() {
    const set = (k, v) => document.querySelectorAll(`[data-ped-stat="${k}"]`)
      .forEach(el => { el.textContent = v; });
    set('sets', D.n_sets);
    set('used', D.n_used);
    set('subruns', D.n_subruns.toLocaleString('en-GB'));
    set('res_step', '×' + D.res_step.toFixed(1));
    set('cm_step', '×' + D.cm_step.toFixed(2));
    set('a_ratio', '×' + D.a_cm_ratio.toFixed(1));
    set('dropouts', D.events.filter(e => e.kind === 'connector').length);
    set('age_max', Math.round(D.age.max) + ' h');
    set('age_median', D.age.median.toFixed(1) + ' h');
    set('span', day(D.span[0].slice(0, 10)) + ' – ' + day(D.span[1].slice(0, 10)));
  }

  /* ---- switches ----------------------------------------------------------- */

  function wireSwitch(sel, attr, onPick) {
    const box = document.querySelector(sel);
    if (!box) return;
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      box.querySelectorAll('button').forEach(x =>
        x.setAttribute('aria-pressed', String(x === b)));
      onPick(b.dataset[attr]);
    });
  }

  /* ---- boot --------------------------------------------------------------- */

  const histTip = makeTip(histCanvas.parentElement);
  const mapTip = makeTip(mapCanvas.parentElement);
  histCanvas.addEventListener('mousemove', histHover);
  histCanvas.addEventListener('mouseleave', () => { hoverHist = -1; histTip.hide(); drawHist(); });
  mapCanvas.addEventListener('mousemove', mapHover);
  mapCanvas.addEventListener('mouseleave', () => { hoverCell = null; mapTip.hide(); drawMap(); });

  wireSwitch('#metric-switch', 'metric', v => {
    metric = v;
    const n = document.getElementById('metric-note');
    if (n) n.textContent = METRICS[v].note;
    drawHist();
  });
  wireSwitch('#map-metric-switch', 'metric', v => { mapMetric = v; drawMap(); });
  wireSwitch('#map-view-switch', 'view', v => {
    mapView = v;
    const n = document.getElementById('map-note');
    if (n) {
      n.textContent = v === 'change'
        ? 'Each chip against its own campaign median, so only movement shows.'
        : 'Absolute level, for comparing chambers with each other rather than with themselves.';
    }
    drawMap();
  });

  register(drawHist);
  register(drawMap);

  fetch('../data/x17-pedestals.json')
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(json => {
      D = json;
      fillStats(); fillTables(); drawHist(); drawMap();
      document.querySelectorAll('.chart-fallback').forEach(el => { el.hidden = true; });
    })
    .catch(() => {
      document.querySelectorAll('.chart-fallback').forEach(el => { el.hidden = false; });
    });
})();
