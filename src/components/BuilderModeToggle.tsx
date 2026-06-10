import { useApp } from '../app/AppState';
import type { BuilderMode } from '../app/AppState';

/**
 * Segmented Guided | Advanced control. Both modes edit the same underlying
 * query tree; the toggle only swaps the editing surface.
 */
export function BuilderModeToggle() {
  const { mode, setMode } = useApp();

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="radiogroup"
          aria-label="Builder mode"
          className="inline-flex overflow-hidden rounded-md border border-slate-300"
        >
          <ModeButton mode="guided" current={mode} onSelect={setMode}>
            Guided
          </ModeButton>
          <ModeButton mode="advanced" current={mode} onSelect={setMode}>
            Advanced
          </ModeButton>
        </div>
        <p className="text-[11px] leading-tight text-slate-400">
          {mode === 'guided'
            ? 'Guided: build the cohort as inclusion and exclusion criteria.'
            : 'Advanced: full AND / OR / NOT logic with nested groups.'}
        </p>
      </div>
    </div>
  );
}

function ModeButton({
  mode,
  current,
  onSelect,
  children,
}: {
  mode: BuilderMode;
  current: BuilderMode;
  onSelect: (m: BuilderMode) => void;
  children: React.ReactNode;
}) {
  const active = current === mode;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onSelect(mode)}
      className={`px-4 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500/40 ${
        mode === 'advanced' ? 'border-l border-slate-300' : ''
      } ${active ? 'bg-cyan-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
    >
      {children}
    </button>
  );
}
