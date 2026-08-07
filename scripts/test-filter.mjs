/* Exercise js/notes-filter.js against a stub of the small DOM surface it
 * actually touches.
 *
 *     node scripts/test-filter.mjs
 *
 * The fixture is synthetic on purpose. An earlier version read the real
 * notes/index.html, and its assertions flipped between pass and fail depending
 * on how many notes happened to be published -- a test that breaks when you
 * write a note is worse than no test.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const REPO = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(REPO, 'js', 'notes-filter.js'), 'utf8');

/* Mirrors what build.py emits: one section per topic, each item carrying a
   lowercased haystack of title + summary + tags. */
const FIXTURE = [
  ['Detector R&D', [
    'micromegas gain uniformity  scan across the foil  detector r&d micromegas',
    'resistive strip layout  strip pitch and edge effects  detector r&d',
  ]],
  ['Analysis', [
    'cumulant ratios bes-ii  net-proton cumulants by energy  analysis',
  ]],
  ['Unfiled', [
    'reading list  papers to get through  ',
  ]],
];

const groups = FIXTURE.map(([name, hays]) => {
  const items = hays.map((h) => ({ dataset: { find: h }, hidden: false }));
  return {
    name, items, hidden: false,
    querySelectorAll: (sel) => (sel === '.note-item' ? items : []),
  };
});
const allItems = groups.flatMap((g) => g.items);
groups[0].parentNode = { insertBefore() {} };

let input, count;
const ctx = {
  document: {
    getElementById: () => ({ insertBefore() {}, firstChild: null }),
    querySelectorAll: (sel) => (sel === '.note-group' ? groups : allItems),
    createElement: () => ({
      set innerHTML(v) {
        this._h = v;
        input = { value: '', listeners: {},
                  addEventListener(t, f) { this.listeners[t] = f; } };
        count = { textContent: '' };
      },
      get innerHTML() { return this._h; },
      querySelector: (s) => (s === 'input' ? input : count),
    }),
  },
  console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const type = (s) => { input.value = s; input.listeners.input(); };
const shown = () => allItems.filter((i) => !i.hidden).length;
const shownGroups = () => groups.filter((g) => !g.hidden).length;

let bad = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) { bad++; }
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${got}`
    + (ok ? '' : `   (wanted ${want})`));
};

check('starts showing everything', shown(), 4);
check('starts showing every group', shownGroups(), 3);
check('no count until you type', count.textContent, '');

type('micromegas');
check('title/tag match narrows', shown(), 1);
check('count is reported', count.textContent, '1 of 4');
check('empty groups are hidden', shownGroups(), 1);

type('detector');
check('a tag matches its whole section', shown(), 2);
check('one section shown', shownGroups(), 1);

type('r&d');
check('punctuation in a tag is literal', shown(), 2);

type('cumulant');
check('a different section matches', shown(), 1);

type('list');
check('untagged notes are still searchable', shown(), 1);

type('micromegas gain');
check('every word must match (AND, not OR)', shown(), 1);

type('micromegas cumulant');
check('words from different notes match none', shown(), 0);
check('all groups hidden', shownGroups(), 0);
check('"no matches" is said out loud', count.textContent, 'no matches');

type('  MICROMEGAS   Gain  ');
check('case- and whitespace-insensitive', shown(), 1);

type('');
check('clearing restores every note', shown(), 4);
check('clearing restores every group', shownGroups(), 3);
check('clearing drops the count', count.textContent, '');

type('micromegas');
input.listeners.keydown({ key: 'Escape' });
check('escape empties the box', input.value, '');
check('escape restores the list', shown(), 4);

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);
