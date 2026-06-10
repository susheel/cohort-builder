export type BooleanChoice = 'any' | 'yes' | 'no';

/** within-variable combinator for multi-value filters */
export type MultiMode = 'any' | 'all' | 'none';

export type FilterValue =
  | { kind: 'boolean'; choice: BooleanChoice }
  | { kind: 'multiselect'; values: string[]; mode?: MultiMode }
  | { kind: 'bins'; labels: string[]; mode?: MultiMode }
  | { kind: 'minCount'; min: number }
  | { kind: 'range'; min: number; max: number };

export interface ActiveFilter {
  /** variable name from the spec */
  variable: string;
  value: FilterValue;
  /** negate this predicate (Exclude / NOT) */
  negate?: boolean;
  /**
   * OR-group label. Filters sharing a non-empty group are OR'd together; that
   * combined clause is then AND'd with everything else. Ungrouped filters
   * (null/undefined/'') are AND'd individually. Default composition is AND.
   */
  group?: string | null;
}

/** keyed by variable name */
export type FilterState = Record<string, ActiveFilter>;

export function multiMode(v: FilterValue): MultiMode {
  if (v.kind === 'multiselect' || v.kind === 'bins') return v.mode ?? 'any';
  return 'any';
}

export function isActive(f: ActiveFilter): boolean {
  switch (f.value.kind) {
    case 'boolean':
      return f.value.choice !== 'any';
    case 'multiselect':
      return f.value.values.length > 0;
    case 'bins':
      return f.value.labels.length > 0;
    case 'minCount':
      return f.value.min > 0;
    case 'range':
      return true;
  }
}
