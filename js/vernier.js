/* Vernier scan demo — how colliders measure their own luminosity.
   Top: transverse profiles of the two beams (Gaussians) at separation Δ; the
   overlap integral is the shaded product. Bottom: collision rate vs Δ — drag
   the slider to move the live point, or "Run scan" to step across like a real
   scan and drop (noisy) measured points. The fitted width of the rate curve
   gives the effective overlap size, and with it the absolute luminosity. */

(() => {
  'use strict';
  const { css, fitCanvas, register, makeTip, reducedMotion } = window.viz;

  const canvas = document.getElementById('vs-canvas');
  if (!canvas) return;
  const box = canvas.closest('.viz-canvas-box');
  const tip = makeTip(box);

  const sepEl = document.getElementById('vs-sep');
  const sepVal = document.getElementById('vs-sep-val');
  const runBtn = document.getElementById('vs-run');
  const readout = document.getElementById('vs-readout');

  const SIG = 150;                 // µm, per-beam transverse size
  const CAP = Math.SQRT2 * SIG;    // rate-curve width: sqrt(σ1² + σ2²)
  const DMAX = 900;                // µm, scan range ±
  const rate = d => Math.exp(-d * d / (2 * CAP * CAP));   // normalized

  let points = [];                 // measured scan points [{d, r}]
  let scanning = false;
  let hover = null;

  const PAD = { l: 46, r: 14, t: 10, b: 30 };

  function draw() {
    const { ctx, w, h } = fitCanvas(canvas, 0.62);
    const d = parseFloat(sepEl.value);
    sepVal.textContent = d + ' µm';

    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px system-ui, sans-serif';

    /* ---- top panel: the two beam profiles --------------------------------- */
    const topH = h * 0.34;
    const X = u => PAD.l + (u + DMAX) / (2 * DMAX) * (w - PAD.l - PAD.r);
    const prof = (u, mu) => Math.exp(-((u - mu) ** 2) / (2 * SIG * SIG));
    const Yt = v => topH - 8 - v * (topH - 26);

    // overlap product, filled — this is the thing the machine measures
    ctx.beginPath();
    for (let u = -DMAX; u <= DMAX; u += 6) {
      const v = prof(u, -d / 2) * prof(u, d / 2);
      const x = X(u), y = Yt(v);
      u === -DMAX ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineTo(X(DMAX), Yt(0)); ctx.lineTo(X(-DMAX), Yt(0)); ctx.closePath();
    ctx.fillStyle = css('--wash-2'); ctx.fill();

    // the two beams (blue = beam 1, aqua = beam 2; legend in the HTML)
    [[-d / 2, '--series-1'], [d / 2, '--series-3']].forEach(([mu, varname]) => {
      ctx.beginPath();
      for (let u = -DMAX; u <= DMAX; u += 6) {
        const x = X(u), y = Yt(prof(u, mu));
        u === -DMAX ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = css(varname); ctx.lineWidth = 2;
      ctx.lineJoin = ctx.lineCap = 'round'; ctx.stroke();
    });
    ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.l, Yt(0)); ctx.lineTo(w - PAD.r, Yt(0)); ctx.stroke();
    ctx.fillStyle = css('--muted'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('beam profiles at the collision point (transverse x, µm)', PAD.l, 2);

    /* ---- bottom panel: rate vs separation --------------------------------- */
    const y0 = topH + 14, plotH = h - y0 - PAD.b;
    const Yr = v => y0 + (1 - v) * plotH;

    ctx.strokeStyle = css('--grid');
    [0.25, 0.5, 0.75, 1].forEach(v => {
      ctx.beginPath(); ctx.moveTo(PAD.l, Yr(v)); ctx.lineTo(w - PAD.r, Yr(v)); ctx.stroke();
    });
    ctx.strokeStyle = css('--axis');
    ctx.beginPath(); ctx.moveTo(PAD.l, Yr(0)); ctx.lineTo(w - PAD.r, Yr(0)); ctx.stroke();
    ctx.fillStyle = css('--muted');
    [-800, -400, 0, 400, 800].forEach(u => {
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(u, X(u), Yr(0) + 6);
    });
    ctx.textAlign = 'center';
    ctx.fillText('beam separation Δ (µm)', (PAD.l + w - PAD.r) / 2, h - 12);
    ctx.save();
    ctx.translate(12, y0 + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('rate (norm.)', 0, 0);
    ctx.restore();

    // true curve (orange — matches the overlap wash above)
    ctx.beginPath();
    for (let u = -DMAX; u <= DMAX; u += 6) {
      const x = X(u), y = Yr(rate(u));
      u === -DMAX ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = css('--series-2'); ctx.lineWidth = 2; ctx.stroke();

    // measured points (same series → same hue; ring keeps them legible on the line)
    points.forEach(p => {
      ctx.beginPath(); ctx.arc(X(p.d), Yr(p.r), 4, 0, Math.PI * 2);
      ctx.fillStyle = css('--series-2'); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = css('--surface'); ctx.stroke();
    });

    // live point at the slider position
    ctx.beginPath(); ctx.arc(X(d), Yr(rate(d)), 5.5, 0, Math.PI * 2);
    ctx.fillStyle = css('--ink'); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = css('--surface'); ctx.stroke();

    // hover on the rate curve
    if (hover && hover.y > y0 && hover.x > PAD.l && hover.x < w - PAD.r) {
      const u = -DMAX + (hover.x - PAD.l) / (w - PAD.l - PAD.r) * 2 * DMAX;
      tip.show(
        `<div class="tt-title">Δ = ${u.toFixed(0)} µm</div>` +
        `<div class="row"><i style="background:${css('--series-2')}"></i>rate <b>${rate(u).toFixed(3)}</b></div>`,
        hover.x, Yr(rate(u)));
    } else tip.hide();
  }

  function finishScan() {
    scanning = false;
    runBtn.disabled = false;
    // "fit": weighted Gaussian width from the measured points (log-quadratic)
    const cap = Math.sqrt(
      points.reduce((a, p) => a + p.d * p.d * p.r, 0) /
      points.reduce((a, p) => a + p.r, 0));
    readout.innerHTML =
      `measured overlap width Σ ≈ <b>${cap.toFixed(0)} µm</b> ` +
      `(true √(σ₁²+σ₂²) = ${CAP.toFixed(0)} µm) → with beam currents known, ` +
      `this width converts the raw rate into an absolute luminosity`;
  }

  function runScan() {
    if (scanning) return;
    scanning = true; runBtn.disabled = true;
    points = [];
    const steps = [];
    for (let d = -800; d <= 800; d += 100) steps.push(d);
    if (reducedMotion.matches) {
      steps.forEach(d => points.push({ d, r: Math.max(0, rate(d) + (Math.random() - 0.5) * 0.05) }));
      sepEl.value = 0; draw(); finishScan();
      return;
    }
    let i = 0;
    const tick = () => {
      if (i >= steps.length) { finishScan(); draw(); return; }
      const d = steps[i];
      sepEl.value = d;
      points.push({ d, r: Math.max(0, rate(d) + (Math.random() - 0.5) * 0.05) });
      draw();
      i += 1;
      setTimeout(tick, 140);
    };
    tick();
  }

  canvas.addEventListener('pointermove', e => { hover = { x: e.offsetX, y: e.offsetY }; draw(); });
  canvas.addEventListener('pointerleave', () => { hover = null; draw(); });
  sepEl.addEventListener('input', draw);
  runBtn.addEventListener('click', runScan);
  register(draw);
})();
