import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/AppState';
import type { FunnelRow } from '../app/AppState';
import { OP, fieldByName, type CohortField } from '../query/fields';
import { makeCriterion, type Criterion } from '../query/guided';
import { FacetCount } from './FacetCount';
import { SensitivityBadge } from './SensitivityBadge';

type Zone = 'include' | 'exclude';

/**
 * Guided Inclusion / Exclusion builder shaped like an attrition funnel.
 *
 * It is a thin editor over the canonical query tree exposed by useApp(): it
 * keeps a local working copy of the include/exclude criteria (seeded from
 * `guided`) and writes the whole query back via setGuided on every change. The
 * local copy is re-seeded whenever `guided` changes from outside (template or
 * AI draft applied) using a content signature.
 */
export function GuidedBuilder() {
  const { guided, setGuided, fields } = useApp();

  const [include, setInclude] = useState<Criterion[]>(guided.include);
  const [exclude, setExclude] = useState<Criterion[]>(guided.exclude);

  // Re-seed local state when the external model changes shape/content (e.g. a
  // template or AI draft replaced the query). A signature avoids feedback loops
  // from our own setGuided writes, which round-trip back as an equal model.
  const externalSig = useMemo(() => signature(guided.include, guided.exclude), [guided]);
  const lastSig = useRef(externalSig);
  useEffect(() => {
    if (externalSig !== lastSig.current) {
      lastSig.current = externalSig;
      setInclude(guided.include);
      setExclude(guided.exclude);
    }
  }, [externalSig, guided.include, guided.exclude]);

  const commit = useCallback(
    (nextInclude: Criterion[], nextExclude: Criterion[]) => {
      setInclude(nextInclude);
      setExclude(nextExclude);
      lastSig.current = signature(nextInclude, nextExclude);
      setGuided(nextInclude, nextExclude);
    },
    [setGuided],
  );

  const setZone = useCallback(
    (zone: Zone, next: Criterion[]) => {
      if (zone === 'include') commit(next, exclude);
      else commit(include, next);
    },
    [commit, exclude, include],
  );

  const addCriterion = useCallback(
    (zone: Zone, fieldName: string) => {
      const f = fieldByName(fields, fieldName);
      if (!f) return;
      const c = makeCriterion(fieldName, guidedDefaultOperator(f, zone), defaultValueFor(f));
      if (zone === 'include') commit([...include, c], exclude);
      else commit(include, [...exclude, c]);
    },
    [commit, fields, include, exclude],
  );

  if (!guided.simple) {
    return <ComplexNotice />;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-700">Build your cohort</h2>
      <p className="mt-0.5 text-[11px] leading-tight text-slate-400">
        Add criteria to include subjects, then add criteria to exclude. Each row narrows the cohort;
        several values in one row mean "any of".
      </p>

      <Funnel include={include} exclude={exclude} />

      <ZonePanel
        zone="include"
        title="Include"
        subtitle="keep subjects who…"
        addLabel="+ Add inclusion criterion"
        criteria={include}
        fields={fields}
        onChange={(next) => setZone('include', next)}
        onAdd={(name) => addCriterion('include', name)}
      />

      <ZonePanel
        zone="exclude"
        title="Exclude"
        subtitle="remove subjects who…"
        addLabel="+ Add exclusion criterion"
        criteria={exclude}
        fields={fields}
        onChange={(next) => setZone('exclude', next)}
        onAdd={(name) => addCriterion('exclude', name)}
        accent="rose"
      />
    </div>
  );
}

function ComplexNotice() {
  const { setMode } = useApp();
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm" role="alert">
      <p className="text-sm font-semibold text-amber-800">This query uses advanced logic</p>
      <p className="mt-1 text-sm leading-relaxed text-amber-700">
        It cannot be shown as simple inclusion and exclusion criteria. Switch to Advanced to view and edit it.
      </p>
      <button
        type="button"
        onClick={() => setMode('advanced')}
        className="mt-3 rounded-md bg-amber-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
      >
        Switch to Advanced
      </button>
    </div>
  );
}

