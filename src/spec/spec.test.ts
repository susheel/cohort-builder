import { describe, it, expect } from 'vitest';
import type { ColumnInfo } from '../duckdb/loader';
import { inferSpec } from './infer';
import { mergeSpec } from './merge';
import type { CohortSpecOverride } from './types';

function cols(...c: Partial<ColumnInfo>[]): ColumnInfo[] {
  return c.map((x) => ({
    name: x.name!,
    type: x.type ?? 'string',
    rawType: x.rawType ?? 'VARCHAR',
    distinctCount: x.distinctCount ?? 2,
    nullable: x.nullable ?? false,
    sampleValues: x.sampleValues ?? [],
    numericMin: x.numericMin,
    numericMax: x.numericMax,
  }));
}

const tables = {
  subjects: cols(
    { name: 'subject_id', type: 'string', distinctCount: 1000 },
    { name: 'age', type: 'integer', numericMin: 60, numericMax: 100, distinctCount: 41 },
    { name: 'sex', type: 'string', distinctCount: 3, sampleValues: ['Female', 'Male', 'Unknown'] },
    { name: 'has_hypertension', type: 'boolean', distinctCount: 2 },
    { name: 'apoe_genotype', type: 'string', distinctCount: 6, sampleValues: ['e3/e3', 'e3/e4'] },
  ),
  files: cols(
    { name: 'syn_id', type: 'string', distinctCount: 500 },
    { name: 'assay_type', type: 'string', distinctCount: 5, sampleValues: ['WGS', 'RNAseq'] },
  ),
  subject_files: cols({ name: 'subject_id' }, { name: 'syn_id' }),
};
const rowCounts = { subjects: 1000, files: 500, subject_files: 4000 };

describe('inferSpec', () => {
  const spec = inferSpec({ tables }, rowCounts);

  it('detects the primary entity and a junction relationship', () => {
    expect(spec.primaryEntity).toBe('subjects');
    expect(spec.tables.subject_files.role).toBe('junction');
    expect(spec.relationships).toHaveLength(1);
    expect(spec.relationships[0]).toMatchObject({ from: 'subjects', to: 'files', via: 'subject_files' });
  });

  it('chooses widgets from column type + name', () => {
    const byName = Object.fromEntries(spec.variables.map((v) => [v.column, v]));
    expect(byName.age.widget).toBe('bins');
    expect(byName.sex.widget).toBe('multiselect');
    expect(byName.has_hypertension.widget).toBe('boolean');
    expect(byName.apoe_genotype.widget).toBe('multiselect');
    expect(byName.assay_type.entity).toBe('files');
  });

  it('treats id columns as internal/non-visible', () => {
    const sid = spec.variables.find((v) => v.column === 'subject_id');
    expect(sid?.widget).toBe('internal');
    expect(sid?.visible).toBe(false);
  });

  it('applies sensitivity heuristics', () => {
    const byName = Object.fromEntries(spec.variables.map((v) => [v.column, v]));
    expect(byName.apoe_genotype.sensitivity).toBe('High');
    expect(byName.assay_type.sensitivity).toBe('None');
  });
});

describe('mergeSpec', () => {
  const base = inferSpec({ tables }, rowCounts);

  it('matches override variables by column and overrides fields', () => {
    const ov: CohortSpecOverride = {
      title: 'ELITE',
      variables: [
        { name: 'apoeGenotype', column: 'apoe_genotype', label: 'APOE Genotype', sensitivity: 'High' },
        { name: 'sex', sensitivity: 'Medium', label: 'Sex' },
      ],
    };
    const merged = mergeSpec(base, ov);
    expect(merged.title).toBe('ELITE');
    const apoe = merged.variables.find((v) => v.column === 'apoe_genotype')!;
    expect(apoe.name).toBe('apoeGenotype');
    expect(apoe.label).toBe('APOE Genotype');
    expect(apoe.source).toBe('merged');
    const sex = merged.variables.find((v) => v.column === 'sex')!;
    expect(sex.sensitivity).toBe('Medium');
  });

  it('deep-merges the SDC policy', () => {
    const merged = mergeSpec(base, { sdc: { levels: { High: { thresholdK: 50 } } } as never });
    expect(merged.sdc.levels.High.thresholdK).toBe(50);
    expect(merged.sdc.levels.High.booleanOnly).toBe(false); // inherited default (count-driven)
    expect(merged.sdc.levels.Low.thresholdK).toBe(5); // untouched
  });

  it('hides override-only variables with no matching data column', () => {
    const merged = mergeSpec(base, {
      variables: [{ name: 'ghostVar', column: 'does_not_exist', entity: 'subjects', widget: 'boolean' }],
    });
    const ghost = merged.variables.find((v) => v.name === 'ghostVar')!;
    expect(ghost.visible).toBe(false);
  });
});
