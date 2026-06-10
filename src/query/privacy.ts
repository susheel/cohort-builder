import type { RuleGroupType } from 'react-querybuilder';
import type { CohortSpec, VariableSpec } from '../spec/types';
import { qualify } from './builder';
import { treeWhere } from './compileTree';

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
  const qiCols = input.qis.map((v) => qualify(table, v.column));
  const groupBy = qiCols.join(', ');
  const ldiv = input.sensitive
    ? `COUNT(DISTINCT ${qualify(table, input.sensitive.column)})`
    : `NULL`;

  return `WITH ec AS (
      SELECT ${qiCols.join(', ')}, COUNT(*) AS sz, ${ldiv} AS ldiv
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
