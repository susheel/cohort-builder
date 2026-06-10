# DuckDB-WASM Integration for the Cohort Builder (React 18 + Vite + TypeScript)

Research note for a client-side cohort query application that loads local synthetic
data (Parquet preferred, CSV fallback) entirely in the browser and runs SQL
aggregation queries. Current as of June 2026.

---

## 0. Executive summary and recommended decisions

| Decision | Recommendation |
| --- | --- |
| Worker setup | **Self-host the bundles via Vite `?url` imports** (manual bundles), not the JSDelivr CDN path. Reliable offline, no third-party CDN dependency, no `Blob`/`importScripts` shim. |
| Threads / COOP-COEP | **Skip cross-origin isolation for v1.** The `mvp`/`eh` bundles run single-threaded fine for our data sizes. Only add COOP/COEP + the `coi` bundle if profiling shows we need parallel query execution. |
| Init pattern | **Module-level promise singleton** wrapped in a React Context provider + `useDuckDB()` hook. One `AsyncDuckDB`, one long-lived connection, created lazily. |
| File loading | **`registerFileBuffer` + `read_parquet` (or `CREATE TABLE AS`)** for both dropped files and shipped static assets. Materialise into real tables once, then query the tables. |
| Result handling | Query returns an **Arrow `Table`**; use `.toArray()` for row objects, but read columnar via `getChild()` for hot paths. Cast `BigInt` counts to JS numbers in SQL (`::INTEGER`/`::DOUBLE`). |
| Version pinning | **Pin to `1.32.0` exactly** (`"@duckdb/duckdb-wasm": "1.32.0"`). Do **not** use `^` or the `latest` dist-tag — `latest` currently points at a `-dev` prerelease. |
| Bundle/lazy load | **Dynamic `import()`** DuckDB only when the user first needs a query; show a loading state while the ~4-10 MB WASM streams in. |

---

## 1. Installing and bundling with Vite

### 1.1 Install and version pinning

```bash
npm install @duckdb/duckdb-wasm@1.32.0 apache-arrow
```

> **Critical pinning note.** As of June 2026 the npm `latest` dist-tag for
> `@duckdb/duckdb-wasm` resolves to a **prerelease** (`1.33.1-dev45.0`). DuckDB-Wasm
> has published `-dev` builds to `latest` for a long time. A bare
> `npm install @duckdb/duckdb-wasm` therefore pulls a dev build, and `^1.32.0`
> can float you onto one too. **Pin the exact last stable: `1.32.0`** (released
> 2025-12-16). Prior known-good stables: `1.31.0`, `1.30.0`, `1.29.2`.
>
> `apache-arrow` must be present (it is a peer of how results are returned).
> Match the Arrow major that your installed `duckdb-wasm` was built against
> (Arrow 17+ for the 1.29+ line). Pin Arrow too, e.g. `apache-arrow@17.0.0`,
> to avoid duplicate Arrow copies and `instanceof` mismatches.

### 1.2 The package layout (what actually ships in `dist/`)

The package ships several WASM modules and matching worker scripts. The three
browser bundle tiers:

- **`mvp`** — baseline WebAssembly MVP. Maximum compatibility, slowest.
- **`eh`** — exception-handling build. This is what virtually every modern
  browser selects. The everyday default.
- **`coi`** — cross-origin-isolated build with pthreads/SharedArrayBuffer for
  parallel query execution. Requires COOP/COEP headers. Has an extra
  `pthreadWorker` file.

`duckdb.selectBundle()` does the browser feature detection and picks the right
tier automatically.

### 1.3 Recommended Vite config (self-hosted manual bundles)

Two things must be set in `vite.config.ts`:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // DuckDB-Wasm ships pre-built worker + wasm assets. Vite's dependency
  // pre-bundler (esbuild) mangles the worker/wasm resolution, so exclude it.
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  // Only needed if you later enable threads (the `coi` bundle). See section 1.5.
  // server: {
  //   headers: {
  //     'Cross-Origin-Opener-Policy': 'same-origin',
  //     'Cross-Origin-Embedder-Policy': 'require-corp',
  //   },
  // },
});
```

> **Why `optimizeDeps.exclude`.** Vite pre-bundles dependencies with esbuild on
> first run. DuckDB-Wasm's worker scripts reference the WASM binary at runtime;
> when esbuild rewrites the module it breaks that resolution and you get a worker
> that fails to instantiate or a 404 on the `.wasm`. Excluding it lets Vite serve
> the package's own pre-built files untouched. This is the single most common
> "it works in dev but the worker won't start" Vite pitfall.

### 1.4 The `?url` worker import pattern

Import the WASM modules and worker scripts as URLs and hand them to a manual
bundle map. Vite's `?url` suffix returns a hashed, served URL for the asset and
copies it into the build output, so everything is self-hosted:

```ts
// src/db/bundles.ts
import * as duckdb from '@duckdb/duckdb-wasm';

