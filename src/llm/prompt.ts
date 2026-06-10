import type { CohortSpec, VariableSpec } from '../spec/types';
import type { DraftedCohort, DraftCriterion } from './types';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function describeVariable(v: VariableSpec): string {
  const base = `  - ${v.name} (${v.label})`;
  switch (v.widget) {
    case 'boolean':
      return `${base}: yes/no. operator "=", value "true" or "false".`;
    case 'multiselect': {
      const vals = (v.values ?? []).map((x) => JSON.stringify(x)).join(', ');
      return `${base}: pick from [${vals}]. operator "in" (any of) or "notIn". value = string array.`;
    }
    case 'bins': {
      const labels = (v.bins ?? []).map((b) => JSON.stringify(b.label)).join(', ');
      return `${base}: pick from [${labels}]. operator "in" or "notIn". value = string array of these exact labels.`;
    }
    case 'minCount': {
      const max = v.options?.reduce((m, o) => Math.max(m, o.min), 0) ?? 1;
      return `${base}: a count. operator ">=", value a number string from 1 to ${max}.`;
    }
    case 'range': {
      const r = v.range;
      return `${base}: numeric range ${r?.min ?? 0}..${r?.max ?? 100}. operator "between", value "min,max".`;
    }
    default:
      return `${base}.`;
  }
}

export function buildSystemPrompt(spec: CohortSpec): string {
  const visibleVars = spec.variables.filter(
    (v) => v.visible !== false && v.widget !== 'internal',
  );
  const varList = visibleVars.map(describeVariable).join('\n');
  const example = buildFewShot(spec) ?? GENERIC_EXAMPLE;

  return `You translate a plain-English cohort description into a strict JSON object for a clinical research tool. You map ONLY what the user actually says onto the variables below.

Dataset: ${spec.title}

VARIABLES (use these names and values exactly):
${varList}

HARD RULES:
1. Use ONLY variables and values listed above. Copy values EXACTLY (including punctuation and case). For bins, use the exact bracket labels.
2. Add a criterion ONLY for a concept the user explicitly states. Do NOT invent filters (do not add file format, study, specimen, counts, etc. unless the user names them).
3. A field must appear in AT MOST ONE of "include" or "exclude" - NEVER both. Do not create mirror/opposite rows.
4. Put a criterion in "exclude" ONLY when the user says to remove it (words like without, except, no, not, excluding). Everything else goes in "include".
5. Multiple options for one concept go in a single criterion's value array (that means "any of"), not as separate rows.
6. If the user mentions something with no matching variable or value, list the phrase in "unmatched" and add no criterion for it.
7. Leave "notes" as "" unless you have a genuine caveat. Leave arrays empty ([]) when nothing applies.
8. Output ONLY the JSON object, no prose, no markdown fences.

EXAMPLE (using this dataset's own variables)
User: "${example.user}"
JSON: ${example.json}

OUTPUT SHAPE
{"include":[{"field":"","operator":"","value":""}],"exclude":[],"notes":"","unmatched":[]}`;
}

// ---------------------------------------------------------------------------
// Per-spec few-shot example
// ---------------------------------------------------------------------------

interface FewShot {
  user: string;
  json: string;
}

const GENERIC_EXAMPLE: FewShot = {
  user: 'women over 85 with hypertension, excluding anyone with dementia',
  json: '{"include":[{"field":"sex","operator":"in","value":["Female"]},{"field":"age","operator":"in","value":["85-89","90+"]},{"field":"hasHypertension","operator":"=","value":"true"}],"exclude":[{"field":"hasDementia","operator":"=","value":"true"}],"notes":"","unmatched":[]}',
};

/**
 * Build a worked example from the spec's ACTUAL variables and values, so the
 * model sees the real vocabulary it must copy from (and the no-mirror rule
 * demonstrated). Falls back to a generic example when the spec lacks suitable
 * variables.
 */
