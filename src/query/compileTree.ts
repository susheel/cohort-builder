import type { RuleGroupType, RuleType } from 'react-querybuilder';
import type { CohortSpec, VariableSpec } from '../spec/types';
import {
  boolEq,
  columnType,
  dataFileColumns,
  fileMembership,
  junctionRelationship,
  lit,
  primaryKeyOf,
  qualify,
} from './builder';

/* ------------------------------ value helpers ---------------------------- */

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter((s) => s !== '');
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  if (value == null) return [];
  return [String(value)];
}

function toRange(value: unknown): [number, number] | null {
  let parts: number[];
  if (Array.isArray(value)) parts = value.map(Number);
  else if (typeof value === 'string') parts = value.split(',').map((s) => Number(s.trim()));
  else return null;
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1]];
}

function variableOf(spec: CohortSpec, field: string): VariableSpec | undefined {
  return spec.variables.find((v) => v.name === field);
}

function isGroup(r: RuleType | RuleGroupType): r is RuleGroupType {
  return 'rules' in r;
}

/* ------------------------------- predicates ------------------------------ */

function binClause(v: VariableSpec, q: string, labels: string[]): string | null {
  const bins = (v.bins ?? []).filter((b) => labels.includes(b.label));
  if (bins.length === 0) return null;
  const clause = bins.map((b) => `(${q} BETWEEN ${b.min} AND ${b.max})`).join(' OR ');
  return bins.length > 1 ? `(${clause})` : clause;
}

/** A single rule -> SQL predicate on the primary entity, or null if inactive. */
export function rulePredicate(spec: CohortSpec, rule: RuleType): string | null {
  const v = variableOf(spec, rule.field);
  if (!v) return null;
  const table = v.entity;
  const onPrimary = table === spec.primaryEntity;
  const q = qualify(table, v.column);
  const wrapFile = (clause: string) => (onPrimary ? clause : fileMembership(spec, table, clause));

  let pred: string | null = null;

  switch (rule.operator) {
    case '=': {
      const want = rule.value === true || rule.value === 'true';
      pred = onPrimary
        ? boolEq(spec, table, v.column, want)
        : fileMembership(spec, table, boolEq(spec, table, v.column, want));
      break;
    }
    case 'in':
    case 'notIn': {
      const vals = toArray(rule.value);
      if (vals.length === 0) return null;
      const negate = rule.operator === 'notIn';
      if (v.widget === 'bins') {
        const clause = binClause(v, q, vals);
        if (!clause) return null;
        pred = wrapFile(clause);
        if (pred && negate) pred = `NOT (${pred})`;
      } else {
        const inList = vals.map(lit).join(', ');
        if (onPrimary) {
          pred = `${q} ${negate ? 'NOT IN' : 'IN'} (${inList})`;
        } else {
          const member = fileMembership(spec, table, `${q} IN (${inList})`);
          pred = member ? (negate ? `NOT (${member})` : member) : null;
        }
      }
      break;
    }
    case 'all': {
      const vals = toArray(rule.value);
      if (vals.length === 0) return null;
      if (onPrimary) {
        // subject column cannot hold multiple values: fall back to IN
        pred = `${q} IN (${vals.map(lit).join(', ')})`;
      } else {
        const parts = vals
          .map((val) => fileMembership(spec, table, `${q} = ${lit(val)}`))
          .filter((p): p is string => p != null);
        pred = parts.length ? `(${parts.join(' AND ')})` : null;
      }
      break;
    }
    case 'between': {
      const r = toRange(rule.value);
      if (!r) return null;
      pred = wrapFile(`${q} BETWEEN ${r[0]} AND ${r[1]}`);
      break;
    }
    case '>=': {
      const n = Number(rule.value);
      if (Number.isNaN(n) || n <= 0) return null;
      pred = wrapFile(`${q} >= ${n}`);
      break;
    }
    default:
      return null;
  }
  return pred;
}

/* --------------------------------- groups -------------------------------- */

function compileGroup(spec: CohortSpec, group: RuleGroupType): string | null {
  const parts: string[] = [];
  for (const r of group.rules) {
    const p = isGroup(r) ? compileGroup(spec, r) : rulePredicate(spec, r);
    if (p) parts.push(p);
  }
  if (parts.length === 0) return null;
  const join = (group.combinator ?? 'and').toLowerCase() === 'or' ? ' OR ' : ' AND ';
  let clause = parts.length > 1 ? `(${parts.join(join)})` : parts[0];
  if (group.not) clause = `NOT ${parts.length > 1 ? clause : `(${clause})`}`;
  return clause;
}

/** Compile a query tree to a WHERE body ('1=1' when empty). */
export function treeWhere(spec: CohortSpec, query: RuleGroupType): string {
  return compileGroup(spec, query) ?? '1=1';
}

/** Distinct field names that contribute an active predicate. */
export function fieldsInTree(spec: CohortSpec, query: RuleGroupType): string[] {
  const out = new Set<string>();
  const walk = (g: RuleGroupType) => {
    for (const r of g.rules) {
      if (isGroup(r)) walk(r);
      else if (rulePredicate(spec, r) != null) out.add(r.field);
    }
  };
  walk(query);
  return [...out];
}

/** Deep-clone the tree with all rules referencing `field` removed. */
export function excludeField(query: RuleGroupType, field: string): RuleGroupType {
  const prune = (g: RuleGroupType): RuleGroupType => ({
    ...g,
    rules: g.rules
      .filter((r) => isGroup(r) || r.field !== field)
      .map((r) => (isGroup(r) ? prune(r) : r)),
  });
  return prune(query);
}

