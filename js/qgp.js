/* QGP demo — heavy-ion collision geometry and multiplicity fluctuations.
   Two Lorentz-contracted nuclei collide at impact parameter b. Nucleons in
   the overlap ("participants", orange) source the fireball; the rest
   ("spectators", gray) fly on. Each event's proton count is accumulated into
   a histogram — event-by-event fluctuations in exactly such distributions,
   measured against an independent-emission baseline, are the observable my
   thesis used to search for QGP critical-point signatures.
   Controls: impact parameter slider, single event, or run 200 events. */

(() => {
  'use strict';
  const { css, fitCanvas, register, reducedMotion } = window.viz;

  const canvas = document.getElementById('qgp-canvas');
  if (!canvas) return;

  const bEl = document.getElementById('qgp-b');
  const bVal = document.getElementById('qgp-b-val');
  const oneBtn = document.getElementById('qgp-one');
  const manyBtn = document.getElementById('qgp-many');
  const readout = document.getElementById('qgp-readout');

  const A = 60;            // nucleons per nucleus (small "gold-like" nucleus)
  const R = 1;             // nuclear radius, working units
  const CONTRACT = 0.35;   // x-contraction of the incoming nuclei
  const D2 = 0.11;         // nucleon-nucleon interaction distance², working units

  let ev = null;           // current event {nucA, nucB, phase, t, parts, tracks}
  let hist = new Array(50).fill(0);   // proton-count histogram
  let nEvents = 0, sum = 0, sum2 = 0;
  let anim = null, batch = 0;

  const rnd = () => Math.random();
  function makeNucleus() {
    // uniform hard sphere projected to the transverse-ish plane (2D cartoon)
    const pts = [];
    while (pts.length < A) {
      const x = (rnd() * 2 - 1), y = (rnd() * 2 - 1);
      if (x * x + y * y <= 1) pts.push({ x: x * R, y: y * R });
    }
    return pts;
  }

  function newEvent(b) {
    const nucA = makeNucleus(), nucB = makeNucleus();
    // participant tagging at the moment of overlap (positions frozen)
    nucA.forEach(p => { p.part = nucB.some(q => (p.x - q.x + 0) ** 2 + (p.y + b / 2 - (q.y - b / 2)) ** 2 < D2); });
    nucB.forEach(q => { q.part = nucA.some(p => (q.x - p.x) ** 2 + (q.y - b / 2 - (p.y + b / 2)) ** 2 < D2); });
    const nPart = nucA.filter(p => p.part).length + nucB.filter(q => q.part).length;
    // produced tracks ~ participants, protons a Poisson-ish subset
    const nTracks = Math.round(nPart * (0.9 + rnd() * 0.4));
    const tracks = Array.from({ length: nTracks }, () => {
      const phi = rnd() * Math.PI * 2;
      return { phi, v: 0.5 + rnd() * 0.8, isP: rnd() < 0.3 };
    });
    return { nucA, nucB, b, t: 0, nPart, tracks, done: false };
  }

  function recordEvent(e) {
    const nP = e.tracks.filter(t => t.isP).length;
    if (nP < hist.length) hist[nP] += 1;
    nEvents += 1; sum += nP; sum2 += nP * nP;
    const mean = sum / nEvents;
    const varr = sum2 / nEvents - mean * mean;
    readout.innerHTML =
      `events <b>${nEvents.toLocaleString()}</b> · N<sub>part</sub> (last) <b>${e.nPart}</b> · ` +
      `protons/event: mean <b>${mean.toFixed(1)}</b>, variance/mean <b>${nEvents > 1 ? (varr / mean).toFixed(2) : '—'}</b> ` +
      `<span style="color:var(--muted)">(independent emission → 1; correlations push it away)</span>`;
  }

  function step() {
    if (!ev) return;
    ev.t += reducedMotion.matches ? 1e3 : 0.035;
    if (ev.t >= 2.4 && !ev.done) { ev.done = true; recordEvent(ev); if (batch > 0) { batch -= 1; launch(); return; } }
    draw();
    if (!ev.done) anim = requestAnimationFrame(step);
  }

  function launch() {
    cancelAnimationFrame(anim);
    ev = newEvent(parseFloat(bEl.value) * R * 2);
    if (reducedMotion.matches || batch > 0) {
      // batch mode: skip animation, land the event instantly
      ev.t = 3; ev.done = true; recordEvent(ev); draw();
      if (batch > 0) { batch -= 1; if (batch > 0) setTimeout(launch, 8); }
    } else anim = requestAnimationFrame(step);
  }

  function draw() {
    const { ctx, w, h } = fitCanvas(canvas, 0.5);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px system-ui, sans-serif';

    const evW = w * 0.58;                       // left: event display
    const cx = evW / 2, cy = h / 2;
    const S = Math.min(evW, h) * 0.21;          // px per working unit

    const b = parseFloat(bEl.value) * 2;        // slider is b/2R in [0,1]
    bVal.textContent = (parseFloat(bEl.value) * 2).toFixed(1) + ' R';

    if (ev) {
      // approach: nuclei slide in along x, meet at t=1, tracks fly after
      const tIn = Math.min(ev.t, 1);
      const dx = (1 - tIn) * evW * 0.45;
      const drawNuc = (nuc, sideX, yOff, tagged) => {
        nuc.forEach(p => {
          let x = cx + sideX * dx + p.x * S * CONTRACT;
          let y = cy + yOff + p.y * S;
          if (ev.t > 1 && !p.part) {            // spectators keep flying through
            x += -sideX * (Math.min(ev.t, 2.4) - 1) * evW * 0.30;
          }
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = (tagged && p.part && ev.t >= 1) ? css('--series-2') : css('--muted');
          ctx.globalAlpha = (tagged && p.part && ev.t >= 1) ? 0.95 : 0.55;
          ctx.fill(); ctx.globalAlpha = 1;
        });
      };
      drawNuc(ev.nucA, -1, +ev.b / 2 * S, true);
      drawNuc(ev.nucB, +1, -ev.b / 2 * S, true);

      // produced tracks stream out from the overlap after contact
      if (ev.t > 1) {
        const tf = Math.min(ev.t - 1, 1.4);
        ev.tracks.forEach(tr => {
          const r = tr.v * tf * S * 2.4;
          const x = cx + Math.cos(tr.phi) * r, y = cy + Math.sin(tr.phi) * r;
          ctx.strokeStyle = tr.isP ? css('--series-1') : css('--grid');
          ctx.lineWidth = tr.isP ? 2 : 1;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
          if (tr.isP) {
            ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = css('--series-1'); ctx.fill();
          }
        });
      }
    } else {
      ctx.fillStyle = css('--muted'); ctx.textAlign = 'center';
      ctx.fillText('press “Collide” — or “Run 200 events” to build statistics', evW / 2, cy);
    }

    /* histogram panel (right): protons per event */
    const hx = evW + 30, hw = w - hx - 14;
    const hy0 = h - 30, hh = h - 58;
    ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, hy0); ctx.lineTo(hx + hw, hy0); ctx.stroke();
    ctx.fillStyle = css('--muted'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('protons per event', hx, 8);
    const hmax = Math.max(1, ...hist);
    const bw = hw / hist.length;
    ctx.fillStyle = css('--series-1');
    hist.forEach((n, i) => {
      if (!n) return;
      const bh = (n / hmax) * hh;
      ctx.beginPath();
      ctx.roundRect(hx + i * bw + 0.5, hy0 - bh, Math.max(1.5, bw - 1), bh, [3, 3, 0, 0]);
      ctx.fill();
    });
    ctx.fillStyle = css('--muted'); ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    [0, 10, 20, 30, 40].forEach(v => {
      if (v < hist.length) ctx.fillText(String(v), hx + (v + 0.5) * bw, hy0 + 6);
    });
  }

  bEl.addEventListener('input', draw);
  oneBtn.addEventListener('click', () => { batch = 0; launch(); });
  manyBtn.addEventListener('click', () => {
    batch = 200; hist = new Array(50).fill(0); nEvents = 0; sum = 0; sum2 = 0;
    launch();
  });
  register(draw);
})();
