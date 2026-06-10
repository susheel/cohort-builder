/**
 * SDC engine: pure functions implementing the Statistical Disclosure Control
 * policy defined in docs/research/02-statistical-disclosure-control.md.
 *
 * Algorithm order is LOAD-BEARING. Read the research doc before changing
 * the order of the steps inside applyCount().
 *
 * No external npm dependencies. Hashing (FNV-1a) and PRNG (mulberry32) are
 * implemented inline so the module is usable in any environment.
 */

import type { SdcConfig, Sensitivity, SdcLevelPolicy } from '../spec/types';
import { formatCount } from './format';

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export type CountKind = 'exact' | 'rounded' | 'suppressed' | 'boolean' | 'zero';

export interface CountResult {
  /** Semantic classification of the disclosed value. */
  kind: CountKind;
  /**
   * The value to display. null means "do not show a number" (suppressed or
   * boolean). For kind 'zero' the value is 0. For kind 'boolean' the value
   * is null and `available` carries the meaning.
   */
  value: number | null;
  /**
   * Whether the cohort has data meeting the threshold (true) or not (false).
   * For suppressed cells where we know the group exists but is too small,
   * this is true. For boolean-only mode, it tracks the threshold comparison.
   * For zero with zeroIsDisclosive, it is false (suppressed entirely).
   */
  available: boolean;
  /** Safe display label. Never exposes the raw count when suppressed/boolean. */
  displayLabel: string;
  /**
   * The original raw count. Present for internal/audit use only. The caller
   * must NOT pass this directly into any public-facing UI text.
   */
  raw?: number;
}

// ---------------------------------------------------------------------------
// Cross-tab types
// ---------------------------------------------------------------------------

export interface CrossTabCell {
  /** Raw count value for this cell. */
  raw: number;
  /** Optional row label (e.g. row category name). */
  rowLabel?: string;
  /** Optional column label (e.g. column stratum name). */
  colLabel?: string;
}

export interface CrossTabResultCell extends CountResult {
  rowIndex: number;
  colIndex: number;
  rowLabel?: string;
  colLabel?: string;
}

export interface CrossTabResult {
  cells: CrossTabResultCell[][];
  /** Row totals (recomputed from post-suppression values, never true totals). */
  rowTotals: CountResult[];
  /** Column totals (recomputed from post-suppression values). */
  colTotals: CountResult[];
  /** Grand total (recomputed). */
  grandTotal: CountResult;
  rows: number;
  cols: number;
}

// ---------------------------------------------------------------------------
// Inline PRNG: FNV-1a hash + mulberry32
// Deterministic: same seed -> same sequence. No external deps.
// ---------------------------------------------------------------------------

/**
 * FNV-1a 32-bit hash of a string.
 * Produces a uint32 suitable for seeding mulberry32.
 */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Multiply by FNV prime (0x01000193) with 32-bit overflow via |0 trick
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0; // coerce to uint32
}

/**
 * mulberry32 PRNG. Returns a function that yields floats in [0, 1).
 * seed must be a uint32.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * Derive a seeded random float in [0, 1) from a seed string and a numeric
 * value. Both the seed and the value are incorporated so that the same seed
 * used for different counts still produces different (but deterministic) outputs.
 */
function seededRandom(seed: string, value: number): number {
  const combined = `${seed}:${value}`;
  const hash = fnv1a32(combined);
  const prng = mulberry32(hash);
  return prng();
}

// ---------------------------------------------------------------------------
// Rounding helpers
// ---------------------------------------------------------------------------

type RoundingMode = SdcLevelPolicy['roundingMode'];

/**
 * Round `n` to a multiple of `base` according to `mode`.
 * For mode 'random', supply a `seed` string so the result is deterministic
 * per (query, value) pair, preventing averaging attacks.
 */
export function roundTo(
  n: number,
  base: number,
  mode: RoundingMode,
  seed = '',
): number {
  if (base <= 1 || mode === 'none') return n;

  const lower = Math.floor(n / base) * base;
  const upper = lower + base;

  switch (mode) {
    case 'nearest':
      return n - lower < upper - n ? lower : upper;

    case 'up':
      // Round up to next multiple unless already an exact multiple
      return n % base === 0 ? n : upper;

    case 'random': {
      // Controlled (random) rounding: probability proportional to distance
      // from the lower multiple. r in [0, 1) from seeded PRNG.
      // Round up with probability (n - lower) / base.
      const r = seededRandom(seed, n);
      const probUp = (n - lower) / base;
      return r < probUp ? upper : lower;
    }
  }
}

