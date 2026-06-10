import { useMemo } from 'react';
import {
  QueryBuilder,
  type ControlElementsProp,
  type FullField,
  type Translations,
} from 'react-querybuilder';
import { QueryBuilderDnD } from '@react-querybuilder/dnd';
import * as ReactDnD from 'react-dnd';
import * as ReactDndHtml5Backend from 'react-dnd-html5-backend';
import { useApp } from '../app/AppState';
import { CohortValueEditor } from './qb/CohortValueEditor';
import { CombinatorSelector } from './qb/CombinatorSelector';
import { ExcludeToggle } from './qb/ExcludeToggle';

/**
 * Tailwind re-skin of react-querybuilder. We deliberately do NOT import the
 * bundled bootstrap/scss styles; every control is styled through
 * controlClassnames against the app's slate/cyan palette.
 */
const controlClassnames = {
  queryBuilder: 'space-y-2',
  ruleGroup:
    'rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2 [&_.ruleGroup]:bg-white',
  header: 'flex flex-wrap items-center gap-2',
  body: 'space-y-2 pl-1',
  combinators: '', // replaced by custom component
  addRule:
    'rounded-md border border-cyan-300 bg-white px-2.5 py-1 text-xs font-medium text-cyan-700 hover:bg-cyan-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40',
  addGroup:
    'rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40',
  removeGroup:
    'rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-sens-high focus:outline-none focus:ring-2 focus:ring-cyan-500/40',
  removeRule:
    'rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-sens-high focus:outline-none focus:ring-2 focus:ring-cyan-500/40',
  rule: 'flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2',
  fields:
    'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40',
  operators:
    'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40',
  value: 'text-xs',
  shiftActions: 'flex flex-col leading-none',
  dragHandle:
    'cursor-grab rounded px-1 text-slate-300 hover:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40',
} as const;

const translations: Partial<Translations> = {
  addRule: { label: '+ Add condition', title: 'Add a condition to this group' },
  addGroup: { label: '+ Add group', title: 'Add a nested group for mixed AND/OR logic' },
  removeRule: { label: '✕', title: 'Remove this condition' },
  removeGroup: { label: '✕', title: 'Remove this group' },
  shiftActionUp: { label: '▲', title: 'Move up (keyboard accessible reorder)' },
  shiftActionDown: { label: '▼', title: 'Move down (keyboard accessible reorder)' },
};

const controlElements: ControlElementsProp<FullField, string> = {
  valueEditor: CohortValueEditor,
  combinatorSelector: CombinatorSelector,
  notToggle: ExcludeToggle,
};

export function QueryBuilderPanel() {
  const { fields, query, setQuery, clearQuery, ruleCount } = useApp();

  // Stable adapter wiring for react-dnd (the first-class @react-querybuilder/dnd
  // core exports plus the accessibility announcer.
  const dndProp = useMemo(() => ({ ...ReactDnD, ...ReactDndHtml5Backend }), []);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">
          Cohort definition
          <span className="ml-2 text-xs font-normal text-slate-400">
            {ruleCount} condition{ruleCount === 1 ? '' : 's'}
          </span>
        </h2>
        {ruleCount > 0 && (
          <button
            type="button"
            onClick={clearQuery}
            className="rounded px-2 py-0.5 text-xs font-medium text-slate-500 underline hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            Clear
          </button>
        )}
      </div>

      <QueryBuilderDnD dnd={dndProp}>
        <QueryBuilder
          fields={fields}
          query={query}
          onQueryChange={setQuery}
          showNotToggle
          showShiftActions
          showCombinatorsBetweenRules={false}
          addRuleToNewGroups
          controlClassnames={controlClassnames}
          controlElements={controlElements}
          translations={translations}
        />
      </QueryBuilderDnD>

      <p className="mt-3 text-[11px] leading-tight text-slate-400">
        Use AND when subjects must meet every condition, OR when any one is enough. Add a group
        for mixed logic. Toggle Exclude (NOT) to remove subjects matching a group. Reorder with the
        ▲ ▼ buttons or by dragging.
      </p>
    </div>
  );
}
