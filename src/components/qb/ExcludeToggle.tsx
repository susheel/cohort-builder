import type { NotToggleProps } from 'react-querybuilder';

/**
 * Group-level "Exclude (NOT)" switch.
 *
 * Trigger: rendered in each group header when showNotToggle is enabled.
 * Why: the research-backed "NOT is a place" pattern expresses negation as a
 *      group property, not a per-rule operator. When active the whole group is
 *      excluded ("none of these"), so we surface it as a clearly-labelled
 *      switch that visibly turns the group into an exclusion.
 * Outcome: an accessible toggle button bound to the group's `not` flag.
 */
export function ExcludeToggle(props: NotToggleProps) {
  const checked = !!props.checked;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={props.disabled}
      onClick={() => props.handleOnChange(!checked)}
      title="When on, subjects matching this group are excluded (NOT)"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500/40 ${
        checked
          ? 'border-sens-high/40 bg-sens-high/10 text-sens-high'
          : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative inline-block h-3.5 w-6 rounded-full transition-colors ${
          checked ? 'bg-sens-high' : 'bg-slate-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${
            checked ? 'left-0.5 translate-x-2.5' : 'left-0.5'
          }`}
        />
      </span>
      {checked ? 'Excluded (NOT)' : 'Exclude (NOT)'}
    </button>
  );
}