/* ------------------------------- funnel ----------------------------------- */

/**
 * Cumulative attrition funnel. Counts come from getFunnelCounts() (the SDC
 * engine applies disclosure control). We render the honest CountResult per row,
 * a small proportional bar, and never display per-step deltas (which could let
 * a small suppressed cell be back-calculated by subtraction).
 */
function Funnel({ include, exclude }: { include: Criterion[]; exclude: Criterion[] }) {
  const { getFunnelCounts } = useApp();
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const sig = useMemo(() => signature(include, exclude), [include, exclude]);

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      getFunnelCounts()
        .then((result) => {
          if (seq.current !== mine) return;
          setRows(result);
          setLoading(false);
        })
        .catch(() => {
          if (seq.current === mine) {
            setRows([]);
            setLoading(false);
          }
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      seq.current++;
    };
    // sig captures include/exclude content; getFunnelCounts is query-aware
  }, [sig, getFunnelCounts]);

  const start = rows.find((r) => r.kind === 'start');
  const startN = start && typeof start.result.value === 'number' ? start.result.value : null;
  const last = rows.length > 0 ? rows[rows.length - 1] : null;

  const barWidth = (r: FunnelRow): number => {
    if (startN == null || startN <= 0) return 100;
    if (typeof r.result.value === 'number') return Math.max(4, Math.round((r.result.value / startN) * 100));
    return 100;
  };

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-3" aria-live="polite" aria-busy={loading}>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">{loading ? 'Computing counts…' : 'No counts yet.'}</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={`${r.kind}-${r.criterion?.id ?? 'start'}-${i}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-slate-600">{funnelLabel(r)}</span>
                <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-slate-200">
                  <span
                    className={`block h-full rounded-full ${r.kind === 'exclude' ? 'bg-rose-300' : 'bg-cyan-400'}`}
                    style={{ width: `${barWidth(r)}%` }}
                  />
                </span>
              </span>
              <FacetCount result={r.result} className="shrink-0" />
            </li>
          ))}
        </ol>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
        <span className="text-xs font-semibold text-slate-700">Matching cohort</span>
        {last ? <FacetCount result={last.result} /> : <span className="text-xs text-slate-400">—</span>}
      </div>
    </div>
  );
}

function funnelLabel(r: FunnelRow): string {
  if (r.kind === 'start') return 'Start: all subjects';
  const verb = r.kind === 'exclude' ? 'Exclude' : 'Include';
  return `${verb}: ${r.criterion?.field ?? ''}`;
}

/* ------------------------------- zones ------------------------------------ */

function ZonePanel({
  zone,
  title,
  subtitle,
  addLabel,
  criteria,
  fields,
  onChange,
  onAdd,
  accent = 'cyan',
}: {
  zone: Zone;
  title: string;
  subtitle: string;
  addLabel: string;
  criteria: Criterion[];
  fields: CohortField[];
  onChange: (next: Criterion[]) => void;
  onAdd: (fieldName: string) => void;
  accent?: 'cyan' | 'rose';
}) {
  const headColour = accent === 'rose' ? 'text-rose-600' : 'text-cyan-700';

  const updateAt = (id: string, value: unknown) => {
    onChange(criteria.map((c) => (c.id === id ? { ...c, value } : c)));
  };
  const removeAt = (id: string) => {
    onChange(criteria.filter((c) => c.id !== id));
  };

  return (
    <section className="mt-4">
      <h3 className={`text-xs font-bold uppercase tracking-wide ${headColour}`}>
        {title} <span className="font-medium normal-case text-slate-400">— {subtitle}</span>
      </h3>

      {criteria.length === 0 ? (
        <p className="mt-1.5 text-xs italic text-slate-400">No {zone === 'include' ? 'inclusion' : 'exclusion'} criteria yet.</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {criteria.map((c) => {
            const field = fieldByName(fields, c.field);
            if (!field) return null;
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-start gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">{field.label}</span>
                  <span className="text-xs text-slate-400">{verbFor(field)}</span>
                  <CriterionValueEditor field={field} value={c.value} onChange={(v) => updateAt(c.id, v)} />
                  <SensitivityBadge sensitivity={field.cbSensitivity} />
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(c.id)}
                  aria-label={`Remove ${field.label}`}
                  title="Remove this criterion"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <VariablePicker fields={fields} label={addLabel} onPick={onAdd} />
    </section>
  );
}

/* ----------------------------- value editors ------------------------------ */

function CriterionValueEditor({
  field,
  value,
  onChange,
}: {
  field: CohortField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.cbWidget) {
    case 'multiselect':
    case 'bins':
      return <ChipMultiSelect field={field} value={value} onChange={onChange} />;
    case 'boolean':
      return <BooleanSegmented field={field} value={value} onChange={onChange} />;
    case 'minCount':
      return <MinCountSelect field={field} value={value} onChange={onChange} />;
    case 'range':
      return <RangeInputs field={field} value={value} onChange={onChange} />;
    default:
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Value for ${field.label}`}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
        />
      );
  }
}

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
function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.length > 0) return value.split(',').map((s) => s.trim());
  return [];
}

