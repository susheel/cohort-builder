import type { LlmConfig, LlmProvider } from '../llm/types';
import { WEBLLM_MODELS, DEFAULT_WEBLLM_MODEL } from '../llm/models';

/**
 * Provider + model controls for the plain-English assistant. Shared between the
 * Describe-the-cohort panel (where it is used) and the Settings drawer, so the
 * provider dropdown and key fields are discoverable from where the feature
 * actually runs. State lives in llmConfig (persisted to localStorage).
 */
export function AiProviderControls({
  config,
  onChange,
}: {
  config: LlmConfig;
  onChange: (c: LlmConfig) => void;
}) {
  const merge = (patch: Partial<LlmConfig>) => onChange({ ...config, ...patch });
  const isExternal = config.provider === 'openai' || config.provider === 'anthropic';
  const selectedModel = WEBLLM_MODELS.find((m) => m.id === (config.model ?? DEFAULT_WEBLLM_MODEL));

  return (
    <div className="space-y-2.5">
      <label className="block">
        <span className="text-xs font-medium text-slate-700">AI provider</span>
        <select
          value={config.provider}
          onChange={(e) => merge({ provider: e.target.value as LlmProvider, model: undefined })}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
        >
          <option value="webllm">In-browser model (WebGPU, no key)</option>
          <option value="openai">OpenAI-compatible (your API key)</option>
          <option value="anthropic">Anthropic-compatible (your API key)</option>
        </select>
      </label>

      {config.provider === 'webllm' && (
        <>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">In-browser model</span>
            <select
              value={config.model ?? DEFAULT_WEBLLM_MODEL}
              onChange={(e) => merge({ model: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              {WEBLLM_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.params}, {m.download}){m.recommended ? ' - recommended' : ''}
                </option>
              ))}
            </select>
          </label>
          {selectedModel && (
            <p className="text-[11px] leading-relaxed text-slate-500">{selectedModel.note}</p>
          )}
          <p className="text-[11px] leading-relaxed text-slate-400">
            Runs entirely in your browser via WebGPU; the model downloads and caches on first use and
            nothing leaves your machine. For best quality, an external provider outperforms any
            in-browser model.
          </p>
        </>
      )}

      {isExternal && (
        <div className="space-y-2.5">
          <Field
            label="Base URL"
            value={config.baseUrl ?? ''}
            placeholder={config.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'}
            onChange={(v) => merge({ baseUrl: v })}
          />
          <Field
            label="API key"
            type="password"
            value={config.apiKey ?? ''}
            placeholder="sk-…"
            onChange={(v) => merge({ apiKey: v })}
          />
          <Field
            label="Model"
            value={config.model ?? ''}
            placeholder={config.provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5'}
            onChange={(v) => merge({ model: v })}
          />
          <p className="text-[11px] leading-relaxed text-slate-400">
            Keys are stored only in this browser (localStorage) and used to call the endpoint directly
            from your browser. Only your description is sent; your data is never sent.
          </p>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={config.trace ?? false}
          onChange={(e) => merge({ trace: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500/40"
        />
        Show LLM trace (request &amp; response)
      </label>
    </div>
  );
}

function Field({
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
