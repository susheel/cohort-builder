import type { CohortSpec, ColumnType, Relationship, VariableSpec } from '../spec/types';
import { type ActiveFilter, type FilterState, isActive, multiMode } from './types';

/** SQL string-literal escaping (single quotes doubled). */
export function lit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

export function qualify(table: string, col: string): string {
  return `"${table}"."${col}"`;
}

export function columnType(spec: CohortSpec, table: string, col: string): ColumnType {
  const t = spec.tables[table];
  return t?.columns.find((c) => c.name === col)?.type ?? 'string';
}

export function primaryKeyOf(spec: CohortSpec): string {
  return spec.tables[spec.primaryEntity]?.primaryKey ?? 'subject_id';
}

/** Boolean predicate that works whether the column is BOOLEAN or text. */
export function boolEq(spec: CohortSpec, table: string, col: string, want: boolean): string {
  const ty = columnType(spec, table, col);
  const q = qualify(table, col);
  if (ty === 'boolean') return `${q} = ${want ? 'TRUE' : 'FALSE'}`;
  const truth = `lower(CAST(${q} AS VARCHAR)) IN ('true','1','yes','t','y')`;
  return want ? truth : `NOT (${truth})`;
}

/** The subjects<->files style relationship (the one with a junction table). */
export function junctionRelationship(spec: CohortSpec): Relationship | undefined {
  return (
    spec.relationships.find((r) => r.via && (r.from === spec.primaryEntity || r.to === spec.primaryEntity)) ??
    spec.relationships.find((r) => r.via)
  );
}

function primaryKey(spec: CohortSpec): string {
  return spec.tables[spec.primaryEntity]?.primaryKey ?? 'subject_id';
}

/**
 * Membership predicate on the primary entity for a file-level variable: the
 * subject is linked, through the junction, to a file matching `valueClause`.
 */
export function fileMembership(spec: CohortSpec, table: string, valueClause: string): string | null {
  const rel = spec.relationships.find((r) => r.to === table || r.from === table);
  if (!rel) return null;
  const pk = primaryKey(spec);
  const targetPk = spec.tables[table]?.primaryKey ?? rel.toKey;
  if (rel.via) {
    return `${qualify(spec.primaryEntity, pk)} IN (
      SELECT "${rel.via}"."${rel.fromKey}"
      FROM "${rel.via}"
      JOIN "${table}" ON "${rel.via}"."${rel.toKey}" = ${qualify(table, targetPk)}
      WHERE ${valueClause}
    )`;
  }
  return `${qualify(spec.primaryEntity, pk)} IN (
    SELECT ${qualify(table, rel.fromKey)} FROM "${table}" WHERE ${valueClause}
  )`;
}

/** Build the predicate for a single active filter. Returns null if inactive. */
function predicateFor(spec: CohortSpec, f: ActiveFilter): string | null {
  const v = spec.variables.find((x) => x.name === f.variable);
  if (!v) return null;

  const onPrimary = v.entity === spec.primaryEntity;
  const table = v.entity;
  let pred: string | null = null;

  switch (f.value.kind) {
    case 'boolean': {
      if (f.value.choice === 'any') return null;
      pred = onPrimary
        ? boolEq(spec, table, v.column, f.value.choice === 'yes')
        : fileMembership(spec, table, boolEq(spec, table, v.column, f.value.choice === 'yes'));
      break;
    }
    case 'multiselect': {
      const vals = f.value.values;
      if (vals.length === 0) return null;
      const mode = multiMode(f.value);
      const q = qualify(table, v.column);
      const inList = vals.map(lit).join(', ');

      if (onPrimary) {
        // a single subject column cannot hold multiple values: ALL collapses to ANY
        if (mode === 'none') pred = `${q} NOT IN (${inList})`;
        else pred = `${q} IN (${inList})`;
      } else if (mode === 'all') {
        // subject must link to a file for EVERY selected value
        const parts = vals
          .map((val) => fileMembership(spec, table, `${q} = ${lit(val)}`))
          .filter((p): p is string => p != null);
        pred = parts.length ? `(${parts.join(' AND ')})` : null;
      } else if (mode === 'none') {
        const member = fileMembership(spec, table, `${q} IN (${inList})`);
        pred = member ? `NOT (${member})` : null;
      } else {
        pred = fileMembership(spec, table, `${q} IN (${inList})`);
      }
      break;
    }
    case 'bins': {
      const labels = f.value.labels;
      const bins = (v.bins ?? []).filter((b) => labels.includes(b.label));
      if (bins.length === 0) return null;
      const q = qualify(table, v.column);
      let clause = bins.map((b) => `(${q} BETWEEN ${b.min} AND ${b.max})`).join(' OR ');
      if (bins.length > 1) clause = `(${clause})`;
      pred = multiMode(f.value) === 'none' ? `NOT ${clause}` : clause;
      break;
    }
    case 'minCount': {
      if (f.value.min <= 0) return null;
      const c = `${qualify(table, v.column)} >= ${f.value.min}`;
      pred = onPrimary ? c : fileMembership(spec, table, c);
      break;
    }
    case 'range': {
      const c = `${qualify(table, v.column)} BETWEEN ${f.value.min} AND ${f.value.max}`;
      pred = onPrimary ? c : fileMembership(spec, table, c);
      break;
    }
  }
  if (pred == null) return null;
  if (f.negate) pred = `NOT (${pred})`;
  return pred;
}

