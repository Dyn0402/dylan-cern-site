/* Proton-facility dashboard stub (facilities/proton-facilities.html): the studied facilities, from the
   `proton` list of data/facilities-survey.json (x17_facility_search/survey/dashboard.py, PROTON).
   The page reads without this script. */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dstr = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  fetch('../data/facilities-survey.json').then(r => r.json()).then(d => {
    const byKey = Object.fromEntries(d.facilities.map(f => [f.key, f]));
    const page = Object.fromEntries((d.hub || []).map(h => [h.key, h.page]));
    const html = (d.proton || []).map(p => {
      const f = byKey[p.key] || {};
      const links = (f.links || []).map(l => '<a href="' + esc(l.href) + '">' + esc(l.t) + '</a>').join('');
      return '<article class="fh-card"><h3><a href="' + esc(page[p.key] || '#') + '">' + esc(p.name) + '</a></h3>' +
        '<p class="site">' + esc(p.reaction) + '</p>' +
        '<dl><dt>Result</dt><dd>' + esc(p.headline) + '</dd><dt>Status</dt><dd>' + esc(p.status) + '</dd>' +
        '<dt>Updated</dt><dd>' + dstr(p.updated) + '</dd></dl><p class="go">' + links + '</p></article>';
    }).join('');
    if (html) document.getElementById('fp-list').innerHTML = html;
  }).catch(() => {});
})();
