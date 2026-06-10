import type { CohortSpec } from '../spec/types';
import type { LlmClient, LlmConfig, DraftedCohort, LlmProgress } from './types';
import { buildSystemPrompt, buildUserPrompt, validateDraft } from './prompt';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
}

export class AnthropicClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  unavailableReason?: string;

  constructor(config: LlmConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiKey = config.apiKey ?? '';
    this.model = config.model ?? DEFAULT_MODEL;
    if (!this.apiKey) {
      this.unavailableReason = 'Anthropic API key not configured.';
    }
  }

  async available(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async draftCohort(
    text: string,
    spec: CohortSpec,
    onProgress?: (p: LlmProgress) => void,
  ): Promise<DraftedCohort> {
    onProgress?.({ text: 'Sending request to Anthropic...' });

    const body = {
      model: this.model,
      max_tokens: 1024,
      system: buildSystemPrompt(spec),
      messages: [
        { role: 'user', content: buildUserPrompt(text) },
      ],
    };

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Anthropic request failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const content = data.content.find((b) => b.type === 'text')?.text ?? '';

    onProgress?.({ text: 'Parsing response...' });
    return validateDraft(content, spec);
  }
}