export interface CompiledQuery {
  where: string;
  predicateCount: number;
}

/**
 * Compose active filters: ungrouped filters AND together; filters sharing an
 * OR-group are OR'd, and that clause is AND'd with the rest.
 */
export function compileFilters(
  spec: CohortSpec,
  filters: FilterState,
  exclude?: string,
): CompiledQuery {
  const ungrouped: string[] = [];
  const groups = new Map<string, string[]>();
  let count = 0;

  for (const f of Object.values(filters)) {
    if (exclude && f.variable === exclude) continue;
    if (!isActive(f)) continue;
    const p = predicateFor(spec, f);
    if (!p) continue;
    count += 1;
    const g = f.group?.trim();
    if (g) {
      const arr = groups.get(g) ?? [];
      arr.push(p);
      groups.set(g, arr);
    } else {
      ungrouped.push(p);
    }
  }

  const clauses = [...ungrouped];
  for (const preds of groups.values()) {
    clauses.push(preds.length > 1 ? `(${preds.join(' OR ')})` : preds[0]);
  }
  return { where: clauses.length ? clauses.join('\n  AND ') : '1=1', predicateCount: count };
}

export function countSql(spec: CohortSpec, filters: FilterState): string {
  const { where } = compileFilters(spec, filters);
  return `SELECT COUNT(*) AS n FROM "${spec.primaryEntity}" WHERE ${where}`;
}

export function populationSql(spec: CohortSpec): string {
  return `SELECT COUNT(*) AS n FROM "${spec.primaryEntity}"`;
}

/** Subquery selecting the primary keys of the cohort matching all filters. */
function cohortSubquery(spec: CohortSpec, filters: FilterState): string {
  const { where } = compileFilters(spec, filters);
  return `SELECT "${primaryKey(spec)}" FROM "${spec.primaryEntity}" WHERE ${where}`;
}

/* --------------------------------- facets -------------------------------- */

/**
 * Per-value counts for `by`, conditional on all OTHER active filters (true
 * faceted search). The caller applies SDC per value at the variable's
 * sensitivity. Returns rows {value, n}.
 */
export function facetSql(spec: CohortSpec, filters: FilterState, by: VariableSpec): string | null {
  const onPrimary = by.entity === spec.primaryEntity;
  const { where } = compileFilters(spec, filters, by.name);

  if (onPrimary) {
    const q = qualify(spec.primaryEntity, by.column);
    if (by.widget === 'boolean') {
      const ty = columnType(spec, by.entity, by.column);
      const label =
        ty === 'boolean'
          ? `CASE WHEN ${q} THEN ${lit(by.booleanLabels?.yes ?? 'Yes')} ELSE ${lit(by.booleanLabels?.no ?? 'No')} END`
          : `CAST(${q} AS VARCHAR)`;
      return `SELECT ${label} AS value, COUNT(*) AS n FROM "${spec.primaryEntity}"
              WHERE ${where} GROUP BY value`;
    }
    if (by.widget === 'bins' && by.bins) {
      const cases = by.bins
        .map((b) => `WHEN ${q} BETWEEN ${b.min} AND ${b.max} THEN ${lit(b.label)}`)
        .join(' ');
      return `SELECT CASE ${cases} ELSE 'Unknown' END AS value, COUNT(*) AS n
              FROM "${spec.primaryEntity}" WHERE ${where} GROUP BY value`;
    }
    return `SELECT CAST(${q} AS VARCHAR) AS value, COUNT(*) AS n
            FROM "${spec.primaryEntity}" WHERE ${where}
            GROUP BY value ORDER BY n DESC LIMIT 60`;
  }

  // file-level facet: subjects (matching other filters) linked to a file per value
  const rel = spec.relationships.find((r) => r.to === by.entity || r.from === by.entity);
  if (!rel || !rel.via) return null;
  const targetPk = spec.tables[by.entity]?.primaryKey ?? rel.toKey;
  const q = qualify(by.entity, by.column);
  return `SELECT CAST(${q} AS VARCHAR) AS value, COUNT(DISTINCT "${rel.via}"."${rel.fromKey}") AS n
          FROM "${rel.via}"
          JOIN "${by.entity}" ON "${rel.via}"."${rel.toKey}" = ${qualify(by.entity, targetPk)}
          WHERE "${rel.via}"."${rel.fromKey}" IN (${cohortSubquery(spec, filters)})
          GROUP BY value ORDER BY n DESC LIMIT 60`;
}

