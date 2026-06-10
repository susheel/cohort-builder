import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

// Self-hosted bundles (Vite `?url` imports). We deliberately skip the `coi`
// threaded bundle: at ~25k + 6k row scale single-threaded `eh` is ample and it
// avoids the COOP/COEP cross-origin-isolation headers that threads require.
const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

/**
 * Module-level cached-promise singleton. Survives React 18 Strict-Mode double
 * mounts (the promise is created once and reused). Never terminated in effect
 * cleanup.
 */
export function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const bundle = await duckdb.selectBundle(BUNDLES);
    const worker = new Worker(bundle.mainWorker!, { type: 'module' });
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    // castBigIntToDouble so COUNT/SUM come back as JS numbers, not BigInt.
    await db.open({
      query: { castBigIntToDouble: true },
    });
    return db;
  })();
  return dbPromise;
}

let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

/** One long-lived connection, reused across the app. */
export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (connPromise) return connPromise;
  connPromise = (async () => {
    const db = await getDuckDB();
    return db.connect();
  })();
  return connPromise;
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

/** Run SQL and return plain JS objects (Arrow rows materialised). */
export async function query<T = Record<string, unknown>>(
  sql: string,
): Promise<QueryResult<T>> {
  const conn = await getConnection();
  const table = await conn.query(sql);
  const rows = table.toArray().map((r) => r.toJSON() as T);
  return { rows, rowCount: rows.length };
}

/** Single-value scalar query helper. */
export async function scalar<T = number>(sql: string): Promise<T> {
  const { rows } = await query<Record<string, T>>(sql);
  const first = rows[0];
  if (!first) throw new Error('scalar query returned no rows');
  return Object.values(first)[0] as T;
}

/** Reset state (used by tests / when re-pointing to new data). */
export async function resetConnection(): Promise<void> {
  if (connPromise) {
    const conn = await connPromise;
    await conn.close();
    connPromise = null;
  }
}
