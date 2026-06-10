import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserPrompt, validateDraft } from './prompt';
import type { CohortSpec } from '../spec/types';
import { DEFAULT_SDC } from '../spec/types';

// ---------------------------------------------------------------------------
// Minimal spec fixture
// ---------------------------------------------------------------------------

const MINIMAL_SPEC: CohortSpec = {
  schemaVersion: '1.0',
  id: 'test',
  title: 'Test Dataset',
  primaryEntity: 'subjects',
  tables: {},
  relationships: [],
  sdc: DEFAULT_SDC,
  variables: [
    {
      name: 'sex',
      label: 'Sex',
      category: 'Demographics',
      entity: 'subjects',
      column: 'sex',
      widget: 'multiselect',
      sensitivity: 'None',
      values: ['Male', 'Female', 'Other'],
    },
    {
      name: 'age_group',
      label: 'Age Group',
      category: 'Demographics',
      entity: 'subjects',
      column: 'age_group',
      widget: 'bins',
      sensitivity: 'None',
      bins: [
        { label: '0-17', min: 0, max: 17 },
        { label: '18-64', min: 18, max: 64 },
        { label: '65+', min: 65, max: 120 },
      ],
    },
    {
      name: 'consented',
      label: 'Consented',
      category: 'Administrative',
      entity: 'subjects',
      column: 'consented',
      widget: 'boolean',
      sensitivity: 'None',
      booleanLabels: { yes: 'Yes', no: 'No' },
    },
    {
      name: 'visit_count',
      label: 'Visit Count',
      category: 'Clinical',
      entity: 'subjects',
      column: 'visit_count',
      widget: 'minCount',
      sensitivity: 'Low',
      options: [
        { label: 'At least 1', min: 1 },
        { label: 'At least 3', min: 3 },
      ],
    },
    {
      name: 'bmi',
      label: 'BMI',
      category: 'Clinical',
      entity: 'subjects',
      column: 'bmi',
      widget: 'range',
      sensitivity: 'None',
      range: { min: 10, max: 60 },
    },
    {
      name: 'internal_id',
      label: 'Internal ID',
      category: 'Internal',
      entity: 'subjects',
      column: 'internal_id',
      widget: 'internal',
      sensitivity: 'High',
    },
    {
      name: 'hidden_field',
      label: 'Hidden',
      category: 'Internal',
      entity: 'subjects',
      column: 'hidden_field',
      widget: 'multiselect',
      sensitivity: 'Low',
      visible: false,
    },
  ],
};

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('includes the spec title and the hard rules + example', () => {
    const prompt = buildSystemPrompt(MINIMAL_SPEC);
    expect(prompt).toContain('Test Dataset');
    expect(prompt).toContain('HARD RULES');
    expect(prompt).toContain('AT MOST ONE'); // anti-mirror rule
    expect(prompt).toContain('EXAMPLE');
    expect(prompt).not.toContain('<optional caveats>'); // no placeholder leakage
  });

  it('lists visible variables', () => {
    const prompt = buildSystemPrompt(MINIMAL_SPEC);
    expect(prompt).toContain('sex');
    expect(prompt).toContain('age_group');
    expect(prompt).toContain('consented');
    expect(prompt).toContain('visit_count');
    expect(prompt).toContain('bmi');
  });

  it('excludes internal widget variables', () => {
    const prompt = buildSystemPrompt(MINIMAL_SPEC);
    expect(prompt).not.toContain('internal_id');
  });

  it('excludes variables with visible === false', () => {
    const prompt = buildSystemPrompt(MINIMAL_SPEC);
    expect(prompt).not.toContain('hidden_field');
  });

  it('includes multiselect values', () => {
    const prompt = buildSystemPrompt(MINIMAL_SPEC);
    expect(prompt).toContain('Male');
    expect(prompt).toContain('Female');
  });

  it('includes bin labels', () => {
    const prompt = buildSystemPrompt(MINIMAL_SPEC);
    expect(prompt).toContain('0-17');
    expect(prompt).toContain('18-64');
  });

  it('includes range bounds', () => {
    const prompt = buildSystemPrompt(MINIMAL_SPEC);
    expect(prompt).toContain('10');
    expect(prompt).toContain('60');
  });

  it('instructs returning JSON only', () => {
    const prompt = buildSystemPrompt(MINIMAL_SPEC);
    expect(prompt.toLowerCase()).toContain('json');
  });
});

