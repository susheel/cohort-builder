import { useApp } from '../app/AppState';
import { SENSITIVITY_ORDER, type SdcConfig, type SdcLevelPolicy, type Sensitivity } from '../spec/types';
import type { LlmConfig, LlmProvider } from '../llm/types';
import { SensitivityBadge } from './SensitivityBadge';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { sdc, setSdc, resetSdc, revealRaw, setRevealRaw, llmConfig, setLlmConfig } = useApp();

  const updateLevel = <K extends keyof SdcLevelPolicy>(
    level: Sensitivity,
    key: K,
    value: SdcLevelPolicy[K],
  ) => {
    const next: SdcConfig = {
      ...sdc,
      levels: { ...sdc.levels, [level]: { ...sdc.levels[level], [key]: value } },
    };
    setSdc(next);
  };

  const updateGlobal = (key: keyof SdcConfig['global'], value: number) => {
    setSdc({ ...sdc, global: { ...sdc.global, [key]: value } });
  };

  return (
    <Drawer title="Disclosure control settings" onClose={onClose}>
      <p className="rounded-md bg-cyan-50 p-2.5 text-xs leading-relaxed text-cyan-800">
        These controls are client-side and advisory. They illustrate how a disclosure-control policy shapes what the UI
        reveals; they are not a substitute for server-side enforcement.
      </p>

      <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={sdc.enabled}
          onChange={(e) => setSdc({ ...sdc, enabled: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500/40"
        />
        Disclosure control enabled
      </label>

      <fieldset className="mt-4 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Global</legend>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Minimum query set size"
            value={sdc.global.minQuerySetSize}
            onChange={(v) => updateGlobal('minQuerySetSize', v)}
          />
          <NumberField
            label="Query repetition limit"
            value={sdc.global.queryRepetitionLimit}
            onChange={(v) => updateGlobal('queryRepetitionLimit', v)}
          />
        </div>
      </fieldset>

      <div className="mt-4 space-y-3">
        {SENSITIVITY_ORDER.map((level) => {
          const p = sdc.levels[level];
          return (
            <fieldset key={level} className="rounded-md border border-slate-200 p-3">
              <legend className="flex items-center gap-2 px-1">
                <SensitivityBadge sensitivity={level} />
              </legend>
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="Threshold k" value={p.thresholdK} onChange={(v) => updateLevel(level, 'thresholdK', v)} />
                <NumberField label="Rounding base" value={p.roundingBase} onChange={(v) => updateLevel(level, 'roundingBase', v)} />
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  Rounding mode
                  <select
                    value={p.roundingMode}
                    onChange={(e) => updateLevel(level, 'roundingMode', e.target.value as SdcLevelPolicy['roundingMode'])}
                    className="rounded border border-slate-300 px-2 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                  >
                    <option value="none">none</option>
                    <option value="nearest">nearest</option>
                    <option value="up">up</option>
                    <option value="random">random</option>
                  </select>
                </label>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                <CheckField label="Complementary suppression" checked={p.complementarySuppression} onChange={(v) => updateLevel(level, 'complementarySuppression', v)} />
                <CheckField label="Boolean only" checked={p.booleanOnly} onChange={(v) => updateLevel(level, 'booleanOnly', v)} />
                <CheckField label="Zero is disclosive" checked={p.zeroIsDisclosive} onChange={(v) => updateLevel(level, 'zeroIsDisclosive', v)} />
              </div>
            </fieldset>
          );
        })}
      </div>

      <AiAssistance config={llmConfig} onChange={setLlmConfig} />

      <fieldset className="mt-4 rounded-md border border-sens-high/30 bg-sens-high/5 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-sens-high">Demo</legend>
        <CheckField
          label="Demo mode: reveal suppressed raw counts (presenter only)"
          checked={revealRaw}
          onChange={setRevealRaw}
        />
      </fieldset>

      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={resetSdc}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
        >
          Reset to defaults
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
        >
          Done
        </button>
      </div>
    </Drawer>
  );
}

function AiAssistance({ config, onChange }: { config: LlmConfig; onChange: (c: LlmConfig) => void }) {
  const merge = (patch: Partial<LlmConfig>) => onChange({ ...config, ...patch });
  const isExternal = config.provider === 'openai' || config.provider === 'anthropic';

  const providers: { value: LlmProvider; label: string; hint: string }[] = [
    { value: 'webllm', label: 'In-browser model (WebGPU, no key)', hint: 'Runs locally; needs WebGPU and downloads a model on first use.' },
    { value: 'openai', label: 'OpenAI-compatible', hint: 'Calls an OpenAI-compatible endpoint directly from your browser.' },
    { value: 'anthropic', label: 'Anthropic-compatible', hint: 'Calls an Anthropic-compatible endpoint directly from your browser.' },
  ];

  return (
    <fieldset className="mt-4 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">AI assistance (optional)</legend>

      <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
        Used only by "Describe the cohort in plain English". Your data is never sent; only your
        description is sent to the endpoint you configure.
      </p>

      <div role="radiogroup" aria-label="AI provider" className="space-y-1.5">
        {providers.map((p) => (
          <label key={p.value} className="flex items-start gap-2 text-xs text-slate-700">
            <input
              type="radio"
              name="llm-provider"
              checked={config.provider === p.value}
              onChange={() => merge({ provider: p.value })}
              className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-cyan-600 focus:ring-cyan-500/40"
            />
            <span>
              <span className="font-medium">{p.label}</span>
              <span className="block text-[11px] text-slate-400">{p.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {isExternal && (
        <div className="mt-3 space-y-2.5">
          <TextField
            label="Base URL"
            value={config.baseUrl ?? ''}
            placeholder={config.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'}
            onChange={(v) => merge({ baseUrl: v })}
          />
          <TextField
            label="API key"
            value={config.apiKey ?? ''}
            type="password"
            placeholder="sk-…"
            onChange={(v) => merge({ apiKey: v })}
          />
          <TextField
            label="Model"
            value={config.model ?? ''}
            placeholder={config.provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-haiku-latest'}
            onChange={(v) => merge({ model: v })}
          />
          <p className="text-[11px] leading-relaxed text-slate-400">
            Keys are stored only in this browser (localStorage) and used to call the endpoint directly
            from your browser.
          </p>
        </div>
      )}

      {config.provider === 'webllm' && (
        <div className="mt-3 space-y-2.5">
          <TextField
            label="Model (optional)"
            value={config.model ?? ''}
            placeholder="MLC prebuilt model id"
            onChange={(v) => merge({ model: v })}
          />
          <p className="text-[11px] leading-relaxed text-slate-400">
            Requires a WebGPU-capable browser. The model is downloaded and cached on first use; nothing
            leaves your machine.
          </p>
        </div>
      )}
    </fieldset>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={type === 'password' ? 'off' : undefined}
        className="rounded border border-slate-300 px-2 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
      />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <input
        type="number"
        value={value}
        min={0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-slate-300 px-2 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
      />
    </label>
  );
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500/40"
      />
      {label}
    </label>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