import mvp_wasm   from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import eh_wasm    from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker  from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

export const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvp_wasm, mainWorker: mvp_worker },
  eh:  { mainModule: eh_wasm,  mainWorker: eh_worker  },
  // To enable threads, also import the coi wasm + worker + pthread worker:
  // coi: {
  //   mainModule: coi_wasm,
  //   mainWorker: coi_worker,
  //   pthreadWorker: coi_pthread_worker,
  // },
};
```

With manual bundles you create the worker **directly** from the URL — no
`Blob`/`importScripts` shim is needed (that shim is only required for the CDN
path, see 1.6):

```ts
const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
const worker = new Worker(bundle.mainWorker!);          // direct, no Blob needed
```

### 1.5 COOP/COEP headers for threads (the `coi` bundle)

DuckDB-Wasm's parallel query execution needs `SharedArrayBuffer`, which browsers
only enable for **cross-origin-isolated** pages. To be isolated, the top-level
document must be served with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Consequences once you turn these on:
- Cross-origin `<img>`, `<script>`, fonts etc. must send CORS headers or carry
  `crossorigin="anonymous"`, otherwise they are blocked by `require-corp`.
- Embedded iframes need `allow="cross-origin-isolated"`.
- You can verify at runtime with `self.crossOriginIsolated === true`.

Dev (Vite) is the `server.headers` block shown in 1.3. For production set the
same headers at the host/CDN. On header-less static hosts (GitHub Pages, plain
S3) you cannot set them server-side; the workaround is
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker), which
patches the headers via a service worker on the client.

> **Recommendation for the Cohort Builder.** Our largest table is ~25k rows
> joined against a ~6k-row table through a mapping table. That is small for
> DuckDB; single-threaded `eh` returns aggregations in milliseconds. The COOP/COEP
> requirement also complicates embedding and deployment. **Ship without
> cross-origin isolation for v1.** Keep the `coi` bundle and headers as a
> documented opt-in if profiling later demands parallelism.

### 1.6 The CDN alternative (and why we are not using it)

The CDN path avoids importing assets but pulls multi-MB WASM from JSDelivr at
runtime and needs a `Blob`/`importScripts` worker shim to dodge cross-origin
worker restrictions:

```ts
// CDN variant — NOT recommended for us (offline-hostile, third-party dependency)
const bundles = duckdb.getJsDelivrBundles();
const bundle = await duckdb.selectBundle(bundles);
const workerUrl = URL.createObjectURL(
  new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' }),
);
const worker = new Worker(workerUrl);
const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
URL.revokeObjectURL(workerUrl);
```

Self-hosting (1.4) is preferable for a synthetic-data tool that should work
offline and not leak which datasets are being explored to a CDN.

### 1.7 Common Vite pitfalls checklist

- **Forgot `optimizeDeps.exclude`** → worker fails to start or `.wasm` 404s.
- **Importing worker without `?url`** → Vite tries to bundle it as a module;
  use `?url` so it is emitted as a standalone asset.
- **Using the CDN `Blob` shim with manual bundles** → unnecessary; create the
  worker directly from `bundle.mainWorker`.
- **`^` version range or `latest`** → silently upgrades you to a `-dev` build.
- **Arrow version drift** → two Arrow copies cause `Table`/`Vector` `instanceof`
  failures when converting results. Pin one Arrow version.
- **SSR/Node prerender** (Next, Remix, Vite SSR) → DuckDB-Wasm is browser-only;
  guard instantiation behind a client-only boundary / `typeof window` check.

---

## 2. Initialising AsyncDuckDB + the React singleton pattern

### 2.1 Bare instantiation

```ts
import * as duckdb from '@duckdb/duckdb-wasm';
import { MANUAL_BUNDLES } from './bundles';

