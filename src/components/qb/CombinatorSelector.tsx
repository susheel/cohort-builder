import type { CombinatorSelectorProps, FullOption } from 'react-querybuilder';

/** Flatten the options list (which may be a flat list or option groups) into FullOption[]. */
function flatten(options: CombinatorSelectorProps['options']): FullOption[] {
  if (!Array.isArray(options)) return [];
  const out: FullOption[] = [];
  for (const o of options) {
    if (o && typeof o === 'object' && 'options' in o && Array.isArray((o as { options: unknown }).options)) {
      out.push(...((o as { options: FullOption[] }).options));
    } else {
      out.push(o as FullOption);
    }
  }
  return out;
}

/**
 * Airtable-style per-group And/Or toggle.
 *
 * Trigger: rendered once per rule group as the combinator control.
 * Why: a plain <select> hides the AND/OR choice; a visible segmented pill makes
 *      the per-group logic obvious, matching the surveyed UX patterns.
 * Outcome: a two-button segmented control bound to the group combinator.
 */
export function CombinatorSelector(props: CombinatorSelectorProps) {
  const options = flatten(props.options);

  return (
    <div
      role="radiogroup"
      aria-label="Match combinator for this group"
      className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-white"
    >
      {options.map((o, i) => {
        const value = String(o.value ?? o.name);
        const label = typeof o.label === 'string' ? o.label : value;
        const active = props.value === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={props.disabled}
            title={props.value === 'and' ? 'AND: rows must all match' : 'OR: any row may match'}
            onClick={() => props.handleOnChange(value)}
            className={`px-3 py-1 text-xs font-bold uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500/40 ${
              i > 0 ? 'border-l border-slate-300' : ''
            } ${
              active
                ? value === 'or'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-700 text-white'
                : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
