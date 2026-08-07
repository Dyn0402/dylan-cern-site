/* Filter box for the notes listing. Added by script rather than sitting in the
   markup, so there is no dead control when JS is off -- the full grouped list
   is the no-JS state, and it is already usable. */
(() => {
  const groups = [...document.querySelectorAll('.note-group')];
  const items = [...document.querySelectorAll('.note-item')];
  if (!groups.length || !items.length) return;

  const bar = document.createElement('div');
  bar.className = 'note-filter';
  bar.innerHTML =
    '<input type="search" id="note-filter-input" autocomplete="off" ' +
    'placeholder="Filter notes…" aria-label="Filter notes">' +
    '<span class="note-filter-count" role="status" aria-live="polite"></span>';
  // Before the first group, not the top of #body: that leaves room above for
  // the offline banner, whichever order the two scripts happen to run in.
  groups[0].parentNode.insertBefore(bar, groups[0]);

  const input = bar.querySelector('input');
  const count = bar.querySelector('.note-filter-count');

  /* Every word has to match somewhere, so "micromegas gain" narrows rather
     than widening the way a plain substring search would. */
  function apply() {
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;

    for (const li of items) {
      const hay = li.dataset.find || '';
      const hit = terms.every((t) => hay.includes(t));
      li.hidden = !hit;
      if (hit) shown++;
    }

    // Hide a heading whose notes have all been filtered away, so the page does
    // not fill up with empty sections.
    for (const g of groups) {
      g.hidden = ![...g.querySelectorAll('.note-item')].some((li) => !li.hidden);
    }

    if (!terms.length) count.textContent = '';
    else if (shown) count.textContent = `${shown} of ${items.length}`;
    else count.textContent = 'no matches';
  }

  input.addEventListener('input', apply);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; apply(); }
  });
  apply();
})();
