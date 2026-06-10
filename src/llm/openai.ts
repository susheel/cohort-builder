import type { CohortSpec } from '../spec/types';
import type { LlmClient, LlmConfig, DraftedCohort, LlmProgress } from './types';
import { buildSystemPrompt, buildUserPrompt, validateDraft } from './prompt';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiRequest {
  model: string;
  messages: OpenAiMessage[];
  response_format: { type: 'json_object' };
  max_tokens?: number;
}

interface OpenAiChoice {
  message: { content: string };
}

interface OpenAiResponse {
  choices: OpenAiChoice[];
}

export class OpenAiClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  unavailableReason?: string;

  constructor(config: LlmConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config.apiKey ?? '';
    this.model = config.model ?? DEFAULT_MODEL;
    if (!this.apiKey) {
      this.unavailableReason = 'OpenAI API key not configured.';
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
    onProgress?.({ text: 'Sending request to OpenAI...' });

    const body: OpenAiRequest = {
      model: this.model,
      messages: [
        { role: 'system', content: buildSystemPrompt(spec) },
        { role: 'user', content: buildUserPrompt(text) },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1024,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenAiResponse;
    const content = data.choices[0]?.message?.content ?? '';

    onProgress?.({ text: 'Parsing response...' });
    return validateDraft(content, spec);
  }
}