// ---------------------------------------------------------------------------
// Core disclosure function
// ---------------------------------------------------------------------------

/**
 * Apply SDC policy to a single raw count.
 *
 * Algorithm order (load-bearing, per research doc §5):
 *   1. SDC disabled -> exact.
 *   2. Look up level policy.
 *   3. Zero handling.
 *   4. Boolean-only mode.
 *   5. Primary suppression (raw < k).
 *   6. Rounding.
 */
export function applyCount(
  rawCount: number,
  level: Sensitivity,
  policy: SdcConfig,
  seed = '',
): CountResult {
  // Step 1: SDC disabled
  if (!policy.enabled) {
    return {
      kind: 'exact',
      value: rawCount,
      available: true,
      displayLabel: formatCount(rawCount),
      raw: rawCount,
    };
  }

  // Step 2: level policy lookup
  const lvl: SdcLevelPolicy = policy.levels[level];
  const k = lvl.thresholdK;

  // Step 3: zero handling
  if (rawCount === 0) {
    if (lvl.zeroIsDisclosive) {
      return {
        kind: 'suppressed',
        value: null,
        available: false,
        displayLabel: `<${k}`,
        raw: rawCount,
      };
    }
    return {
      kind: 'zero',
      value: 0,
      available: false,
      displayLabel: '0',
      raw: 0,
    };
  }

  // Step 4: boolean-only mode (High tier)
  if (lvl.booleanOnly) {
    const meetsThreshold = rawCount >= k;
    return {
      kind: 'boolean',
      value: null,
      available: meetsThreshold,
      displayLabel: meetsThreshold
        ? `Data available (≥${k})`
        : `Insufficient data (<${k})`,
      raw: rawCount,
    };
  }

  // Step 5: primary suppression
  if (rawCount < k) {
    return {
      kind: 'suppressed',
      value: null,
      available: true,
      displayLabel: `<${k}`,
      raw: rawCount,
    };
  }

  // Step 6: rounding
  const base = lvl.roundingBase;
  const mode = lvl.roundingMode;

  if (base <= 1 || mode === 'none') {
    return {
      kind: 'exact',
      value: rawCount,
      available: true,
      displayLabel: formatCount(rawCount),
      raw: rawCount,
    };
  }

  const rounded = roundTo(rawCount, base, mode, seed);
  return {
    kind: 'rounded',
    value: rounded,
    available: true,
    displayLabel: `≈ ${formatCount(rounded)}`,
    raw: rawCount,
  };
}

// ---------------------------------------------------------------------------
// Cross-tab: primary + complementary suppression
// ---------------------------------------------------------------------------

/**
 * Apply SDC to a 2-D cross-tab.
 *
 * Steps (per research doc §2):
 *   1. Primary pass: applyCount every cell.
 *   2. Complementary suppression (if enabled): iteratively suppress the
 *      smallest eligible cell in any row/column that has exactly one suppressed
 *      cell and a visible total, until stable.
 *   3. Recompute row/column/grand totals from post-suppression rounded values.
 */
