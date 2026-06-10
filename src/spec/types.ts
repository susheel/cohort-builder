/**
 * Cohort Spec — the single declarative contract that configures the entire
 * Cohort Builder: the data tables, the filterable variables and their widgets,
 * the many-to-many relationships, and the statistical disclosure control (SDC)
 * policy. The UI, the DuckDB query builder, and the SDC engine all read from a
 * resolved CohortSpec.
 *
 * A spec can be produced three ways (and combined):
 *   1. Inferred from a data file's schema + value sampling (zero config).
 *   2. Authored by hand as an override file (YAML / TOML / JSON).
 *   3. Compiled from an external source (e.g. the ELITE xlsx workbook).
 *
 * The effective spec used at runtime = inferred base ⊕ override.
 */

export type Sensitivity = 'None' | 'Low' | 'Medium' | 'High';

export type WidgetType =
  | 'boolean' // tri-state Any / Yes / No
  | 'multiselect' // controlled-vocabulary membership (OR within)
  | 'bins' // labelled numeric buckets, e.g. age
  | 'minCount' // "n+ of something", e.g. visit count
  | 'range' // numeric min/max slider
  | 'internal'; // present in data, never shown as a filter

export type ColumnType = 'boolean' | 'integer' | 'double' | 'string' | 'date';

export type TableRole = 'entity' | 'attribute' | 'junction' | 'lookup';

export interface ColumnSpec {
  name: string;
  type: ColumnType;
  /** number of distinct non-null values, when known (drives widget choice) */
  distinctCount?: number;
  /** small sample of values, for UI affordances / inference */
  sampleValues?: (string | number | boolean)[];
  nullable?: boolean;
}

export interface FileSource {
  /** URL relative to the app (e.g. /data/elite/subjects.parquet) */
  url?: string;
  format?: 'parquet' | 'csv';
  /** key matching an uploaded file handle, when data is provided at runtime */
  uploadKey?: string;
}

export interface TableSpec {
  /** logical name; also the name the table is registered under in DuckDB */
  name: string;
  role: TableRole;
  primaryKey: string;
  columns: ColumnSpec[];
  source?: FileSource;
}

/** A many-to-many (or one-to-many) link between two tables through a junction. */
export interface Relationship {
  /** the entity side, e.g. "subjects" */
  from: string;
  /** the other side, e.g. "files" */
  to: string;
  /** junction table name, e.g. "subject_files"; omit for a direct FK */
  via?: string;
  /** junction column referencing `from`'s primary key */
  fromKey: string;
  /** junction column referencing `to`'s primary key */
  toKey: string;
}

export interface AgeBin {
  label: string;
  min: number;
  max: number;
}

export interface MinCountOption {
  label: string;
  min: number;
}

export interface VariableSpec {
  name: string;
  label: string;
  category: string;
  description?: string | null;
  /** logical table the column lives on */
  entity: string;
  column: string;
  widget: WidgetType;
  sensitivity: Sensitivity;
  /** multiselect controlled vocabulary */
  values?: string[];
  /** bins widget buckets */
  bins?: AgeBin[];
  /** minCount widget options */
  options?: MinCountOption[];
  /** range widget bounds */
  range?: { min: number; max: number; step?: number };
  /** labels for the two boolean states */
  booleanLabels?: { yes: string; no: string };
  /** maps controlled-vocab values to macro groups for drill-down */
  macro?: Record<string, string>;
  /** false hides it from the filter panel (still queryable internally) */
  visible?: boolean;
  /** provenance of this entry after the merge */
  source?: 'inferred' | 'override' | 'merged';
  /** free-form note surfaced in the UI (e.g. visualization guidance) */
  note?: string | null;
}

export interface SdcLevelPolicy {
  /** suppress any non-zero count strictly below this threshold */
  thresholdK: number;
  /** rounding granularity; 1 disables rounding */
  roundingBase: number;
  roundingMode: 'none' | 'nearest' | 'up' | 'random';
  /** apply secondary suppression on cross-tabs to block differencing */
  complementarySuppression: boolean;
  /** return only "data available / insufficient", never a number */
  booleanOnly: boolean;
  /** treat a true zero as disclosive (suppress it too) */
  zeroIsDisclosive: boolean;
}

export interface SdcConfig {
  enabled: boolean;
  levels: Record<Sensitivity, SdcLevelPolicy>;
  global: {
    /** reject queries whose unfiltered population is below this */
    minQuerySetSize: number;
    /** warn after this many near-identical queries in a session */
    queryRepetitionLimit: number;
  };
}

export interface CohortSpec {
  schemaVersion: string;
  id: string;
  title: string;
  description?: string;
  /** logical table that represents one unit of the cohort (e.g. "subjects") */
  primaryEntity: string;
  tables: Record<string, TableSpec>;
  relationships: Relationship[];
  variables: VariableSpec[];
  sdc: SdcConfig;
  /** variable names to show as default characterisation charts */
  defaultCharts?: string[];
  /** provenance metadata */
  meta?: Record<string, unknown>;
}

/* ----------------------------- override types ---------------------------- */

/** An override is a partial spec; variables/tables are matched by `name`. */
export interface CohortSpecOverride {
  schemaVersion?: string;
  id?: string;
  title?: string;
  description?: string;
  primaryEntity?: string;
  tables?: Partial<Record<string, DeepPartial<TableSpec>>>;
  relationships?: Relationship[];
  variables?: VariableOverride[];
  sdc?: DeepPartial<SdcConfig>;
  defaultCharts?: string[];
  meta?: Record<string, unknown>;
}

export interface VariableOverride extends Partial<VariableSpec> {
  /** required: the variable (by name) this override targets or creates */
  name: string;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? U[]
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

/* --------------------------- canonical defaults -------------------------- */

export const SENSITIVITY_ORDER: Sensitivity[] = ['None', 'Low', 'Medium', 'High'];

export function sensitivityRank(s: Sensitivity): number {
  return SENSITIVITY_ORDER.indexOf(s);
}

/** Default SDC policy (see docs/research/00-decisions-and-architecture.md §3). */
export const DEFAULT_SDC: SdcConfig = {
  enabled: true,
  levels: {
    None: {
      thresholdK: 1,
      roundingBase: 1,
      roundingMode: 'none',
      complementarySuppression: false,
      booleanOnly: false,
      zeroIsDisclosive: false,
    },
    Low: {
      thresholdK: 5,
      roundingBase: 5,
      roundingMode: 'nearest',
      complementarySuppression: false,
      booleanOnly: false,
      zeroIsDisclosive: false,
    },
    Medium: {
      thresholdK: 10,
      roundingBase: 10,
      roundingMode: 'up',
      complementarySuppression: true,
      booleanOnly: false,
      zeroIsDisclosive: false,
    },
    High: {
      thresholdK: 20,
      roundingBase: 20,
      roundingMode: 'up',
      complementarySuppression: true,
      booleanOnly: true,
      zeroIsDisclosive: true,
    },
  },
  global: {
    minQuerySetSize: 0,
    queryRepetitionLimit: 25,
  },
};

export const CATEGORY_FALLBACK = 'Other';
