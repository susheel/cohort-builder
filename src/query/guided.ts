import type { RuleGroupType, RuleType } from 'react-querybuilder';

/**
 * Guided (Inclusion/Exclusion) model. A thin, clinician-friendly view over the
 * canonical RuleGroupType:
 *
 *   root AND
 *     include rule 1
 *     include rule 2
 *     NOT( OR exclude rule 1, exclude rule 2 )   // the Exclude zone
 *
 * Include rows AND together (each narrows the cohort); a row with multiple
 * values is an OR within that row. Exclude rows remove anyone matching ANY of
 * them: NOT(e1 OR e2). Logic is encoded by position, never by typed operators.
 */
export interface Criterion {
  id: string;
  field: string;
  operator: string;
  value: unknown;
}

export interface GuidedModel {
  include: Criterion[];
  exclude: Criterion[];
  /** false when the underlying tree is too complex for the guided view */
  simple: boolean;
}

let cid = 0;
function newId(): string {
  cid += 1;
  return `g-${cid}`;
}

function isGroup(r: RuleType | RuleGroupType): r is RuleGroupType {
  return 'rules' in r && Array.isArray((r as RuleGroupType).rules);
}

function toCriterion(r: RuleType): Criterion {
  return { id: r.id ?? newId(), field: r.field, operator: r.operator, value: r.value };
}

function toRule(c: Criterion): RuleType {
  return { id: c.id, field: c.field, operator: c.operator, value: c.value };
}

/** Build the canonical tree from include/exclude criteria. */
export function guidedToTree(include: Criterion[], exclude: Criterion[]): RuleGroupType {
  const rules: (RuleType | RuleGroupType)[] = include.map(toRule);
  if (exclude.length > 0) {
    rules.push({
      combinator: 'or',
      not: true,
      rules: exclude.map(toRule),
    });
  }
  return { combinator: 'and', rules };
}

/**
 * Interpret a tree as a guided model. `simple` is false when the tree cannot be
 * faithfully shown as include/exclude rows (deep nesting, OR at the root,
 * negated include rows, more than one exclude group, etc.).
 */
export function treeToGuided(query: RuleGroupType): GuidedModel {
  const include: Criterion[] = [];
  const exclude: Criterion[] = [];
  let simple = true;
  let excludeGroups = 0;

  if ((query.combinator ?? 'and').toLowerCase() !== 'and' || query.not) {
    // a non-AND or negated root cannot be a plain include list
    if (query.rules.length > 0) simple = false;
  }

  for (const r of query.rules) {
    if (isGroup(r)) {
      const isExcludeShape =
        r.not === true &&
        (r.combinator ?? 'or').toLowerCase() === 'or' &&
        r.rules.every((x) => !isGroup(x));
      if (isExcludeShape) {
        excludeGroups += 1;
        if (excludeGroups > 1) simple = false;
        for (const x of r.rules) exclude.push(toCriterion(x as RuleType));
      } else {
        simple = false;
      }
    } else {
      // a negated leaf at the root does not fit the include/exclude split
      include.push(toCriterion(r));
    }
  }

  return { include, exclude, simple };
}

/** A single step of the attrition funnel: a label + the cumulative subtree. */
export interface FunnelStep {
  kind: 'start' | 'include' | 'exclude';
  /** the criterion this step applies (absent for 'start') */
  criterion?: Criterion;
  /** cumulative query up to and including this step */
  query: RuleGroupType;
}

/**
 * Ordered cumulative steps for the funnel: start (all subjects), then each
 * include applied in turn, then each exclude applied in turn. The caller runs a
 * count for each `query` and passes it through the SDC engine.
 */
export function funnelSteps(model: GuidedModel): FunnelStep[] {
  const steps: FunnelStep[] = [{ kind: 'start', query: { combinator: 'and', rules: [] } }];
  for (let i = 0; i < model.include.length; i += 1) {
    steps.push({
      kind: 'include',
      criterion: model.include[i],
      query: guidedToTree(model.include.slice(0, i + 1), []),
    });
  }
  for (let i = 0; i < model.exclude.length; i += 1) {
    steps.push({
      kind: 'exclude',
      criterion: model.exclude[i],
      query: guidedToTree(model.include, model.exclude.slice(0, i + 1)),
    });
  }
  return steps;
}

export function makeCriterion(field: string, operator: string, value: unknown): Criterion {
  return { id: newId(), field, operator, value };
}