const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
const worker = new Worker(bundle.mainWorker!);
const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
const db = new duckdb.AsyncDuckDB(logger, worker);
await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

const conn = await db.connect();
const result = await conn.query('SELECT 42 AS answer');
console.log(result.toArray()); // [{ answer: 42 }]
```

`AsyncDuckDB` runs the engine inside the web worker, so queries never block the
React render thread. `db.connect()` opens a connection; you can hold one
long-lived connection for the app.

### 2.2 Module-level promise singleton

Instantiation is expensive (download + compile WASM) and must happen exactly
once. A module-scoped cached promise guarantees that even under React 18 Strict
Mode double-invocation:

```ts
// src/db/duckdb.ts
import * as duckdb from '@duckdb/duckdb-wasm';
import { MANUAL_BUNDLES } from './bundles';

export interface DuckDBHandle {
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
}

let handlePromise: Promise<DuckDBHandle> | null = null;

export function getDuckDB(): Promise<DuckDBHandle> {
  if (handlePromise) return handlePromise;

  handlePromise = (async () => {
    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    // Tune once at startup.
    await db.open({
      query: { castBigIntToDouble: true }, // counts/sums come back as JS numbers
    });

    const conn = await db.connect();
    return { db, conn };
  })();

  return handlePromise;
}

export async function terminateDuckDB(): Promise<void> {
  if (!handlePromise) return;
  const { db, conn } = await handlePromise;
  await conn.close();
  await db.terminate();
  handlePromise = null;
}
```

> `castBigIntToDouble: true` is the pragmatic choice for a cohort builder:
> `COUNT(*)` and friends return DuckDB `BIGINT`, which Arrow surfaces as JS
> `BigInt`. `BigInt` does not interpolate cleanly into React text or chart libs.
> Casting to double here (or casting per-query with `::DOUBLE`/`::INTEGER`)
> avoids `TypeError: Cannot convert a BigInt`. Counts up to 2^53 are exact.

### 2.3 React Context provider + hook

```tsx
// src/db/DuckDBProvider.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DuckDBHandle } from './duckdb';
import { getDuckDB } from './duckdb';

interface DuckDBState {
  handle: DuckDBHandle | null;
  loading: boolean;
  error: Error | null;
}

const DuckDBContext = createContext<DuckDBState>({
  handle: null,
  loading: true,
  error: null,
});

export function DuckDBProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DuckDBState>({
    handle: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    getDuckDB()
      .then((handle) => {
        if (!cancelled) setState({ handle, loading: false, error: null });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ handle: null, loading: false, error });
      });
    // Do NOT terminate on unmount: the singleton is app-scoped and Strict Mode
    // mounts twice. Terminate only on real app teardown if at all.
    return () => {
      cancelled = true;
    };
  }, []);

  return <DuckDBContext.Provider value={state}>{children}</DuckDBContext.Provider>;
}

export function useDuckDB(): DuckDBState {
  return useContext(DuckDBContext);
}
```

A query hook on top:

```tsx
// src/db/useQuery.ts
import { useEffect, useState } from 'react';
import { useDuckDB } from './DuckDBProvider';