// ---------------------------------------------------------------------------
// buildUserPrompt
// ---------------------------------------------------------------------------

describe('buildUserPrompt', () => {
  it('embeds the user text', () => {
    const prompt = buildUserPrompt('adults with BMI over 30');
    expect(prompt).toContain('adults with BMI over 30');
  });

  it('requests JSON output', () => {
    const prompt = buildUserPrompt('test');
    expect(prompt.toLowerCase()).toContain('json');
  });
});

// ---------------------------------------------------------------------------
// validateDraft
// ---------------------------------------------------------------------------

describe('validateDraft', () => {
  it('parses a well-formed JSON string', () => {
    const raw = JSON.stringify({
      include: [{ field: 'sex', operator: 'in', value: ['Male'] }],
      exclude: [],
    });
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include).toHaveLength(1);
    expect(result.include[0]).toMatchObject({ field: 'sex', operator: 'in', value: ['Male'] });
    expect(result.exclude).toHaveLength(0);
  });

  it('strips markdown fences before parsing', () => {
    const raw = '```json\n{"include":[],"exclude":[]}\n```';
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include).toHaveLength(0);
    expect(result.exclude).toHaveLength(0);
  });

  it('accepts a pre-parsed object', () => {
    const raw = { include: [], exclude: [], notes: 'hello' };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.notes).toBe('hello');
  });

  it('returns empty arrays for completely invalid input', () => {
    const result = validateDraft('not json at all!!!', MINIMAL_SPEC);
    expect(result.include).toHaveLength(0);
    expect(result.exclude).toHaveLength(0);
  });

  it('returns empty arrays for null input', () => {
    const result = validateDraft(null, MINIMAL_SPEC);
    expect(result.include).toHaveLength(0);
    expect(result.exclude).toHaveLength(0);
  });

  it('drops criteria for unknown fields', () => {
    const raw = {
      include: [
        { field: 'sex', operator: 'in', value: ['Male'] },
        { field: 'nonexistent_field', operator: 'in', value: ['x'] },
      ],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include).toHaveLength(1);
    expect(result.include[0]?.field).toBe('sex');
  });

  it('drops criteria for internal widget fields', () => {
    const raw = {
      include: [{ field: 'internal_id', operator: 'in', value: ['x'] }],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include).toHaveLength(0);
  });

  it('drops criteria for visible===false fields', () => {
    const raw = {
      include: [{ field: 'hidden_field', operator: 'in', value: ['x'] }],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include).toHaveLength(0);
  });

  it('coerces boolean operator to "="', () => {
    const raw = {
      include: [{ field: 'consented', operator: 'badop', value: 'true' }],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include[0]?.operator).toBe('=');
  });

  it('coerces boolean value true (boolean) to string "true"', () => {
    const raw = {
      include: [{ field: 'consented', operator: '=', value: true }],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include[0]?.value).toBe('true');
  });

  it('coerces boolean value false (boolean) to string "false"', () => {
    const raw = {
      include: [{ field: 'consented', operator: '=', value: false }],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include[0]?.value).toBe('false');
  });

  it('coerces minCount operator to ">="', () => {
    const raw = {
      include: [{ field: 'visit_count', operator: 'in', value: '3' }],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include[0]?.operator).toBe('>=');
  });

  it('coerces minCount numeric value to string', () => {
    const raw = {
      include: [{ field: 'visit_count', operator: '>=', value: 3 }],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include[0]?.value).toBe('3');
  });

  it('coerces range operator to "between"', () => {
    const raw = {
      include: [{ field: 'bmi', operator: 'in', value: '20,35' }],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include[0]?.operator).toBe('between');
  });

  it('accepts valid range string value', () => {
    const raw = {
      include: [{ field: 'bmi', operator: 'between', value: '20,35' }],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include[0]?.value).toBe('20,35');
  });

  it('wraps a bare multiselect string value in an array', () => {
    const raw = {
      include: [{ field: 'sex', operator: 'in', value: 'Male' }],
      exclude: [],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.include[0]?.value).toEqual(['Male']);
  });

  it('preserves notes as a string', () => {
    const raw = { include: [], exclude: [], notes: 'some caveat' };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.notes).toBe('some caveat');
  });

  it('preserves unmatched as a string array', () => {
    const raw = { include: [], exclude: [], unmatched: ['blood pressure'] };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.unmatched).toEqual(['blood pressure']);
  });

  it('filters non-string values from unmatched', () => {
    const raw = { include: [], exclude: [], unmatched: ['valid', 42, null] };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.unmatched).toEqual(['valid']);
  });

  it('handles exclude criteria correctly', () => {
    const raw = {
      include: [],
      exclude: [{ field: 'age_group', operator: 'in', value: ['0-17'] }],
    };
    const result = validateDraft(raw, MINIMAL_SPEC);
    expect(result.exclude).toHaveLength(1);
    expect(result.exclude[0]?.field).toBe('age_group');
  });
});

