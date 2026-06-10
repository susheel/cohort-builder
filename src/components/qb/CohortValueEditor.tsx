import { useEffect, useMemo, useRef, useState } from 'react';
import type { ValueEditorProps } from 'react-querybuilder';
import { useApp } from '../../app/AppState';
import type { FacetCell } from '../../app/AppState';
import type { CohortField } from '../../query/fields';
import { FacetCount } from '../FacetCount';

/**
 * Re-skinned value editor for react-querybuilder.
 *
 * Trigger: each rule's value control is rendered through here.
 * Why: the default editors are bootstrap-styled and do not annotate options
 *      with disclosure-controlled facet counts; we switch on the field's
 *      `cbWidget` to render the correct honest control.
 * Outcome: multiselect/bins -> annotated checkbox list; boolean -> segmented
 *      Yes/No; minCount -> select; range/between -> two number inputs writing a
 *      "min,max" string the tree compiler parses.
 */
export function CohortValueEditor(props: ValueEditorProps) {
  const field = props.fieldData as CohortField;
  const widget = field?.cbWidget;

  if (widget === 'multiselect' || widget === 'bins') {
    return <MultiSelectEditor {...props} />;
  }
  if (widget === 'boolean') {
    return <BooleanEditor {...props} />;
  }
  if (widget === 'minCount') {
    return <SelectEditor {...props} />;
  }
  if (widget === 'range') {
    return <RangeEditor {...props} />;
  }
  // Fallback: a plain text input (keeps the editor usable for any unknown widget).
  return (
    <input
      type="text"
      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
      value={typeof props.value === 'string' ? props.value : ''}
      onChange={(e) => props.handleOnChange(e.target.value)}
      aria-label={`Value for ${field?.label ?? 'rule'}`}
    />
  );
}

/* --------------------------- option list helpers -------------------------- */

interface OptObj {
  name: string;
  label: string;
}

function readOptions(values: unknown): OptObj[] {
  if (!Array.isArray(values)) return [];
  const out: OptObj[] = [];
  for (const v of values) {
    if (v && typeof v === 'object' && 'name' in v) {
      const o = v as { name: unknown; label?: unknown };
      out.push({ name: String(o.name), label: String(o.label ?? o.name) });
    } else if (typeof v === 'string') {
      out.push({ name: v, label: v });
    }
  }
  return out;
}

/** Normalise the editor value into an array of selected option names. */
function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.length > 0) return value.split(',').map((s) => s.trim());
  return [];
}

/* --------------------------- facet count fetch ---------------------------- */

/**
 * Lazily fetch facet counts for one variable, debounced and query-aware.
 *
 * Trigger: a multiselect/bins editor mounts or the rest of the query changes.
 * Why: facet counts are conditional on the rest of the query (SDC-applied) and
 *      cost a DB round-trip; we debounce ~250ms and cancel stale requests.
 * Outcome: a Map of option value -> FacetCell, refreshed honestly on change.
 */
function useFacetMap(variableName: string): Map<string, FacetCell> {
  const { getFacetCounts, query, sdc } = useApp();
  const [map, setMap] = useState<Map<string, FacetCell>>(new Map());
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      getFacetCounts(variableName)
        .then((cells) => {
          if (seq.current !== mine) return; // a newer request superseded this one
          const m = new Map<string, FacetCell>();
          for (const c of cells) m.set(c.value, c);
          setMap(m);
        })
        .catch(() => {
          if (seq.current === mine) setMap(new Map());
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      // bump seq so any in-flight promise from this effect is treated as stale
      seq.current++;
    };
    // query/sdc drive the conditional facet counts
  }, [variableName, getFacetCounts, query, sdc]);

  return map;
}

/* ------------------------------- editors ---------------------------------- */

function MultiSelectEditor(props: ValueEditorProps) {
  const field = props.fieldData as CohortField;
  const options = useMemo(() => readOptions(props.values), [props.values]);
  const selected = useMemo(() => new Set(asArray(props.value)), [props.value]);
  const facets = useFacetMap(field.name);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    props.handleOnChange(Array.from(next));
  };

  if (options.length === 0) {
    return <span className="text-xs italic text-slate-400">No values available</span>;
  }

  return (
    <fieldset className="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/50 p-1.5">
      <legend className="sr-only">Choose values for {field.label}</legend>
      {options.map((o) => {
        const checked = selected.has(o.name);
        const facet = facets.get(o.label) ?? facets.get(o.name);
        return (
          <label
            key={o.name}
            className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-white ${
              checked ? 'font-medium text-slate-800' : 'text-slate-600'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(o.name)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-cyan-600 focus:ring-2 focus:ring-cyan-500/40"
            />
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {facet ? <FacetCount result={facet.result} /> : null}
          </label>
        );
      })}
    </fieldset>
  );
}

function BooleanEditor(props: ValueEditorProps) {
  const field = props.fieldData as CohortField;
  const options = useMemo(() => readOptions(props.values), [props.values]);
  const current = typeof props.value === 'string' ? props.value : String(props.value ?? '');

  return (
    <div
      role="radiogroup"
      aria-label={`Choose ${field.label}`}
      className="inline-flex overflow-hidden rounded-md border border-slate-300"
    >
      {options.map((o, i) => {
        const active = current === o.name;
        return (
          <button
            key={o.name}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => props.handleOnChange(o.name)}
            className={`px-3 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500/40 ${
              i > 0 ? 'border-l border-slate-300' : ''
            } ${active ? 'bg-cyan-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SelectEditor(props: ValueEditorProps) {
  const field = props.fieldData as CohortField;
  const options = useMemo(() => readOptions(props.values), [props.values]);
  const current = props.value == null ? '' : String(props.value);

  return (
    <select
      aria-label={`Value for ${field.label}`}
      value={current}
      onChange={(e) => props.handleOnChange(e.target.value)}
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
    >
      {options.map((o) => (
        <option key={o.name} value={o.name}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Parse a stored range value ("min,max" or [min,max]) into a tuple of strings. */
function parseRange(value: unknown): [string, string] {
  if (Array.isArray(value)) return [String(value[0] ?? ''), String(value[1] ?? '')];
  if (typeof value === 'string') {
    const [a, b] = value.split(',');
    return [(a ?? '').trim(), (b ?? '').trim()];
  }
  return ['', ''];
}

function RangeEditor(props: ValueEditorProps) {
  const field = props.fieldData as CohortField;
  const [min, max] = parseRange(props.value);

  const write = (nextMin: string, nextMax: string) => {
    props.handleOnChange(`${nextMin},${nextMax}`);
  };

  const inputClass =
    'w-20 rounded-md border border-slate-300 px-2 py-1 text-xs tabular-nums text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40';

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        aria-label={`Minimum ${field.label}`}
        value={min}
        onChange={(e) => write(e.target.value, max)}
        className={inputClass}
      />
      <span className="text-xs text-slate-400">to</span>
      <input
        type="number"
        aria-label={`Maximum ${field.label}`}
        value={max}
        onChange={(e) => write(min, e.target.value)}
        className={inputClass}
      />
    </div>
  );
}
