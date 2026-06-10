import { describe, it, expect } from 'vitest';
import type { CohortSpec } from '../spec/types';
import { DEFAULT_SDC } from '../spec/types';
import { buildResponseSchema, CRITERION_OPERATORS } from './schema';
import { buildFewShot } from './prompt';

const spec: CohortSpec = {
  schemaVersion: '1.0',
  id: 't',
  title: 'Test cohort',
  primaryEntity: 'subjects',
  tables: {
    subjects: { name: 'subjects', role: 'entity', primaryKey: 'id', columns: [] },
  },
  relationships: [],
  variables: [
    { name: 'sex', label: 'Sex', category: 'D', entity: 'subjects', column: 'sex', widget: 'multiselect', sensitivity: 'Medium', values: ['Female', 'Male'] },
    { name: 'age', label: 'Age', category: 'D', entity: 'subjects', column: 'age', widget: 'bins', sensitivity: 'High', bins: [{ label: '65-84', min: 65, max: 84 }, { label: '85+', min: 85, max: 120 }] },
    { name: 'hasDiabetes', label: 'Diabetes', category: 'C', entity: 'subjects', column: 'diabetes', widget: 'boolean', sensitivity: 'Medium' },
    { name: 'hasDementia', label: 'Dementia', category: 'C', entity: 'subjects', column: 'dementia', widget: 'boolean', sensitivity: 'High' },
    { name: 'subjectId', label: 'ID', category: 'X', entity: 'subjects', column: 'id', widget: 'internal', sensitivity: 'None' },
    { name: 'hidden', label: 'Hidden', category: 'X', entity: 'subjects', column: 'h', widget: 'multiselect', sensitivity: 'None', values: ['x'], visible: false },
  ],
  sdc: DEFAULT_SDC,
};

describe('buildResponseSchema', () => {
  const schema = buildResponseSchema(spec) as any;

  it('enum-binds field names to the draftable variables only', () => {
    const fieldEnum: string[] = schema.properties.include.items.properties.field.enum;
    expect(fieldEnum).toContain('sex');
    expect(fieldEnum).toContain('age');
    expect(fieldEnum).not.toContain('subjectId'); // internal
    expect(fieldEnum).not.toContain('hidden'); // visible:false
  });

  it('enum-binds operators and requires every top-level key', () => {
    expect(schema.properties.include.items.properties.operator.enum).toEqual([...CRITERION_OPERATORS]);
    expect(schema.required).toEqual(['include', 'exclude', 'notes', 'unmatched']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.include.items.additionalProperties).toBe(false);
  });
});

describe('buildFewShot', () => {
  it('builds an example from the spec\'s real variables and values', () => {
    const ex = buildFewShot(spec)!;
    expect(ex).not.toBeNull();
    const parsed = JSON.parse(ex.json) as {
      include: { field: string }[];
      exclude: { field: string }[];
    };
    const includeFields = parsed.include.map((c) => c.field);
    const excludeFields = parsed.exclude.map((c) => c.field);

    // uses real field names
    expect(includeFields).toContain('sex');
    // demonstrates the no-mirror rule: no field in both include and exclude
    for (const f of excludeFields) expect(includeFields).not.toContain(f);
  });

  it('returns null when the spec has no draftable variables', () => {
    expect(buildFewShot({ ...spec, variables: [] })).toBeNull();
  });
});