/* --------------------------------- SQL ----------------------------------- */

export function treeCountSql(spec: CohortSpec, query: RuleGroupType): string {
  return `SELECT COUNT(*) AS n FROM "${spec.primaryEntity}" WHERE ${treeWhere(spec, query)}`;
}

export function populationSql(spec: CohortSpec): string {
  return `SELECT COUNT(*) AS n FROM "${spec.primaryEntity}"`;
}

function cohortSubquery(spec: CohortSpec, query: RuleGroupType): string {
  return `SELECT "${primaryKeyOf(spec)}" FROM "${spec.primaryEntity}" WHERE ${treeWhere(spec, query)}`;
}

/** Facet counts for `by`, conditional on the rest of the query (own field dropped). */
export function facetSql(spec: CohortSpec, query: RuleGroupType, by: VariableSpec): string | null {
  const conditioned = excludeField(query, by.name);
  const where = treeWhere(spec, conditioned);
  const onPrimary = by.entity === spec.primaryEntity;

  if (onPrimary) {
    const q = qualify(spec.primaryEntity, by.column);
    if (by.widget === 'boolean') {
      const ty = columnType(spec, by.entity, by.column);
      const label =
        ty === 'boolean'
          ? `CASE WHEN ${q} THEN ${lit(by.booleanLabels?.yes ?? 'Yes')} ELSE ${lit(by.booleanLabels?.no ?? 'No')} END`
          : `CAST(${q} AS VARCHAR)`;
      return `SELECT ${label} AS value, COUNT(*) AS n FROM "${spec.primaryEntity}" WHERE ${where} GROUP BY value`;
    }
    if (by.widget === 'bins' && by.bins) {
      const cases = by.bins
        .map((b) => `WHEN ${q} BETWEEN ${b.min} AND ${b.max} THEN ${lit(b.label)}`)
        .join(' ');
      return `SELECT CASE ${cases} ELSE 'Unknown' END AS value, COUNT(*) AS n
              FROM "${spec.primaryEntity}" WHERE ${where} GROUP BY value`;
    }
    return `SELECT CAST(${q} AS VARCHAR) AS value, COUNT(*) AS n
            FROM "${spec.primaryEntity}" WHERE ${where} GROUP BY value ORDER BY n DESC LIMIT 60`;
  }

  const rel = spec.relationships.find((r) => r.to === by.entity || r.from === by.entity);
  if (!rel || !rel.via) return null;
  const targetPk = spec.tables[by.entity]?.primaryKey ?? rel.toKey;
  const q = qualify(by.entity, by.column);
  return `SELECT CAST(${q} AS VARCHAR) AS value, COUNT(DISTINCT "${rel.via}"."${rel.fromKey}") AS n
          FROM "${rel.via}"
          JOIN "${by.entity}" ON "${rel.via}"."${rel.toKey}" = ${qualify(by.entity, targetPk)}
          WHERE "${rel.via}"."${rel.fromKey}" IN (${cohortSubquery(spec, conditioned)})
          GROUP BY value ORDER BY n DESC LIMIT 60`;
}

export function breakdownSql(spec: CohortSpec, query: RuleGroupType, by: VariableSpec): string | null {
  if (by.entity !== spec.primaryEntity) {
    const inner = facetSql(spec, query, by);
    return inner ? `SELECT value AS bucket, n FROM (${inner})` : null;
  }
  const where = treeWhere(spec, query);
  const q = qualify(spec.primaryEntity, by.column);
  if (by.widget === 'bins' && by.bins) {
    const cases = by.bins
      .map((b) => `WHEN ${q} BETWEEN ${b.min} AND ${b.max} THEN ${lit(b.label)}`)
      .join(' ');
    return `SELECT CASE ${cases} ELSE 'Unknown' END AS bucket, COUNT(*) AS n
            FROM "${spec.primaryEntity}" WHERE ${where} GROUP BY bucket ORDER BY bucket`;
  }
  if (by.widget === 'boolean') {
    const ty = columnType(spec, by.entity, by.column);
    const label =
      ty === 'boolean'
        ? `CASE WHEN ${q} THEN ${lit(by.booleanLabels?.yes ?? 'Yes')} ELSE ${lit(by.booleanLabels?.no ?? 'No')} END`
        : `CAST(${q} AS VARCHAR)`;
    return `SELECT ${label} AS bucket, COUNT(*) AS n FROM "${spec.primaryEntity}" WHERE ${where} GROUP BY bucket ORDER BY bucket`;
  }
  return `SELECT CAST(${q} AS VARCHAR) AS bucket, COUNT(*) AS n
          FROM "${spec.primaryEntity}" WHERE ${where} GROUP BY bucket ORDER BY n DESC LIMIT 40`;
}

export function dataFilesSql(
  spec: CohortSpec,
  query: RuleGroupType,
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
          WHERE "${rel.via}"."${rel.fromKey}" IN (${cohortSubquery(spec, query)})
          GROUP BY ${groupBy}
          ORDER BY subject_count DESC
          LIMIT ${opts.limit} OFFSET ${opts.offset}`;
}

export function dataFilesCountSql(spec: CohortSpec, query: RuleGroupType): string | null {
  const rel = junctionRelationship(spec);
  if (!rel || !rel.via) return null;
  return `SELECT COUNT(DISTINCT "${rel.via}"."${rel.toKey}") AS n
          FROM "${rel.via}"
          WHERE "${rel.via}"."${rel.fromKey}" IN (${cohortSubquery(spec, query)})`;
}

export const EMPTY_QUERY: RuleGroupType = { combinator: 'and', rules: [] };