export function useDuckDBQuery<T = Record<string, unknown>>(
  sql: string | null,
  params: unknown[] = [],
) {
  const { handle } = useDuckDB();
  const [rows, setRows] = useState<T[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!handle || !sql) return;
    let cancelled = false;
    setBusy(true);
    (async () => {
      try {
        const stmt = await handle.conn.prepare(sql);
        const result = await stmt.query(...params);
        await stmt.close();
        if (!cancelled) setRows(result.toArray().map((r) => r.toJSON() as T));
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, sql, JSON.stringify(params)]);

  return { rows, busy, error };
}
```

> **Off-the-shelf alternative.** `duckdb-wasm-kit` (`useDuckDb`,
> `initializeDuckDb`, `useDuckDbQuery`) and `@jetblack/duckdb-react`
> (`DuckDB` provider + `useDuckDB`) implement essentially the above. They are
> fine for prototyping, but for a self-hosted offline tool the ~30 lines of
> singleton code give us control over bundle source and version pinning without
> an extra dependency that may lag the core package. Recommend rolling our own.

---

## 3. Loading local data files

DuckDB-Wasm exposes a virtual filesystem. You register a "file" under a name,
then reference that name in SQL. The four registration entry points:

| Method | Use for |
| --- | --- |
| `registerFileBuffer(name, Uint8Array)` | Bytes already in memory (fetched static asset, decoded base64). Best general choice. |
| `registerFileHandle(name, File, DuckDBDataProtocol.BROWSER_FILEREADER, true)` | A `File`/`Blob` from a drop or `<input type=file>`, read lazily without copying the whole thing into JS memory first. |
| `registerFileURL(name, url, DuckDBDataProtocol.HTTP, false)` | A remote/served URL; DuckDB does ranged HTTP reads and can skip Parquet row groups. |
| `registerFileText(name, string)` | Small inline text (CSV/JSON snippets). |

### 3.1 Files the user drops in (recommended path for uploads)

`registerFileHandle` with `BROWSER_FILEREADER` lets DuckDB read the `File`
incrementally from disk — important for not blowing the WASM heap on large
Parquet:

```ts
import * as duckdb from '@duckdb/duckdb-wasm';

async function loadDroppedFile(handle: DuckDBHandle, file: File) {
  const { db, conn } = handle;
  const isParquet = file.name.toLowerCase().endsWith('.parquet');

  await db.registerFileHandle(
    file.name,
    file,
    duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
    true, // directIO
  );

  if (isParquet) {
    // Materialise into a real table once; query the table thereafter.
    await conn.query(`CREATE OR REPLACE TABLE patients AS
                      SELECT * FROM read_parquet('${file.name}')`);
  } else {
    // CSV fallback with auto-detected schema.
    await conn.query(`CREATE OR REPLACE TABLE patients AS
                      SELECT * FROM read_csv_auto('${file.name}')`);
  }

  await db.dropFile(file.name); // optional: registration can be released after CTAS
}
```

### 3.2 Files shipped as static assets (the synthetic dataset)

Fetch the bytes (asset emitted by Vite with `?url`), register the buffer, build
the table:

```ts
import patientsUrl from '../assets/patients.parquet?url';

async function loadStaticParquet(handle: DuckDBHandle) {
  const { db, conn } = handle;
  const buf = new Uint8Array(await (await fetch(patientsUrl)).arrayBuffer());
  await db.registerFileBuffer('patients.parquet', buf);
  await conn.query(`CREATE OR REPLACE TABLE patients AS
                    SELECT * FROM read_parquet('patients.parquet')`);
  await db.dropFile('patients.parquet');
}
```

For Parquet you can also `registerFileURL(..., DuckDBDataProtocol.HTTP, false)`
and let DuckDB issue ranged reads, but for our small bundled file a single fetch
+ buffer is simpler and avoids needing the dev server to support range requests.

### 3.3 Parquet vs CSV

Prefer Parquet: it is columnar, compressed, carries a typed schema, and DuckDB
reads it natively via `read_parquet`. CSV needs schema inference (`read_csv_auto`)
which is slower and can mis-type columns. Ship the synthetic data as Parquet and
keep CSV only as a user-upload fallback.

### 3.4 OPFS persistence options

The Origin Private File System lets DuckDB persist a database file across page
reloads (no re-loading the dataset each visit). Two flavours:

**Persistent database file** — open the whole DB on an `opfs://` path:

```ts
await db.open({
  path: 'opfs://cohort.db',
  accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
});
// CREATE TABLE ... persists; on next load the tables are already there.
```

**Register an OPFS-resident data file** — keep a large Parquet in OPFS and query
it with synchronous access handles (near in-memory speed; on Firefox comparable
to in-memory, on Chrome notably faster than naive OPFS):

```ts
await db.registerFileHandle(
  'cohort.parquet',
  null,
  duckdb.DuckDBDataProtocol.BROWSER_FSACCESS,
  true,
);
```

> **Recommendation.** OPFS is a worthwhile v1.1 optimisation: load the synthetic
> Parquet once, persist tables to `opfs://cohort.db`, and skip re-ingestion on
> subsequent visits. Gotchas: OPFS + the `coi` (threaded) bundle has had open
> issues (`db.open` errors under coi; stale handles after a cache clear), so if
> you adopt OPFS, do it with the single-threaded `eh` bundle we already
> recommend. For v1, in-memory ingestion of a ~25k-row table is fast enough that
> OPFS is optional.

---

## 4. Querying patterns

### 4.1 Prepared / parameterised statements

Use `?` placeholders and `prepare()`; never string-concatenate user filter
values (injection + plan re-compilation cost). Reuse the statement across
re-renders when the SQL shape is stable, varying only parameters:

```ts
const stmt = await conn.prepare(
  `SELECT cohort_id, COUNT(*)::INTEGER AS n
   FROM patients
   WHERE age >= ? AND age <= ? AND sex = ?
   GROUP BY cohort_id
   ORDER BY n DESC`,
);
const result = await stmt.query(40, 65, 'F'); // materialised Arrow Table
// ...later, different filter, same compiled plan:
const result2 = await stmt.query(18, 39, 'M');
await stmt.close(); // release; closing the connection also releases statements
```

### 4.2 Arrow results → JS objects

`conn.query()` / `stmt.query()` return an Apache Arrow `Table`:

```ts
const table = await conn.query('SELECT cohort_id, n FROM cohort_counts');

table.numRows;                         // row count
table.toArray();                       // array of Arrow row proxies
table.toArray().map((r) => r.toJSON()); // -> plain JS objects (recommended for React state)

// Columnar access (fast path — avoids per-row object allocation):
const ids = table.getChild('cohort_id')!.toArray(); // typed array / values
const ns  = table.getChild('n')!.toArray();
```

`.toJSON()` on each row proxy gives a clean plain object suitable for setting
React state or feeding chart libraries. For large result sets that you reduce
immediately (e.g. summing), prefer columnar `getChild().toArray()` and avoid
building thousands of intermediate objects.

> **BigInt reminder.** Counts/sums are `BIGINT` → JS `BigInt`. Either set
> `castBigIntToDouble: true` at `db.open()` (section 2.2) or cast per column
> (`COUNT(*)::INTEGER`, `SUM(x)::DOUBLE`). Without this, `JSON.stringify` throws
> and React renders `[object BigInt]` issues.

### 4.3 Streaming large results

For result sets too big to materialise, stream record batches with `send()`:

```ts
const reader = await conn.send('SELECT * FROM patients'); // returns batches
for await (const batch of reader) {
  // batch.numRows; process incrementally
}
```

For cohort aggregations the result is tiny (grouped counts), so plain
`query()` is right; streaming matters only if you ever return raw row-level data.

### 4.4 Performance tips for our shapes (~25k + ~6k + M:N mapping)

These sizes are trivial for DuckDB-Wasm; the wins are about doing the work in
SQL rather than JS:

- **Aggregate in SQL, not JS.** Push `GROUP BY`/`COUNT`/`SUM`/`AVG` into the
  query and return only the small grouped result. Never pull 25k rows into JS to
  count them.
- **Materialise once, query many.** Load the Parquet into real tables (`CREATE
  TABLE AS`) at startup; subsequent filter changes re-run against in-memory
  columnar tables, not re-parsing files.
- **Join order / cardinality.** For a many-to-many through a mapping table, let
  DuckDB plan it; just ensure the mapping table is a real table too. With 25k ×
  6k via a mapping table the hash join is sub-millisecond.
- **Project only needed columns.** `SELECT cohort_id, age` not `SELECT *` —
  columnar storage means unread columns cost nothing to skip.
- **Filter pushdown on Parquet.** If you query `read_parquet(url)` directly over
  HTTP, predicates and `LIMIT` can skip row groups via Parquet metadata; for
  in-memory tables this is moot.
- **Cast counts** to `INTEGER`/`DOUBLE` (see BigInt note) so chart/table
  components consume plain numbers.
- **Index?** DuckDB is a columnar OLAP engine; for these sizes you do **not**
  need indexes. Don't add `CREATE INDEX` reflexively.

---

## 5. Bundle size and lazy loading

The WASM payload is the cost: roughly 4 MB (`eh`) and up depending on tier, plus
the worker and `apache-arrow`. Strategy:

- **Dynamic import the DB layer** so DuckDB is not in the initial JS chunk:

```ts
async function ensureDB() {
  const { getDuckDB } = await import('./db/duckdb'); // code-split point
  return getDuckDB();
}
```

  With Vite this puts DuckDB + Arrow in a separate chunk loaded only when the
  user first runs a query, keeping first paint fast.

- **Lazy-mount the provider.** Wrap the cohort query UI in `React.lazy` +
  `Suspense` so the provider (and therefore instantiation) only kicks off when
  that route/panel is shown.

- **Loading-state UX.** Instantiation is async and visible. Surface three
  states from the provider/hook: `loading` (WASM downloading/compiling — show a
  skeleton or "Preparing query engine…"), `error` (instantiation failed — offer
  retry), and ready. Then per-query, surface `busy` for the (usually brief)
  query execution. Because WASM compile is the long pole, consider kicking off
  `getDuckDB()` speculatively on app idle (`requestIdleCallback`) so it is warm
  by the time the user filters.

- **Self-hosted assets are cacheable.** The `?url`-imported `.wasm`/worker get
  content-hashed filenames and long-cache headers from your host, so the
  multi-MB download is a one-time cost per version.

---

## 6. Known gotchas and version pinning advice

- **`latest` is a prerelease.** `npm i @duckdb/duckdb-wasm` (or `^`) currently
  installs `1.33.1-dev45.0`. **Pin exactly `1.32.0`** (last stable, Dec 2025).
- **Pin `apache-arrow` too** and keep a single copy; mismatched Arrow versions
  break `instanceof` checks on `Table`/`Vector` and corrupt result conversion.
- **`optimizeDeps.exclude` is mandatory** in Vite or the worker won't start.
- **BigInt counts** need `castBigIntToDouble` or per-query casts.
- **OPFS + coi bundle** has open reliability issues (`db.open` under coi; stale
  handles after cache clear). If using OPFS, stay on the single-threaded `eh`
  bundle.
- **COOP/COEP is all-or-nothing.** Enabling it for threads restricts all
  cross-origin embeds on the page; only adopt when parallelism is justified.
- **Browser-only.** Guard instantiation against SSR; DuckDB-Wasm cannot run
  during Node prerender.
- **Strict Mode double-mount.** The module-level promise singleton (section 2.2)
  makes React 18 double-invocation a no-op; do not terminate the DB in an effect
  cleanup.
- **Close statements/connections** you create ad hoc to release WASM memory;
  the app-scoped singleton connection stays open by design.
- **Memory ceiling.** WASM heap is bounded (multi-GB on 64-bit browsers but not
  infinite). Use `registerFileHandle(BROWSER_FILEREADER)` for large uploads and
  prefer aggregation over materialising raw rows in JS.

---

## Sources

- DuckDB-Wasm README and `llms.txt` (instantiation, manual vs JSDelivr bundles, prepared statements, import APIs) — https://github.com/duckdb/duckdb-wasm and https://github.com/duckdb/duckdb-wasm/blob/main/packages/duckdb-wasm/README.md
- DuckDB-Wasm instantiation docs — https://duckdb.org/docs/stable/clients/wasm/instantiation
- DuckDB-Wasm launch article (threads, SharedArrayBuffer, coi bundle) — https://duckdb.org/2021/10/29/duckdb-wasm
- npm package `@duckdb/duckdb-wasm` (versions, dist-tags; verified `latest=1.33.1-dev45.0`, last stable `1.32.0`) — https://www.npmjs.com/package/@duckdb/duckdb-wasm
- Vite dependency pre-bundling (`optimizeDeps.exclude`) — https://vite.dev/guide/dep-pre-bundling
- Cross-origin isolation with COOP/COEP — https://web.dev/articles/coop-coep
- Setting COOP/COEP on static hosting; `coi-serviceworker` — https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/ and https://github.com/gzuidhof/coi-serviceworker
- DuckDBDataProtocol / OPFS interfaces — https://shell.duckdb.org/docs/enums/index.DuckDBDataProtocol.html and https://github.com/duckdb/duckdb-wasm/blob/main/packages/duckdb-wasm/test/opfs.test.ts
- OPFS read/write performance vs IndexedDB — https://www.sambaiz.net/en/article/565/
- React helper libraries — duckdb-wasm-kit (https://github.com/holdenmatt/duckdb-wasm-kit) and @jetblack/duckdb-react (https://github.com/rob-blackbourn/jetblack-duckdb-react)
- Worked Vite + React + DuckDB-Wasm example — https://bufferings.github.io/vite-react-duckdb-wasm/
- DuckDB-Wasm in the browser overview (MotherDuck) — https://motherduck.com/blog/duckdb-wasm-in-browser/
