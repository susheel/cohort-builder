import { useState } from 'react';
import { useApp } from '../app/AppState';
import type { RuleGroupType, RuleType } from 'react-querybuilder';
import { OP, type CohortField } from '../query/fields';
import { treeCountSql } from '../query/compileTree';

type View = 'english' | 'sql';

/**
 * Compact read-back of the current query, toggleable between plain English and
 * the actual compiled SQL.
 *
 * The English view is built from the RuleGroupType rather than formatQuery's
 * natural_language output because our operators (in/notIn/all/=/between/>=) and
 * value encodings (bin labels, "min,max" ranges, boolean 'true'/'false') need
 * cohort-specific phrasing. The SQL view shows the exact count query DuckDB-WASM
 * runs (note: the displayed count is then passed through disclosure control).
 */
export function QuerySummary() {
  const { spec, fields, query } = useApp();
  const [view, setView] = useState<View>('english');
  const [copied, setCopied] = useState(false);
  if (!spec) return null;

  const empty = query.rules.length === 0;
  const text = describeGroup(query, fields, true);
  const sql = formatSql(treeCountSql(spec, query));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const tabClass = (v: View) =>
    `rounded px-2 py-0.5 text-xs font-medium transition-colors ${
      view === v ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-100'
    }`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1" role="tablist" aria-label="Query view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'english'}
            className={tabClass('english')}
            onClick={() => setView('english')}
          >
            Plain English
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'sql'}
            className={tabClass('sql')}
            onClick={() => setView('sql')}
          >
            SQL
          </button>
        </div>
        {view === 'sql' && (
          <button
            type="button"
            onClick={copy}
            className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {view === 'english' ? (
        empty ? (
          <p className="text-sm text-slate-500">All subjects (no conditions).</p>
        ) : (
          <p className="text-sm leading-relaxed text-slate-700">{text}</p>
        )
      ) : (
        <>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
            {sql}
          </pre>
          <p className="mt-1.5 text-xs text-slate-400">
            The query DuckDB-WASM runs in your browser. The returned count is then
            passed through statistical disclosure control before display.
          </p>
        </>
      )}
    </div>
  );
}

/** Light pretty-print: put each top-level clause on its own indented line. */
function formatSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/ WHERE /, '\nWHERE ')
    .replace(/ AND /g, '\n  AND ')
    .replace(/ FROM /g, '\nFROM ')
    .trim();
}

function isGroup(r: RuleType | RuleGroupType): r is RuleGroupType {
  return 'rules' in r && Array.isArray((r as RuleGroupType).rules);
}

function describeGroup(group: RuleGroupType, fields: CohortField[], root = false): string {
  const parts = group.rules
    .map((r) => (isGroup(r) ? describeGroup(r, fields) : describeRule(r, fields)))
    .filter((s): s is string => !!s);

  if (parts.length === 0) return '';

  const joiner = (group.combinator ?? 'and').toUpperCase() === 'OR' ? ' OR ' : ' AND ';
  let body = parts.join(joiner);

  // Bracket multi-part groups so precedence is unambiguous.
  if (parts.length > 1 && !root) body = `(${body})`;

  if (group.not) {
    body = parts.length > 1 ? `NOT (${parts.join(joiner)})` : `NOT ${parts[0]}`;
  }

  return body;
}

function describeRule(rule: RuleType, fields: CohortField[]): string {
  const field = fields.find((f) => f.name === rule.field);
  if (!field) return '';
  const label = field.label;

  switch (field.cbWidget) {
    case 'boolean': {
      const opt = optionLabel(field, String(rule.value));
      return `${label} is ${opt}`;
    }
    case 'multiselect':
    case 'bins': {
      const values = normaliseArray(rule.value).map((v) => optionLabel(field, v));
      if (values.length === 0) return `${label} (no values chosen)`;
      const verb =
        rule.operator === OP.notIn ? 'is none of' : rule.operator === OP.all ? 'is all of' : 'is any of';
      return `${label} ${verb} ${values.join(', ')}`;
    }
    case 'minCount': {
      const opt = optionLabel(field, String(rule.value));
      return `${label} at least ${opt}`;
    }
    case 'range': {
      const [min, max] = parseRange(rule.value);
      return `${label} between ${min} and ${max}`;
    }
    default:
      return `${label} ${String(rule.value ?? '')}`.trim();
  }
}

function optionLabel(field: CohortField, name: string): string {
  const values = field.values;
  if (Array.isArray(values)) {
    for (const v of values) {
      if (v && typeof v === 'object' && 'name' in v && String((v as { name: unknown }).name) === name) {
        return String((v as { label?: unknown }).label ?? name);
      }
    }
  }
  return name;
}

function normaliseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.length > 0) return value.split(',').map((s) => s.trim());
  return [];
}

function parseRange(value: unknown): [string, string] {
  if (Array.isArray(value)) return [String(value[0] ?? ''), String(value[1] ?? '')];
  if (typeof value === 'string') {
    const [a, b] = value.split(',');
    return [(a ?? '').trim(), (b ?? '').trim()];
  }
  return ['', ''];
}