// ---------------------------------------------------------------------------
// validateDraft - hardening against weak-model output
// ---------------------------------------------------------------------------

describe('validateDraft - hardening', () => {
  it('drops multiselect values not in the controlled vocabulary, routing them to unmatched', () => {
    const raw = { include: [{ field: 'sex', operator: 'in', value: ['Female', 'Wizard'] }] };
    const r = validateDraft(raw, MINIMAL_SPEC);
    expect(r.include[0]?.value).toEqual(['Female']);
    expect(r.unmatched).toContain('Sex: Wizard');
  });

  it('matches vocabulary case/punctuation-insensitively', () => {
    const raw = { include: [{ field: 'sex', operator: 'in', value: ['female'] }] };
    expect(validateDraft(raw, MINIMAL_SPEC).include[0]?.value).toEqual(['Female']);
  });

  it('maps a bare age number onto the bin whose range contains it', () => {
    const raw = { include: [{ field: 'age_group', operator: 'in', value: ['90'] }] };
    expect(validateDraft(raw, MINIMAL_SPEC).include[0]?.value).toEqual(['65+']);
  });

  it('drops a criterion whose values all fail to map (no empty criterion emitted)', () => {
    const raw = { include: [{ field: 'sex', operator: 'in', value: ['Nope'] }] };
    const r = validateDraft(raw, MINIMAL_SPEC);
    expect(r.include).toHaveLength(0);
    expect(r.unmatched).toContain('Sex: Nope');
  });

  it('clamps an absurd minCount to the variable maximum', () => {
    const raw = { include: [{ field: 'visit_count', operator: '>=', value: '90' }] };
    expect(validateDraft(raw, MINIMAL_SPEC).include[0]?.value).toBe('3');
  });

  it('removes mirror exclude rows (same field in include and exclude)', () => {
    const raw = {
      include: [{ field: 'sex', operator: 'in', value: ['Female'] }],
      exclude: [{ field: 'sex', operator: 'notIn', value: ['Female'] }],
    };
    const r = validateDraft(raw, MINIMAL_SPEC);
    expect(r.include).toHaveLength(1);
    expect(r.exclude).toHaveLength(0);
  });

  it('strips placeholder text from notes and unmatched', () => {
    const raw = {
      include: [],
      notes: '<optional caveats>',
      unmatched: ['<concept that could not be mapped>', 'real concept'],
    };
    const r = validateDraft(raw, MINIMAL_SPEC);
    expect(r.notes).toBeUndefined();
    expect(r.unmatched).toEqual(['real concept']);
  });

  it('recovers JSON embedded in surrounding prose', () => {
    const raw = 'Sure! Here you go:\n{"include":[{"field":"consented","operator":"=","value":"true"}]}\nHope that helps.';
    const r = validateDraft(raw, MINIMAL_SPEC);
    expect(r.include[0]).toMatchObject({ field: 'consented', value: 'true' });
  });
});
