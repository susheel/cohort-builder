/**
 * Curated subset of WebLLM prebuilt models for in-browser cohort drafting,
 * ordered from smallest/fastest to largest/most capable. Structured extraction
 * (NL -> JSON criteria) is demanding, so very small models (<= 1B) are offered
 * but flagged as basic. Download sizes are approximate; weights are cached by
 * the browser after first use.
 */
export interface WebLlmModel {
  id: string;
  label: string;
  params: string;
  download: string;
  note: string;
  recommended?: boolean;
}

export const WEBLLM_MODELS: WebLlmModel[] = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 0.5B',
    params: '0.5B',
    download: '~0.9 GB',
    note: 'Tiny and fastest. Basic quality; may miss or mis-map criteria. Low-end devices.',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B',
    params: '1B',
    download: '~0.9 GB',
    note: 'Fast, small. Limited at structured extraction; expect occasional spurious criteria.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 1.5B',
    params: '1.5B',
    download: '~1.6 GB',
    note: 'Balanced default. Noticeably better JSON/criteria quality than 1B for a modest size.',
    recommended: true,
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B',
    params: '3B',
    download: '~2.3 GB',
    note: 'Higher quality, slower. Needs a capable GPU (roughly 3 GB VRAM).',
  },
  {
    id: 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC',
    label: 'Hermes 3 (Llama 3.2 3B)',
    params: '3B',
    download: '~2.3 GB',
    note: 'Tuned for structured / function-calling output; strong at clean JSON.',
  },
  {
    id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 7B',
    params: '7B',
    download: '~5.8 GB',
    note: 'Best quality offered. Large download; needs a strong GPU (roughly 6 GB VRAM).',
  },
];

export const DEFAULT_WEBLLM_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

export function webLlmModel(id?: string): WebLlmModel | undefined {
  return WEBLLM_MODELS.find((m) => m.id === id);
}
