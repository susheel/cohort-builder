import type { CohortSpec, VariableSpec } from '../spec/types';
import type { DraftedCohort, DraftCriterion } from './types';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function describeVariable(v: VariableSpec): string {
  const base = `  - ${v.name} (${v.label}, widget: ${v.widget}`;
  switch (v.widget) {
    case 'boolean':
      return `${base}, values: true | false)`;
    case 'multiselect':
      return `${base}, values: [${(v.values ?? []).map((x) => JSON.stringify(x)).join(', ')}])`;
    case 'bins':
      return `${base}, bins: [${(v.bins ?? []).map((b) => JSON.stringify(b.label)).join(', ')}])`;
    case 'minCount':
      return `${base}, options: [${(v.options ?? []).map((o) => JSON.stringify(String(o.min))).join(', ')}])`;
    case 'range': {
      const r = v.range;
      return `${base}, range: ${r?.min ?? 0}..${r?.max ?? 100})`;
    }
    default:
      return `${base})`;
  }
}

function operatorRules(v: VariableSpec): string {
  switch (v.widget) {
    case 'boolean':
      return '  Operator must be "=". Value must be "true" or "false" (string).';
    case 'multiselect':
      return '  Operator must be "in", "notIn", or "all". Value must be a non-empty string[].';
    case 'bins':
      return '  Operator must be "in" or "notIn". Value must be a non-empty string[] of bin labels.';
    case 'minCount':
      return '  Operator must be ">=". Value must be a string representing the numeric minimum.';
    case 'range':
      return '  Operator must be "between". Value must be a string of the form "min,max".';
    default:
      return '  Operator must be "in". Value must be a non-empty string[].';
  }
}

export function buildSystemPrompt(spec: CohortSpec): string {
  const visibleVars = spec.variables.filter(
    (v) => v.visible !== false && v.widget !== 'internal',
  );

  const varList = visibleVars.map((v) => describeVariable(v)).join('\n');
  const opRules = visibleVars.map((v) => `${v.name}:\n${operatorRules(v)}`).join('\n');

  return `You are a cohort-building assistant for a clinical research platform.
Your job is to translate a plain-English cohort description into a structured JSON object.

Dataset: ${spec.title}
Primary entity: ${spec.primaryEntity}

Available variables:
${varList}

Operator and value rules per variable:
${opRules}

Response format (JSON only, no markdown fences):
{
  "include": [ { "field": "<name>", "operator": "<op>", "value": <value> } ],
  "exclude": [ { "field": "<name>", "operator": "<op>", "value": <value> } ],
  "notes": "<optional caveats>",
  "unmatched": ["<concept that could not be mapped>"]
}

Rules:
- Only use variable names listed above.
- Honour the operator and value constraints exactly.
- Place inclusion criteria in "include", exclusion criteria in "exclude".
- If the user requests something that cannot be mapped to any variable, add it to "unmatched".
- Return ONLY the JSON object. No explanation, no markdown.`;
}

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

export function buildUserPrompt(text: string): string {
  return `Build a cohort matching this description: ${text}\n\nReturn only the JSON object.`;
}

// ---------------------------------------------------------------------------
// Validation / coercion
// ---------------------------------------------------------------------------

const WIDGET_OPERATORS: Record<string, Set<string>> = {
  boolean: new Set(['=']),
  multiselect: new Set(['in', 'notIn', 'all']),
  bins: new Set(['in', 'notIn']),
  minCount: new Set(['>=']),
  range: new Set(['between']),
};

function defaultOperator(widget: VariableSpec['widget']): string {
  switch (widget) {
    case 'boolean': return '=';
    case 'minCount': return '>=';
    case 'range': return 'between';
    default: return 'in';
  }
}

function coerceOperator(op: unknown, widget: VariableSpec['widget']): string {
  const allowed = WIDGET_OPERATORS[widget];
  if (typeof op === 'string' && allowed && allowed.has(op)) return op;
  return defaultOperator(widget);
}

function coerceValue(
  value: unknown,
  operator: string,
  v: VariableSpec,
): unknown {
  switch (v.widget) {
    case 'boolean': {
      if (value === true || value === 'true') return 'true';
      if (value === false || value === 'false') return 'false';
      return 'true';
    }
    case 'multiselect':
    case 'bins': {
      if (Array.isArray(value)) return value.filter((x) => typeof x === 'string');
      if (typeof value === 'string' && value.length > 0) return [value];
      return [];
    }
    case 'minCount': {
      if (typeof value === 'number') return String(value);
      if (typeof value === 'string') return value;
      return String(v.options?.[0]?.min ?? 1);
    }
    case 'range': {
      if (typeof value === 'string' && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(value)) return value;
      if (typeof value === 'number') return `${value},${v.range?.max ?? 100}`;
      return `${v.range?.min ?? 0},${v.range?.max ?? 100}`;
    }
    default: {
      // treat operator as unused in other branches; it is intentionally used here implicitly
      void operator;
      if (Array.isArray(value)) return value.filter((x) => typeof x === 'string');
      if (typeof value === 'string') return [value];
      return [];
    }
  }
}

function parseCriteria(
  arr: unknown,
  varMap: Map<string, VariableSpec>,
): DraftCriterion[] {
  if (!Array.isArray(arr)) return [];
  const result: DraftCriterion[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const field = String(rec['field'] ?? '');
    const spec = varMap.get(field);
    if (!spec) continue;
    const operator = coerceOperator(rec['operator'], spec.widget);
    const value = coerceValue(rec['value'], operator, spec);
    result.push({ field, operator, value });
  }
  return result;
}

export function validateDraft(raw: unknown, spec: CohortSpec): DraftedCohort {
  const varMap = new Map<string, VariableSpec>(
    spec.variables
      .filter((v) => v.visible !== false && v.widget !== 'internal')
      .map((v) => [v.name, v]),
  );

  let parsed: Record<string, unknown> = {};

  if (typeof raw === 'string') {
    // strip markdown fences if present
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try {
      parsed = JSON.parse(stripped) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  } else if (typeof raw === 'object' && raw !== null) {
    parsed = raw as Record<string, unknown>;
  }

  const include = parseCriteria(parsed['include'], varMap);
  const exclude = parseCriteria(parsed['exclude'], varMap);

  const notes = typeof parsed['notes'] === 'string' ? parsed['notes'] : undefined;
  const unmatched = Array.isArray(parsed['unmatched'])
    ? (parsed['unmatched'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined;

  return { include, exclude, notes, unmatched };
}
