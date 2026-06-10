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

/**
 * Left-rail discovery surface. A searchable, category-grouped list of the
 * spec's filterable variables. Selecting a row drops a default condition for
 * that variable into the builder via addRule(); the actual editing happens in
 * the QueryBuilderPanel.
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
  const matches = (v: VariableSpec) =>
    !q ||
    v.label.toLowerCase().includes(q) ||
    v.name.toLowerCase().includes(q) ||
    v.category.toLowerCase().includes(q);

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
            placeholder="Search variables…"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          />
        </label>
        <p className="mt-2 text-[11px] leading-tight text-slate-400">
          Add a variable to start a condition, then refine it in the builder.
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
                {vars.map((v) => (
                  <li key={v.name}>
                    <button
                      type="button"
                      onClick={() => addRule(v.name)}
                      title={v.description ?? `Add a condition on ${v.label}`}
                      className="group flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-cyan-50/60 focus:bg-cyan-50/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500/40"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                        {v.label}
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
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