/* ------------------------------ data files ------------------------------- */

export interface DataFileColumns {
  fileTable: string;
  cols: string[];
}

/** Which file-table columns to surface in the data table. */
export function dataFileColumns(spec: CohortSpec): DataFileColumns | null {
  const rel = junctionRelationship(spec);
  if (!rel) return null;
  const fileTable = rel.to === spec.primaryEntity ? rel.from : rel.to;
  const t = spec.tables[fileTable];
  if (!t) return null;
  return { fileTable, cols: t.columns.map((c) => c.name) };
}

/**
 * Files linked to the current cohort, one row per file, with a count of
 * matching subjects per file (the caller applies SDC to that count).
 */
export function dataFilesSql(
  spec: CohortSpec,
  filters: FilterState,
  opts: { limit: number; offset: number },
): string | null {
  const info = dataFileColumns(spec);
  const rel = junctionRelationship(spec);
  if (!info || !rel || !rel.via) return null;
  const { fileTable, cols } = info;
  const filePk = spec.tables[fileTable]?.primaryKey ?? rel.toKey;
  const select = cols.map((c) => qualify(fileTable, c)).join(', ');
  const groupBy = cols.map((_, i) => i + 1).join(', ');
  return `SELECT ${select}, COUNT(DISTINCT "${rel.via}"."${rel.fromKey}") AS subject_count
          FROM "${fileTable}"
          JOIN "${rel.via}" ON "${rel.via}"."${rel.toKey}" = ${qualify(fileTable, filePk)}
          WHERE "${rel.via}"."${rel.fromKey}" IN (${cohortSubquery(spec, filters)})
          GROUP BY ${groupBy}
          ORDER BY subject_count DESC
          LIMIT ${opts.limit} OFFSET ${opts.offset}`;
}

/** Number of distinct files linked to the current cohort (for pagination). */
export function dataFilesCountSql(spec: CohortSpec, filters: FilterState): string | null {
  const rel = junctionRelationship(spec);
  if (!rel || !rel.via) return null;
  return `SELECT COUNT(DISTINCT "${rel.via}"."${rel.toKey}") AS n
          FROM "${rel.via}"
          WHERE "${rel.via}"."${rel.fromKey}" IN (${cohortSubquery(spec, filters)})`;
}

/* --------------------------- characterisation ---------------------------- */

export function breakdownSql(
  spec: CohortSpec,
  filters: FilterState,
  by: VariableSpec,
): string | null {
  if (by.entity !== spec.primaryEntity) {
    // file-level breakdown reuses the facet query (subject counts per value),
    // but with this variable's OWN filter applied too and the column renamed.
    const inner = facetSql(spec, filters, by);
    return inner ? `SELECT value AS bucket, n FROM (${inner})` : null;
  }
  const { where } = compileFilters(spec, filters);
  const q = qualify(spec.primaryEntity, by.column);

  if (by.widget === 'bins' && by.bins) {
    const cases = by.bins
      .map((b) => `WHEN ${q} BETWEEN ${b.min} AND ${b.max} THEN ${lit(b.label)}`)
      .join(' ');
    return `SELECT CASE ${cases} ELSE 'Unknown' END AS bucket, COUNT(*) AS n
            FROM "${spec.primaryEntity}" WHERE ${where}
            GROUP BY bucket ORDER BY bucket`;
  }
  if (by.widget === 'boolean') {
    const ty = columnType(spec, by.entity, by.column);
    const label =
      ty === 'boolean'
        ? `CASE WHEN ${q} THEN ${lit(by.booleanLabels?.yes ?? 'Yes')} ELSE ${lit(by.booleanLabels?.no ?? 'No')} END`
        : `CAST(${q} AS VARCHAR)`;
    return `SELECT ${label} AS bucket, COUNT(*) AS n
            FROM "${spec.primaryEntity}" WHERE ${where}
            GROUP BY bucket ORDER BY bucket`;
  }
  return `SELECT CAST(${q} AS VARCHAR) AS bucket, COUNT(*) AS n
          FROM "${spec.primaryEntity}" WHERE ${where}
          GROUP BY bucket ORDER BY n DESC LIMIT 40`;
}
