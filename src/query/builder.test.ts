import { describe, it, expect } from 'vitest';
import type { CohortSpec } from '../spec/types';
import { DEFAULT_SDC } from '../spec/types';
import { breakdownSql, compileFilters, countSql, dataFilesSql, facetSql } from './builder';
import type { FilterState } from './types';

const spec: CohortSpec = {
  schemaVersion: '1.0',
  id: 't',
  title: 't',
  primaryEntity: 'subjects',
  tables: {
    subjects: {
      name: 'subjects',
      role: 'entity',
      primaryKey: 'subject_id',
      columns: [
        { name: 'subject_id', type: 'string' },
        { name: 'age', type: 'integer' },
        { name: 'sex', type: 'string' },
        { name: 'has_hypertension', type: 'boolean' },
      ],
    },
    files: {
      name: 'files',
      role: 'attribute',
      primaryKey: 'syn_id',
      columns: [
        { name: 'syn_id', type: 'string' },
        { name: 'assay_type', type: 'string' },
      ],
    },
    subject_files: {
      name: 'subject_files',
      role: 'junction',
      primaryKey: 'subject_id',
      columns: [
        { name: 'subject_id', type: 'string' },
        { name: 'syn_id', type: 'string' },
      ],
    },
  },
  relationships: [
    { from: 'subjects', to: 'files', via: 'subject_files', fromKey: 'subject_id', toKey: 'syn_id' },
  ],
  variables: [
    { name: 'age', label: 'Age', category: 'Demographic & Clinical', entity: 'subjects', column: 'age', widget: 'bins', sensitivity: 'High', bins: [{ label: '<70', min: 0, max: 69 }, { label: '90+', min: 90, max: 200 }] },
    { name: 'sex', label: 'Sex', category: 'Demographic & Clinical', entity: 'subjects', column: 'sex', widget: 'multiselect', sensitivity: 'Medium', values: ['Female', 'Male'] },
    { name: 'hasHypertension', label: 'Hypertension', category: 'Comorbidity', entity: 'subjects', column: 'has_hypertension', widget: 'boolean', sensitivity: 'High', booleanLabels: { yes: 'Yes', no: 'No' } },
    { name: 'assayType', label: 'Assay', category: 'Data Modality', entity: 'files', column: 'assay_type', widget: 'multiselect', sensitivity: 'None', values: ['WGS', 'RNAseq'] },
  ],
  sdc: DEFAULT_SDC,
};

