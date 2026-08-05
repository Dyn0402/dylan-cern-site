/* X17 demo — e+e- opening-angle spectrum.
   Internal Pair Creation (IPC) from a nuclear transition falls smoothly and
   steeply with opening angle. A new boson of mass m decaying to e+e- piles up
   near its kinematic opening angle θ ≈ 2·asin(m c² / E), so a ~17 MeV particle
   from an ~18 MeV transition makes a bump at large angle where the background
   is quietest — that is the whole reason the anomaly is striking.
   Sliders: boson mass (moves the bump), signal strength (scales it). */

(() => {
  'use strict';
  const { css, fitCanvas, register, makeTip } = window.viz;

  const canvas = document.getElementById('x17-canvas');
  if (!canvas) return;
  const box = canvas.closest('.viz-canvas-box');
  const tip = makeTip(box);

  const massEl = document.getElementById('x17-mass');
  const sigEl = document.getElementById('x17-sig');
  const massVal = document.getElementById('x17-mass-val');
  const sigVal = document.getElementById('x17-sig-val');
  const peakOut = document.getElementById('x17-peak');

  const E = 18.15;                    // MeV — 8Be M1 transition energy
  const TH_MIN = 40, TH_MAX = 180;    // degrees, x-domain
  const PAD = { l: 46, r: 14, t: 14, b: 34 };

  // Smooth, steeply falling IPC-like background (arbitrary units, log-ish fall)
  const bg = th => 1000 * Math.exp(-(th - TH_MIN) / 24) + 2;

  function signal(th, m, strength) {
    const thPeak = 2 * Math.asin(Math.min(1, m / E)) * 180 / Math.PI;
    const sigma = 7;                  // deg — detector + kinematic smearing
    return strength * 55 * Math.exp(-0.5 * ((th - thPeak) / sigma) ** 2);
  }

  let hoverX = null;                  // CSS-px x of crosshair, null = none

  function draw() {
    const { ctx, w, h } = fitCanvas(canvas, 0.52);
    const m = parseFloat(massEl.value), strength = parseFloat(sigEl.value);
    const thPeak = 2 * Math.asin(Math.min(1, m / E)) * 180 / Math.PI;

    massVal.textContent = m.toFixed(1) + ' MeV';
    sigVal.textContent = strength.toFixed(1) + '×';
    peakOut.innerHTML = `bump sits at θ ≈ <b>${thPeak.toFixed(0)}°</b>` +
      ` (kinematics: θ ≈ 2·asin(mc²/E), E = ${E} MeV)`;

    const X = th => PAD.l + (th - TH_MIN) / (TH_MAX - TH_MIN) * (w - PAD.l - PAD.r);
    // log y — the background spans ~3 decades; linear would flatten the tail
    const YMAX = 1100, YMIN = 1;
    const Y = v => {
      const f = (Math.log10(Math.max(v, YMIN)) - Math.log10(YMIN)) /
                (Math.log10(YMAX) - Math.log10(YMIN));
      return h - PAD.b - f * (h - PAD.t - PAD.b);
    };

    ctx.clearRect(0, 0, w, h);

    // grid + axes: hairline, recessive
    ctx.font = '11px system-ui, sans-serif';
    ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    ctx.fillStyle = css('--muted');
    [1, 10, 100, 1000].forEach(v => {
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(v >= 1000 ? '1,000' : String(v), PAD.l - 7, y);
    });
    for (let th = 60; th <= 180; th += 30) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(th + '°', X(th), h - PAD.b + 7);
    }
    ctx.strokeStyle = css('--axis');
    ctx.beginPath(); ctx.moveTo(PAD.l, h - PAD.b); ctx.lineTo(w - PAD.r, h - PAD.b); ctx.stroke();
    // axis titles
    ctx.fillStyle = css('--muted'); ctx.textAlign = 'center';
    ctx.fillText('e⁺e⁻ opening angle θ', (PAD.l + w - PAD.r) / 2, h - 14);
    ctx.save();
    ctx.translate(12, (h - PAD.b + PAD.t) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('pairs / bin (log)', 0, 0);
    ctx.restore();

    // series: background (slot 1) under background+signal (slot 2)
    const line = (f, color, wash) => {
      ctx.beginPath();
      for (let th = TH_MIN; th <= TH_MAX; th += 1) {
        const x = X(th), y = Y(f(th));
        th === TH_MIN ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      if (wash) {
        ctx.save();
        ctx.lineTo(X(TH_MAX), h - PAD.b); ctx.lineTo(X(TH_MIN), h - PAD.b);
        ctx.closePath(); ctx.fillStyle = wash; ctx.fill();
        ctx.restore();
        ctx.beginPath();
        for (let th = TH_MIN; th <= TH_MAX; th += 1) {
          const x = X(th), y = Y(f(th));
          th === TH_MIN ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.stroke();
    };
    const total = th => bg(th) + signal(th, m, strength);
    line(bg, css('--series-1'), css('--wash-1'));
    line(total, css('--series-2'), null);

    // selective direct label on the one thing the story is about
    if (strength > 0.15) {
      const lx = X(thPeak), ly = Y(total(thPeak));
      ctx.fillStyle = css('--ink-2');
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('X17?', lx, ly - 8);
    }

    // hover crosshair
    if (hoverX !== null && hoverX > PAD.l && hoverX < w - PAD.r) {
      const th = TH_MIN + (hoverX - PAD.l) / (w - PAD.l - PAD.r) * (TH_MAX - TH_MIN);
      ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hoverX, PAD.t); ctx.lineTo(hoverX, h - PAD.b); ctx.stroke();
      const marks = [
        { c: css('--series-2'), v: total(th) },
        { c: css('--series-1'), v: bg(th) },
      ];
      marks.forEach(mk => {                       // 2px surface ring on markers
        ctx.beginPath(); ctx.arc(hoverX, Y(mk.v), 4.5, 0, Math.PI * 2);
        ctx.fillStyle = mk.c; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = css('--surface'); ctx.stroke();
      });
      tip.show(
        `<div class="tt-title">θ = ${th.toFixed(0)}°</div>` +
        `<div class="row"><i style="background:${css('--series-2')}"></i>IPC + X17 <b>${total(th).toFixed(1)}</b></div>` +
        `<div class="row"><i style="background:${css('--series-1')}"></i>IPC only <b>${bg(th).toFixed(1)}</b></div>`,
        hoverX, Y(total(th)));
    } else tip.hide();
  }

  canvas.addEventListener('pointermove', e => {
    hoverX = e.offsetX; draw();
  });
  canvas.addEventListener('pointerleave', () => { hoverX = null; draw(); });
  massEl.addEventListener('input', draw);
  sigEl.addEventListener('input', draw);
  register(draw);
})();
