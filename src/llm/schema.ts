import type { CohortSpec, VariableSpec } from '../spec/types';

/**
 * JSON schema for the drafted-cohort payload, derived from the spec. This is
 * the single source of truth for constrained decoding:
 *
 *  - WebLLM:    response_format { type: 'json_object', schema } (XGrammar)
 *  - OpenAI:    response_format { type: 'json_schema', strict }
 *  - Anthropic: a forced tool call whose input_schema is this object
 *
 * Field names and operators are enum-bound here so the model physically cannot
 * emit an unknown field or operator. Values stay loosely typed (string or
 * string[]) and are grounded against each variable's controlled vocabulary by
 * validateDraft(); binding every value enum per-field would explode the grammar
 * for little gain over the existing value validation.
 */

export const CRITERION_OPERATORS = ['in', 'notIn', 'all', '=', 'between', '>='] as const;

function draftableFields(spec: CohortSpec): string[] {
  return spec.variables
    .filter((v) => v.visible !== false && v.widget !== 'internal')
    .map((v) => v.name);
}

export interface JsonSchema {
  [key: string]: unknown;
}

export function buildResponseSchema(spec: CohortSpec): JsonSchema {
  const fields = draftableFields(spec);

  const criterion: JsonSchema = {
    type: 'object',
    properties: {
      field: { type: 'string', enum: fields },
      operator: { type: 'string', enum: [...CRITERION_OPERATORS] },
      // a single value (boolean/range/count) or a list of vocabulary values
      value: {
        anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
      },
    },
    required: ['field', 'operator', 'value'],
    additionalProperties: false,
  };

  return {
    type: 'object',
    properties: {
      include: { type: 'array', items: criterion },
      exclude: { type: 'array', items: criterion },
      notes: { type: 'string' },
      unmatched: { type: 'array', items: { type: 'string' } },
    },
    // all keys required so the shape is identical across providers (OpenAI
    // strict mode in particular requires every property to be listed)
    required: ['include', 'exclude', 'notes', 'unmatched'],
    additionalProperties: false,
  };
}

/** The schema as a string, for engines that take a stringified JSON schema (WebLLM). */
export function buildResponseSchemaString(spec: CohortSpec): string {
  return JSON.stringify(buildResponseSchema(spec));
}

/** Name of the synthetic tool/function the model "calls" to return the cohort. */
export const COHORT_TOOL_NAME = 'submit_cohort';

/** Helper for the spec's draftable variables (used by the few-shot builder). */
export function draftableVariables(spec: CohortSpec): VariableSpec[] {
  return spec.variables.filter((v) => v.visible !== false && v.widget !== 'internal');
}
