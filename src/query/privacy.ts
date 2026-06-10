import type { RuleGroupType } from 'react-querybuilder';
import type { CohortSpec, VariableSpec } from '../spec/types';
import { columnType, lit, qualify } from './builder';
import { fieldsInTree, treeWhere } from './compileTree';

/**
 * k-anonymity and l-diversity over the matching cohort.
 *
 * Equivalence classes are formed by grouping the cohort on the quasi-identifier
 * (QI) columns. k-anonymity is the size of the smallest class (the most
 * re-identifiable record shares its QI profile with k-1 others). l-diversity is
 * the smallest number of distinct sensitive-attribute values within any class.
 */

const QI_KEYWORDS =
  /(age_?bin|^sex$|gender|^race$|ethnic|country_?code|field_?center|^cohort$)/i;

/** Variables/columns usable as QIs: subject-level, categorical (multiselect/bins). */
export function resolveQuasiIdentifiers(spec: CohortSpec): VariableSpec[] {
  const onPrimary = (v: VariableSpec) => v.entity === spec.primaryEntity;
  const categorical = (v: VariableSpec) => v.widget === 'multiselect' || v.widget === 'bins';

  if (spec.quasiIdentifiers && spec.quasiIdentifiers.length > 0) {
    return spec.quasiIdentifiers
      .map((n) => spec.variables.find((v) => v.name === n))
      .filter((v): v is VariableSpec => !!v && onPrimary(v));
  }
  // default: subject-level categorical demographics that look like QIs
  return spec.variables.filter(
    (v) => onPrimary(v) && categorical(v) && v.visible !== false && QI_KEYWORDS.test(v.column),
  );
}

/**
 * The quasi-identifiers that actually apply to a given query: the spec baseline
 * (declared or heuristic) UNION the subject-level categorical/bin/boolean
 * variables the query constrains on. This makes k-anonymity and l-diversity
 * respond to the dimensions a particular cohort is defined by, rather than a
 * single fixed set: adding an age + ethnicity filter narrows the equivalence
 * classes and the scores move accordingly. The sensitive attribute is removed
 * elsewhere so it is never also treated as a quasi-identifier.
 */
export function effectiveQuasiIdentifiers(spec: CohortSpec, query: RuleGroupType): VariableSpec[] {
  const onPrimary = (v: VariableSpec) => v.entity === spec.primaryEntity;
  const categorical = (v: VariableSpec) =>
    v.widget === 'multiselect' || v.widget === 'bins' || v.widget === 'boolean';

  const byName = new Map<string, VariableSpec>();
  for (const v of resolveQuasiIdentifiers(spec)) byName.set(v.name, v);
  for (const name of fieldsInTree(spec, query)) {
    const v = spec.variables.find((x) => x.name === name);
    if (v && onPrimary(v) && categorical(v) && v.visible !== false && v.widget !== 'internal') {
      byName.set(v.name, v);
    }
  }
  return [...byName.values()];
}

/** The sensitive attribute for l-diversity (a subject-level categorical variable). */
export function resolveSensitiveAttribute(spec: CohortSpec): VariableSpec | undefined {
  const onPrimary = (v: VariableSpec) => v.entity === spec.primaryEntity;
  if (spec.sensitiveAttribute) {
    const v = spec.variables.find((x) => x.name === spec.sensitiveAttribute);
    if (v && onPrimary(v)) return v;
  }
  const prefer = ['diagnosis', 'apoeGenotype', 'apoe_genotype'];
  for (const p of prefer) {
    const v = spec.variables.find((x) => (x.name === p || x.column === p) && onPrimary(x));
    if (v) return v;
  }
  // fall back to the highest-sensitivity subject-level categorical not used as a QI
  return spec.variables.find(
    (v) => onPrimary(v) && v.widget === 'multiselect' && v.sensitivity === 'High',
  );
}

export interface PrivacyMetricsInput {
  qis: VariableSpec[];
  sensitive?: VariableSpec;
}

/**
 * The SQL expression that buckets a quasi-identifier into its disclosed form.
 * For bins this is the bin label (not the raw numeric), matching how the rest
 * of the app groups by bins; otherwise the raw value cast to text.
 */
function qiExpr(spec: CohortSpec, v: VariableSpec): string {
  const table = spec.primaryEntity;
  const q = qualify(table, v.column);
  if (v.widget === 'bins' && v.bins && v.bins.length > 0) {
    const cases = v.bins
      .map((b) => `WHEN ${q} BETWEEN ${b.min} AND ${b.max} THEN ${lit(b.label)}`)
      .join(' ');
    return `CASE ${cases} ELSE 'Unknown' END`;
  }
  if (v.widget === 'boolean') {
    const ty = columnType(spec, v.entity, v.column);
    return ty === 'boolean'
      ? `CASE WHEN ${q} THEN ${lit(v.booleanLabels?.yes ?? 'Yes')} ELSE ${lit(v.booleanLabels?.no ?? 'No')} END`
      : `CAST(${q} AS VARCHAR)`;
  }
  return `CAST(${q} AS VARCHAR)`;
}

/**
 * One query returning k-anonymity, l-diversity and class statistics for the
 * cohort defined by `query`. Returns null when there are no QI columns.
 */
export function privacyMetricsSql(
  spec: CohortSpec,
  query: RuleGroupType,
  input: PrivacyMetricsInput,
): string | null {
  if (input.qis.length === 0) return null;
  const where = treeWhere(spec, query);
  const table = spec.primaryEntity;
  const qiExprs = input.qis.map((v) => qiExpr(spec, v));
  // Equivalence classes group on the bucketed QI expressions; ordinal GROUP BY
  // keeps the expressions in sync with the SELECT list.
  const selectQis = qiExprs.map((e, i) => `${e} AS qi${i}`).join(', ');
  const groupBy = qiExprs.map((_, i) => i + 1).join(', ');
  const ldiv = input.sensitive
    ? `COUNT(DISTINCT ${qualify(table, input.sensitive.column)})`
    : `NULL`;

  return `WITH ec AS (
      SELECT ${selectQis}, COUNT(*) AS sz, ${ldiv} AS ldiv
      FROM "${table}" WHERE ${where}
      GROUP BY ${groupBy}
    )
    SELECT
      MIN(sz) AS k_anon,
      ${input.sensitive ? 'MIN(ldiv)' : 'NULL'} AS l_div,
      COUNT(*) AS classes,
      COALESCE(SUM(sz), 0) AS total,
      COALESCE(SUM(CASE WHEN sz < {K} THEN sz ELSE 0 END), 0) AS records_at_risk,
      COALESCE(SUM(CASE WHEN sz < {K} THEN 1 ELSE 0 END), 0) AS classes_at_risk
    FROM ec`;
}

export interface PrivacyMetrics {
  kAnonymity: number;
  lDiversity: number | null;
  classes: number;
  total: number;
  recordsAtRisk: number;
  classesAtRisk: number;
  /** the threshold k the cohort's sensitivity implies */
  threshold: number;
  qiLabels: string[];
  sensitiveLabel?: string;
}