function ChipMultiSelect({
  field,
  value,
  onChange,
}: {
  field: CohortField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = useMemo(() => readOptions(field.values), [field.values]);
  const selected = useMemo(() => new Set(asArray(value)), [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(Array.from(next));
  };

  const chosen = options.filter((o) => selected.has(o.name));

  if (options.length === 0) {
    return <span className="text-xs italic text-slate-400">No values available</span>;
  }

  return (
    <div ref={ref} className="relative inline-flex flex-wrap items-center gap-1">
      {chosen.length > 1 && <span className="text-xs italic text-slate-400">any of</span>}
      {chosen.map((o) => (
        <span
          key={o.name}
          className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700"
        >
          {o.label}
          <button
            type="button"
            onClick={() => toggle(o.name)}
            aria-label={`Remove ${o.label}`}
            className="text-cyan-400 hover:text-cyan-700 focus:outline-none"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="rounded-full border border-dashed border-cyan-300 px-2 py-0.5 text-xs font-medium text-cyan-600 hover:bg-cyan-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
      >
        {chosen.length === 0 ? 'Choose values' : '+ add'}
      </button>

      {open && (
        <fieldset
          className="absolute left-0 top-full z-20 mt-1 flex max-h-52 w-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg"
        >
          <legend className="sr-only">Choose values for {field.label}</legend>
          {options.map((o) => {
            const checked = selected.has(o.name);
            return (
              <label
                key={o.name}
                className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50 ${
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
              </label>
            );
          })}
        </fieldset>
      )}
    </div>
  );
}

function BooleanSegmented({
  field,
  value,
  onChange,
}: {
  field: CohortField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const options = useMemo(() => readOptions(field.values), [field.values]);
  const current = typeof value === 'string' && value ? value : 'true';

  return (
    <div role="radiogroup" aria-label={`Choose ${field.label}`} className="inline-flex overflow-hidden rounded-md border border-slate-300">
      {options.map((o, i) => {
        const active = current === o.name;
        return (
          <button
            key={o.name}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.name)}
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

function MinCountSelect({
  field,
  value,
  onChange,
}: {
  field: CohortField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const options = useMemo(() => readOptions(field.values), [field.values]);
  const current = value == null ? '' : String(value);
  return (
    <select
      aria-label={`Value for ${field.label}`}
      value={current}
      onChange={(e) => onChange(e.target.value)}
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

function parseRange(value: unknown): [string, string] {
  if (Array.isArray(value)) return [String(value[0] ?? ''), String(value[1] ?? '')];
  if (typeof value === 'string') {
    const [a, b] = value.split(',');
    return [(a ?? '').trim(), (b ?? '').trim()];
  }
  return ['', ''];
}

function RangeInputs({
  field,
  value,
  onChange,
}: {
  field: CohortField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [min, max] = parseRange(value);
  const inputClass =
    'w-20 rounded-md border border-slate-300 px-2 py-1 text-xs tabular-nums text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40';
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        aria-label={`Minimum ${field.label}`}
        value={min}
        onChange={(e) => onChange(`${e.target.value},${max}`)}
        className={inputClass}
      />
      <span className="text-xs text-slate-400">to</span>
      <input
        type="number"
        aria-label={`Maximum ${field.label}`}
        value={max}
        onChange={(e) => onChange(`${min},${e.target.value}`)}
        className={inputClass}
      />
    </div>
  );
}

/* --------------------------- variable picker ------------------------------ */

/**
 * Searchable, category-grouped variable picker shown in a popover. Focus moves
 * to the search box on open and Escape closes it.
 */
function VariablePicker({
  fields,
  label,
  onPick,
}: {
  fields: CohortField[];
  label: string;
  onPick: (fieldName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const byCat = new Map<string, CohortField[]>();
    const order: string[] = [];
    for (const f of fields) {
      const cat = f.variable.category || 'Other';
      if (!byCat.has(cat)) {
        byCat.set(cat, []);
        order.push(cat);
      }
      byCat.get(cat)!.push(f);
    }
    return order.map((category) => ({ category, fields: byCat.get(category)! }));
  }, [fields]);

  const q = search.trim().toLowerCase();
  const matches = (f: CohortField) =>
    !q || f.label.toLowerCase().includes(q) || f.name.toLowerCase().includes(q) || f.variable.category.toLowerCase().includes(q);

  const pick = (name: string) => {
    onPick(name);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={ref} className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded-md border border-cyan-300 bg-white px-2.5 py-1 text-xs font-medium text-cyan-700 hover:bg-cyan-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
      >
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a variable"
          className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[90vw] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
        >
          <div className="border-b border-slate-100 p-2">
            <label className="block">
              <span className="sr-only">Search variables</span>
              <input
                ref={inputRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search variables…"
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
              />
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {groups.map((group) => {
              const vis = group.fields.filter(matches);
              if (vis.length === 0) return null;
              return (
                <section key={group.category} className="border-b border-slate-100 last:border-0">
                  <h4 className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {group.category}
                  </h4>
                  <ul className="pb-1.5">
                    {vis.map((f) => (
                      <li key={f.name}>
                        <button
                          type="button"
                          onClick={() => pick(f.name)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-cyan-50/60 focus:bg-cyan-50/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500/40"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{f.label}</span>
                          <SensitivityBadge sensitivity={f.cbSensitivity} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- helpers ---------------------------------- */

/**
 * Default operator for a guided row. Exclusion is conveyed by the zone, so we
 * still prefer the widget's positive operator (e.g. "is any of") inside Exclude.
 */
function guidedDefaultOperator(field: CohortField, _zone: Zone): string {
  switch (field.cbWidget) {
    case 'boolean':
      return OP.is;
    case 'minCount':
      return OP.gte;
    case 'range':
      return OP.between;
    default:
      return OP.in;
  }
}

function defaultValueFor(field: CohortField): unknown {
  return field.defaultValue ?? (field.cbWidget === 'range' ? '0,100' : []);
}

/** Plain-language verb derived from the field's operator label for the row. */
function verbFor(field: CohortField): string {
  switch (field.cbWidget) {
    case 'boolean':
      return 'is';
    case 'minCount':
      return 'at least';
    case 'range':
      return 'between';
    case 'multiselect':
    case 'bins':
    default:
      // Exclusion is conveyed by the Exclude zone, so both zones keep the
      // positive "is any of" phrasing for multi-value rows.
      return 'is any of';
  }
}

/** Stable content signature of the criteria, used to detect external changes. */
function signature(include: Criterion[], exclude: Criterion[]): string {
  const enc = (c: Criterion) => `${c.field}|${c.operator}|${JSON.stringify(c.value)}`;
  return `I:${include.map(enc).join(';')}#E:${exclude.map(enc).join(';')}`;
}
