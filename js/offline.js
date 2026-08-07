/* Say so when the listing is coming out of the cache rather than the network,
   so a note that has not synced yet is not mistaken for a note that is gone. */
(() => {
  const list = document.querySelector('.note-list');
  if (!list) return;

  const bar = document.createElement('p');
  bar.className = 'offline-bar';
  bar.hidden = true;
  bar.innerHTML = '<b>Offline.</b> Showing the notes cached on this device — ' +
    'anything added since your last visit is not here yet.';
  list.parentNode.insertBefore(bar, list);

  const sync = () => { bar.hidden = navigator.onLine; };
  addEventListener('online', sync);
  addEventListener('offline', sync);
  sync();
})();