export function applyCrossTab(
  cells: CrossTabCell[][],
  level: Sensitivity,
  policy: SdcConfig,
  opts: { seed?: string } = {},
): CrossTabResult {
  const seed = opts.seed ?? '';
  const rows = cells.length;
  const cols = rows > 0 ? cells[0].length : 0;
  const lvl = policy.levels[level];

  // Track which cells are suppressed (separate from the CountResult kind so
  // we can mutate during the complementary pass without rebuilding objects).
  const suppressed: boolean[][] = Array.from({ length: rows }, () =>
    new Array<boolean>(cols).fill(false),
  );

  // Step 1: primary suppression pass
  // Determine which cells are primary-suppressed. We do NOT call applyCount
  // for the complementary logic; we just check the suppression criteria so
  // we can iterate. Final CountResult objects are built after all suppressions
  // are determined.

  // A cell is primary-suppressed when SDC is enabled AND booleanOnly is false AND:
  //   - its raw is 0 and zeroIsDisclosive, OR
  //   - raw > 0 AND raw < thresholdK
  // When SDC is disabled or booleanOnly is true, nothing is suppressed at this
  // level: applyCount handles boolean-only cells directly, and there is no count
  // to protect via complementary suppression.
  function isPrimarySuppressed(raw: number): boolean {
    if (!policy.enabled) return false;
    if (lvl.booleanOnly) return false;
    if (raw === 0) return lvl.zeroIsDisclosive;
    return raw < lvl.thresholdK;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      suppressed[r][c] = isPrimarySuppressed(cells[r][c].raw);
    }
  }

  // Step 2: complementary suppression (iterative, until stable)
  if (lvl.complementarySuppression && !lvl.booleanOnly) {
    let changed = true;
    while (changed) {
      changed = false;

      // Row pass: for each row, if exactly one suppressed cell, suppress the
      // smallest unsuppressed non-zero cell in that row.
      for (let r = 0; r < rows; r++) {
        const suppressedInRow = countSuppressedInRow(r);
        if (suppressedInRow !== 1) continue;

        // Find the smallest unsuppressed, non-zero cell in this row.
        const candidate = smallestUnsuppressedInRow(r);
        if (candidate !== -1) {
          suppressed[r][candidate] = true;
          changed = true;
        }
      }

      // Column pass: same logic per column.
      for (let c = 0; c < cols; c++) {
        const suppressedInCol = countSuppressedInCol(c);
        if (suppressedInCol !== 1) continue;

        const candidate = smallestUnsuppressedInCol(c);
        if (candidate !== -1) {
          suppressed[candidate][c] = true;
          changed = true;
        }
      }
    }
  }

  // Helper functions for the complementary pass
  function countSuppressedInRow(r: number): number {
    let count = 0;
    for (let c = 0; c < cols; c++) {
      if (suppressed[r][c]) count++;
    }
    return count;
  }

  function smallestUnsuppressedInRow(r: number): number {
    let minVal = Infinity;
    let minCol = -1;
    for (let c = 0; c < cols; c++) {
      if (suppressed[r][c]) continue;
      const raw = cells[r][c].raw;
      if (raw > 0 && raw < minVal) {
        minVal = raw;
        minCol = c;
      }
    }
    return minCol;
  }

  function countSuppressedInCol(c: number): number {
    let count = 0;
    for (let r = 0; r < rows; r++) {
      if (suppressed[r][c]) count++;
    }
    return count;
  }

  function smallestUnsuppressedInCol(c: number): number {
    let minVal = Infinity;
    let minRow = -1;
    for (let r = 0; r < rows; r++) {
      if (suppressed[r][c]) continue;
      const raw = cells[r][c].raw;
      if (raw > 0 && raw < minVal) {
        minVal = raw;
        minRow = r;
      }
    }
    return minRow;
  }

  // Step 3: build final result cells, applying rounding to non-suppressed cells.
  // For complementary-suppressed cells (not primary) we still show <k label.
  const k = lvl.thresholdK;

  function buildCellResult(r: number, c: number): CrossTabResultCell {
    const cell = cells[r][c];
    const isSuppressed = suppressed[r][c];
    let base: CountResult;

    if (isSuppressed) {
      // Show as suppressed regardless of whether primary or complementary
      base = {
        kind: 'suppressed',
        value: null,
        available: cell.raw > 0,
        displayLabel: `<${k}`,
        raw: cell.raw,
      };
    } else {
      base = applyCount(cell.raw, level, policy, seed);
    }

    return {
      ...base,
      rowIndex: r,
      colIndex: c,
      rowLabel: cell.rowLabel,
      colLabel: cell.colLabel,
    };
  }

  const resultCells: CrossTabResultCell[][] = Array.from(
    { length: rows },
    (_, r) =>
      Array.from({ length: cols }, (__, c) => buildCellResult(r, c)),
  );

  // Step 4: recompute totals from post-suppression rounded values.
  // Never use the true raw total; sum only the visible (non-suppressed) values.
  function sumVisible(values: (number | null)[]): number {
    return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  }

  const rowTotals: CountResult[] = Array.from({ length: rows }, (_, r) => {
    const visibleValues = resultCells[r].map((c) => c.value);
    const total = sumVisible(visibleValues);
    return buildTotalResult(total, level, policy, seed);
  });

  const colTotals: CountResult[] = Array.from({ length: cols }, (_, c) => {
    const visibleValues = resultCells.map((row) => row[c].value);
    const total = sumVisible(visibleValues);
    return buildTotalResult(total, level, policy, seed);
  });

  const grandTotalVal = sumVisible(rowTotals.map((t) => t.value));
  const grandTotal = buildTotalResult(grandTotalVal, level, policy, seed);

  return { cells: resultCells, rowTotals, colTotals, grandTotal, rows, cols };
}

