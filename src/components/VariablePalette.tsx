import { useMemo, useState } from 'react';
import { useApp } from '../app/AppState';
import type { VariableSpec } from '../spec/types';
import { SensitivityBadge } from './SensitivityBadge';

/** Preferred ordering for well-known categories; unknowns keep first-seen order after these. */
const KNOWN_CATEGORY_ORDER = [
  'Demographics',
  'Comorbidities',
  'Data modality',
  'Genetic stratification',
  'Genetics',
  'Assessment availability',
  'Assessments',
];

interface CategoryGroup {
  category: string;
  variables: VariableSpec[];
}

/** The selectable value labels for a variable (the controlled vocabulary the user can filter on). */
function valueLabelsOf(v: VariableSpec): string[] {
  switch (v.widget) {
    case 'multiselect':
      return v.values ?? [];
    case 'bins':
      return (v.bins ?? []).map((b) => b.label);
    case 'minCount':
      return (v.options ?? []).map((o) => o.label);
    case 'boolean':
      return [v.booleanLabels?.yes ?? 'Yes', v.booleanLabels?.no ?? 'No'];
    default:
      return [];
  }
}

/** Only array-valued widgets can be pre-filled with matched values via addRule. */
function presetable(v: VariableSpec): boolean {
  return v.widget === 'multiselect' || v.widget === 'bins';
}

/** Render a label with the matched query substring emphasised. */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-200/70 px-0.5 text-slate-900">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

/**
 * Left-rail discovery surface. A searchable, category-grouped list of the
 * spec's filterable variables. Search matches variable names AND their values,
 * so typing a value (e.g. "African") surfaces and expands the owning variable
 * (e.g. "Ethnic Group Code") with the matching values highlighted. Selecting a
 * variable drops a condition into the builder via addRule(); selecting a matched
 * value pre-fills that value.
 */
export function VariablePalette() {
  const { spec, addRule } = useApp();
  const [search, setSearch] = useState('');

  const groups = useMemo<CategoryGroup[]>(() => {
    if (!spec) return [];
    const filterable = spec.variables.filter((v) => v.visible !== false && v.widget !== 'internal');

    const order: string[] = [];
    const byCat = new Map<string, VariableSpec[]>();
    for (const v of filterable) {
      const cat = v.category || 'Other';
      if (!byCat.has(cat)) {
        byCat.set(cat, []);
        order.push(cat);
      }
      byCat.get(cat)!.push(v);
    }

    order.sort((a, b) => {
      const ia = KNOWN_CATEGORY_ORDER.indexOf(a);
      const ib = KNOWN_CATEGORY_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return 0;
    });

    return order.map((category) => ({ category, variables: byCat.get(category)! }));
  }, [spec]);

  const q = search.trim().toLowerCase();

  const matchedValues = (v: VariableSpec): string[] =>
    q ? valueLabelsOf(v).filter((l) => l.toLowerCase().includes(q)) : [];

  const nameMatches = (v: VariableSpec): boolean =>
    !q ||
    v.label.toLowerCase().includes(q) ||
    v.name.toLowerCase().includes(q) ||
    v.category.toLowerCase().includes(q);

  const matches = (v: VariableSpec) => nameMatches(v) || matchedValues(v).length > 0;

  if (!spec) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-3">
        <label className="block">
          <span className="sr-only">Search variables</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search variables or values…"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          />
        </label>
        <p className="mt-2 text-[11px] leading-tight text-slate-400">
          Search names or values (e.g. "African"). Add a variable to start a condition, then refine it in the builder.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {groups.map((group) => {
          const vars = group.variables.filter(matches);
          if (vars.length === 0) return null;
          return (
            <section key={group.category} className="border-b border-slate-100">
              <h3 className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {group.category}
                <span className="ml-1 font-normal normal-case text-slate-300">({vars.length})</span>
              </h3>
              <ul className="pb-2">
                {vars.map((v) => {
                  const hits = matchedValues(v);
                  return (
                    <li key={v.name}>
                      <button
                        type="button"
                        onClick={() => addRule(v.name, presetable(v) ? hits : undefined)}
                        title={v.description ?? `Add a condition on ${v.label}`}
                        className="group flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-cyan-50/60 focus:bg-cyan-50/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500/40"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                          <Highlight text={v.label} q={nameMatches(v) ? q : ''} />
                        </span>
                        <SensitivityBadge sensitivity={v.sensitivity} />
                        <span
                          aria-hidden="true"
                          className="shrink-0 rounded-full border border-cyan-200 bg-white px-1.5 text-xs font-semibold text-cyan-600 opacity-0 group-hover:opacity-100 group-focus:opacity-100"
                        >
                          +
                        </span>
                        <span className="sr-only">Add condition</span>
                      </button>

                      {hits.length > 0 && (
                        <div className="flex flex-wrap gap-1 px-3 pb-1.5 pl-5">
                          {hits.map((val) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => addRule(v.name, presetable(v) ? [val] : undefined)}
                              title={presetable(v) ? `Add ${v.label} = ${val}` : `Add a condition on ${v.label}`}
                              className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                            >
                              <Highlight text={val} q={q} />
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
