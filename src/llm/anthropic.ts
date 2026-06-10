import type { CohortSpec } from '../spec/types';
import type { LlmClient, LlmConfig, DraftedCohort, LlmProgress, LlmTrace } from './types';
import { buildSystemPrompt, buildUserPrompt, validateDraft } from './prompt';
import { buildResponseSchema, COHORT_TOOL_NAME } from './schema';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
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
    onTrace?: (t: LlmTrace) => void,
  ): Promise<DraftedCohort> {
    onProgress?.({ text: 'Sending request to Anthropic...' });

    const endpoint = `${this.baseUrl}/v1/messages`;
    // Force a single tool call whose input is the spec-derived schema: the
    // model must return structured criteria, not free text.
    const body = {
      model: this.model,
      max_tokens: 1024,
      system: buildSystemPrompt(spec),
      messages: [
        { role: 'user', content: buildUserPrompt(text) },
      ],
      tools: [
        {
          name: COHORT_TOOL_NAME,
          description: 'Submit the drafted cohort criteria mapped onto the dataset variables.',
          input_schema: buildResponseSchema(spec),
        },
      ],
      tool_choice: { type: 'tool', name: COHORT_TOOL_NAME },
    };
    onTrace?.({ provider: 'anthropic', model: this.model, endpoint, request: body });

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onTrace?.({ provider: 'anthropic', model: this.model, endpoint, request: body, error: msg });
      throw e;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      const msg = `Anthropic request failed (${response.status}): ${errorText}`;
      onTrace?.({ provider: 'anthropic', model: this.model, endpoint, request: body, error: msg });
      throw new Error(msg);
    }

    const data = (await response.json()) as AnthropicResponse;
    // Prefer the forced tool call's structured input; fall back to any text.
    const toolUse = data.content.find((b) => b.type === 'tool_use' && b.name === COHORT_TOOL_NAME);
    const raw: unknown = toolUse?.input ?? data.content.find((b) => b.type === 'text')?.text ?? '';
    onTrace?.({
      provider: 'anthropic',
      model: this.model,
      endpoint,
      request: body,
      response: typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2),
    });

    onProgress?.({ text: 'Parsing response...' });
    return validateDraft(raw, spec);
  }
}
