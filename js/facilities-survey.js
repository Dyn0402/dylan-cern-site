/* Neutron-facility dashboard (facilities/neutron-facilities.html).
   Data: data/facilities-survey.json, written by x17_facility_search/survey/dashboard.py;
   map: data/world-map.json, pre-projected (Equal Earth) by survey/dashboard_map.py. The
   projection below must stay the same formula as that script's. Three views share one
   filter state and one detail renderer: the map (site markers + side panel), the beams
   table (rows expand in place) and the ranking (raw production beside the model reach). */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const SVGNS = 'http://www.w3.org/2000/svg';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---- verdict groups: five identities, fixed order, never cycled ------------------------
  const GROUPS = [
    { id: 'potential', label: 'Potential', css: 'var(--v-potential)', v: ['POTENTIAL'] },
    { id: 'studied', label: 'Studied', css: 'var(--v-studied)', v: ['STUDIED'] },
    { id: 'marginal', label: 'Marginal', css: 'var(--v-marginal)', v: ['MARGINAL'] },
    { id: 'watch', label: 'Watch (not running yet)', css: 'var(--v-watch)', v: ['WATCH'] },
    { id: 'out', label: 'Eliminated', css: 'var(--v-out)', v: ['DOMINATED', 'DUTY', 'WINDOW', 'TARGET', 'ACCESS'] },
  ];
  const groupOf = v => GROUPS.find(g => g.v.includes(v)) || GROUPS[4];
  const RANK = Object.fromEntries(GROUPS.map((g, i) => [g.id, i]));
  const WHY = {
    DOMINATED: 'same class as a studied facility, and below it',
    DUTY: 'pulsed white source: throttled by its per-pulse load',
    WINDOW: 'neutrons only far above the ATOMKI-like window',
    TARGET: 'the flux needs the cell at the production target, which makes the same pairs',
    ACCESS: 'closed, no extracted beam, or not open to a CERN collaboration',
  };

  const TIPS = {
    ast: '<div class="tt">The quickest metric we can make</div>X17 produced per day if the facility\'s full beam ' +
      'hits the n_TOF 500 bar ³He capsule (Ø2 cm × 8 cm), with X17/IPC = 1.5×10⁻³ (ATOMKI ⁴He) at every ' +
      'neutron energy, and <b>every X17 counted</b>: no acceptance, trigger, background, dead time or rate ' +
      'limit. It ranks raw production only. The 50-day reach is the real figure of merit.',
    reach: '<div class="tt">50-day reach (model)</div>X17/IPC at 3σ in 50 days with big plastics and the best beam ' +
      'throttle, from the survey\'s scaled models (ILL rate walls for cold/thermal, re-weighted GANIL/NFS ' +
      'Geant4 for fast beams). E* ≤ 22 MeV signal. A range spans the soft-neutron singles bracket. ' +
      '<b>Smaller is better</b>; ATOMKI\'s ⁴He value is 1.5×10⁻³.',
  };

  // ---- formatting ---------------------------------------------------------------------------
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  function sci(v, d = 2) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(v)));
    if (e >= -2 && e <= 3) return num(v);
    const m = (v / 10 ** e).toPrecision(d);
    const ms = m === '1' || m === '1.0' ? '' : m + '×';
    return ms + '10' + String(e).split('').map(c => SUP[c]).join('');
  }
  function num(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 100) return Math.round(Number(v.toPrecision(2))).toLocaleString('en-US').replace(/,/g, ' ');
    if (v >= 0.01) return String(Number(v.toPrecision(2)));
    return sci(v);
  }
  const pct = v => v == null ? '—' : (v >= 0.995 ? '100 %' : v < 0.005 ? (v > 0 ? '< 1 %' : '0 %') : Math.round(v * 100) + ' %');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const x17txt = f => f.x17 == null ? '—' : (f.bound ? f.bound.op + ' ' : '') + num(f.x17);
  const estTag = f => f.est ? ' <span class="nf-est" title="' + esc(f.est) + '">est.</span>' : '';
  const shortName = n => n.replace(/ \([^()]*\)$/, '');
  const operating = f => /operating|restarted|commercial/i.test(f.status) && !/off since|shut down|^closed|construction/i.test(f.status);
  const best = f => (f.reach && f.reach[0]) || null;
  const pips = n => '<span class="nf-effort" aria-label="explored ' + n + ' of 4">' +
    [1, 2, 3, 4].map(i => '<i class="' + (i <= n ? 'on' : '') + '"></i>').join('') + '</span>';
  function reachTxt(r) {
    if (!r) return '—';
    const lo = Math.min(r.soft, r.soft_flat ?? r.soft), hi = Math.max(r.soft, r.soft_flat ?? r.soft);
    return hi / lo > 1.15 ? sci(lo) + ' – ' + sci(hi) : sci(r.soft);
  }

  // ---- state -----------------------------------------------------------------------------------
  let DATA, MAP, FAC = [], BYKEY = {}, SITES = [];
  const S = { view: 'map', q: '', cls: '', op: false, groups: new Set(GROUPS.map(g => g.id)),
              sel: null, site: null, sort: { k: 'x17', dir: -1 }, open: null };

  function passes(f) {
    if (!S.groups.has(groupOf(f.verdict).id)) return false;
    if (S.cls && f.cls !== S.cls) return false;
    if (S.op && !operating(f)) return false;
    if (S.q) {
      const hay = [f.name, f.site, f.kind, f.beam, f.cls_label, f.verdict, f.status, f.reason,
                   f.sites.map(s => s.name).join(' ')].join(' ').toLowerCase();
      if (!S.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }

  // ---- tooltip ---------------------------------------------------------------------------------
  const tip = $('#nf-tip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    let tx = x + 14, ty = y + 16;
    if (tx + tw > W - 8) tx = Math.max(8, x - tw - 14);
    if (ty + th > H - 8) ty = Math.max(8, y - th - 12);
    tip.style.left = tx + 'px';
    tip.style.top = ty + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  document.addEventListener('mouseover', e => {
    const b = e.target.closest('.nf-ast');
    if (b) showTip(TIPS[b.dataset.tip], e.clientX, e.clientY);
  });
  document.addEventListener('mouseout', e => { if (e.target.closest('.nf-ast')) hideTip(); });
  document.addEventListener('focusin', e => {
    const b = e.target.closest('.nf-ast');
    if (b) { const r = b.getBoundingClientRect(); showTip(TIPS[b.dataset.tip], r.right, r.bottom); }
  });
  document.addEventListener('focusout', e => { if (e.target.closest('.nf-ast')) hideTip(); });
  document.addEventListener('click', e => {
    const b = e.target.closest('.nf-ast');
    if (b) { e.stopPropagation(); e.preventDefault(); const r = b.getBoundingClientRect(); showTip(TIPS[b.dataset.tip], r.right, r.bottom); }
    else if (!e.target.closest('#nf-map, #nf-rank')) hideTip();
  }, true);
  window.addEventListener('scroll', hideTip, { passive: true });

  // ---- detail (shared by panel and table) ------------------------------------------------------
  function detailHTML(f) {
    const g = groupOf(f.verdict), r = best(f);
    let hero;
    if (f.x17 == null) {
      hero = '<div class="nf-hero"><span class="big">—</span><span class="u">X17 / day<button class="nf-ast" data-tip="ast">*</button></span></div>' +
        '<p class="nf-sub">No beam number to compute it from.</p>';
    } else if (f.bound) {
      hero = '<div class="nf-hero"><span class="big">' + esc(x17txt(f)) + '</span><span class="u">X17 / day<button class="nf-ast" data-tip="ast">*</button></span></div>' +
        '<p class="nf-sub">No number of its own: ' + (f.bound.op === '≲' ? 'at most' : 'about') + ' ' +
        '<a href="#" data-goto="' + esc(f.bound.ref) + '">' + esc(f.bound.ref_name) + '</a>' +
        (f.win != null ? ' · in the ATOMKI window: ' + pct(f.win) : '') + '</p>';
    } else {
      hero = '<div class="nf-hero"><span class="big">' + esc(num(f.x17)) + '</span><span class="u">X17 / day<button class="nf-ast" data-tip="ast">*</button>' + estTag(f) + '</span></div>' +
        (f.est ? '<p class="nf-sub">Rests on an estimate: ' + esc(f.est) + '</p>' : '') +
        '<p class="nf-sub">in the ATOMKI window (E_n ≤ 2.75 MeV): ' + pct(f.win) + ' · IPC pairs/day ' + sci(f.ipc_day) +
        ' · ' + sci(f.n_cap) + ' n/s on the capsule</p>' +
        (f.scen || []).map(s => '<p class="nf-scen">Also: ' + esc(s.label) + ' → ' + num(s.x17) + ' X17/day*</p>').join('');
    }
    const kv = [
      ['Beam', f.beam], ['Source', f.kind], f.spectrum_label ? ['Spectrum used', f.spectrum_label] : null,
      ['Flux', f.geom || f.number], ['Status', f.status],
      ['50-day reach', r ? reachTxt(r) + ' <span class="nf-src">(ATOMKI 1.5×10⁻³)</span>' : '— <span class="nf-src">(not modelled)</span>'],
    ].filter(Boolean);
    const sites = f.sites.length > 1 ? '<p class="nf-src">Sites: ' + f.sites.map(s => esc(s.name)).join(', ') + '</p>' : '';
    return '<div class="nf-d">' +
      '<span class="nf-vchip"><span class="nf-dot" style="background:' + g.css + '"></span>' + esc(f.verdict) + '</span>' +
      '<h3>' + esc(f.name) + '</h3><p class="where">' + esc(f.site) + ' · ' + esc(f.cls_label) + '</p>' + hero +
      '<dl class="nf-kv">' + kv.map(([k, v]) => '<dt>' + k + '</dt><dd>' + (k === '50-day reach' ? v : esc(v)) + '</dd>').join('') + '</dl>' +
      '<h4>Verdict</h4><p>' + esc(f.reason) + (WHY[f.verdict] ? ' <span class="nf-src">(' + f.verdict.toLowerCase() + ': ' + WHY[f.verdict] + ')</span>' : '') + '</p>' +
      '<h4>Explored</h4><p>' + pips(f.effort) + ' &nbsp;' + esc(f.effort_label) + '</p>' +
      (f.effort_note ? '<p>' + esc(f.effort_note) + '</p>' : '') +
      (f.next ? '<h4>Next</h4><p>' + esc(f.next) + '</p>' : '') +
      '<p class="nf-src">Contact: ' + esc(f.contact) + '</p>' +
      (f.links.length ? '<h4>Our studies</h4><ul class="links">' + f.links.map(l => '<li><a href="' + esc(l.href) + '">' + esc(l.t) + ' →</a></li>').join('') + '</ul>' : '') +
      '<h4>Sources</h4><p class="nf-src">' + esc(f.source) + '</p>' + sites +
      '<p class="nf-src">Updated ' + esc(f.updated) + '</p></div>';
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    select(a.dataset.goto, true);
  });

  // ---- map ---------------------------------------------------------------------------------------
  const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
  function project(lon, lat) {                      // same as survey/dashboard_map.py
    const lam = lon * Math.PI / 180, th = Math.asin(M * Math.sin(lat * Math.PI / 180));
    const t2 = th * th, t6 = t2 * t2 * t2;
    return [lam * Math.cos(th) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))),
            -th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))];
  }
  // world: the span of the sites (Patagonia to Finland, California to Japan), not the whole globe;
  // the map is 4:3, so the full Equal Earth frame would leave sea bands above and below
  const REGIONS = { world: [-128, -48, 155, 72], europe: [-11, 35, 30, 61], namerica: [-125, 24, -66, 50], asia: [98, 18, 146, 46] };
  const svg = $('#nf-map');
  let VB, gLand, gMk, gLbl;

  function aspect() { const r = svg.getBoundingClientRect(); return r.width && r.height ? r.width / r.height : 2; }
  function pxPerUnit() { return svg.getBoundingClientRect().width / VB[2]; }
  function setVB(v) { VB = v; svg.setAttribute('viewBox', v.map(x => x.toFixed(4)).join(' ')); drawMarkers(); }
  function fitBox(x0, y0, x1, y1, pad = 0.06) {
    let w = (x1 - x0) * (1 + pad), h = (y1 - y0) * (1 + pad);
    const a = aspect();
    if (w / h > a) h = w / a; else w = h * a;
    return [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h];
  }
  function regionBox(id) {
    const b = MAP.bounds;
    if (!REGIONS[id]) return fitBox(b[0], b[1], b[2], b[3], 0.02);
    const [lo0, la0, lo1, la1] = REGIONS[id], xs = [], ys = [];
    for (let i = 0; i <= 8; i++) for (const la of [la0, la1, la0 + (la1 - la0) * i / 8]) {
      for (const lo of [lo0, lo1, lo0 + (lo1 - lo0) * i / 8]) { const p = project(lo, la); xs.push(p[0]); ys.push(p[1]); }
    }
    return fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  }
  function animateTo(target) {
    $$('.nf-mapctl [data-region]').forEach(b => b.classList.remove('on'));
    if (reduced.matches || !VB) return setVB(target);
    const from = VB.slice(), t0 = performance.now(), D = 450;
    const step = now => {
      const t = Math.min(1, (now - t0) / D), k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      setVB(from.map((v, i) => v + (target[i] - v) * k));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function refit() {                                 // the box changed shape: redo the region shown, else keep centre and width
    const on = $('.nf-mapctl [data-region].on');
    if (on) return setVB(regionBox(on.dataset.region));
    const a = aspect(), h = VB[2] / a; setVB([VB[0], VB[1] + (VB[3] - h) / 2, VB[2], h]);
  }
  function zoomAt(f, cx, cy, instant) {
    const [x, y, w, h] = VB, b = MAP.bounds;
    const nw = Math.min(Math.max(w / f, 0.12), (b[2] - b[0]) * 1.05), nh = nw * h / w;
    if (cx == null) { cx = x + w / 2; cy = y + h / 2; }
    const v = [cx - (cx - x) * nw / w, cy - (cy - y) * nh / h, nw, nh];
    if (instant) { $$('.nf-mapctl [data-region]').forEach(b => b.classList.remove('on')); setVB(v); } else animateTo(v);
  }

  function buildMap() {
    svg.innerHTML = '';
    const el = (tag, attrs, parent) => {
      const n = document.createElementNS(SVGNS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      (parent || svg).appendChild(n);
      return n;
    };
    const b = MAP.bounds;
    el('rect', { class: 'sea', x: b[0] - 5, y: b[1] - 5, width: b[2] - b[0] + 10, height: b[3] - b[1] + 10 });
    let grat = '';
    for (let lo = -180; lo <= 180; lo += 30) {
      const pts = []; for (let la = -60; la <= 84; la += 4) pts.push(project(lo, la));
      grat += 'M' + pts.map(p => p[0].toFixed(3) + ' ' + p[1].toFixed(3)).join('L');
    }
    for (let la = -60; la <= 80; la += 30) {
      const pts = []; for (let lo = -180; lo <= 180; lo += 5) pts.push(project(lo, la));
      grat += 'M' + pts.map(p => p[0].toFixed(3) + ' ' + p[1].toFixed(3)).join('L');
    }
    el('path', { class: 'grat', d: grat });
    gLand = el('g', {});
    el('path', { class: 'land', d: MAP.land }, gLand);
    el('path', { class: 'border', d: MAP.borders }, gLand);
    gMk = el('g', {});
    gLbl = el('g', {});
    setVB(regionBox('world'));
    $('.nf-mapctl [data-region="world"]').classList.add('on');
  }

  function buildSites() {
    const m = new Map();
    for (const f of FAC) for (const s of f.sites) {
      const k = s.lat.toFixed(2) + ',' + s.lon.toFixed(2);
      if (!m.has(k)) m.set(k, { id: k, name: s.name, lat: s.lat, lon: s.lon, xy: project(s.lon, s.lat), fac: [] });
      const site = m.get(k);
      if (!site.fac.includes(f)) site.fac.push(f);
    }
    SITES = Array.from(m.values());
    for (const s of SITES) s.fac.sort(facOrder);
  }
  function facOrder(a, b) {
    return RANK[groupOf(a.verdict).id] - RANK[groupOf(b.verdict).id] || (b.x17 ?? -1) - (a.x17 ?? -1);
  }
  const radiusPx = x => (x == null ? 4 : 4 + 2.1 * Math.min(5.2, Math.max(0, Math.log10(x) + 1))) *
    Math.max(0.6, Math.min(1, svg.getBoundingClientRect().width / 800));

  function drawMarkers() {
    if (!gMk || !SITES.length) return;
    const k = 1 / pxPerUnit();
    gMk.innerHTML = ''; gLbl.innerHTML = '';
    const order = SITES.slice().sort((a, b) => {
      const fa = a.fac.filter(passes), fb = b.fac.filter(passes);
      return (fb.length ? 0 : 1) - (fa.length ? 0 : 1) || (maxX(b.fac) - maxX(a.fac));
    }).reverse();                                    // big and visible last = on top
    const placed = [];
    const labelled = [];
    for (const s of order) {
      const vis = s.fac.filter(passes);
      const lead = (vis.length ? vis : s.fac)[0];
      const g = groupOf(lead.verdict);
      const rpx = radiusPx(Math.max(...(vis.length ? vis : s.fac).map(f => f.bound ? 0 : f.x17 ?? 0)) || null);
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', s.xy[0]); c.setAttribute('cy', s.xy[1]); c.setAttribute('r', rpx * k);
      c.setAttribute('class', 'mk' + (vis.length ? '' : ' dim') + (S.site === s.id ? ' sel' : ''));
      c.style.fill = g.css;
      c.setAttribute('tabindex', vis.length ? '0' : '-1');
      c.setAttribute('role', 'button');
      c.setAttribute('aria-label', s.name + ': ' + s.fac.map(f => f.name).join(', '));
      c.dataset.site = s.id;
      gMk.appendChild(c);
      if (vis.length) labelled.push({ s, lead, rpx });
    }
    // labels: greedy, most important first, skip any that would collide
    labelled.sort((a, b) => (b.s.id === S.site) - (a.s.id === S.site) || RANK[groupOf(a.lead.verdict).id] - RANK[groupOf(b.lead.verdict).id] || b.rpx - a.rpx);
    const zoomed = (MAP.bounds[2] - MAP.bounds[0]) / VB[2];
    const maxLabels = zoomed > 2.5 ? 40 : 12;
    const ppu = pxPerUnit();
    for (const { s, lead, rpx } of labelled) {
      if (placed.length >= maxLabels) break;
      if (zoomed < 2.5 && RANK[groupOf(lead.verdict).id] > 1 && s.id !== S.site) continue;
      const px = (s.xy[0] - VB[0]) * ppu, py = (s.xy[1] - VB[1]) * ppu;
      const text = s.name, w = text.length * 6.6 + 4, h = 14;
      const box = [px + rpx + 3, py - h / 2, px + rpx + 3 + w, py + h / 2];
      if (box[2] > VB[2] * ppu - 4) { box[0] = px - rpx - 3 - w; box[2] = px - rpx - 3; }
      if (placed.some(p => !(box[2] < p[0] || box[0] > p[2] || box[3] < p[1] || box[1] > p[3]))) continue;
      placed.push(box);
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', VB[0] + box[0] / ppu); t.setAttribute('y', s.xy[1] + 4 * k);
      t.setAttribute('class', 'lbl'); t.setAttribute('font-size', 11.5 * k);
      t.style.strokeWidth = 3 * k;
      t.textContent = text;
      gLbl.appendChild(t);
    }
  }
  const maxX = fac => Math.max(...fac.map(f => f.bound ? 0 : f.x17 ?? 0));

  function siteTip(s) {
    return '<div class="tt">' + esc(s.name) + '</div>' + s.fac.map(f =>
      '<div><span class="nf-dot" style="background:' + groupOf(f.verdict).css + ';width:8px;height:8px;margin-right:6px"></span>' +
      esc(f.name) + ' · <b>' + esc(x17txt(f)) + '</b> X17/day*' + (passes(f) ? '' : ' <span class="nf-src">(filtered)</span>') + '</div>').join('');
  }

  function wireMap() {
    let drag = null, moved = false;
    svg.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY, vb: VB.slice() }; moved = false;
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { moved = true; svg.classList.add('drag'); hideTip(); }
        if (moved) {
          const k = drag.vb[2] / svg.getBoundingClientRect().width;
          setVB([drag.vb[0] - dx * k, drag.vb[1] - dy * k, drag.vb[2], drag.vb[3]]);
          $$('.nf-mapctl [data-region]').forEach(b => b.classList.remove('on'));
        }
        return;
      }
      const c = e.target.closest('.mk');
      if (c) showTip(siteTip(SITES.find(s => s.id === c.dataset.site)), e.clientX, e.clientY); else hideTip();
    });
    svg.addEventListener('pointerup', e => {
      svg.classList.remove('drag');
      const wasDrag = moved; drag = null;
      if (wasDrag) return;
      const c = document.elementFromPoint(e.clientX, e.clientY);
      const mk = c && c.closest && c.closest('.mk');
      if (mk) openSite(mk.dataset.site);
    });
    svg.addEventListener('pointerleave', () => { if (!drag) hideTip(); });
    svg.addEventListener('keydown', e => {
      const mk = e.target.closest && e.target.closest('.mk');
      if (mk && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSite(mk.dataset.site); }
    });
    svg.addEventListener('dblclick', e => {
      const r = svg.getBoundingClientRect();
      zoomAt(2, VB[0] + (e.clientX - r.left) / r.width * VB[2], VB[1] + (e.clientY - r.top) / r.height * VB[3]);
    });
    svg.addEventListener('wheel', e => {             // scroll over the map zooms it, about the cursor
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.004),
             VB[0] + (e.clientX - r.left) / r.width * VB[2], VB[1] + (e.clientY - r.top) / r.height * VB[3], true);
    }, { passive: false });
    $$('.nf-mapctl [data-region]').forEach(b => b.addEventListener('click', () => {
      animateTo(regionBox(b.dataset.region));
      setTimeout(() => b.classList.add('on'), 0);
    }));
    $$('.nf-mapctl [data-zoom]').forEach(b => b.addEventListener('click', () => zoomAt(Number(b.dataset.zoom))));
    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (!VB) return; refit(); drawRanking(); }, 120);
    });
  }

  function openSite(id, keyWanted) {
    const s = SITES.find(x => x.id === id);
    if (!s) return;
    S.site = id;
    const vis = s.fac.filter(passes);
    const list = vis.length ? vis : s.fac;
    const f = (keyWanted && list.find(x => x.key === keyWanted)) || list[0];
    S.sel = f.key;
    renderPanel(s, list, f);
    drawMarkers();
    writeHash();
  }
  function renderPanel(s, list, f) {
    const p = $('#nf-panel');
    let h = '<p class="nf-sitehead">' + esc(s.name) + (list.length > 1 ? ' · ' + list.length + ' beams' : '') + '</p>';
    if (list.length > 1) {
      h += '<ul class="nf-pick">' + list.map(x =>
        '<li><button data-pick="' + esc(x.key) + '" class="' + (x === f ? 'on' : '') + '">' +
        '<span class="nf-dot" style="background:' + groupOf(x.verdict).css + '"></span>' + esc(x.name) +
        '<span class="x">' + esc(x17txt(x)) + '</span></button></li>').join('') + '</ul>';
    }
    p.innerHTML = h + detailHTML(f);
    p.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => openSite(s.id, b.dataset.pick)));
  }

  // ---- table -----------------------------------------------------------------------------------
  const SORTERS = {
    name: f => f.name.toLowerCase(), cls: f => f.cls_label, verdict: f => RANK[groupOf(f.verdict).id] * 100 + f.verdict.charCodeAt(0) / 100,
    x17: f => f.x17 ?? -1, win: f => f.win ?? -1, reach: f => best(f) ? best(f).soft : Infinity, effort: f => f.effort,
  };
  function drawTable() {
    const tb = $('#nf-table tbody');
    const { k, dir } = S.sort, key = SORTERS[k];
    const rows = FAC.filter(passes).sort((a, b) => {
      const va = key(a), vb = key(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir || (b.x17 ?? -1) - (a.x17 ?? -1);
    });
    $$('#nf-table th').forEach(th => th.removeAttribute('aria-sort'));
    const th = $('#nf-table th[data-sort="' + k + '"]');
    if (th) th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
    const lmax = Math.log10(Math.max(...FAC.map(f => f.x17 ?? 0)) * 1.2), lmin = -1;
    tb.innerHTML = rows.map(f => {
      const g = groupOf(f.verdict);
      const w = f.x17 == null ? 0 : Math.max(0.03, (Math.log10(f.x17) - lmin) / (lmax - lmin));
      const bar = '<span class="track"><span class="fill" style="width:' + (w * 100).toFixed(1) + '%;background:' +
        (f.bound ? 'var(--axis)' : g.css) + '"></span></span>';
      const open = S.open === f.key;
      return '<tr class="row' + (open ? ' open' : '') + '" data-key="' + esc(f.key) + '" tabindex="0" aria-expanded="' + open + '">' +
        '<td><span class="fname">' + esc(f.name) + '</span><span class="fsite">' + esc(f.site) + '</span></td>' +
        '<td>' + esc(f.cls_label) + '<span class="fbeam">' + esc(f.beam) + '</span></td>' +
        '<td><span class="nf-vchip"><span class="nf-dot" style="background:' + g.css + '"></span>' + esc(f.verdict) + '</span></td>' +
        '<td class="num"><span class="nf-xbar"><span class="' + (f.bound ? 'nf-bound' : '') + '">' + esc(x17txt(f)) + estTag(f) + '</span>' + bar + '</span></td>' +
        '<td class="num">' + pct(f.win) + '</td>' +
        '<td class="num">' + reachTxt(best(f)) + '</td>' +
        '<td>' + pips(f.effort) + '</td></tr>' +
        (open ? '<tr class="drow"><td class="detail" colspan="7">' + detailHTML(f) + '</td></tr>' : '');
    }).join('') || '<tr><td colspan="7" class="nf-src" style="padding:18px">No facility matches the filters.</td></tr>';
  }
  function wireTable() {
    $$('#nf-table th[data-sort]').forEach(th => th.addEventListener('click', e => {
      if (e.target.closest('.nf-ast')) return;
      const k = th.dataset.sort;
      S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (k === 'name' || k === 'cls' || k === 'verdict' || k === 'reach' ? 1 : -1) };
      drawTable();
    }));
    const toggle = tr => { S.open = S.open === tr.dataset.key ? null : tr.dataset.key; S.sel = S.open || S.sel; drawTable(); writeHash(); };
    $('#nf-table tbody').addEventListener('click', e => {
      const tr = e.target.closest('tr.row');
      if (tr && !e.target.closest('a, .nf-ast')) toggle(tr);
    });
    $('#nf-table tbody').addEventListener('keydown', e => {
      const tr = e.target.closest('tr.row');
      if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(tr); }
    });
  }

  // ---- ranking ---------------------------------------------------------------------------------
  function drawRanking() {
    const box = $('#nf-rank');
    if (!box || box.closest('[hidden]')) return;
    const rows = FAC.filter(f => passes(f) && f.x17 != null).sort((a, b) => b.x17 - a.x17);
    const W = box.clientWidth - 16;
    const narrow = W < 680;
    const LW = narrow ? 150 : 250, gap = 40, rowH = 22, top = 46, bottom = 30;
    const pw = narrow ? W - LW - 50 : (W - LW - gap - 60) * 0.55;
    const pw2 = narrow ? 0 : W - LW - gap - pw - 20;
    const H = top + rows.length * rowH + bottom;
    if (!rows.length) { box.innerHTML = '<p class="nf-src" style="padding:12px">No facility matches the filters.</p>'; return; }
    const xmax = Math.ceil(Math.log10(Math.max(...rows.map(f => f.x17)))), xmin = Math.min(-1, Math.floor(Math.log10(Math.min(...rows.map(f => f.x17)))));
    const X = v => LW + (Math.log10(v) - xmin) / (xmax - xmin) * pw;
    const r0 = -4, r1 = 0, X2 = v => LW + pw + gap + (Math.log10(Math.min(Math.max(v, 10 ** r0), 1)) - r0) / (r1 - r0) * pw2;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Ranking of facilities by X17 per day and 50-day reach">';
    s += '<g class="axis">';
    for (let e = xmin; e <= xmax; e++) {
      s += '<line x1="' + X(10 ** e) + '" x2="' + X(10 ** e) + '" y1="' + (top - 6) + '" y2="' + (H - bottom + 4) + '"/>' +
        '<text x="' + X(10 ** e) + '" y="' + (H - bottom + 18) + '" text-anchor="middle">' + num(10 ** e) + '</text>';
    }
    s += '<text x="' + LW + '" y="16" style="fill:var(--ink);font-weight:600;font-size:12.5px">X17 produced per day*</text>';
    if (!narrow) {
      for (let e = r0; e <= r1; e++) {
        s += '<line x1="' + X2(10 ** e) + '" x2="' + X2(10 ** e) + '" y1="' + (top - 6) + '" y2="' + (H - bottom + 4) + '"/>' +
          '<text x="' + X2(10 ** e) + '" y="' + (H - bottom + 18) + '" text-anchor="middle">' + sci(10 ** e, 1).replace(/^1$/, '1') + '</text>';
      }
      s += '<text x="' + (LW + pw + gap) + '" y="16" style="fill:var(--ink);font-weight:600;font-size:12.5px">50-day reach, X17/IPC at 3σ</text>' +
        '<text x="' + (LW + pw + gap + pw2) + '" y="16" text-anchor="end">← better</text>';
    }
    s += '</g>';
    if (!narrow) s += '<line class="ref" x1="' + X2(1.5e-3) + '" x2="' + X2(1.5e-3) + '" y1="' + (top - 8) + '" y2="' + (H - bottom + 4) + '"/>' +
      '<text x="' + (X2(1.5e-3) + 4) + '" y="' + (top - 12) + '" style="font-size:11px;fill:var(--ink-2)">ATOMKI ⁴He</text>';
    rows.forEach((f, i) => {
      const y = top + i * rowH + rowH / 2, g = groupOf(f.verdict), r = best(f);
      const sn = shortName(f.name), name = sn.length > (narrow ? 20 : 36) ? sn.slice(0, narrow ? 19 : 35) + '…' : sn;
      s += '<rect class="rowhit" data-key="' + esc(f.key) + '" x="0" y="' + (y - rowH / 2) + '" width="' + W + '" height="' + rowH + '" rx="4"/>';
      s += '<text x="' + (LW - 10) + '" y="' + (y + 4) + '" text-anchor="end" style="pointer-events:none">' + esc(name) + '</text>';
      const x0 = X(10 ** xmin), x1 = X(f.x17);
      if (f.bound) {
        s += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + y + '" y2="' + y + '" style="stroke:var(--axis);stroke-width:2;stroke-dasharray:2 3;pointer-events:none"/>' +
          '<circle cx="' + x1 + '" cy="' + y + '" r="4" style="fill:var(--surface);stroke:' + g.css + ';stroke-width:2;pointer-events:none"/>';
      } else {
        s += '<rect x="' + x0 + '" y="' + (y - 4) + '" width="' + Math.max(2, x1 - x0) + '" height="8" rx="4" style="fill:' + g.css + ';pointer-events:none"/>';
      }
      s += '<text x="' + (x1 + 8) + '" y="' + (y + 4) + '" style="pointer-events:none;font-variant-numeric:tabular-nums">' + esc(x17txt(f)) + (f.est ? ' est.' : '') + '</text>';
      if (!narrow && r) {
        const lo = Math.min(r.soft, r.soft_flat ?? r.soft), hi = Math.max(r.soft, r.soft_flat ?? r.soft);
        s += '<line x1="' + X2(lo) + '" x2="' + X2(hi) + '" y1="' + y + '" y2="' + y + '" style="stroke:' + g.css + ';stroke-width:2;stroke-linecap:round;opacity:0.55;pointer-events:none"/>' +
          '<circle cx="' + X2(r.soft) + '" cy="' + y + '" r="4.5" style="fill:' + g.css + ';stroke:var(--surface);stroke-width:2;pointer-events:none"/>';
      }
    });
    s += '</svg>';
    box.innerHTML = s;
  }
  function wireRanking() {
    const box = $('#nf-rank');
    box.addEventListener('mousemove', e => {
      const r = e.target.closest('.rowhit');
      if (!r) return hideTip();
      const f = BYKEY[r.dataset.key];
      showTip('<div class="tt">' + esc(f.name) + '</div>' + esc(f.verdict) + ' · ' + esc(f.cls_label) +
        '<br><b>' + esc(x17txt(f)) + '</b> X17/day* · window ' + pct(f.win) +
        '<br>50-day reach: <b>' + reachTxt(best(f)) + '</b><br><span class="nf-src">click for the details</span>', e.clientX, e.clientY);
    });
    box.addEventListener('mouseleave', hideTip);
    box.addEventListener('click', e => {
      const r = e.target.closest('.rowhit');
      if (r) select(r.dataset.key, true);
    });
  }

  // ---- views, filters, hash -------------------------------------------------------------------
  function setView(v) {
    S.view = v;
    $$('.nf-tabs [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    ['map', 'beams', 'ranking'].forEach(k => { $('#nf-view-' + k).hidden = k !== v; });
    hideTip();
    if (v === 'map') refit();
    if (v === 'beams') drawTable();
    if (v === 'ranking') drawRanking();
    writeHash();
  }
  // Show one facility: on the map its site panel; otherwise the table with its row open.
  function select(key, toTable) {
    const f = BYKEY[key];
    if (!f) return;
    S.sel = key;
    if (toTable || S.view !== 'map') {
      S.open = key;
      if (!passes(f)) resetFilters();
      setView('beams');
      const tr = document.querySelector('#nf-table tr.row[data-key="' + key + '"]');
      if (tr) tr.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' });
    } else {
      const site = SITES.find(s => s.fac.includes(f));
      openSite(site.id, key);
    }
  }
  function resetFilters() {
    S.q = ''; S.cls = ''; S.op = false; S.groups = new Set(GROUPS.map(g => g.id));
    $('#nf-q').value = ''; $('#nf-cls').value = ''; $('#nf-op').checked = false;
    drawLegend();
  }
  function refresh() {
    drawLegend();
    drawMarkers();
    if (S.view === 'beams') drawTable();
    if (S.view === 'ranking') drawRanking();
  }
  function drawLegend() {
    const L = $('#nf-legend');
    L.innerHTML = GROUPS.map(g => {
      const n = FAC.filter(f => groupOf(f.verdict) === g).length;
      return '<button data-g="' + g.id + '" aria-pressed="' + S.groups.has(g.id) + '"><span class="nf-dot" style="background:' + g.css + '"></span>' +
        g.label + ' <span class="n">' + n + '</span></button>';
    }).join('');
  }
  function wireFilters() {
    $('#nf-legend').addEventListener('click', e => {
      const b = e.target.closest('[data-g]');
      if (!b) return;
      const id = b.dataset.g;
      if (S.groups.has(id)) S.groups.delete(id); else S.groups.add(id);
      refresh();
    });
    $('#nf-q').addEventListener('input', e => { S.q = e.target.value.trim(); refresh(); });
    $('#nf-cls').addEventListener('change', e => { S.cls = e.target.value; refresh(); });
    $('#nf-op').addEventListener('change', e => { S.op = e.target.checked; refresh(); });
    $$('.nf-tabs [data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
    window.addEventListener('hashchange', readHash);
  }
  function writeHash() {
    const h = '#' + S.view + (S.view === 'map' && S.sel ? '/' + S.sel : S.view === 'beams' && S.open ? '/' + S.open : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    const [v, key] = location.hash.slice(1).split('/');
    if (['map', 'beams', 'ranking'].includes(v) && v !== S.view) setView(v);
    if (key && BYKEY[key]) { if (S.view === 'map') select(key); else if (S.view === 'beams') { S.open = key; drawTable(); } }
  }

  // ---- static parts ---------------------------------------------------------------------------
  function fillStatic() {
    const pot = FAC.filter(f => f.verdict === 'POTENTIAL');
    const deep = FAC.filter(f => f.effort >= 3);
    const drafted = FAC.filter(f => /drafted/.test(f.contact)).length;
    const sent = FAC.filter(f => /^contacted/i.test(f.contact)).length;
    const nSites = new Set(SITES.map(s => s.id)).size;
    const short = n => n.replace(/ \/ .*| \(.*\)|High Flux Accelerator-Driven Neutron Facility/g, '').replace(/^Birmingham\s*$/, 'Birmingham HF-ADNeF').trim();
    $('#nf-stats').innerHTML = [
      [FAC.length, 'Catalogue rows', nSites + ' sites on the map'],
      [pot.length, 'Potential', pot.map(f => short(f.name)).join(', ')],
      [deep.length, 'Looked at in depth', 'dedicated study or Geant4 (explored ≥ 3 of 4)'],
      [sent, 'Facilities contacted', drafted + ' emails drafted, not sent'],
    ].map(([n, k, s]) => '<li><span class="n">' + n + '</span><span class="k">' + k + '</span><span class="s">' + esc(s) + '</span></li>').join('');
    const cls = Array.from(new Set(FAC.map(f => f.cls)));
    $('#nf-cls').innerHTML = '<option value="">All beam classes</option>' +
      cls.map(c => '<option value="' + esc(c) + '">' + esc(FAC.find(f => f.cls === c).cls_label) + '</option>').join('');
    $('#nf-effort-key').innerHTML = Object.entries(DATA.effort_levels).map(([n, t]) =>
      '<li>' + pips(Number(n)) + '<span>' + esc(t) + '</span></li>').join('');
    $('#nf-log').innerHTML = DATA.log.map(l => '<li><span class="d">' + esc(l.date) + '</span><span>' + esc(l.text) + '</span></li>').join('');
    $('#nf-gen').textContent = 'Data generated ' + DATA.generated + '.';
  }

  // ---- boot -------------------------------------------------------------------------------------
  Promise.all([fetch('../data/facilities-survey.json').then(r => r.json()), fetch('../data/world-map.json').then(r => r.json())])
    .then(([d, m]) => {
      DATA = d; MAP = m; FAC = d.facilities;
      FAC.forEach(f => { BYKEY[f.key] = f; });
      buildSites();
      fillStatic();
      drawLegend();
      buildMap();
      wireMap(); wireTable(); wireRanking(); wireFilters();
      if (location.hash.length > 1) readHash();
      if (!S.sel) {
        const top = FAC.filter(f => f.verdict === 'POTENTIAL').sort((a, b) => b.x17 - a.x17)[0];
        if (top) { const site = SITES.find(s => s.fac.includes(top)); S.site = site.id; S.sel = top.key; renderPanel(site, site.fac, top); drawMarkers(); }
      }
    })
    .catch(err => {
      $('#nf-panel').innerHTML = '<p class="nf-empty">Could not load the facility data (' + esc(err.message) + ').</p>';
    });
})();