export function buildFewShot(spec: CohortSpec): FewShot | null {
  const vars = spec.variables.filter((v) => v.visible !== false && v.widget !== 'internal');

  const firstMulti = vars.find((v) => v.widget === 'multiselect' && (v.values?.length ?? 0) > 0);
  const firstBins = vars.find((v) => (v.bins?.length ?? 0) >= 2);
  const booleans = vars.filter((v) => v.widget === 'boolean');
  const incBool = booleans[0];
  const excBool = booleans.find((v) => v.name !== incBool?.name);

  const include: DraftCriterion[] = [];
  const phrases: string[] = [];

  if (firstMulti) {
    const val = firstMulti.values![0];
    include.push({ field: firstMulti.name, operator: 'in', value: [val] });
    phrases.push(`${firstMulti.label.toLowerCase()} of ${val}`);
  }
  if (firstBins) {
    const labels = firstBins.bins!.slice(-2).map((b) => b.label);
    include.push({ field: firstBins.name, operator: 'in', value: labels });
    phrases.push(`in the ${labels.join(' or ')} ${firstBins.label.toLowerCase()} range`);
  }
  if (incBool) {
    include.push({ field: incBool.name, operator: '=', value: 'true' });
    phrases.push(`with ${incBool.label.toLowerCase()}`);
  }

  const exclude: DraftCriterion[] = [];
  if (excBool) {
    exclude.push({ field: excBool.name, operator: '=', value: 'true' });
  }

  if (include.length === 0 && exclude.length === 0) return null;

  let user = phrases.length > 0 ? `subjects ${phrases.join(', ')}` : 'subjects';
  if (excBool) user += `, excluding anyone with ${excBool.label.toLowerCase()}`;

  return {
    user,
    json: JSON.stringify({ include, exclude, notes: '', unmatched: [] }),
  };
}

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

