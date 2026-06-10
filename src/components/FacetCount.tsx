import type { CountResult } from '../sdc/engine';
import { formatCount } from '../sdc/format';

/**
 * Honest inline rendering of a single CountResult.
 *
 * Discipline: suppressed and boolean values NEVER show a number. Suppressed
 * renders its muted displayLabel (e.g. "<20"); boolean renders a small
 * availability marker; zero is shown distinctly as "0".
 */
export function FacetCount({ result, className = '' }: { result: CountResult; className?: string }) {
  const { kind, value, available, displayLabel } = result;

  if (kind === 'suppressed') {
    return (
      <span className={`text-[11px] italic text-slate-400 ${className}`} title="Below disclosure threshold">
        {displayLabel}
      </span>
    );
  }

  if (kind === 'boolean') {
    if (!available) {
      return (
        <span className={`text-[11px] italic text-slate-400 ${className}`} title="No data available">
          n/a
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700 ${className}`}
        title="Data available"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" aria-hidden="true" />
        avail
      </span>
    );
  }

  if (kind === 'zero') {
    return <span className={`text-[11px] font-medium text-slate-400 ${className}`}>0</span>;
  }

  if (kind === 'rounded') {
    return (
      <span className={`text-[11px] font-semibold tabular-nums text-amber-600 ${className}`} title="Rounded count">
        {'≈'}
        {formatCount(typeof value === 'number' ? value : 0)}
      </span>
    );
  }

  // exact
  return (
    <span className={`text-[11px] font-semibold tabular-nums text-slate-600 ${className}`}>
      {formatCount(typeof value === 'number' ? value : 0)}
    </span>
  );
}
