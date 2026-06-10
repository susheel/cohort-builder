import { describeTable, existingTables, loadTables, rowCount, type TableSource } from '../duckdb/loader';
import type { ColumnInfo } from '../duckdb/loader';
import { inferSpec } from './infer';
import { mergeSpec } from './merge';
import type { CohortSpec, CohortSpecOverride } from './types';

export interface ResolveInput {
  /** data tables to register (bundled URLs or uploaded buffers) */
  sources: TableSource[];
  /** optional override (already parsed) */
  override?: CohortSpecOverride;
  primaryEntity?: string;
}

export interface ResolveResult {
  spec: CohortSpec;
  rowCounts: Record<string, number>;
}

/**
 * Full pipeline: register data -> introspect -> infer base spec -> merge
 * override -> effective spec. The single entry point the app calls on load.
 */
export async function resolveSpec(input: ResolveInput): Promise<ResolveResult> {
  await loadTables(input.sources);
  const tables = await existingTables();

  const columns: Record<string, ColumnInfo[]> = {};
  const rowCounts: Record<string, number> = {};
  for (const t of tables) {
    columns[t] = await describeTable(t);
    rowCounts[t] = await rowCount(t);
  }

  const base = inferSpec(
    { tables: columns, primaryEntity: input.override?.primaryEntity ?? input.primaryEntity },
    rowCounts,
  );
  const spec = mergeSpec(base, input.override);
  return { spec, rowCounts };
}
