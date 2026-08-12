/* /x17/ campaign charts — the two plots kept from the retired live dashboard,
   redrawn from a frozen snapshot (data/x17-campaign.json, see
   scripts/freeze_x17_campaign.py). Data taking ended 2026-08-10, so nothing
   here polls the beamline; the numbers are final.

   Integrated events   cumulative beam triggers and cosmics against the
                       projection frozen on 2026-07-27, which is the plot the
                       shift crew actually watched.
   Events per day      the same record differenced, which is where the beam
                       gaps and the cosmic-only days are legible.

   Both plots carry events on one axis — beam and cosmics are the same unit and
   are never summed, because cosmics were taken during beam-off periods and a
   combined curve would imply an exposure that never happened.

   The stat tiles are filled from the same JSON, but the fragment ships the
   final numbers as static text, so the headline survives with JS off. */

(() => {
  'use strict';
  const { css, fitCanvas, register, makeTip } = window.viz;

  const cumCanvas = document.getElementById('cum-canvas');
  const dayCanvas = document.getElementById('day-canvas');
  if (!cumCanvas || !dayCanvas) return;

  // t leaves room for the axis label to sit above the top gridline rather than
  // on it. The line chart needs a wide right margin for the direct labels that
  // sit past the end of each curve; the bar chart has none, so it gets it back.
  const PAD = { l: 52, r: 78, t: 24, b: 26 };
  const PAD_BAR = { ...PAD, r: 16 };

  const fmtM = v => v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + ' M'
    : v >= 1e3 ? (v / 1e3).toFixed(0) + ' k' : String(Math.round(v));
  /* Axis ticks are round by construction, so drop the decimal the headline
     format keeps: "30 M", not "30.0 M". */
  const fmtTick = v => v === 0 ? '0'
    : v >= 1e6 ? +(v / 1e6).toFixed(2) + ' M'
      : v >= 1e3 ? +(v / 1e3).toFixed(1) + ' k' : String(v);
  const fmtInt = v => Math.round(v).toLocaleString('en-GB');
  const dayName = iso => {
    const [, m, d] = iso.split('-');
    return new Date(Date.UTC(2026, +m - 1, +d))
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const stamp = t => new Date(t * 1000)
    .toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  /* Nice round y ticks: 1/2/5 x 10^n, four or so of them. */
  function ticks(max) {
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].find(m => m * mag >= raw) * mag;
    const out = [];
    for (let v = 0; v <= max * 1.0001; v += step) out.push(v);
    return out;
  }

  function frame(ctx, w, h, yMax, label, pad = PAD) {
    const x0 = pad.l, x1 = w - pad.r, y0 = h - pad.b, y1 = pad.t;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const v of ticks(yMax)) {
      const y = y0 - (v / yMax) * (y0 - y1);
      ctx.strokeStyle = css('--grid');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(y) + 0.5);
      ctx.lineTo(x1, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillStyle = css('--muted');
      ctx.fillText(fmtTick(v), x0 - 8, y);
    }
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x0, 2);
    return { x0, x1, y0, y1 };
  }

  let D = null;                          // the frozen payload
  let hoverCum = -1, hoverDay = -1;

  /* ---- integrated events ------------------------------------------------- */

  function drawCum() {
    const { ctx, w, h } = fitCanvas(cumCanvas, 0.46);
    ctx.clearRect(0, 0, w, h);
    if (!D) return;

    const pts = D.cumulative, proj = D.projection_curve;
    const tMin = pts[0][0], tMax = pts[pts.length - 1][0];
    const yMax = Math.max(pts[pts.length - 1][1],
      proj.length ? proj[proj.length - 1][1] : 0) * 1.06;
    const { x0, x1, y0, y1 } = frame(ctx, w, h, yMax, 'events recorded');

    const X = t => x0 + ((t - tMin) / (tMax - tMin)) * (x1 - x0);
    const Y = v => y0 - (v / yMax) * (y0 - y1);

    // date ticks every three days, on the day boundary
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < D.daily.length; i += 3) {
      const d = D.daily[i].d;
      const t = new Date(d + 'T00:00:00').getTime() / 1000;
      if (t < tMin || t > tMax) continue;
      ctx.fillText(dayName(d), X(t), y0 + 7);
    }

    // the projection first, so the measured curves sit on top of it
    if (proj.length) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = css('--axis');
      ctx.lineWidth = 2;
      ctx.beginPath();
      proj.forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v))));
      ctx.stroke();
      ctx.restore();
      const last = proj[proj.length - 1];
      ctx.fillStyle = css('--muted');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('projection', X(last[0]) - 4, Y(last[1]) + 16);
    }

    // beam: wash under a 2px line
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), y0);
    pts.forEach(([t, b]) => ctx.lineTo(X(t), Y(b)));
    ctx.lineTo(X(tMax), y0);
    ctx.closePath();
    ctx.fillStyle = css('--wash-1');
    ctx.fill();

    const line = (idx, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[idx])) : ctx.moveTo(X(p[0]), Y(p[idx]))));
      ctx.stroke();
    };
    line(2, css('--series-2'));
    line(1, css('--series-1'));

    // direct labels past the end of each curve — identity without a trip to
    // the legend, and the final number where the eye already is
    const end = pts[pts.length - 1];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 11.5px system-ui, sans-serif';
    [[1, 'beam'], [2, 'cosmic']].forEach(([idx, name]) => {
      ctx.fillStyle = css('--ink');
      ctx.fillText(fmtM(end[idx]), x1 + 6, Y(end[idx]) - 7);
      ctx.fillStyle = css('--muted');
      ctx.fillText(name, x1 + 6, Y(end[idx]) + 6);
    });

    if (hoverCum >= 0) {
      const p = pts[hoverCum];
      const x = X(p[0]);
      ctx.strokeStyle = css('--axis');
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, y1);
      ctx.lineTo(Math.round(x) + 0.5, y0);
      ctx.stroke();
      ctx.setLineDash([]);
      [[1, '--series-1'], [2, '--series-2']].forEach(([idx, tok]) => {
        ctx.beginPath();
        ctx.arc(x, Y(p[idx]), 4.5, 0, Math.PI * 2);
        ctx.fillStyle = css(tok);
        ctx.fill();
        ctx.lineWidth = 2;                       // surface ring, so the dot
        ctx.strokeStyle = css('--surface');      // reads over the line beneath
        ctx.stroke();
      });
    }
  }

  /* ---- events per day ---------------------------------------------------- */

  function drawDay() {
    const { ctx, w, h } = fitCanvas(dayCanvas, 0.42);
    ctx.clearRect(0, 0, w, h);
    if (!D) return;

    const days = D.daily;
    const yMax = Math.max(...days.map(d => Math.max(d.beam, d.cos))) * 1.1;
    const { x0, x1, y0, y1 } = frame(ctx, w, h, yMax, 'events per day', PAD_BAR);

    const slot = (x1 - x0) / days.length;
    const bw = Math.max(3, (slot - 6) / 2 - 1);   // 2px between the pair
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    days.forEach((d, i) => {
      const left = x0 + i * slot + 3;
      [[d.beam, '--series-1', 0], [d.cos, '--series-2', bw + 2]].forEach(([v, tok, dx]) => {
        if (!v) return;
        const bh = (v / yMax) * (y0 - y1);
        ctx.fillStyle = css(tok);
        ctx.globalAlpha = hoverDay < 0 || hoverDay === i ? 1 : 0.45;
        ctx.beginPath();
        ctx.roundRect(left + dx, y0 - bh, bw, bh, [4, 4, 0, 0]);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
      if (i % 3 === 0) {
        ctx.fillStyle = css('--muted');
        ctx.fillText(dayName(d.d), left + slot / 2 - 3, y0 + 7);
      }
    });

    ctx.strokeStyle = css('--axis');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(y0) + 0.5);
    ctx.lineTo(x1, Math.round(y0) + 0.5);
    ctx.stroke();
  }

  /* ---- hover ------------------------------------------------------------- */

  function attach(canvas, tip, onMove) {
    const box = canvas.parentElement;
    const t = makeTip(box);
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      onMove(e.clientX - r.left, e.clientY - r.top, t);
    });
    canvas.addEventListener('mouseleave', () => {
      t.hide();
      hoverCum = hoverDay = -1;
      drawCum(); drawDay();
    });
    return t;
  }

  const swatch = tok => `<i style="background:var(${tok})"></i>`;

  function init() {
    attach(cumCanvas, null, (mx, my, tip) => {
      if (!D) return;
      const pts = D.cumulative;
      const w = cumCanvas.clientWidth;
      const x0 = PAD.l, x1 = w - PAD.r;
      const tMin = pts[0][0], tMax = pts[pts.length - 1][0];
      const t = tMin + ((mx - x0) / (x1 - x0)) * (tMax - tMin);
      let best = 0;
      pts.forEach((p, i) => {
        if (Math.abs(p[0] - t) < Math.abs(pts[best][0] - t)) best = i;
      });
      hoverCum = best;
      drawCum();
      const p = pts[best];
      tip.show(
        `<div class="tt-title">${stamp(p[0])}</div>` +
        `<div class="row">${swatch('--series-1')}beam <b>${fmtInt(p[1])}</b></div>` +
        `<div class="row">${swatch('--series-2')}cosmic <b>${fmtInt(p[2])}</b></div>`,
        mx, my);
    });

    attach(dayCanvas, null, (mx, my, tip) => {
      if (!D) return;
      const w = dayCanvas.clientWidth;
      const x0 = PAD_BAR.l, x1 = w - PAD_BAR.r;
      const i = Math.floor(((mx - x0) / (x1 - x0)) * D.daily.length);
      if (i < 0 || i >= D.daily.length) { tip.hide(); hoverDay = -1; drawDay(); return; }
      hoverDay = i;
      drawDay();
      const d = D.daily[i];
      tip.show(
        `<div class="tt-title">${dayName(d.d)}</div>` +
        `<div class="row">${swatch('--series-1')}beam <b>${fmtInt(d.beam)}</b>` +
        ` <span style="color:var(--muted)">${d.beam_hours} h</span></div>` +
        `<div class="row">${swatch('--series-2')}cosmic <b>${fmtInt(d.cos)}</b>` +
        ` <span style="color:var(--muted)">${d.cos_hours} h</span></div>`,
        mx, my);
    });

    register(drawCum);
    register(drawDay);
  }

  /* ---- tiles and the table view ------------------------------------------ */

  function fillTiles() {
    const flat = { ...D.totals, ...D.campaign, ...D.projection };
    document.querySelectorAll('[data-stat]').forEach(el => {
      const v = flat[el.dataset.stat];
      if (v === undefined || v === null) return;
      el.textContent = el.dataset.fmt === 'M' ? fmtM(v)
        : typeof v === 'number' ? fmtInt(v) : String(v);
    });
  }

  /* Every chart needs a way to read the numbers without reading the picture. */
  function fillTable() {
    const body = document.querySelector('#day-table tbody');
    if (!body) return;
    body.innerHTML = D.daily.map(d =>
      `<tr><td>${dayName(d.d)}</td><td>${fmtInt(d.beam)}</td>` +
      `<td>${d.beam_hours}</td><td>${fmtInt(d.cos)}</td>` +
      `<td>${d.cos_hours}</td></tr>`).join('');
  }

  fetch('../data/x17-campaign.json')
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(payload => {
      D = payload;
      fillTiles();
      fillTable();
      init();
    })
    .catch(() => {
      // The tiles already carry the final numbers as static text; only the
      // plots are lost, so say so where the plots would have been.
      document.querySelectorAll('.chart-fallback').forEach(el => {
        el.hidden = false;
      });
    });
})();
