import type { ColumnInfo } from '../duckdb/loader';
import {
  CATEGORY_FALLBACK,
  DEFAULT_SDC,
  type CohortSpec,
  type ColumnSpec,
  type Relationship,
  type Sensitivity,
  type TableRole,
  type TableSpec,
  type VariableSpec,
  type WidgetType,
} from './types';

export interface InferInput {
  /** logical table name -> its introspected columns */
  tables: Record<string, ColumnInfo[]>;
  /** which table is the cohort unit; auto-detected if omitted */
  primaryEntity?: string;
}

/** Cardinality at/under which a string column becomes a multiselect facet. */
const MULTISELECT_MAX_CARDINALITY = 30;

export function camelToSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function titleise(name: string): string {
  const spaced = name
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
  // collapse single-letter runs from acronym snake-casing: "C V D" -> "CVD"
  return spaced.replace(/\b(?:[A-Z] )+[A-Z]\b/g, (m) => m.replace(/ /g, ''));
}

/* --------------------------- heuristic keyword maps ---------------------- */

const SENSITIVITY_RULES: [RegExp, Sensitivity][] = [
  [/(data_?type|assay|file_?format|file_?size|file_?name|is_multi|specimen|study_?code|visit|cohort\b)/i, 'None'],
  [/(age_?death|^age$|_age$|race|ethnic|apoe|genotype|family|pedigree|kinship|^diagnosis$|dementia|parkinson|mz_?twin|braak|cause_?death|individual)/i, 'High'],
  [/(sex|gender|mortality|deceased|vital|diagnosis_?status|country|field_?center|postmortem|pmi)/i, 'Medium'],
];

const CATEGORY_RULES: [RegExp, string][] = [
  [/(data_?type|assay|file_?format|file_?size|file_?name|is_multi|specimen|nucleic|library|read_?length|run_?type|platform|genome_?assembly|measurement|technique|array_?manufacturer)/i, 'Data Modality'],
  [/(apoe|genotype|prs|ancestry|kinship|imputation|genetic_?pcs|allele)/i, 'Genetic Stratification'],
  [/has_(biomarker|functional|anthropom|cognitive|education|mmse|moca|cdr|casi|gait|grip|adl|score|imaging|panel|chemistr|glucose|insulin|lipid|cholesterol|crp|il6|igf|cystatin|creatinin|metabolom|proteom|microbiome|wearable|wgs|genotyping|data|history)/i, 'Assessment Availability'],
  [/has_(cvd|c_v_d|hypertension|dementia|diabetes|parkinson|cancer|stroke|depression|anxiety|arthritis|asthma|copd|c_o_p_d|glaucoma|osteoporosis|cabg|c_a_b_g|chf|c_h_f|dvt|d_v_t|mi$|m_i|tia|t_i_a|atrial|peripheral|afib|chd)/i, 'Comorbidity'],
  [/(^age|_age$|sex|gender|race|ethnic|diagnosis|mortality|vital|education|braak|cerad|thal|amy)/i, 'Demographic & Clinical'],
  [/(cohort|study|country|field_?center|family|visit|consent|consortium|program|grant|longevity)/i, 'Study & Cohort Design'],
];

function matchRule<T>(rules: [RegExp, T][], col: string, fallback: T): T {
  for (const [re, val] of rules) if (re.test(col)) return val;
  return fallback;
}

function looksLikeIdentifier(col: string, info: ColumnInfo, rowCount: number): boolean {
  if (/(^id$|_id$|^syn_?id$|^subject_?id$|^family_?id$|uuid|hash|accession|individual_?id)/i.test(col)) {
    return true;
  }
  // high-cardinality strings that approach one-value-per-row are identifiers
  return info.type === 'string' && rowCount > 0 && info.distinctCount > rowCount * 0.8;
}

function chooseWidget(col: string, info: ColumnInfo, isId: boolean): WidgetType {
  if (isId) return 'internal';
  if (info.type === 'boolean') return 'boolean';
  if (info.type === 'integer' || info.type === 'double') {
    if (/(^age$|_age$|age_?death)/i.test(col)) return 'bins';
    if (/(visit|count|n_)/i.test(col)) return 'minCount';
    return 'range';
  }
  // string
  if (info.distinctCount > 0 && info.distinctCount <= MULTISELECT_MAX_CARDINALITY) {
    return 'multiselect';
  }
  return 'internal';
}

const AGE_BINS = [
  { label: '<70', min: 0, max: 69 },
  { label: '70-74', min: 70, max: 74 },
  { label: '75-79', min: 75, max: 79 },
  { label: '80-84', min: 80, max: 84 },
  { label: '85-89', min: 85, max: 89 },
  { label: '90+', min: 90, max: 200 },
];

