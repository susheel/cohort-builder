import { getConnection, getDuckDB, query } from './db';
import type { ColumnType } from '../spec/types';

/** A table to register: either a bundled URL or an uploaded byte buffer. */
export interface TableSource {
  /** logical name the table is registered under */
  name: string;
  url?: string;
  buffer?: Uint8Array;
  /** file name (used to detect csv vs parquet when registering a buffer) */
  fileName?: string;
}

function isCsv(s: { url?: string; fileName?: string }): boolean {
  const n = (s.fileName ?? s.url ?? '').toLowerCase();
  return n.endsWith('.csv') || n.endsWith('.tsv');
}

function readExpr(virtualPath: string, csv: boolean): string {
  return csv
    ? `read_csv_auto('${virtualPath}', SAMPLE_SIZE=-1)`
    : `read_parquet('${virtualPath}')`;
}

/**
 * Register each source as a virtual file and CREATE TABLE from it once, then
 * queries hit the materialised table (faster than re-reading the file each time).
 */
// monotonic token so each load uses fresh virtual file names; re-registering
// an already-registered name in duckdb-wasm can hang, so we never reuse one.
let loadGeneration = 0;

export async function loadTables(sources: TableSource[]): Promise<void> {
  const db = await getDuckDB();
  const conn = await getConnection();
  const gen = ++loadGeneration;

  for (const src of sources) {
    const csv = isCsv(src);
    const virtualPath = `g${gen}_${src.name}.${csv ? 'csv' : 'parquet'}`;

    if (src.buffer) {
      await db.registerFileBuffer(virtualPath, src.buffer);
    } else if (src.url) {
      const resp = await fetch(src.url);
      if (!resp.ok) {
        throw new Error(`failed to fetch ${src.url}: ${resp.status}`);
      }
      const buf = new Uint8Array(await resp.arrayBuffer());
      await db.registerFileBuffer(virtualPath, buf);
    } else {
      throw new Error(`table source ${src.name} has neither url nor buffer`);
    }

    await conn.query(`DROP TABLE IF EXISTS "${src.name}"`);
    await conn.query(
      `CREATE TABLE "${src.name}" AS SELECT * FROM ${readExpr(virtualPath, csv)}`,
    );
  }
}

export interface ColumnInfo {
  name: string;
  type: ColumnType;
  rawType: string;
  distinctCount: number;
  nullable: boolean;
  sampleValues: (string | number | boolean)[];
  numericMin?: number;
  numericMax?: number;
}

function mapDuckType(raw: string): ColumnType {
  const t = raw.toUpperCase();
  if (t === 'BOOLEAN') return 'boolean';
  if (/INT|HUGEINT|UBIGINT/.test(t)) return 'integer';
  if (/DECIMAL|DOUBLE|FLOAT|REAL/.test(t)) return 'double';
  if (/DATE|TIMESTAMP|TIME/.test(t)) return 'date';
  return 'string';
}

const SAMPLE_LIMIT = 60;

/** Introspect a loaded table: types, distinct counts, sample values, ranges. */
export async function describeTable(table: string): Promise<ColumnInfo[]> {
  const { rows: cols } = await query<{ column_name: string; column_type: string }>(
    `DESCRIBE "${table}"`,
  );

  const infos: ColumnInfo[] = [];
  for (const c of cols) {
    const col = c.column_name;
    const type = mapDuckType(c.column_type);

    const { rows: stats } = await query<{
      d: number;
      n: number;
      total: number;
    }>(
      `SELECT COUNT(DISTINCT "${col}") AS d,
              COUNT(*) FILTER (WHERE "${col}" IS NULL) AS n,
              COUNT(*) AS total
       FROM "${table}"`,
    );
    const distinctCount = Number(stats[0]?.d ?? 0);
    const nullable = Number(stats[0]?.n ?? 0) > 0;

    let sampleValues: (string | number | boolean)[] = [];
    let numericMin: number | undefined;
    let numericMax: number | undefined;

    if (type === 'integer' || type === 'double') {
      const { rows: mm } = await query<{ lo: number; hi: number }>(
        `SELECT MIN("${col}") AS lo, MAX("${col}") AS hi FROM "${table}"`,
      );
      numericMin = mm[0]?.lo != null ? Number(mm[0].lo) : undefined;
      numericMax = mm[0]?.hi != null ? Number(mm[0].hi) : undefined;
    }

    // Pull a sample of distinct values for low-cardinality columns (drives the
    // multiselect vocabulary when no override supplies one).
    if (distinctCount > 0 && distinctCount <= SAMPLE_LIMIT) {
      const { rows: vals } = await query<Record<string, string | number | boolean>>(
        `SELECT DISTINCT "${col}" AS v FROM "${table}"
         WHERE "${col}" IS NOT NULL ORDER BY v LIMIT ${SAMPLE_LIMIT}`,
      );
      sampleValues = vals.map((r) => r.v);
    }

    infos.push({
      name: col,
      type,
      rawType: c.column_type,
      distinctCount,
      nullable,
      sampleValues,
      numericMin,
      numericMax,
    });
  }
  return infos;
}

export async function rowCount(table: string): Promise<number> {
  const { rows } = await query<{ c: number }>(`SELECT COUNT(*) AS c FROM "${table}"`);
  return Number(rows[0]?.c ?? 0);
}

/** Which of the candidate tables actually exist in the database. */
export async function existingTables(): Promise<string[]> {
  const { rows } = await query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'main'`,
  );
  return rows.map((r) => r.name);
}
