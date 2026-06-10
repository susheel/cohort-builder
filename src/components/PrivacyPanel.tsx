import { useEffect, useState } from 'react';
import { useApp } from '../app/AppState';
import type { PrivacyMetrics } from '../query/privacy';

type Assessment = PrivacyMetrics | { suppressed: true } | null;

interface RiskBand {
  label: string;
  text: string;
  bg: string;
  border: string;
  dot: string;
}

/**
 * Risk band for a k-anonymity value. Colour is paired with text in every case
 * so risk is never communicated by colour alone (WCAG 1.4.1).
 *
 * Why explicit emerald/amber/red rather than the sens-* palette: sens-low is
 * cyan, which does not read as "good" for a risk score.
 */
function riskBand(kAnonymity: number, threshold: number): RiskBand {
  if (kAnonymity >= threshold) {
    return {
      label: 'Low risk',
      text: 'text-emerald-700',
      bg: 'bg-emerald-50',
      border: 'border-emerald-300',
      dot: 'bg-emerald-500',
    };
  }
  if (kAnonymity <= 1) {
    return {
      label: 'High re-identification risk',
      text: 'text-sens-high',
      bg: 'bg-sens-high/5',
      border: 'border-sens-high/40',
      dot: 'bg-sens-high',
    };
  }
  return {
    label: 'Caution',
    text: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    dot: 'bg-amber-500',
  };
}

function joinLabels(labels: string[]): string {
  if (labels.length === 0) return 'demographic';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function kAnonymityGloss(m: PrivacyMetrics): string {
  const profile = joinLabels(m.qiLabels);
  if (m.kAnonymity <= 1) {
    return `The most identifiable subject is unique on their ${profile} profile.`;
  }
  const others = m.kAnonymity - 1;
  return `The most identifiable subject shares their ${profile} profile with ${others} other${others === 1 ? '' : 's'}.`;
}

export function PrivacyPanel() {
  const { spec, query, sdc, getPrivacyMetrics } = useApp();
  const [assessment, setAssessment] = useState<Assessment>(null);
  const [assessing, setAssessing] = useState(false);

  useEffect(() => {
    if (!spec) {
      setAssessment(null);
      return;
    }
    let cancelled = false;
    setAssessing(true);
    const timer = setTimeout(() => {
      getPrivacyMetrics()
        .then((m) => {
          if (!cancelled) setAssessment(m);
        })
        .catch(() => {
          if (!cancelled) setAssessment(null);
        })
        .finally(() => {
          if (!cancelled) setAssessing(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [spec, query, sdc, getPrivacyMetrics]);

  if (!spec) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Privacy assessment</h2>
        {assessing && (
          <span className="text-[11px] italic text-slate-400" aria-hidden="true">
            assessing…
          </span>
        )}
      </div>

      <div aria-live="polite" aria-busy={assessing}>
        {assessment === null ? (
          <p className="text-sm text-slate-400">
            Privacy assessment is not available for this dataset (no quasi-identifiers configured).
          </p>
        ) : 'suppressed' in assessment ? (
          <p className="text-sm text-slate-400">
            The cohort is below the disclosure threshold; a privacy assessment is withheld until the
            cohort is large enough.
          </p>
        ) : (
          <Metrics metrics={assessment} />
        )}
      </div>

      <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
        k-anonymity and l-diversity are computed on the matching cohort and are informational; they
        do not block queries.
      </p>
    </div>
  );
}

function Metrics({ metrics: m }: { metrics: PrivacyMetrics }) {
  const band = riskBand(m.kAnonymity, m.threshold);
  return (
    <div className="space-y-3">
      <div className={`rounded-md border ${band.border} ${band.bg} p-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-700">
            k-anonymity ={' '}
            <span className="tabular-nums">{m.kAnonymity}</span>
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border ${band.border} px-2 py-0.5 text-[11px] font-semibold ${band.text}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${band.dot}`} aria-hidden="true" />
            {band.label}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{kAnonymityGloss(m)}</p>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        {m.lDiversity == null ? (
          <p className="text-xs text-slate-500">
            l-diversity: not assessed (no sensitive attribute configured).
          </p>
        ) : (
          <>
            <span className="text-sm font-semibold text-slate-700">
              l-diversity ={' '}
              <span className="tabular-nums">{m.lDiversity}</span>
            </span>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              Every demographic group contains at least {m.lDiversity} distinct{' '}
              {m.sensitiveLabel ?? 'sensitive'} value{m.lDiversity === 1 ? '' : 's'}.
            </p>
          </>
        )}
      </div>

      <p className="text-xs text-slate-500">
        <span className="tabular-nums">{m.classes}</span> demographic group
        {m.classes === 1 ? '' : 's'}; <span className="tabular-nums">{m.recordsAtRisk}</span>{' '}
        subject{m.recordsAtRisk === 1 ? '' : 's'} in groups smaller than k=
        <span className="tabular-nums">{m.threshold}</span> (
        <span className="tabular-nums">{m.classesAtRisk}</span> such group
        {m.classesAtRisk === 1 ? '' : 's'}).
      </p>

      <p className="text-[11px] leading-relaxed text-slate-400">
        Quasi-identifiers: {m.qiLabels.length > 0 ? joinLabels(m.qiLabels) : 'none'}
        {m.sensitiveLabel ? `; sensitive attribute: ${m.sensitiveLabel}` : '; no sensitive attribute'}.
        These are configurable in the spec.
      </p>
    </div>
  );
}
