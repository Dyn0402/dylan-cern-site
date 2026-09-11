/* The parquet reader, off the main thread.

   One sub-run shard is 10-20 MB of snappy-compressed columns and decoding
   thirteen of them takes over a second. On the main thread that is a second of
   frozen scrolling every time you click a sub-run, so it happens here and the
   page gets a message when it is done.

   THE PROTOCOL is deliberately tiny -- {id, op, ...} in, {id, ok, ...} out --
   because the interesting part is not the messaging, it is that `columns`
   makes the request cheap: hyparquet reads the file's footer, works out which
   byte ranges hold those column chunks, and asks the server for only those.
   A thirteen-column scan of a 60 k-track sub-run is ~4 MB of a 14 MB file.

   Columns come back as typed arrays wherever the data allows and are
   TRANSFERRED, not copied, so a re-histogram on the page costs nothing.
   Strings cannot be, and come back as a plain array. */

import { parquetMetadataAsync, parquetRead, asyncBufferFromUrl, cachedAsyncBuffer }
  from './lib/hyparquet/index.js';

/* One AsyncBuffer per shard URL, kept for the life of the worker.

   hyparquet's own cachedAsyncBuffer memoises byte ranges, so asking for a
   second variable after the first re-reads the footer from memory rather than
   from the network. Bounded by the number of sub-runs someone clicks in one
   sitting, which is not a leak worth managing. */
const files = new Map();
/* Column caches, per shard: pulling `chi2dof_x` twice must not pay twice. */
const cols = new Map();

async function open(url) {
  let f = files.get(url);
  if (!f) {
    // cachedAsyncBuffer memoises byte ranges, which is what makes opening a
    // SECOND track in the same row group free: the detail read pulls every
    // column of one row group (~2.6 MB), and without this every expanded row
    // paid that again.
    const file = cachedAsyncBuffer(await asyncBufferFromUrl({ url }));
    const metadata = await parquetMetadataAsync(file);
    f = { file, metadata, n: Number(metadata.num_rows) };
    files.set(url, f);
    cols.set(url, new Map());
  }
  return f;
}

/* hyparquet hands back one array per column, already in file order. Numeric
   columns become typed arrays here: a Float32Array of 120 000 tracks is 480 kB
   and can be transferred, where the boxed Array it arrives as is several MB
   and cannot. `null` becomes NaN -- every consumer on the page filters on
   Number.isFinite anyway, and a typed array has no way to say "missing". */
function pack(values) {
  let numeric = true, str = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') { str = true; numeric = false; break; }
    if (typeof v === 'boolean') continue;
    if (typeof v === 'bigint') continue;
    if (typeof v !== 'number') { numeric = false; break; }
  }
  if (str || !numeric) return { kind: 'str', data: values.map(v =>
    v === null || v === undefined ? '' : String(v)) };
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = (v === null || v === undefined) ? NaN
      : (typeof v === 'bigint' ? Number(v) : (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  }
  return { kind: 'num', data: out };
}

async function readColumns(url, want) {
  const { file, metadata, n } = await open(url);
  const cache = cols.get(url);
  const missing = want.filter(c => !cache.has(c));

  if (missing.length) {
    // rowFormat 'object' keys every row by COLUMN NAME, so nothing here
    // depends on hyparquet returning the columns in the order they were asked
    // for. That assumption held when it was measured, but a silent re-order
    // would put the right label on the wrong distribution -- the one failure
    // this page must not have -- and objects cost nothing: 1276 ms against
    // 1287 ms for the array form on 59 k rows x 13 columns.
    const got = await new Promise((res, rej) => parquetRead({
      file, metadata, columns: missing, rowFormat: 'object',
      onComplete: rows => res(rows), onError: rej,
    }));
    for (const name of missing) {
      const v = new Array(got.length);
      for (let i = 0; i < got.length; i++) v[i] = got[i][name];
      cache.set(name, pack(v));
    }
  }

  const out = {}, transfer = [];
  for (const c of want) {
    const p = cache.get(c);
    if (p.kind === 'num') {
      // A copy per request, because the transfer neuters what it sends and the
      // cache has to survive it. 480 kB per column is cheaper than re-decoding.
      const copy = p.data.slice();
      out[c] = { kind: 'num', data: copy };
      transfer.push(copy.buffer);
    } else {
      out[c] = p;
    }
  }
  return { n, columns: out, transfer };
}

/* Every column of a narrow row range -- what one clicked track needs. With
   16 384-row groups this is a single range request for ~1 MB. */
async function readRows(url, start, end) {
  const { file, metadata } = await open(url);
  const rows = await new Promise((res, rej) => parquetRead({
    file, metadata, rowStart: start, rowEnd: end, rowFormat: 'object',
    onComplete: r => res(r), onError: rej,
  }));
  // BigInt does not survive structuredClone into the page's JSON handling.
  return rows.map(r => {
    const o = {};
    for (const k in r) o[k] = typeof r[k] === 'bigint' ? Number(r[k]) : r[k];
    return o;
  });
}

self.onmessage = async e => {
  const { id, op, url } = e.data;
  try {
    if (op === 'columns') {
      const { n, columns, transfer } = await readColumns(url, e.data.columns);
      self.postMessage({ id, ok: true, n, columns }, transfer);
    } else if (op === 'rows') {
      self.postMessage({ id, ok: true,
        rows: await readRows(url, e.data.start, e.data.end) });
    } else if (op === 'info') {
      const { metadata, n } = await open(url);
      self.postMessage({ id, ok: true, n,
        rowGroups: metadata.row_groups.length,
        columns: metadata.schema.slice(1).map(s => s.name) });
    } else {
      throw new Error(`unknown op ${op}`);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
