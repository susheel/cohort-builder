import { camelToSnake } from './infer';
import type {
  CohortSpec,
  CohortSpecOverride,
  SdcConfig,
  SdcLevelPolicy,
  Sensitivity,
  TableSpec,
  VariableOverride,
  VariableSpec,
} from './types';
import { SENSITIVITY_ORDER } from './types';

/** Does an override variable target this inferred variable? Match by column. */
function matchesVariable(base: VariableSpec, ov: VariableOverride): boolean {
  if (ov.column && ov.column === base.column) return true;
  if (ov.name === base.name) return true;
  // override names are typically camelCase; inferred names are the snake column
  if (camelToSnake(ov.name) === base.column) return true;
  if (ov.column && ov.column === base.name) return true;
  return false;
}

function mergeVariable(base: VariableSpec, ov: VariableOverride): VariableSpec {
  const merged: VariableSpec = { ...base };
  // copy only defined override fields
  for (const [k, val] of Object.entries(ov)) {
    if (val !== undefined && val !== null) {
      (merged as unknown as Record<string, unknown>)[k] = val;
    }
  }
  // keep the data binding: the inferred column is authoritative unless the
  // override explicitly supplies a column that exists.
  merged.column = ov.column ?? base.column;
  merged.entity = ov.entity ?? base.entity;
  merged.source = 'merged';
  if (merged.visible === undefined) merged.visible = merged.widget !== 'internal';
  return merged;
}

function newVariableFromOverride(ov: VariableOverride): VariableSpec {
  return {
    name: ov.name,
    label: ov.label ?? ov.name,
    category: ov.category ?? 'Other',
    entity: ov.entity ?? '',
    column: ov.column ?? camelToSnake(ov.name),
    widget: ov.widget ?? 'internal',
    sensitivity: ov.sensitivity ?? 'Low',
    values: ov.values,
    bins: ov.bins,
    options: ov.options,
    range: ov.range,
    booleanLabels: ov.booleanLabels,
    macro: ov.macro,
    note: ov.note,
    visible: ov.visible ?? (ov.widget ? ov.widget !== 'internal' : false),
    source: 'override',
  };
}

function mergeSdc(base: SdcConfig, ov?: SdcConfig | Partial<SdcConfig>): SdcConfig {
  if (!ov) return base;
  const levels = { ...base.levels };
  if (ov.levels) {
    for (const lvl of SENSITIVITY_ORDER) {
      const o = (ov.levels as Partial<Record<Sensitivity, Partial<SdcLevelPolicy>>>)[lvl];
      if (o) levels[lvl] = { ...base.levels[lvl], ...o };
    }
  }
  return {
    enabled: ov.enabled ?? base.enabled,
    levels,
    global: { ...base.global, ...(ov.global ?? {}) },
  };
}

function mergeTables(
  base: Record<string, TableSpec>,
  ov?: CohortSpecOverride['tables'],
): Record<string, TableSpec> {
  if (!ov) return base;
  const out = { ...base };
  for (const [name, partial] of Object.entries(ov)) {
    if (!partial) continue;
    const existing = out[name];
    if (existing) {
      const columns = existing.columns.slice();
      if (partial.columns) {
        for (const pc of partial.columns) {
          const idx = columns.findIndex((c) => c.name === pc.name);
          if (idx >= 0) columns[idx] = { ...columns[idx], ...pc };
          else if (pc.name && pc.type) columns.push(pc as (typeof columns)[number]);
        }
      }
      out[name] = {
        ...existing,
        ...partial,
        name,
        columns,
      } as TableSpec;
    } else if (partial.name && partial.primaryKey) {
      out[name] = { columns: [], role: 'attribute', ...partial, name } as TableSpec;
    }
  }
  return out;
}

/**
 * Effective spec = inferred base ⊕ override. Variables matched by column;
 * unmatched overrides appended; sdc/tables deep-merged; relationships replaced
 * if the override supplies any.
 */
export function mergeSpec(base: CohortSpec, override?: CohortSpecOverride): CohortSpec {
  if (!override) return base;

  const variables = base.variables.map((v) => ({ ...v }));
  const usedOverrides = new Set<VariableOverride>();

  for (const v of variables) {
    const ov = override.variables?.find(
      (o) => !usedOverrides.has(o) && matchesVariable(v, o),
    );
    if (ov) {
      usedOverrides.add(ov);
      Object.assign(v, mergeVariable(v, ov));
    }
  }

  // append override-only variables whose column exists in some table
  const columnsByTable = new Map<string, Set<string>>();
  for (const t of Object.values(base.tables)) {
    columnsByTable.set(t.name, new Set(t.columns.map((c) => c.name)));
  }
  for (const ov of override.variables ?? []) {
    if (usedOverrides.has(ov)) continue;
    const created = newVariableFromOverride(ov);
    const cols = columnsByTable.get(created.entity);
    // hide variables we cannot bind to real data, but keep them for reference
    if (!cols || !cols.has(created.column)) {
      created.visible = false;
      created.note = (created.note ? created.note + ' ' : '') + '(no matching data column)';
    }
    variables.push(created);
  }

  return {
    ...base,
    schemaVersion: override.schemaVersion ?? base.schemaVersion,
    id: override.id ?? base.id,
    title: override.title ?? base.title,
    description: override.description ?? base.description,
    primaryEntity: override.primaryEntity ?? base.primaryEntity,
    tables: mergeTables(base.tables, override.tables),
    relationships:
      override.relationships && override.relationships.length > 0
        ? override.relationships
        : base.relationships,
    variables,
    sdc: mergeSdc(base.sdc, override.sdc as SdcConfig | undefined),
    defaultCharts: override.defaultCharts ?? base.defaultCharts,
    quasiIdentifiers: override.quasiIdentifiers ?? base.quasiIdentifiers,
    sensitiveAttribute: override.sensitiveAttribute ?? base.sensitiveAttribute,
    meta: { ...(base.meta ?? {}), ...(override.meta ?? {}) },
  };
}
