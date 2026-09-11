# hyparquet, vendored

    hyparquet 1.30.0 — https://github.com/hyparam/hyparquet — MIT (LICENSE beside this file)
    npm: https://registry.npmjs.org/hyparquet/-/hyparquet-1.30.0.tgz
    vendored 2026-09-10, from `package/src/` verbatim

This is the **only** third-party code in the site, and it is here rather than on
a CDN for the same reason the charts are hand-drawn on canvas: the site has no
build step, no package manager and no external requests, and adding a CDN would
add a second origin that has to stay up for `/x17/qa-tracks.html` to work.
248 kB of plain ESM with no dependencies costs less than that.

## What it is for

`qa-tracks.html` reads the per-track parquet shards **in the browser**, over
HTTP range requests, so a histogram costs the columns it plots rather than the
size of the file. CERN's Apache serves `206 Partial Content` with a correct
`content-range` (measured 2026-09-10), which is the whole reason this works
without a server.

## The two local changes

1. **`node.js` is deleted.** It is the package's Node entry point and its first
   statement is `import { ... } from 'fs'`, which a browser cannot resolve.
   Nothing in `index.js` referenced it.
2. Nothing else. The rest is byte-for-byte upstream, so a version bump is a
   re-extract of `package/src/`, delete `node.js`, and re-read the note below.

## The one thing to check on an upgrade

**Only SNAPPY works out of the box.** hyparquet ships snappy; gzip and zstd
need the separate `hyparquet-compressors` package. The shards are written
snappy for exactly this reason — see
`sept26_prelim_analysis/trackqa_shards.py`. If a future version drops or
changes that, the page fails with

    parquet unsupported compression codec: <CODEC>

and the fix is in the writer, not here.
