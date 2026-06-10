import { describe, it, expect } from 'vitest';
import type { CohortSpec } from '../spec/types';
import { DEFAULT_SDC } from '../spec/types';
import type { RuleGroupType } from 'react-querybuilder';
import {
  effectiveQuasiIdentifiers,
  privacyMetricsSql,
  resolveQuasiIdentifiers,
  resolveSensitiveAttribute,
} from './privacy';

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
        { name: 'age_bin', type: 'string' },
        { name: 'sex', type: 'string' },
        { name: 'race', type: 'string' },
        { name: 'diagnosis', type: 'string' },
      ],
    },
  },
  relationships: [],
  variables: [
    { name: 'ageBin', label: 'Age Bin', category: 'D', entity: 'subjects', column: 'age_bin', widget: 'bins', sensitivity: 'Low', bins: [] },
    { name: 'sex', label: 'Sex', category: 'D', entity: 'subjects', column: 'sex', widget: 'multiselect', sensitivity: 'Medium', values: ['Female', 'Male'] },
    { name: 'race', label: 'Race', category: 'D', entity: 'subjects', column: 'race', widget: 'multiselect', sensitivity: 'High', values: ['White'] },
    { name: 'diagnosis', label: 'Diagnosis', category: 'D', entity: 'subjects', column: 'diagnosis', widget: 'multiselect', sensitivity: 'High', values: ['AD'] },
  ],
  sdc: DEFAULT_SDC,
};

describe('resolveQuasiIdentifiers', () => {
  it('defaults to demographic categorical QIs by keyword', () => {
    const qis = resolveQuasiIdentifiers(spec).map((v) => v.column);
    expect(qis).toContain('age_bin');
    expect(qis).toContain('sex');
    expect(qis).toContain('race');
    expect(qis).not.toContain('diagnosis'); // not a QI keyword
  });

  it('honours an explicit spec.quasiIdentifiers list', () => {
    const qis = resolveQuasiIdentifiers({ ...spec, quasiIdentifiers: ['sex'] }).map((v) => v.column);
    expect(qis).toEqual(['sex']);
  });
});

describe('resolveSensitiveAttribute', () => {
  it('prefers diagnosis when present', () => {
    expect(resolveSensitiveAttribute(spec)?.column).toBe('diagnosis');
  });
  it('honours an explicit override', () => {
    expect(resolveSensitiveAttribute({ ...spec, sensitiveAttribute: 'race' })?.column).toBe('race');
  });
});

describe('effectiveQuasiIdentifiers', () => {
  const empty: RuleGroupType = { combinator: 'and', rules: [] };

  it('returns the spec baseline for an empty query', () => {
    const names = effectiveQuasiIdentifiers(spec, empty).map((v) => v.name);
    expect(names).toContain('sex');
    expect(names).not.toContain('diagnosis'); // not a baseline QI, not in the query
  });

  it('adds subject-level categorical fields the query constrains', () => {
    const q: RuleGroupType = {
      combinator: 'and',
      rules: [{ field: 'diagnosis', operator: 'in', value: ['AD'] }],
    };
    const names = effectiveQuasiIdentifiers(spec, q).map((v) => v.name);
    expect(names).toContain('diagnosis'); // promoted to a QI because the query uses it
    expect(names).toContain('sex'); // baseline still present
  });
});

describe('privacyMetricsSql bins bucketing', () => {
  const specBins: CohortSpec = {
    ...spec,
    variables: spec.variables.map((v) =>
      v.name === 'ageBin'
        ? { ...v, bins: [{ label: '65-74', min: 65, max: 74 }, { label: '75+', min: 75, max: 120 }] }
        : v,
    ),
  };

  it('groups a bins QI by its bucket label, not the raw column', () => {
    const ageBin = specBins.variables.find((v) => v.name === 'ageBin')!;
    const sql = privacyMetricsSql(specBins, { combinator: 'and', rules: [] }, { qis: [ageBin] })!;
    expect(sql).toContain('CASE WHEN "subjects"."age_bin" BETWEEN 65 AND 74 THEN \'65-74\'');
    expect(sql).toContain('GROUP BY 1'); // ordinal group-by over the bucketed expression
  });
});

describe('privacyMetricsSql', () => {
  const qis = resolveQuasiIdentifiers(spec);
  const sensitive = resolveSensitiveAttribute(spec);

  it('groups by QI columns and computes min class size + l-diversity', () => {
    const sql = privacyMetricsSql(spec, { combinator: 'and', rules: [] }, { qis, sensitive })!;
    expect(sql).toContain('MIN(sz) AS k_anon');
    expect(sql).toContain('COUNT(DISTINCT "subjects"."diagnosis")');
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('{K}'); // threshold placeholder for the caller to fill
  });

  it('returns null when there are no quasi-identifiers', () => {
    expect(privacyMetricsSql(spec, { combinator: 'and', rules: [] }, { qis: [], sensitive })).toBeNull();
  });

  it('omits l-diversity when no sensitive attribute', () => {
    const sql = privacyMetricsSql(spec, { combinator: 'and', rules: [] }, { qis, sensitive: undefined })!;
    expect(sql).toContain('NULL AS l_div');
  });
});
