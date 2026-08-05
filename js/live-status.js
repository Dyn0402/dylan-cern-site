/* Live pill: same-origin peek at the DAQ page's data.json. Fails quietly
   (e.g. local preview, or the stats generator idle between campaigns). */
(async () => {
  const pill = document.getElementById('live-pill');
  const txt = document.getElementById('live-pill-text');
  if (!pill || !txt) return;   // not on this page
  try {
    const r = await fetch('/x17/data.json', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const d = await r.json();
    const run = d.latest && d.latest.run;
    if (run && run.status === 'RUNNING') {
      pill.classList.add('good');
      txt.textContent = `${run.name} running · ${d.latest.triggers.rate_hz.toFixed(1)} Hz`;
    } else if (run) {
      txt.textContent = `last run ${run.name} · ${run.status.toLowerCase()}`;
    } else throw new Error();
  } catch (e) {
    txt.textContent = 'status offline';
  }
})();
