import type { CohortSpec } from '../spec/types';
import type { LlmClient, LlmConfig, DraftedCohort, LlmProgress } from './types';
import { buildSystemPrompt, buildUserPrompt, validateDraft } from './prompt';
import { DEFAULT_WEBLLM_MODEL } from './models';

const DEFAULT_MODEL = DEFAULT_WEBLLM_MODEL;

// Minimal shape of the WebLLM engine we use (avoids importing the full package at top level).
interface WebLlmEngine {
  chat: {
    completions: {
      create(params: {
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        max_tokens?: number;
        stream?: false;
      }): Promise<{
        choices: Array<{ message: { content: string | null } }>;
      }>;
    };
  };
}

type CreateMLCEngineType = (
  modelId: string,
  options?: {
    initProgressCallback?: (report: { progress: number; text: string }) => void;
  },
) => Promise<WebLlmEngine>;

export class WebLlmClient implements LlmClient {
  private readonly model: string;
  unavailableReason?: string;

  constructor(config: LlmConfig) {
    this.model = config.model ?? DEFAULT_MODEL;
    if (!('gpu' in navigator)) {
      this.unavailableReason = 'WebGPU is not available in this browser.';
    }
  }

  async available(): Promise<boolean> {
    return 'gpu' in navigator;
  }

  async draftCohort(
    text: string,
    spec: CohortSpec,
    onProgress?: (p: LlmProgress) => void,
  ): Promise<DraftedCohort> {
    if (!('gpu' in navigator)) {
      throw new Error('WebGPU is not available in this browser.');
    }

    onProgress?.({ text: 'Loading WebLLM module...' });

    // Dynamic import only — never imported at the top level to avoid
    // bundling @mlc-ai/web-llm eagerly in the main chunk.
    const webllm = (await import('@mlc-ai/web-llm')) as { CreateMLCEngine: CreateMLCEngineType };

    onProgress?.({ text: `Initialising model ${this.model}...` });

    const engine = await webllm.CreateMLCEngine(this.model, {
      initProgressCallback: (report) => {
        onProgress?.({ progress: report.progress, text: report.text });
      },
    });

    onProgress?.({ text: 'Generating cohort criteria...' });

    const completion = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: buildSystemPrompt(spec) },
        { role: 'user', content: buildUserPrompt(text) },
      ],
      temperature: 0,
      max_tokens: 1024,
      stream: false,
    });

    const content = completion.choices[0]?.message?.content ?? '';

    onProgress?.({ text: 'Parsing response...' });
    return validateDraft(content, spec);
  }
}
