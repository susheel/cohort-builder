import { useState } from 'react';
import { useApp } from '../app/AppState';
import { formatCount } from '../sdc/format';
import type { CountResult } from '../sdc/engine';
import type { SdcLevelPolicy } from '../spec/types';
import { SensitivityBadge } from './SensitivityBadge';

export function CountRail() {
  const {
    count,
    rawCount,
    counting,
    activeSensitivity,
    sdc,
    revealRaw,
    populationWarning,
    repetitionWarning,
  } = useApp();

  const [howOpen, setHowOpen] = useState(false);
  const level = sdc.levels[activeSensitivity];

  const showDemo =
    revealRaw &&
    rawCount != null &&
    count != null &&
    (count.kind === 'suppressed' || count.kind === 'boolean' || count.kind === 'rounded');

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Matching subjects</h2>
          <SensitivityBadge sensitivity={activeSensitivity} title={`Highest sensitivity in query: ${activeSensitivity}`} />
        </div>

        <div aria-live="polite" aria-busy={counting} className={counting ? 'opacity-50' : ''}>
          {count ? <CountDisplay result={count} counting={counting} /> : <p className="text-sm text-slate-400">Computing…</p>}
        </div>

        <LevelTreatment level={level} sensitivity={activeSensitivity} enabled={sdc.enabled} />
      </div>

      {populationWarning && <AlertBanner>{populationWarning}</AlertBanner>}
      {repetitionWarning && <AlertBanner>{repetitionWarning}</AlertBanner>}

      {showDemo && (
        <div className="rounded-lg border-2 border-dashed border-sens-high bg-sens-high/5 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-sens-high">Demo mode (presenter only)</p>
          <p className="mt-1 text-sm text-slate-700">
            True raw count = <span className="font-bold">{formatCount(rawCount!)}</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            This is what disclosure control hid. Never shown to end users.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setHowOpen((o) => !o)}
          aria-expanded={howOpen}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500/40"
        >
          How this number was computed
          <span className="text-slate-400">{howOpen ? '−' : '+'}</span>
        </button>
        {howOpen && (
          <div className="space-y-1.5 border-t border-slate-100 px-4 py-3 text-[11px] leading-relaxed text-slate-500">
            <p>
              Disclosure control is {sdc.enabled ? 'enabled' : 'disabled'}. The highest sensitivity touched by your
              query is <strong>{activeSensitivity}</strong>, so the {activeSensitivity} policy applies:
            </p>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>Counts below {level.thresholdK} are suppressed (shown as &lt;{level.thresholdK}).</li>
              {level.booleanOnly ? (
                <li>This tier discloses only availability, never a number.</li>
              ) : level.roundingMode !== 'none' && level.roundingBase > 1 ? (
                <li>
                  Counts are rounded ({level.roundingMode}) to the nearest {level.roundingBase}.
                </li>
              ) : (
                <li>Counts at or above the threshold are shown exactly.</li>
              )}
              {level.zeroIsDisclosive && <li>A true zero is also suppressed at this tier.</li>}
              {level.complementarySuppression && <li>Complementary suppression guards cross-tab margins.</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function CountDisplay({ result, counting }: { result: CountResult; counting: boolean }) {
  const shimmer = counting ? 'animate-pulse' : '';

  switch (result.kind) {
    case 'exact':
      return (
        <div>
          <p className={`text-4xl font-bold text-slate-900 ${shimmer}`}>{formatCount(result.value ?? 0)}</p>
          <p className="mt-1 text-sm text-slate-500">subjects match</p>
        </div>
      );

    case 'rounded':
      return (
        <div>
          <div className="flex items-baseline gap-2">
            <p className={`text-4xl font-bold text-slate-900 ${shimmer}`}>≈ {formatCount(result.value ?? 0)}</p>
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700"
              title="Rounded to protect privacy"
            >
              rounded
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">subjects match (rounded to protect privacy)</p>
        </div>
      );

    case 'suppressed':
      return (
        <div>
          <p className={`text-4xl font-bold text-slate-400 ${shimmer}`}>{result.displayLabel}</p>
          <p className="mt-1 text-sm text-slate-500">
            Exact count suppressed (below the disclosure threshold).
          </p>
          {result.available && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              <Dot className="bg-emerald-500" /> Data available
            </span>
          )}
        </div>
      );

    case 'boolean':
      return (
        <div>
          {result.available ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-3 py-1.5 text-base font-semibold text-emerald-700">
              <Dot className="bg-emerald-500" /> Data available
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-base font-semibold text-slate-500">
              <Dot className="bg-slate-400" /> Insufficient data
            </span>
          )}
          <p className="mt-2 text-sm text-slate-500">
            Exact counts are not disclosed for high-sensitivity queries.
          </p>
        </div>
      );

    case 'zero':
      return (
        <div>
          <p className={`text-4xl font-bold text-slate-700 ${shimmer}`}>0</p>
          <p className="mt-1 text-sm text-slate-500">No matching subjects (a true zero, not suppressed).</p>
        </div>
      );
  }
}

function LevelTreatment({
  level,
  sensitivity,
  enabled,
}: {
  level: SdcLevelPolicy;
  sensitivity: string;
  enabled: boolean;
}) {
  if (!enabled) {
    return <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">Disclosure control disabled (exact counts).</p>;
  }
  const treatment = level.booleanOnly
    ? 'availability only'
    : level.roundingMode !== 'none' && level.roundingBase > 1
      ? `rounded to ${level.roundingBase}`
      : 'exact above threshold';
  return (
    <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
      {sensitivity} policy: threshold k = {level.thresholdK}, {treatment}.
    </p>
  );
}

function AlertBanner({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
      {children}
    </div>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`h-2 w-2 rounded-full ${className}`} aria-hidden="true" />;
}
