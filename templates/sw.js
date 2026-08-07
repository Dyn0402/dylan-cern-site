/* Offline cache for the site. Rendered to /sw.js by scripts/build.py, which
   fills in the asset list and a version hash of their contents.

   SAFETY -- a service worker registered at the root controls the WHOLE origin,
   including paths this repository does not own:

     /x17/                 live DAQ dashboard, regenerated at the beamline.
                           js/live-status.js fetches /x17/data.json with
                           `cache: 'no-store'` precisely because it must be
                           fresh; serving it from a cache would show stale run
                           status to anyone visiting the dashboard.
     /trigger_scheme.html  standalone page, hand-published.

   Therefore the fetch handler is an ALLOWLIST, exactly like PAYLOAD in
   scripts/deploy-eos.sh: it calls respondWith() only for paths that are in the
   generated precache list, and returns without touching anything else, which
   leaves the browser's normal networking in place. Never widen this to a
   catch-all. */

const VERSION = '{{version}}';
const CACHE = 'dneff-' + VERSION;
const ASSETS = {{assets}};

const ALLOW = new Set(ASSETS);

/* '/' and '/notes/' are the same documents as their index.html. */
function key(pathname) {
  return pathname.endsWith('/') ? pathname + 'index.html' : pathname;
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One 404 must not fail the whole install and leave the site with no
    // worker at all -- take what is there and move on.
    await Promise.all(ASSETS.map((a) => cache.add(a).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('dneff-') && n !== CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = key(url.pathname);
  if (!ALLOW.has(path)) return;   // /x17/, /trigger_scheme.html, everything else

  e.respondWith(freshen(req, path));
});

/* Serve the cached copy at once -- that is what makes this work on a plane --
   and refresh it in the background so the next open is current. */
async function freshen(req, path) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(path);

  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(path, res.clone());
    return res;
  }).catch(() => null);

  if (hit) return hit;

  const res = await network;
  if (res) return res;
  return new Response('Offline, and this page was never cached.',
    { status: 504, headers: { 'Content-Type': 'text/plain' } });
}
