import type { DraftCriterion } from '../llm/types';

/**
 * Starter cohort templates. Each references variables by name; at apply time we
 * keep only the criteria whose field exists (and whose values are valid) in the
 * current spec, so a template degrades gracefully across datasets.
 */
export interface CohortTemplate {
  id: string;
  title: string;
  description: string;
  include: DraftCriterion[];
  exclude: DraftCriterion[];
}

export const TEMPLATES: CohortTemplate[] = [
  {
    id: 'ad-cases',
    title: "Alzheimer's disease cases (65+)",
    description: "Older adults with an Alzheimer's diagnosis.",
    include: [
      { field: 'diagnosis', operator: 'in', value: ["Alzheimer's Disease"] },
      { field: 'age', operator: 'in', value: ['70-74', '75-79', '80-84', '85-89', '90+'] },
    ],
    exclude: [],
  },
  {
    id: 'controls',
    title: 'Cognitively normal controls',
    description: 'Control subjects with no dementia diagnosis.',
    include: [{ field: 'diagnosis', operator: 'in', value: ['Control'] }],
    exclude: [{ field: 'hasDementia', operator: '=', value: 'true' }],
  },
  {
    id: 'apoe4-carriers',
    title: 'APOE e4 carriers with cognitive data',
    description: 'Carriers of at least one APOE e4 allele who have cognitive assessment data.',
    include: [
      { field: 'apoeGenotype', operator: 'in', value: ['e2/e4', 'e3/e4', 'e4/e4'] },
      { field: 'hasCognitiveAssessment', operator: '=', value: 'true' },
    ],
    exclude: [],
  },
  {
    id: 'mci-with-genomics',
    title: 'MCI with whole-genome data',
    description: 'Mild cognitive impairment subjects who have WGS files.',
    include: [
      { field: 'diagnosis', operator: 'in', value: ['Mild Cognitive Impairment'] },
      { field: 'assayType', operator: 'in', value: ['WGS'] },
    ],
    exclude: [],
  },
];
