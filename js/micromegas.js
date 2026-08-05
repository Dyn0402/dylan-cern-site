/* Micromegas demo — how a gaseous detector turns one charged particle into a
   position measurement. Cross-section view: a charged track crosses the drift
   gap and leaves primary ionization; the electrons drift down to the
   micromesh, avalanche in the thin amplification gap, and the charge induced
   on the anode strips builds a cluster whose centroid is the measured
   position. Slider sets the track angle; "Fire track" runs one event. */

(() => {
  'use strict';
  const { css, fitCanvas, register, reducedMotion } = window.viz;

  const canvas = document.getElementById('mm-canvas');
  if (!canvas) return;

  const angEl = document.getElementById('mm-angle');
  const angVal = document.getElementById('mm-angle-val');
  const fireBtn = document.getElementById('mm-fire');
  const resOut = document.getElementById('mm-readout');

  const N_STRIPS = 24;

  /* Event state: primaries [{x0,y0 (frac of drift gap), drifted}], strip charges */
  let ev = null;      // null until first fire
  let anim = null;    // requestAnimationFrame id

  function geometry(w, h) {
    // vertical layout fractions of the canvas
    const top = 18, driftH = h * 0.52, ampH = 12, stripH = 10, histH = h - top - driftH - ampH - stripH - 46;
    return {
      xL: 40, xR: w - 16,
      yDriftTop: top,
      yMesh: top + driftH,
      yAnode: top + driftH + ampH,
      yStripBot: top + driftH + ampH + stripH,
      yHistBase: h - 20,
      histH,
    };
  }

  function newEvent() {
    const angle = parseFloat(angEl.value) * Math.PI / 180;
    // Track enters at random x in the middle half, tilted by `angle`.
    const xEntry = 0.3 + Math.random() * 0.4;      // frac of active width at top
    const primaries = [];
    // ~ one primary cluster every 3.5% of gap depth (Poisson-ish spacing)
    for (let f = 0; f < 1; f += 0.02 + Math.random() * 0.045) {
      primaries.push({
        depth: f,                                   // 0 top .. 1 mesh
        x: xEntry + Math.tan(angle) * f * 0.28,     // 0.28: gap depth / width scale
        drift: 0,                                   // drift progress 0..1
        n: 1 + (Math.random() < 0.15 ? Math.round(Math.random() * 3) : 0), // rare big cluster
      });
    }
    return { angle, xEntry, primaries, strips: new Array(N_STRIPS).fill(0), done: false, t: 0 };
  }

  function stripOf(xFrac) {
    return Math.max(0, Math.min(N_STRIPS - 1, Math.floor(xFrac * N_STRIPS)));
  }

  function step() {
    if (!ev || ev.done) return;
    ev.t += 1;
    let allDown = true;
    ev.primaries.forEach(p => {
      if (p.drift < 1) {
        // constant drift velocity; small transverse diffusion as it goes
        p.drift = Math.min(1, p.drift + 0.022);
        p.x += (Math.random() - 0.5) * 0.0035;
        if (p.drift < 1) allDown = false;
        else {
          // reached the mesh: avalanche → gain fluctuations, charge on ~2 strips
          const g = p.n * (0.6 + Math.random());
          const s = stripOf(p.x);
          ev.strips[s] += g * 0.8;
          if (s + 1 < N_STRIPS) ev.strips[s + 1] += g * 0.2;
          p.flash = 8;                              // frames of avalanche flash
        }
      }
      if (p.flash) { p.flash -= 1; if (p.flash > 0) allDown = false; }
    });
    if (allDown) {
      ev.done = true;
      // centroid vs true mid-gap position, in strip pitch units
      const q = ev.strips.reduce((a, b) => a + b, 0);
      const cen = ev.strips.reduce((a, b, i) => a + b * (i + 0.5), 0) / q / N_STRIPS;
      const truth = ev.xEntry + Math.tan(ev.angle) * 0.5 * 0.28;
      ev.residual = (cen - truth) * N_STRIPS;       // strip-pitch units
    }
    draw();
    if (!ev.done) {
      if (!reducedMotion.matches) anim = requestAnimationFrame(step);
    } else if (resOut && ev.residual !== undefined) {
      resOut.innerHTML =
        `cluster centroid − true position = <b>${(ev.residual >= 0 ? '+' : '') +
        ev.residual.toFixed(2)}</b> strip pitches — averaging many tracks is ` +
        `what gets resolution well below one strip`;
    }
  }

  function fire() {
    cancelAnimationFrame(anim);
    ev = newEvent();
    resOut.textContent = '…drifting';
    if (reducedMotion.matches) {
      while (!ev.done) step();      // no animation: run the event to completion
    } else anim = requestAnimationFrame(step);
  }

  function draw() {
    const { ctx, w, h } = fitCanvas(canvas, 0.56);
    const g = geometry(w, h);
    const W = g.xR - g.xL;
    const xpx = f => g.xL + f * W;

    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px system-ui, sans-serif';

    // regions
    ctx.fillStyle = css('--wash-1');                 // drift gap wash
    ctx.fillRect(g.xL, g.yDriftTop, W, g.yMesh - g.yDriftTop);

    // cathode, mesh, anode
    ctx.strokeStyle = css('--axis'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(g.xL, g.yDriftTop); ctx.lineTo(g.xR, g.yDriftTop); ctx.stroke();
    ctx.setLineDash([4, 3]);                         // mesh = dashed line
    ctx.beginPath(); ctx.moveTo(g.xL, g.yMesh); ctx.lineTo(g.xR, g.yMesh); ctx.stroke();
    ctx.setLineDash([]);

    // anode strips
    const pitch = W / N_STRIPS;
    for (let i = 0; i < N_STRIPS; i += 1) {
      ctx.fillStyle = css('--grid');
      ctx.fillRect(g.xL + i * pitch + 1, g.yAnode, pitch - 2, g.yStripBot - g.yAnode);
    }

    // region labels
    ctx.fillStyle = css('--muted'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('cathode', 4, g.yDriftTop + 1);
    ctx.fillText('drift gap · E ≈ 600 V/cm', g.xL + 6, g.yDriftTop + 14);
    ctx.fillText('mesh', 4, g.yMesh);
    ctx.fillText('amplification gap · ~50 kV/cm', g.xL + 6, g.yMesh + (g.yAnode - g.yMesh) / 2 + 1);
    ctx.fillText('strips', 4, (g.yAnode + g.yStripBot) / 2);

    if (ev) {
      // track: entry point to current deepest ionized depth
      const deep = ev.done ? 1 : Math.min(1, ev.t * 0.05);
      ctx.strokeStyle = css('--series-2'); ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(xpx(ev.xEntry), g.yDriftTop);
      const xe = ev.xEntry + Math.tan(ev.angle) * deep * 0.28;
      ctx.lineTo(xpx(xe), g.yDriftTop + deep * (g.yMesh - g.yDriftTop));
      ctx.stroke();

      // primaries drifting down
      ev.primaries.forEach(p => {
        const y0 = g.yDriftTop + p.depth * (g.yMesh - g.yDriftTop);
        const y = y0 + p.drift * (g.yMesh - y0);
        if (p.drift < 1) {
          ctx.beginPath(); ctx.arc(xpx(p.x), y, 2.6, 0, Math.PI * 2);
          ctx.fillStyle = css('--series-1'); ctx.fill();
        } else if (p.flash) {
          // avalanche flash: teardrop in the amplification gap
          const a = p.flash / 8;
          ctx.beginPath();
          ctx.moveTo(xpx(p.x), g.yMesh);
          ctx.lineTo(xpx(p.x) - 5 * a, g.yAnode);
          ctx.lineTo(xpx(p.x) + 5 * a, g.yAnode);
          ctx.closePath();
          ctx.globalAlpha = 0.35 + 0.5 * a;
          ctx.fillStyle = css('--series-2'); ctx.fill();
          ctx.globalAlpha = 1;
        }
      });

      // charge histogram under the strips (single series — no legend needed)
      const qmax = Math.max(4, ...ev.strips);
      ctx.fillStyle = css('--series-1');
      ev.strips.forEach((q, i) => {
        if (q <= 0) return;
        const bh = (q / qmax) * g.histH;
        const x = g.xL + i * pitch + 2, bw = pitch - 4;
        const y = g.yHistBase - bh;
        ctx.beginPath();                              // 4px rounded data-end, square base
        ctx.roundRect(x, y, bw, bh, [4, 4, 0, 0]);
        ctx.fill();
      });
      ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(g.xL, g.yHistBase); ctx.lineTo(g.xR, g.yHistBase); ctx.stroke();
      ctx.fillStyle = css('--muted'); ctx.textAlign = 'left';
      ctx.fillText('charge per strip', g.xL, g.yHistBase + 10);

      // centroid marker once done
      if (ev.done) {
        const q = ev.strips.reduce((a, b) => a + b, 0);
        if (q > 0) {
          const cen = ev.strips.reduce((a, b, i) => a + b * (i + 0.5), 0) / q / N_STRIPS;
          ctx.strokeStyle = css('--series-3'); ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(xpx(cen), g.yHistBase + 2); ctx.lineTo(xpx(cen), g.yHistBase - g.histH - 4);
          ctx.stroke();
          ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText('centroid', xpx(cen), g.yHistBase - g.histH - 8);
        }
      }
    } else {
      ctx.fillStyle = css('--muted'); ctx.textAlign = 'center';
      ctx.fillText('press “Fire track”', w / 2, (g.yDriftTop + g.yMesh) / 2 + 16);
    }
  }

  angEl.addEventListener('input', () => {
    angVal.textContent = angEl.value + '°';
  });
  fireBtn.addEventListener('click', fire);
  register(draw);
})();
