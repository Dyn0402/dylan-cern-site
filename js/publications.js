/* Renders the publication list from data/publications.json.
   Regenerate that file with `python3 scripts/fetch_publications.py` so the
   site, the CV and INSPIRE cannot drift apart. Fails quietly to the static
   fallback markup already in the page (local preview, or a fetch error). */
(async () => {
  const list = document.getElementById('pub-list');
  const summary = document.getElementById('pub-summary');
  if (!list) return;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let d;
  try {
    const r = await fetch('data/publications.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    d = await r.json();
  } catch (e) {
    return; // leave the fallback markup in place
  }

  list.innerHTML = d.selected.map((p) => {
    // Collaboration papers have hundreds of authors; naming the collaboration
    // is more honest than an author count, and more useful than "et al."
    const who = p.collaborations.length
      ? `${esc(p.collaborations.join(', '))} Collaboration`
      : (p.n_authors === 1 ? 'Sole author' : `${p.n_authors} authors`);
    const links = [
      p.arxiv ? `<a href="https://arxiv.org/abs/${esc(p.arxiv)}">arXiv:${esc(p.arxiv)}</a>` : '',
      p.doi ? `<a href="https://doi.org/${esc(p.doi)}">DOI</a>` : '',
      `<a href="${esc(p.url)}">INSPIRE</a>`,
    ].filter(Boolean).join(' · ');
    const cites = p.citations > 0 ? ` · ${p.citations} citation${p.citations === 1 ? '' : 's'}` : '';
    const tag = p.doc_type === 'thesis' ? '<span class="tag">thesis</span>' : '';

    return `<li>
      <div class="pub-title"><a href="${esc(p.url)}">${esc(p.title)}</a> ${tag}</div>
      <div class="venue">${esc(p.venue || p.year)} · ${who}${cites}</div>
      <div class="pub-links">${links}</div>
    </li>`;
  }).join('');

  if (summary) {
    const parts = Object.entries(d.by_collaboration)
      .filter(([k]) => k !== '(individual)')
      .map(([k, n]) => `${n} with ${esc(k)}`);
    summary.innerHTML =
      `<a href="${esc(d.profile)}">${d.total} records on INSPIRE-HEP</a> — ` +
      `${parts.join(', ')}. Full list, citations and co-authors there; ` +
      `ORCID <a href="https://orcid.org/${esc(d.orcid)}">${esc(d.orcid)}</a>.`;
  }
})();
