import type { CohortSpec } from '../spec/types';

export type LlmProvider = 'openai' | 'anthropic' | 'webllm';

export interface LlmConfig {
  provider: LlmProvider;
  /** base URL for external providers (e.g. https://api.openai.com/v1) */
  baseUrl?: string;
  apiKey?: string;
  /** model id (provider-specific; for webllm an MLC prebuilt id) */
  model?: string;
}

/** A draft cohort proposed by the LLM, to be confirmed/edited by the user. */
export interface DraftCriterion {
  field: string;
  operator: string;
  value: unknown;
}

export interface DraftedCohort {
  include: DraftCriterion[];
  exclude: DraftCriterion[];
  /** model caveats / clarifications to surface to the user */
  notes?: string;
  /** concepts the user asked for that could not be mapped to a variable */
  unmatched?: string[];
}

export interface LlmProgress {
  /** 0..1 for model download/init (webllm); omitted for external providers */
  progress?: number;
  text: string;
}

export interface LlmClient {
  /** turn a plain-English description into drafted, spec-valid criteria */
  draftCohort(
    text: string,
    spec: CohortSpec,
    onProgress?: (p: LlmProgress) => void,
  ): Promise<DraftedCohort>;
  /** whether this client can run now (key present / WebGPU available) */
  available(): Promise<boolean>;
  /** human-readable reason when not available */
  unavailableReason?: string;
}
