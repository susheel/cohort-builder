import raw from './variables.json';

export type Sensitivity = 'None' | 'Low' | 'Medium' | 'High';
export type WidgetType = 'boolean' | 'multiselect' | 'bins' | 'minCount' | 'internal';
export type Entity = 'subject' | 'file';

export interface AgeBin {
  label: string;
  min: number;
  max: number;
}

export interface MinCountOption {
  label: string;
  min: number;
}

export interface VariableDef {
  name: string;
  label: string;
  category: string;
  sensitivity: Sensitivity;
  sensitive: boolean;
  priority: string;
  buildVersion: string;
  entity: Entity;
  column: string;
  widget: WidgetType;
  vizNote?: string | null;
  values?: string[];
  macro?: Record<string, string>;
  bins?: AgeBin[];
  options?: MinCountOption[];
  booleanLabels?: { yes: string; no: string };
}

export const VARIABLES: VariableDef[] = raw as VariableDef[];

export const CATEGORY_ORDER = [
  'Demographic & Clinical',
  'Comorbidity',
  'Study & Cohort Design',
  'Genetic Stratification',
  'Assessment Availability',
  'Data Modality',
] as const;

/** Variables a user can actually filter on (excludes internal-only fields). */
export const FILTERABLE = VARIABLES.filter((v) => v.widget !== 'internal');

export const BY_NAME: Record<string, VariableDef> = Object.fromEntries(
  VARIABLES.map((v) => [v.name, v]),
);

export const BY_CATEGORY: Record<string, VariableDef[]> = (() => {
  const out: Record<string, VariableDef[]> = {};
  for (const v of FILTERABLE) (out[v.category] ??= []).push(v);
  return out;
})();

export function sensitivityRank(s: Sensitivity): number {
  return { None: 0, Low: 1, Medium: 2, High: 3 }[s];
}
