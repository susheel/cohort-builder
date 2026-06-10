import { describe, it, expect } from 'vitest';
import type { RuleGroupType } from 'react-querybuilder';
import type { CohortSpec } from '../spec/types';
import { DEFAULT_SDC } from '../spec/types';
import {
  dataFilesSql,
  excludeField,
  facetSql,
  fieldsInTree,
  rulePredicate,
  treeCountSql,
  treeWhere,
} from './compileTree';

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
    { name: 'age', label: 'Age', category: 'D', entity: 'subjects', column: 'age', widget: 'bins', sensitivity: 'High', bins: [{ label: '<70', min: 0, max: 69 }, { label: '90+', min: 90, max: 200 }] },
    { name: 'sex', label: 'Sex', category: 'D', entity: 'subjects', column: 'sex', widget: 'multiselect', sensitivity: 'Medium', values: ['Female', 'Male'] },
    { name: 'hasHypertension', label: 'Hypertension', category: 'C', entity: 'subjects', column: 'has_hypertension', widget: 'boolean', sensitivity: 'High', booleanLabels: { yes: 'Yes', no: 'No' } },
    { name: 'assayType', label: 'Assay', category: 'M', entity: 'files', column: 'assay_type', widget: 'multiselect', sensitivity: 'None', values: ['WGS', 'RNAseq'] },
  ],
  sdc: DEFAULT_SDC,
};

describe('rulePredicate', () => {
  it('boolean =', () => {
    expect(rulePredicate(spec, { field: 'hasHypertension', operator: '=', value: 'true' })).toContain('= TRUE');
  });
  it('multiselect in / notIn on a subject column', () => {
    expect(rulePredicate(spec, { field: 'sex', operator: 'in', value: ['Female', 'Male'] })).toContain("\"sex\" IN ('Female', 'Male')");
    expect(rulePredicate(spec, { field: 'sex', operator: 'notIn', value: ['Male'] })).toContain('NOT IN');
  });
  it('bins in maps labels to ranges', () => {
    const p = rulePredicate(spec, { field: 'age', operator: 'in', value: ['<70', '90+'] })!;
    expect(p).toContain('BETWEEN 0 AND 69');
    expect(p).toContain('BETWEEN 90 AND 200');
  });
  it('file-level ALL becomes AND of per-value memberships', () => {
    const p = rulePredicate(spec, { field: 'assayType', operator: 'all', value: ['WGS', 'RNAseq'] })!;
    expect(p).toContain("= 'WGS'");
    expect(p).toContain("= 'RNAseq'");
    expect(p).toContain(' AND ');
    expect(p).toContain('"subject_files"');
  });
  it('file-level ANY becomes a single membership subquery', () => {
    const p = rulePredicate(spec, { field: 'assayType', operator: 'in', value: ['WGS'] })!;
    expect(p).toContain('"subjects"."subject_id" IN (');
    expect(p).toContain('JOIN "files"');
  });
  it('returns null for inactive rules', () => {
    expect(rulePredicate(spec, { field: 'sex', operator: 'in', value: [] })).toBeNull();
  });
});

describe('compileGroup / treeWhere', () => {
  it('empty query is 1=1', () => {
    expect(treeWhere(spec, { combinator: 'and', rules: [] })).toBe('1=1');
  });
  it('nested OR group inside AND, with NOT', () => {
    const q: RuleGroupType = {
      combinator: 'and',
      rules: [
        { field: 'sex', operator: 'in', value: ['Female'] },
        {
          combinator: 'or',
          rules: [
            { field: 'hasHypertension', operator: '=', value: 'true' },
            { field: 'age', operator: 'in', value: ['90+'] },
          ],
        },
        { combinator: 'and', not: true, rules: [{ field: 'assayType', operator: 'in', value: ['WGS'] }] },
      ],
    };
    const w = treeWhere(spec, q);
    expect(w).toContain(' OR ');
    expect(w).toContain(' AND ');
    expect(w).toMatch(/NOT \(/);
  });
  it('drops empty subgroups', () => {
    const q: RuleGroupType = {
      combinator: 'and',
      rules: [
        { field: 'sex', operator: 'in', value: ['Female'] },
        { combinator: 'or', rules: [] },
      ],
    };
    expect(treeWhere(spec, q)).toBe("\"subjects\".\"sex\" IN ('Female')");
  });
});

describe('fieldsInTree / excludeField / facet / files', () => {
  const q: RuleGroupType = {
    combinator: 'and',
    rules: [
      { field: 'sex', operator: 'in', value: ['Female'] },
      { field: 'assayType', operator: 'in', value: ['WGS'] },
    ],
  };
  it('lists active fields', () => {
    expect(fieldsInTree(spec, q).sort()).toEqual(['assayType', 'sex']);
  });
  it('excludeField removes the named field for facet conditioning', () => {
    const pruned = excludeField(q, 'sex');
    expect(fieldsInTree(spec, pruned)).toEqual(['assayType']);
  });
  it('facetSql conditions on other fields, excludes own', () => {
    const sql = facetSql(spec, q, spec.variables[1])!; // facet sex
    expect(sql).toContain('GROUP BY value');
    expect(sql).toContain('assay'); // other filter applied via membership
    expect(sql).not.toContain("\"sex\" IN ('Female')");
  });
  it('dataFilesSql counts subjects per file', () => {
    const sql = dataFilesSql(spec, q, { limit: 25, offset: 0 })!;
    expect(sql).toContain('AS subject_count');
    expect(sql).toContain('LIMIT 25 OFFSET 0');
  });
  it('treeCountSql targets the primary entity', () => {
    expect(treeCountSql(spec, q)).toContain('FROM "subjects" WHERE');
  });
});
