/* Load the generated sw.js against stubbed worker globals and check the
 * allowlist: which requests does it take over, and which does it leave alone?
 *
 *     node scripts/test-sw.mjs
 *
 * The cases that matter are the "MUST NOT intercept" ones. A root service
 * worker controls the whole origin, including /x17/ -- the live DAQ dashboard
 * this repo does not own, whose data.json must never be served from a cache.
 * If someone widens the fetch handler, this is what should stop them.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const REPO = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const src = fs.readFileSync(process.argv[2] ?? path.join(REPO, 'sw.js'), 'utf8');

const handlers = {};
const store = new Map();
let networkUp = true;
const fetched = [];

const cache = {
  async add(u) { if (!networkUp) throw new Error('offline'); store.set(u, `body:${u}`); },
  async match(k) { return store.get(k) ?? undefined; },
  async put(k, v) { store.set(k, v); },
};

const self_ = {
  location: { origin: 'https://dylan-neff.web.cern.ch' },
  addEventListener: (t, fn) => { handlers[t] = fn; },
  skipWaiting: async () => {},
  clients: { claim: async () => {} },
};

const ctx = {
  self: self_,
  caches: { open: async () => cache, keys: async () => [], delete: async () => true },
  URL,
  Response: class { constructor(b, i) { this.body = b; Object.assign(this, i); } },
  fetch: async (req) => {
    fetched.push(req.url);
    if (!networkUp) throw new Error('offline');
    return { ok: true, clone: () => `fresh:${req.url}` };
  },
};
ctx.self.location = self_.location;
vm.createContext(ctx);
vm.runInContext(src, ctx);

/* Install, then ask what happens to each request. */
await (async () => {
  let p;
  await handlers.install({ waitUntil: (x) => { p = x; } });
  await p;
})();

async function probe(url, method = 'GET') {
  let responded = null;
  await handlers.fetch({
    request: { url, method },
    respondWith: (x) => { responded = x; },
  });
  if (responded === null) return { intercepted: false };
  return { intercepted: true, value: await responded };
}

const O = 'https://dylan-neff.web.cern.ch';
const cases = [
  // Not ours: the live dashboard, the hand-published page, other origins.
  ['MUST NOT intercept', `${O}/x17/data.json`, false],
  ['MUST NOT intercept', `${O}/x17/`, false],
  ['MUST NOT intercept', `${O}/x17/index.html`, false],
  ['MUST NOT intercept', `${O}/trigger_scheme.html`, false],
  ['MUST NOT intercept', `${O}/some/unknown/page.html`, false],
  ['MUST NOT intercept', 'https://inspirehep.net/api/x', false],
  // Ours, but online-only on purpose: the live CV. See PRECACHE in build.py.
  ['MUST NOT intercept', `${O}/`, false],
  ['MUST NOT intercept', `${O}/index.html`, false],
  ['MUST NOT intercept', `${O}/projects/x17.html`, false],
  ['MUST NOT intercept', `${O}/data/publications.json`, false],
  ['MUST NOT intercept', `${O}/cv/Dylan_Neff_CV.pdf`, false],
  // The hub and the notes, and what they need to render.
  ['MUST intercept', `${O}/hub/`, true],
  ['MUST intercept', `${O}/hub/index.html`, true],
  ['MUST intercept', `${O}/js/notes-filter.js`, true],
  // The pill's *script* is cached so the hub works offline; the /x17/data.json
  // it fetches is not, and is asserted above. Do not conflate the two.
  ['MUST intercept', `${O}/js/live-status.js`, true],
  ['MUST intercept', `${O}/notes/`, true],
  ['MUST intercept', `${O}/notes/index.html`, true],
  ['MUST intercept', `${O}/notes/standalone-example.html`, true],
  ['MUST intercept', `${O}/notes/offline-notes.html`, true],
  ['MUST intercept', `${O}/style.css`, true],
  ['MUST intercept', `${O}/js/shared.js`, true],
  ['MUST intercept', `${O}/manifest.json`, true],
];

let bad = 0;
for (const [label, url, want] of cases) {
  const r = await probe(url);
  const ok = r.intercepted === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(18)} ${url.replace(O, '')}`);
}

// POSTs are never ours, even to a precached path.
const post = await probe(`${O}/notes/index.html`, 'POST');
console.log(`${post.intercepted === false ? 'ok  ' : 'FAIL'}  MUST NOT intercept POST /notes/index.html`);
if (post.intercepted) bad++;

/* The actual point: pull the plug and see if a note still resolves. Reset the
   store to install-time bodies first -- the probes above ran online, so
   stale-while-revalidate has already written refreshed copies over them. */
for (const k of [...store.keys()]) store.set(k, `body:${k}`);
networkUp = false;
fetched.length = 0;

for (const [url, want] of [
  [`${O}/notes/standalone-example.html`, 'body:/notes/standalone-example.html'],
  [`${O}/notes/offline-notes.html`, 'body:/notes/offline-notes.html'],
  [`${O}/notes/`, 'body:/notes/index.html'],
  [`${O}/hub/`, 'body:/hub/index.html'],
  [`${O}/style.css`, 'body:/style.css'],
]) {
  const r = await probe(url);
  const ok = r.value === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  offline read        ${url.replace(O, '') || '/'} -> ${r.value}`);
}

/* A precached path whose entry is missing must degrade to the 504, not hang. */
store.delete('/notes/offline-notes.html');
const gone = await probe(`${O}/notes/offline-notes.html`);
const degraded = gone.value?.status === 504;
console.log(`${degraded ? 'ok  ' : 'FAIL'}  offline, uncached   /notes/offline-notes.html -> ${gone.value?.status}`);
if (!degraded) bad++;

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);
