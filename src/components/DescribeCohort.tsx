import { useState } from 'react';
import { useApp } from '../app/AppState';
import { OP, type CohortField } from '../query/fields';
import type { DraftCriterion, DraftedCohort, LlmTrace } from '../llm/types';

type Phase = 'idle' | 'checking' | 'drafting' | 'preview' | 'error';

/**
 * Natural-language front door. The user describes the cohort in plain English;
 * the configured LLM provider drafts spec-valid criteria, which are shown as a
 * read-only PREVIEW. Nothing is applied to the query until the user confirms
 * with "Use this cohort" (applyDraft). The description text (never any data) is
 * sent to the provider.
 */
export function DescribeCohort() {
  const { fields, llmAvailable, draftFromText, applyDraft, llmConfig, setLlmConfig } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ progress?: number; text: string } | null>(null);
  const [draft, setDraft] = useState<DraftedCohort | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [trace, setTrace] = useState<LlmTrace | null>(null);

  const traceOn = llmConfig.trace ?? false;

  const reset = () => {
    setPhase('idle');
    setProgress(null);
    setDraft(null);
    setProblem(null);
    setTrace(null);
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setProblem(null);
    setDraft(null);
    setTrace(null);
    setPhase('checking');
    const avail = await llmAvailable();
    if (!avail.ok) {
      setProblem(
        avail.reason ??
          'The configured AI provider is not available. Open Settings to choose a provider or add a key.',
      );
      setPhase('error');
      return;
    }
    setPhase('drafting');
    setProgress({ text: 'Contacting the model…' });
    try {
      const result = await draftFromText(
        trimmed,
        (p) => setProgress(p),
        traceOn ? (t) => setTrace(t) : undefined,
      );
      setDraft(result);
      setPhase('preview');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const confirm = () => {
    if (!draft) return;
    applyDraft(draft);
    reset();
    setOpen(false);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500/40"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <SparkIcon />
          Describe the cohort in plain English
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            AI, optional
          </span>
        </span>
        <span aria-hidden="true" className="text-slate-400">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 p-4">
          <label className="block">
            <span className="sr-only">Cohort description</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="e.g. older adults with Alzheimer's or MCI who have genetic data, excluding APOE e4/e4"
              className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim() || phase === 'checking' || phase === 'drafting'}
              className="rounded-md bg-cyan-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === 'checking' || phase === 'drafting' ? 'Drafting…' : 'Draft cohort'}
            </button>
            <span className="text-[11px] text-slate-400">
              Provider: <span className="font-medium text-slate-500">{providerLabel(llmConfig.provider)}</span>
            </span>
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
              <input
                type="checkbox"
                checked={traceOn}
                onChange={(e) => setLlmConfig({ ...llmConfig, trace: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500/40"
              />
              Show LLM trace
            </label>
          </div>

          <p className="rounded-md bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-500">
            The AI drafts a starting point that you review and edit before anything runs. Only your
            description is sent to your configured LLM provider; your data is never sent.
          </p>

          {(phase === 'checking' || phase === 'drafting') && (
            <div aria-live="polite" className="space-y-1.5">
              <p className="text-xs text-slate-500">{progress?.text ?? 'Working…'}</p>
              {typeof progress?.progress === 'number' && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-cyan-500 transition-all"
                    style={{ width: `${Math.round((progress.progress ?? 0) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {phase === 'error' && problem && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              <p>{problem}</p>
              <p className="mt-1.5 text-amber-700">
                Open <span className="font-semibold">Settings</span> (the gear icon, top right) to choose a provider or add a key.
              </p>
            </div>
          )}

          {phase === 'preview' && draft && (
            <DraftPreview draft={draft} fields={fields} onConfirm={confirm} onCancel={reset} />
          )}

          {traceOn && trace && <TracePanel trace={trace} />}
        </div>
      )}
    </div>
  );
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Developer-facing view of the exact request sent to the provider and the raw response. */
function TracePanel({ trace }: { trace: LlmTrace }) {
  const [open, setOpen] = useState(true);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-md border border-slate-300 bg-slate-50"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-600">
        LLM trace
        <span className="ml-1 font-normal text-slate-400">
          ({providerLabel(trace.provider)}
          {trace.model ? ` · ${trace.model}` : ''})
        </span>
      </summary>
      <div className="space-y-3 border-t border-slate-200 p-3">
        {trace.endpoint && (
          <p className="break-all text-[11px] text-slate-500">
            <span className="font-medium text-slate-600">Endpoint:</span> {trace.endpoint}
          </p>
        )}
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Request sent</p>
          <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-2.5 text-[11px] leading-relaxed text-slate-100">
            {prettyJson(trace.request)}
          </pre>
        </div>
        {trace.response !== undefined && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Response received</p>
            <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-2.5 text-[11px] leading-relaxed text-slate-100">
              {trace.response || '(empty)'}
            </pre>
          </div>
        )}
        {trace.error && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-600">Error</p>
            <pre className="max-h-40 overflow-auto rounded bg-rose-50 p-2.5 text-[11px] leading-relaxed text-rose-800">
              {trace.error}
            </pre>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-slate-400">
          This is the exact prompt and parameters sent to the provider. API keys are sent as headers and
          are not shown here. Only your description (never your data) is included.
        </p>
      </div>
    </details>
  );
}

function DraftPreview({
  draft,
  fields,
  onConfirm,
  onCancel,
}: {
  draft: DraftedCohort;
  fields: CohortField[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const empty = draft.include.length === 0 && draft.exclude.length === 0;
  return (
    <div className="rounded-md border border-cyan-200 bg-cyan-50/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">AI-drafted cohort (review before use)</p>

      {empty ? (
        <p className="mt-2 text-sm text-slate-600">
          The model did not map your description to any available variable. Try rephrasing, or build the cohort manually.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {draft.include.length > 0 && (
            <DraftZone title="Include — keep subjects who…" criteria={draft.include} fields={fields} zone="include" />
          )}
          {draft.exclude.length > 0 && (
            <DraftZone title="Exclude — remove subjects who…" criteria={draft.exclude} fields={fields} zone="exclude" />
          )}
        </div>
      )}

      {draft.notes && (
        <p className="mt-3 rounded bg-white/70 p-2 text-xs leading-relaxed text-slate-600">
          <span className="font-medium text-slate-700">Note from the model: </span>
          {draft.notes}
        </p>
      )}

      {draft.unmatched && draft.unmatched.length > 0 && (
        <div role="alert" className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs leading-relaxed text-amber-800">
          <span className="font-medium">Could not map: </span>
          {draft.unmatched.join(', ')}. These concepts have no matching variable and were left out.
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={empty}
          className="rounded-md bg-cyan-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Use this cohort
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DraftZone({
  title,
  criteria,
  fields,
  zone,
}: {
  title: string;
  criteria: DraftCriterion[];
  fields: CohortField[];
  zone: 'include' | 'exclude';
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="mt-1 space-y-1">
        {criteria.map((c, i) => (
          <li key={`${zone}-${i}`} className="text-sm text-slate-700">
            <span aria-hidden="true" className="mr-1 text-slate-300">
              ▸
            </span>
            {describeDraft(c, fields)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function providerLabel(p: string): string {
  if (p === 'webllm') return 'In-browser model';
  if (p === 'openai') return 'OpenAI-compatible';
  if (p === 'anthropic') return 'Anthropic-compatible';
  return p;
}

/** Plain-language phrasing of a drafted criterion, mirroring QuerySummary. */
function describeDraft(c: DraftCriterion, fields: CohortField[]): string {
  const field = fields.find((f) => f.name === c.field);
  if (!field) return c.field;
  const label = field.label;
  switch (field.cbWidget) {
    case 'boolean':
      return `${label} is ${optionLabel(field, String(c.value))}`;
    case 'multiselect':
    case 'bins': {
      const values = normaliseArray(c.value).map((v) => optionLabel(field, v));
      if (values.length === 0) return `${label} (no values chosen)`;
      const verb = c.operator === OP.notIn ? 'is none of' : c.operator === OP.all ? 'is all of' : 'is any of';
      return `${label} ${verb} ${values.join(', ')}`;
    }
    case 'minCount':
      return `${label} at least ${optionLabel(field, String(c.value))}`;
    case 'range': {
      const [min, max] = parseRange(c.value);
      return `${label} between ${min} and ${max}`;
    }
    default:
      return `${label} ${String(c.value ?? '')}`.trim();
  }
}

function optionLabel(field: CohortField, name: string): string {
  if (Array.isArray(field.values)) {
    for (const v of field.values) {
      if (v && typeof v === 'object' && 'name' in v && String((v as { name: unknown }).name) === name) {
        return String((v as { label?: unknown }).label ?? name);
      }
    }
  }
  return name;
}

function normaliseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value.length > 0) return value.split(',').map((s) => s.trim());
  return [];
}

function parseRange(value: unknown): [string, string] {
  if (Array.isArray(value)) return [String(value[0] ?? ''), String(value[1] ?? '')];
  if (typeof value === 'string') {
    const [a, b] = value.split(',');
    return [(a ?? '').trim(), (b ?? '').trim()];
  }
  return ['', ''];
}

function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-cyan-500">
      <path
        d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
