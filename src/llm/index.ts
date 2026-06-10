export type { LlmClient, LlmConfig, LlmProvider, LlmProgress, LlmTrace, DraftedCohort, DraftCriterion } from './types';
export { buildSystemPrompt, buildUserPrompt, validateDraft } from './prompt';
export { OpenAiClient } from './openai';
export { AnthropicClient } from './anthropic';
export { WebLlmClient } from './webllm';

import type { LlmClient, LlmConfig } from './types';
import { OpenAiClient } from './openai';
import { AnthropicClient } from './anthropic';
import { WebLlmClient } from './webllm';

/**
 * Factory: returns the appropriate LlmClient for the given configuration.
 * Throws if the provider is unknown.
 */
export function makeLlmClient(config: LlmConfig): LlmClient {
  switch (config.provider) {
    case 'openai':
      return new OpenAiClient(config);
    case 'anthropic':
      return new AnthropicClient(config);
    case 'webllm':
      return new WebLlmClient(config);
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}