function classifyTables(
  tables: Record<string, ColumnInfo[]>,
): { roles: Record<string, TableRole>; primary: string; junctions: string[] } {
  const names = Object.keys(tables);
  const roles: Record<string, TableRole> = {};
  const junctions: string[] = [];

  for (const name of names) {
    const cols = tables[name];
    const allIdish = cols.every((c) => /(_id$|^id$|syn)/i.test(c.name));
    if (cols.length <= 3 && allIdish) {
      roles[name] = 'junction';
      junctions.push(name);
    }
  }

  // primary entity: prefer a table literally named subjects/individuals/patients
  const entityCandidates = names.filter((n) => roles[n] !== 'junction');
  let primary =
    entityCandidates.find((n) => /(subject|individual|patient|person|participant)/i.test(n)) ??
    entityCandidates[0] ??
    names[0];

  for (const name of entityCandidates) {
    if (name === primary) roles[name] = 'entity';
    else if (/(file|sample|assay|specimen|biospecimen)/i.test(name)) roles[name] = 'attribute';
    else roles[name] ??= 'attribute';
  }
  roles[primary] = 'entity';
  return { roles, primary, junctions };
}

function inferRelationships(
  tables: Record<string, ColumnInfo[]>,
  roles: Record<string, TableRole>,
  primary: string,
): Relationship[] {
  const rels: Relationship[] = [];
  const pkOf: Record<string, string> = {};
  for (const [name, cols] of Object.entries(tables)) {
    // pick the most id-like column as PK
    pkOf[name] =
      cols.find((c) => c.name === `${singular(name)}_id`)?.name ??
      cols.find((c) => /_id$|^syn_?id$/i.test(c.name))?.name ??
      cols[0]?.name ??
      'id';
  }
  for (const [name, cols] of Object.entries(tables)) {
    if (roles[name] !== 'junction') continue;
    // a 2-col junction linking the primary entity to another table
    const colNames = cols.map((c) => c.name);
    const others = Object.keys(tables).filter((t) => t !== name && roles[t] !== 'junction');
    const fromCol = colNames.find((c) => c === pkOf[primary]);
    const toTable = others.find((t) => t !== primary && colNames.includes(pkOf[t]));
    if (fromCol && toTable) {
      rels.push({
        from: primary,
        to: toTable,
        via: name,
        fromKey: fromCol,
        toKey: pkOf[toTable],
      });
    }
  }
  return rels;
}

function singular(name: string): string {
  return name.endsWith('s') ? name.slice(0, -1) : name;
}

/** Build a base CohortSpec purely from introspected schema + heuristics. */
export function inferSpec(input: InferInput, rowCounts: Record<string, number>): CohortSpec {
  const { roles, primary, junctions } = classifyTables(input.tables);
  const tables: Record<string, TableSpec> = {};
  const variables: VariableSpec[] = [];

  for (const [name, cols] of Object.entries(input.tables)) {
    const role = roles[name];
    const pk =
      cols.find((c) => c.name === `${singular(name)}_id`)?.name ??
      cols.find((c) => /_id$|^syn_?id$/i.test(c.name))?.name ??
      cols[0]?.name ??
      'id';

    const columnSpecs: ColumnSpec[] = cols.map((c) => ({
      name: c.name,
      type: c.type,
      distinctCount: c.distinctCount,
      sampleValues: c.sampleValues,
      nullable: c.nullable,
    }));
    tables[name] = { name, role, primaryKey: pk, columns: columnSpecs };

    if (role === 'junction') continue;

    const rc = rowCounts[name] ?? 0;
    for (const info of cols) {
      const col = info.name;
      const isId = looksLikeIdentifier(col, info, rc);
      const isPk = col === pk;
      const widget = chooseWidget(col, info, isId || isPk);
      const sensitivity = isId || isPk ? 'High' : matchRule(SENSITIVITY_RULES, col, 'Low');
      const category = matchRule(CATEGORY_RULES, col, CATEGORY_FALLBACK);

      const v: VariableSpec = {
        name: col,
        label: titleise(col),
        category,
        entity: name,
        column: col,
        widget,
        sensitivity,
        visible: widget !== 'internal',
        source: 'inferred',
      };
      if (widget === 'multiselect') {
        v.values = info.sampleValues.map(String);
      } else if (widget === 'bins') {
        v.bins = AGE_BINS;
      } else if (widget === 'minCount') {
        const hi = info.numericMax ?? 4;
        v.options = Array.from({ length: Math.min(hi, 4) }, (_, i) => ({
          label: `${i + 1}+`,
          min: i + 1,
        }));
      } else if (widget === 'range') {
        v.range = { min: info.numericMin ?? 0, max: info.numericMax ?? 100 };
      } else if (widget === 'boolean') {
        v.booleanLabels = { yes: 'Yes', no: 'No' };
      }
      variables.push(v);
    }
  }

  const relationships = inferRelationships(input.tables, roles, primary);

  return {
    schemaVersion: '1.0',
    id: 'inferred',
    title: 'Inferred cohort',
    description: 'Spec inferred from data schema and value sampling.',
    primaryEntity: input.primaryEntity ?? primary,
    tables,
    relationships,
    variables,
    sdc: structuredClone(DEFAULT_SDC),
    meta: { source: 'inference', junctions },
  };
}
