import { describe, it, expect } from 'vitest';
import type { RuleGroupType } from 'react-querybuilder';
import { funnelSteps, guidedToTree, makeCriterion, treeToGuided } from './guided';

describe('guidedToTree / treeToGuided round-trip', () => {
  it('builds an AND of includes plus a NOT-OR exclude group', () => {
    const include = [
      makeCriterion('age', 'in', ['70-74']),
      makeCriterion('diagnosis', 'in', ['AD', 'MCI']),
    ];
    const exclude = [makeCriterion('apoeGenotype', 'in', ['e4/e4'])];
    const tree = guidedToTree(include, exclude);
    expect(tree.combinator).toBe('and');
    expect(tree.rules).toHaveLength(3);
    const grp = tree.rules[2] as RuleGroupType;
    expect(grp.not).toBe(true);
    expect(grp.combinator).toBe('or');
    expect(grp.rules).toHaveLength(1);
  });

  it('round-trips a simple include/exclude tree', () => {
    const include = [makeCriterion('sex', 'in', ['Female'])];
    const exclude = [makeCriterion('hasDementia', '=', 'true')];
    const tree = guidedToTree(include, exclude);
    const back = treeToGuided(tree);
    expect(back.simple).toBe(true);
    expect(back.include.map((c) => c.field)).toEqual(['sex']);
    expect(back.exclude.map((c) => c.field)).toEqual(['hasDementia']);
  });

  it('omits the exclude group when there are no exclusions', () => {
    const tree = guidedToTree([makeCriterion('sex', 'in', ['Male'])], []);
    expect(tree.rules).toHaveLength(1);
    expect(treeToGuided(tree).exclude).toHaveLength(0);
  });
});

describe('treeToGuided: complexity detection', () => {
  it('flags an OR root as not simple', () => {
    const tree: RuleGroupType = {
      combinator: 'or',
      rules: [
        { field: 'sex', operator: 'in', value: ['Female'] },
        { field: 'age', operator: 'in', value: ['90+'] },
      ],
    };
    expect(treeToGuided(tree).simple).toBe(false);
  });

  it('flags a nested include group as not simple', () => {
    const tree: RuleGroupType = {
      combinator: 'and',
      rules: [
        { combinator: 'or', rules: [{ field: 'a', operator: 'in', value: ['x'] }] }, // not an exclude shape (no not)
      ],
    };
    expect(treeToGuided(tree).simple).toBe(false);
  });

  it('flags two exclude groups as not simple', () => {
    const tree: RuleGroupType = {
      combinator: 'and',
      rules: [
        { combinator: 'or', not: true, rules: [{ field: 'a', operator: 'in', value: ['x'] }] },
        { combinator: 'or', not: true, rules: [{ field: 'b', operator: 'in', value: ['y'] }] },
      ],
    };
    expect(treeToGuided(tree).simple).toBe(false);
  });

  it('treats an empty tree as simple', () => {
    expect(treeToGuided({ combinator: 'and', rules: [] }).simple).toBe(true);
  });
});

describe('funnelSteps', () => {
  it('produces start + one step per include then per exclude, cumulatively', () => {
    const model = {
      include: [makeCriterion('age', 'in', ['70-74']), makeCriterion('sex', 'in', ['Female'])],
      exclude: [makeCriterion('hasDementia', '=', 'true')],
      simple: true,
    };
    const steps = funnelSteps(model);
    expect(steps.map((s) => s.kind)).toEqual(['start', 'include', 'include', 'exclude']);
    // start is empty
    expect(steps[0].query.rules).toHaveLength(0);
    // first include step has 1 rule, second has 2
    expect(steps[1].query.rules).toHaveLength(1);
    expect(steps[2].query.rules).toHaveLength(2);
    // exclude step adds the NOT group on top of both includes
    expect(steps[3].query.rules).toHaveLength(3);
  });
});