describe('compileFilters', () => {
  it('returns 1=1 when nothing active', () => {
    expect(compileFilters(spec, {}).where).toBe('1=1');
  });

  it('compiles a boolean filter against a BOOLEAN column', () => {
    const f: FilterState = { hasHypertension: { variable: 'hasHypertension', value: { kind: 'boolean', choice: 'yes' } } };
    expect(compileFilters(spec, f).where).toContain('"subjects"."has_hypertension" = TRUE');
  });

  it('compiles a multiselect IN list with escaping', () => {
    const f: FilterState = { sex: { variable: 'sex', value: { kind: 'multiselect', values: ['Female', "O'Brien"] } } };
    const w = compileFilters(spec, f).where;
    expect(w).toContain(`"subjects"."sex" IN ('Female', 'O''Brien')`);
  });

  it('compiles age bins as OR of ranges', () => {
    const f: FilterState = { age: { variable: 'age', value: { kind: 'bins', labels: ['<70', '90+'] } } };
    const w = compileFilters(spec, f).where;
    expect(w).toContain('BETWEEN 0 AND 69');
    expect(w).toContain('BETWEEN 90 AND 200');
    expect(w).toContain(' OR ');
  });

  it('wraps a file-level filter in a junction subquery', () => {
    const f: FilterState = { assayType: { variable: 'assayType', value: { kind: 'multiselect', values: ['WGS'] } } };
    const w = compileFilters(spec, f).where;
    expect(w).toContain('"subjects"."subject_id" IN (');
    expect(w).toContain('"subject_files"');
    expect(w).toContain('JOIN "files"');
  });

  it('negates with NOT', () => {
    const f: FilterState = { hasHypertension: { variable: 'hasHypertension', value: { kind: 'boolean', choice: 'yes' }, negate: true } };
    expect(compileFilters(spec, f).where).toContain('NOT (');
  });

  it('ANDs multiple predicates', () => {
    const f: FilterState = {
      sex: { variable: 'sex', value: { kind: 'multiselect', values: ['Female'] } },
      hasHypertension: { variable: 'hasHypertension', value: { kind: 'boolean', choice: 'yes' } },
    };
    const c = compileFilters(spec, f);
    expect(c.predicateCount).toBe(2);
    expect(c.where).toContain(' AND ');
  });

  it('multiselect NONE mode emits NOT IN on a subject column', () => {
    const f: FilterState = { sex: { variable: 'sex', value: { kind: 'multiselect', values: ['Male'], mode: 'none' } } };
    expect(compileFilters(spec, f).where).toContain('"subjects"."sex" NOT IN (\'Male\')');
  });

  it('file-level ALL mode requires a link per value (AND of subqueries)', () => {
    const f: FilterState = { assayType: { variable: 'assayType', value: { kind: 'multiselect', values: ['WGS', 'RNAseq'], mode: 'all' } } };
    const w = compileFilters(spec, f).where;
    expect(w).toContain("= 'WGS'");
    expect(w).toContain("= 'RNAseq'");
    expect(w.match(/IN \(/g)?.length).toBeGreaterThanOrEqual(2); // two membership subqueries
    expect(w).toContain(' AND ');
  });

  it('OR-groups: same group is OR, different clauses AND', () => {
    const f: FilterState = {
      sex: { variable: 'sex', value: { kind: 'multiselect', values: ['Female'] }, group: 'g1' },
      hasHypertension: { variable: 'hasHypertension', value: { kind: 'boolean', choice: 'yes' }, group: 'g1' },
      age: { variable: 'age', value: { kind: 'bins', labels: ['<70'] } },
    };
    const w = compileFilters(spec, f).where;
    expect(w).toContain(' OR ');
    expect(w).toContain(' AND ');
  });
});

describe('facetSql / dataFilesSql', () => {
  it('builds a facet conditional on OTHER filters (excludes own)', () => {
    const f: FilterState = {
      sex: { variable: 'sex', value: { kind: 'multiselect', values: ['Female'] } },
      hasHypertension: { variable: 'hasHypertension', value: { kind: 'boolean', choice: 'yes' } },
    };
    const sql = facetSql(spec, f, spec.variables[1])!; // facet on sex
    expect(sql).toContain('GROUP BY value');
    expect(sql).toContain('has_hypertension'); // other filter applied
    expect(sql).not.toContain("\"sex\" IN ('Female')"); // own filter excluded
  });

  it('builds a per-file data table with an SDC-able subject_count', () => {
    const sql = dataFilesSql(spec, {}, { limit: 25, offset: 0 })!;
    expect(sql).toContain('COUNT(DISTINCT "subject_files"."subject_id") AS subject_count');
    expect(sql).toContain('FROM "files"');
    expect(sql).toContain('LIMIT 25 OFFSET 0');
  });
});

describe('countSql / breakdownSql', () => {
  it('builds a COUNT against the primary entity', () => {
    expect(countSql(spec, {})).toContain('SELECT COUNT(*) AS n FROM "subjects"');
  });

  it('builds an age-bin breakdown with CASE buckets', () => {
    const sql = breakdownSql(spec, {}, spec.variables[0])!;
    expect(sql).toContain('CASE');
    expect(sql).toContain('GROUP BY bucket');
  });

  it('supports a file-level breakdown via the facet query (aliased to bucket)', () => {
    const sql = breakdownSql(spec, {}, spec.variables[3])!; // assayType (file-level)
    expect(sql).toContain('AS bucket');
    expect(sql).toContain('"subject_files"');
  });
});