export function buildUserPrompt(text: string): string {
  return `Description: ${text}\n\nReturn ONLY the JSON object.`;
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

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Match a requested value to the controlled vocabulary, ignoring case/punctuation. */
function matchVocab(requested: string, allowed: string[]): string | null {
  const exact = allowed.find((a) => a === requested);
  if (exact) return exact;
  const n = norm(requested);
  if (!n) return null;
  const hits = allowed.filter((a) => norm(a) === n);
  return hits.length === 1 ? hits[0] : null;
}

/** Map a bin value (a label, or a bare number that falls inside a bin range). */
function matchBin(requested: string, v: VariableSpec): string | null {
  const bins = v.bins ?? [];
  const exact = bins.find((b) => b.label === requested);
  if (exact) return exact.label;
  const n = Number(String(requested).replace(/[^0-9.\-]/g, ''));
  if (!Number.isNaN(n) && String(requested).match(/\d/)) {
    const inRange = bins.find((b) => n >= b.min && n <= b.max);
    if (inRange) return inRange.label;
  }
  const byNorm = bins.filter((b) => norm(b.label) === norm(requested));
  return byNorm.length === 1 ? byNorm[0].label : null;
}

interface CoerceResult {
  value: unknown;
  /** values that could not be mapped to the controlled vocabulary */
  dropped: string[];
}

function asArray(x: unknown): string[] {
  if (Array.isArray(x)) return x.map(String);
  if (typeof x === 'string' && x.length > 0) return x.split(',').map((s) => s.trim());
  return [];
}

function coerceValue(value: unknown, v: VariableSpec): CoerceResult {
  switch (v.widget) {
    case 'boolean': {
      const val =
        value === true || value === 'true'
          ? 'true'
          : value === false || value === 'false'
            ? 'false'
            : 'true';
      return { value: val, dropped: [] };
    }
    case 'multiselect': {
      const requested = asArray(value);
      const allowed = v.values ?? [];
      if (allowed.length === 0) return { value: requested, dropped: [] }; // no vocab to validate
      const kept: string[] = [];
      const dropped: string[] = [];
      for (const r of requested) {
        const m = matchVocab(r, allowed);
        if (m) kept.push(m);
        else dropped.push(r);
      }
      return { value: Array.from(new Set(kept)), dropped };
    }
    case 'bins': {
      const requested = asArray(value);
      const kept: string[] = [];
      const dropped: string[] = [];
      for (const r of requested) {
        const m = matchBin(r, v);
        if (m) kept.push(m);
        else dropped.push(r);
      }
      return { value: Array.from(new Set(kept)), dropped };
    }
    case 'minCount': {
      const n = Math.round(Number(value));
      const max = v.options?.reduce((m, o) => Math.max(m, o.min), 1) ?? 1;
      const min = v.options?.reduce((m, o) => Math.min(m, o.min), max) ?? 1;
      if (Number.isNaN(n)) return { value: String(min), dropped: [] };
      const clamped = Math.min(Math.max(n, min), max); // clamp absurd values (e.g. 90 -> max)
      return { value: String(clamped), dropped: [] };
    }
    case 'range': {
      const lo = v.range?.min ?? 0;
      const hi = v.range?.max ?? 100;
      if (typeof value === 'string' && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(value)) {
        const [a, b] = value.split(',').map(Number);
        return { value: `${Math.max(a, lo)},${Math.min(b, hi)}`, dropped: [] };
      }
      if (typeof value === 'number') return { value: `${Math.max(value, lo)},${hi}`, dropped: [] };
      return { value: `${lo},${hi}`, dropped: [] };
    }
    default:
      return { value: asArray(value), dropped: [] };
  }
}

function isEmptyValue(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function parseCriteria(
  arr: unknown,
  varMap: Map<string, VariableSpec>,
  unmatched: string[],
): DraftCriterion[] {
  if (!Array.isArray(arr)) return [];
  const result: DraftCriterion[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const field = String(rec['field'] ?? '');
    const spec = varMap.get(field);
    if (!spec) {
      if (field) unmatched.push(field);
      continue;
    }
    const operator = coerceOperator(rec['operator'], spec.widget);
    const { value, dropped } = coerceValue(rec['value'], spec);
    for (const d of dropped) unmatched.push(`${spec.label}: ${d}`);
    if (isEmptyValue(value)) continue; // nothing valid left for this criterion
    result.push({ field, operator, value });
  }
  return result;
}

function cleanStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/[<>]/.test(s)); // drop placeholder / junk text
}

export function validateDraft(raw: unknown, spec: CohortSpec): DraftedCohort {
  const varMap = new Map<string, VariableSpec>(
    spec.variables
      .filter((v) => v.visible !== false && v.widget !== 'internal')
      .map((v) => [v.name, v]),
  );

  let parsed: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try {
      parsed = JSON.parse(stripped) as Record<string, unknown>;
    } catch {
      // recover the first {...} block from noisy output
      const m = stripped.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
      }
    }
  } else if (typeof raw === 'object' && raw !== null) {
    parsed = raw as Record<string, unknown>;
  }

  const unmatched = cleanStrings(parsed['unmatched']);
  const include = parseCriteria(parsed['include'], varMap, unmatched);
  let exclude = parseCriteria(parsed['exclude'], varMap, unmatched);

  // Anti-mirror: a field must not appear in both include and exclude. Weak
  // models often duplicate every include as its opposite exclude; drop those.
  const includeFields = new Set(include.map((c) => c.field));
  exclude = exclude.filter((c) => !includeFields.has(c.field));

  const notesRaw = typeof parsed['notes'] === 'string' ? parsed['notes'].trim() : '';
  const notes = notesRaw.length > 0 && !/[<>]/.test(notesRaw) ? notesRaw : undefined;

  return {
    include,
    exclude,
    notes,
    unmatched: unmatched.length > 0 ? Array.from(new Set(unmatched)) : undefined,
  };
}
