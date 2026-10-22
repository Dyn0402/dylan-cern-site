/* Facilities hub (facilities/index.html): the neutron mini-dashboard's reach chart and stats, and the
   list of facilities studied. Data: data/facilities-survey.json, written by
   x17_facility_search/survey/dashboard.py (its HUB and PROTON lists decide what appears here). The page
   is fully readable without this script; it only fills in numbers and cards. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  function sci(v) {
    const e = Math.floor(Math.log10(v)), m = (v / 10 ** e).toPrecision(2);
    return m + '×10' + String(e).split('').map(c => SUP[c]).join('');
  }
  const GROUPS = {
    POTENTIAL: ['Potential', 'var(--v-potential)'], STUDIED: ['Studied', 'var(--v-studied)'],
    MARGINAL: ['Marginal', 'var(--v-marginal)'], WATCH: ['Watch', 'var(--v-watch)'],
  };
  const SHORT = { frm2_medapp: 'FRM II MEDAPP', birmingham: 'Birmingham HF-ADNeF', ganil_nfs: 'GANIL / NFS', ill_pf1b: 'ILL PF1B',
    ntof_ear2: 'CERN n_TOF EAR2', demokritos: 'NCSR Demokritos', lnl_cn: 'LNL Legnaro' };
  const group = v => GROUPS[v] || ['Closed', 'var(--v-out)'];
  const ROUTE = { neutron: ['Neutron route', 'neutron-facilities.html'], proton: ['Proton route', 'proton-facilities.html'] };
  const dstr = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const pips = n => '<span class="fh-effort" title="explored ' + n + ' of 4">' +
    [1, 2, 3, 4].map(i => '<i class="' + (i <= n ? 'on' : '') + '"></i>').join('') + '</span>';

  function stats(d) {
    const fs = d.facilities, n = fs.length;
    const vals = [[n, 'catalogued'], [fs.filter(f => f.verdict === 'POTENTIAL').length, 'potential'],
      [fs.filter(f => f.effort >= 3).length, 'in depth'], [fs.filter(f => /^(contacted|asked)/i.test(f.contact || '')).length, 'contacted']];
    document.querySelectorAll('#fh-n-stats li').forEach((li, i) => {
      li.querySelector('.n').textContent = vals[i][0]; li.querySelector('.k').textContent = vals[i][1];
    });
    const ps = document.querySelectorAll('#fh-p-stats li');   // proton numbers: data/facilities-proton.json
    fetch('../data/facilities-proton.json').then(r => r.json()).then(pd => {
      const pf = pd.facilities, v = [pf.length, pf.filter(f => f.verdict === 'POTENTIAL').length,
        pf.filter(f => f.effort >= 3).length, pf.filter(f => /^(contacted|asked|in contact)/i.test(f.contact || '')).length];
      ps.forEach((li, i) => { li.querySelector('.n').textContent = v[i]; });
    }).catch(() => {});
  }

  // days to the ATOMKI strength per studied facility, log axis, sooner is better; the dashed line is a 2-week run
  function reach(d) {
    const host = $('#fh-n-reach');
    const rows = d.facilities.filter(f => f.effort >= 3 && f.reach && f.reach[0] && f.reach[0].days != null && f.key !== 'ill_fipps' && f.key !== 'ntof_ear2')
      .map(f => ({ f, r: f.reach[0].days })).filter(x => x.r > 0).sort((a, b) => a.r - b.r);
    if (!rows.length) return;
    const lo = 0, hi = 5, at = v => 100 * Math.min(1, Math.max(0, (Math.log10(v) - lo) / (hi - lo)));
    const dtxt = v => v < 365 ? String(Number(v.toPrecision(2))) + ' d' : String(Number((v / 365.25).toPrecision(2))) + ' yr';
    const ref = at(14);
    host.innerHTML = rows.map(({ f, r }) => {
      const href = f.links && f.links[0] ? f.links[0].href : 'neutron-facilities.html';
      const nm = SHORT[f.key] || f.name;
      return '<a class="fh-row" href="' + esc(href) + '" title="' + esc(f.name) + ': ' + dtxt(r) + ' of beam to the ATOMKI strength at 3σ"><span class="nm">' + esc(nm) +
        '</span><span class="fh-track"><i class="ref" style="left:' + ref.toFixed(1) + '%"></i><i class="dot" style="left:' +
        at(r).toFixed(1) + '%;--c:' + group(f.verdict)[1] + '"></i></span><span class="v">' + dtxt(r) + '</span></a>';
    }).join('') +
      '<div class="fh-axis"><span></span><span class="ax"><span style="left:0">1 d</span><span class="ref" style="left:' + ref.toFixed(1) +
      '%">2 weeks</span><span style="left:100%">270 yr</span></span><span></span></div>' +
      '<p class="cap" style="margin:6px 0 0">Beam days to the ATOMKI strength at 3σ (statistics only); left of the line: within a 2-week run. Sooner is better.</p>';
  }

  function card(h, byKey, log, d) {
    const f = byKey[h.key]; if (!f) return '';
    const pr = h.routes.length === 1 && h.routes[0] === 'proton' ? (d.proton || []).find(x => x.key === f.key) : null;
    const [vlab, vcol] = group(pr ? pr.verdict : f.verdict);
    const last = log.find(l => l.keys.includes(f.key));
    const name = SHORT[f.key] || f.name;
    const routes = h.routes.map(r => '<a class="chip route" href="' + ROUTE[r][1] + '">' + ROUTE[r][0] + '</a>').join('');
    const links = (f.links || []).map(l => '<a href="' + esc(l.href) + '">' + esc(l.t) + '</a>').join('');
    return '<article class="fh-card"><h3><a href="' + esc(h.page) + '">' + esc(name) + '</a></h3>' +
      '<p class="site">' + esc(f.site) + ' · ' + esc(f.kind) + '</p>' +
      '<div class="tags">' + routes + '<span class="chip v" style="--c:' + vcol + '">' + vlab + '</span>' + pips(f.effort) + '</div>' +
      '<dl><dt>Status</dt><dd>' + esc(f.status) + '</dd>' +
      '<dt>Finding</dt><dd>' + esc(f.effort_note || f.reason) + '</dd>' +
      (last ? '<dt>Latest</dt><dd><time datetime="' + last.date + '">' + dstr(last.date) + '</time>' + esc(last.text) + '</dd>' :
        '<dt>Updated</dt><dd>' + dstr(f.updated) + '</dd>') +
      (f.next ? '<dt>Next</dt><dd>' + esc(f.next) + '</dd>' : '') + '</dl>' +
      '<p class="go">' + links + '</p></article>';
  }

  function list(d) {
    const byKey = Object.fromEntries(d.facilities.map(f => [f.key, f]));
    const when = h => { const l = d.log.find(x => x.keys.includes(h.key)); return (l && l.date) || (byKey[h.key] || {}).updated || ''; };
    const html = (d.hub || []).slice().sort((a, b) => when(b).localeCompare(when(a))).map(h => card(h, byKey, d.log, d)).join('');
    if (html) $('#fh-list').innerHTML = html;
  }

  fetch('../data/facilities-survey.json').then(r => r.json()).then(d => {
    stats(d); reach(d); list(d);
    const g = $('#fh-gen'); if (g) g.textContent = '(generated ' + d.generated + ')';
  }).catch(() => { /* static markup stays */ });
})();