/**
 * Build a CountResult for a recomputed total value.
 * Totals are derived values (sums of rounded/suppressed cells), so they are
 * always displayed as exact or rounded; they never undergo primary suppression
 * themselves (the suppression already happened at the cell level).
 */
function buildTotalResult(
  total: number,
  level: Sensitivity,
  policy: SdcConfig,
  seed: string,
): CountResult {
  if (!policy.enabled) {
    return {
      kind: 'exact',
      value: total,
      available: true,
      displayLabel: formatCount(total),
    };
  }

  const lvl = policy.levels[level];

  // Boolean-only mode: totals also get boolean treatment to avoid leaking
  // the summed count.
  if (lvl.booleanOnly) {
    const meetsThreshold = total >= lvl.thresholdK;
    return {
      kind: 'boolean',
      value: null,
      available: meetsThreshold,
      displayLabel: meetsThreshold
        ? `Data available (≥${lvl.thresholdK})`
        : `Insufficient data (<${lvl.thresholdK})`,
    };
  }

  const base = lvl.roundingBase;
  const mode = lvl.roundingMode;

  if (base <= 1 || mode === 'none') {
    return {
      kind: 'exact',
      value: total,
      available: true,
      displayLabel: formatCount(total),
    };
  }

  const rounded = roundTo(total, base, mode, seed);
  return {
    kind: 'rounded',
    value: rounded,
    available: true,
    displayLabel: `≈ ${formatCount(rounded)}`,
  };
}

// ---------------------------------------------------------------------------
// Differencing guards
// ---------------------------------------------------------------------------

/**
 * Check whether a query's result-set population is large enough to evaluate.
 * Returns ok:false with a reason when population < global.minQuerySetSize.
 */
export function checkQuerySetSize(
  populationCount: number,
  policy: SdcConfig,
): { ok: boolean; reason?: string } {
  const min = policy.global.minQuerySetSize;
  if (min > 0 && populationCount < min) {
    return {
      ok: false,
      reason: `Query result set too small: ${populationCount} < minimum ${min}. Query rejected to prevent differencing attacks.`,
    };
  }
  return { ok: true };
}

/**
 * Stable-stringify an object with sorted keys so it can be used as both
 * the rounding seed and the query repetition key. Same logical query always
 * produces the same canonical string regardless of property insertion order.
 */
export function canonicalizeQuery(obj: unknown): string {
  return JSON.stringify(obj, sortedReplacer);
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Tracks canonical query strings within a session and warns when the same
 * (or effectively identical) query exceeds the configured repetition limit.
 * Purely in-memory. Thread-safe concerns are not applicable in a browser
 * single-threaded environment.
 */
export class RepeatedQueryTracker {
  private readonly counts = new Map<string, number>();
  private readonly limit: number;

  constructor(policy: SdcConfig) {
    this.limit = policy.global.queryRepetitionLimit;
  }

  /**
   * Record a query. Returns a warning message when the repetition limit is
   * exceeded, otherwise returns null.
   */
  record(canonicalKey: string): { warning: string } | null {
    const current = (this.counts.get(canonicalKey) ?? 0) + 1;
    this.counts.set(canonicalKey, current);

    if (current > this.limit) {
      return {
        warning:
          `Query repeated ${current} times (limit: ${this.limit}). ` +
          `Repeated identical queries can defeat random rounding via averaging. ` +
          `Consider varying your query parameters.`,
      };
    }
    return null;
  }

  /** Return the current repetition count for a canonical key. */
  getCount(canonicalKey: string): number {
    return this.counts.get(canonicalKey) ?? 0;
  }

  /** Reset all tracked queries (e.g. on session start). */
  reset(): void {
    this.counts.clear();
  }
}
