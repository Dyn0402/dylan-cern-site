/* Exercise js/x17-table.js — the sort/expand/total machinery the three /x17/
 * QA pages share — against a stub of the DOM surface it actually touches.
 *
 *     node scripts/test-table.mjs
 *
 * The fixture is synthetic on purpose: a test that reads data/x17-runs.json
 * would start failing the next time a run is added, which is worse than no
 * test. What is checked is the behaviour the three pages rely on and that has
 * no other guard:
 *
 *   - a numeric column starts descending, a text column ascending
 *   - clicking the same header again reverses; a different one resets
 *   - ties break through opts.tie, so the order is deterministic
 *   - the row/detail pairing is by position, which is what lets a segment id
 *     like `run_100/0000×224600` be a row key at all
 *   - the total row aligns to the columns, and footNote replaces it when
 *     total() declines
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const REPO = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(REPO, 'js', 'x17-table.js'), 'utf8');

/* ---- the DOM stub -------------------------------------------------------- */

function el() {
  return {
    innerHTML: '', textContent: '', listeners: {},
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    fire(t, ev) { (this.listeners[t] || []).forEach(f => f(ev)); },
  };
}

/* A body that understands just enough of its own markup to answer the one
   query the module makes: find the detail row paired with a clicked row. */
function bodyEl() {
  const b = el();
  b.details = {};
  Object.defineProperty(b, 'innerHTML', {
    get() { return this._h || ''; },
    set(v) {
      this._h = v;
      this.details = {};
      for (const m of v.matchAll(/data-detail="(\d+)"/g)) {
        this.details[m[1]] = { hidden: true };
      }
    },
  });
  b.querySelector = sel => {
    const m = /\[data-detail="(.+)"\]/.exec(sel);
    return m ? b.details[m[1]] || null : null;
  };
  return b;
}

const head = el(), body = bodyEl(), foot = el(), count = el();
const ctx = { window: {}, document: { getElementById: () => null }, console, CSS: undefined };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { makeTable, fmt, tickStep, chip, facts } = ctx.window.x17;

/* ---- fixture ------------------------------------------------------------- */

const ROWS = [
  { n: 3, name: 'charlie', h: 2 },
  { n: 1, name: 'alpha', h: 5 },
  { n: 2, name: 'bravo', h: 5 },     // ties with alpha on h
];
const COLS = [
  { key: 'n', label: 'N', num: true, cell: r => String(r.n) },
  { key: 'name', label: 'Name', num: false, cell: r => r.name },
  { key: 'h', label: 'Hours', num: true, cell: r => String(r.h) },
];

let totalMode = 'sum';
const table = makeTable({
  head, body, foot, count, noun: 'rows',
  cols: COLS, sort: 'n', dir: -1,
  detail: r => r.n === 2 ? '' : `<i>${r.name}</i>`,   // row 2 has nothing to expand
  total: shown => totalMode === 'none' ? null
    : [`${shown.length} rows`, '', String(shown.reduce((a, r) => a + r.h, 0))],
  footNote: 'nothing to total',
  empty: 'no rows',
  tie: (a, b) => a.n - b.n,
  onSort: () => table.render(ROWS),
});

/* ---- helpers ------------------------------------------------------------- */

let fails = 0;
const ok = (name, cond, got) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name.padEnd(52)} ${got ?? ''}`);
  if (!cond) fails++;
};
// The FIRST cell of each data row, not every numeric cell: `n` and `h` are both
// bare integers and a looser match reads the two columns interleaved.
const order = () => [...body.innerHTML.matchAll(/<tr class="run-row[^>]*><td>(\d+)<\/td>/g)]
  .map(m => m[1]);
const clickHead = key => head.fire('click', { target: { closest: () => ({ dataset: { sort: key } }) } });
const clickRow = i => body.fire('click', { target: { closest: () => ({ dataset: { row: String(i) } }) } });

/* ---- the checks ---------------------------------------------------------- */

table.render(ROWS);
ok('initial sort is n descending', order().join(',') === '3,2,1', order().join(','));
ok('count reads the noun', count.textContent === '3 rows', count.textContent);

table.render(ROWS.slice(0, 2), ROWS.length);
ok('a filtered render says "of"', count.textContent === '2 of 3 rows', count.textContent);
table.render(ROWS);

clickHead('name');
ok('a text column starts ascending', order().join(',') === '1,2,3', order().join(','));
clickHead('name');
ok('clicking again reverses it', order().join(',') === '3,2,1', order().join(','));

clickHead('h');
ok('a numeric column starts descending', order()[0] !== '3', order().join(','));
ok('ties break through opts.tie', order().join(',') === '1,2,3', order().join(','));

clickHead('n');
ok('a different column resets direction', order().join(',') === '3,2,1', order().join(','));

// Expansion. Row 2 declares no detail, so only two detail rows exist, and they
// are numbered by POSITION in the rendered order (3, 2, 1) -- index 0 is run 3.
ok('rows with no detail get no detail row',
  Object.keys(body.details).sort().join(',') === '0,2', Object.keys(body.details).join(','));
ok('a flat row is marked', /class="run-row flat"/.test(body.innerHTML));
clickRow(0);
ok('clicking a row expands it', body.details['0'].hidden === false);
clickRow(0);
ok('clicking it again collapses it', body.details['0'].hidden === true);
clickRow(1);
ok('clicking a flat row does nothing', body.details['1'] === undefined);

body.fire('keydown', { key: 'Enter', preventDefault() {},
  target: { closest: () => ({ dataset: { row: '2' } }) } });
ok('Enter expands too', body.details['2'].hidden === false);

// Totals.
ok('the total row aligns to the columns',
  foot.innerHTML === '<tr><td>3 rows</td><td></td><td>12</td></tr>', foot.innerHTML);
totalMode = 'none';
table.render(ROWS);
ok('footNote replaces a declined total',
  foot.innerHTML.includes('nothing to total') && foot.innerHTML.includes('colspan="3"'));
table.render([]);
ok('an empty result shows the empty message', body.innerHTML.includes('no rows'));
ok('an empty result clears the footer', foot.innerHTML === '', JSON.stringify(foot.innerHTML));

// The shared helpers the pages depend on.
ok('tickStep picks a round step', tickStep(97) === 25, String(tickStep(97)));
ok('fmt.mins crosses to hours', fmt.mins(90) === '1.5 h' && fmt.mins(45) === '45 min');
ok('fmt.gb crosses to TB', fmt.gb(1500) === '1.50 TB' && fmt.gb(12.3) === '12.3 GB');
ok('esc closes an attribute', fmt.esc('a"<b>') === 'a&quot;&lt;b&gt;');
ok('chip carries the token', chip('st', '--good', 'x').includes('var(--good)'));
ok('facts render an em dash for empty', facts([['k', '']]).includes('—'));

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
