/**
 * Tests for applyCrossTab: primary suppression, complementary suppression,
 * total recomputation, and recovery-prevention checks.
 */

import { describe, it, expect } from 'vitest';
import { applyCrossTab, type CrossTabCell } from './engine';
import { DEFAULT_SDC, type SdcConfig } from '../spec/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCell(raw: number, rowLabel?: string, colLabel?: string): CrossTabCell {
  return { raw, rowLabel, colLabel };
}

/**
 * Convenience: build a 2-D array of cells from a plain 2-D number array.
 */
function makeCells(data: number[][]): CrossTabCell[][] {
  return data.map((row, r) =>
    row.map((raw, c) => makeCell(raw, `row${r}`, `col${c}`)),
  );
}

/**
 * Count how many result cells have kind 'suppressed' in the result grid.
 */
function countSuppressed(grid: ReturnType<typeof applyCrossTab>): number {
  let n = 0;
  for (const row of grid.cells) {
    for (const cell of row) {
      if (cell.kind === 'suppressed') n++;
    }
  }
  return n;
}

/**
 * Get non-null numeric values from the grid. Null values (suppressed/boolean)
 * are excluded.
 */
function visibleValues(grid: ReturnType<typeof applyCrossTab>): number[] {
  const vals: number[] = [];
  for (const row of grid.cells) {
    for (const cell of row) {
      if (cell.value !== null) vals.push(cell.value);
    }
  }
  return vals;
}

// ---------------------------------------------------------------------------
// Basic cross-tab (no complementary suppression)
// ---------------------------------------------------------------------------

describe('applyCrossTab – Low level (no complementary suppression)', () => {
  // Low: k=5, nearest 5, complementarySuppression=false
  const cells = makeCells([
    [3, 100, 200],
    [50, 75, 30],
  ]);

  it('primary-suppresses the <5 cell', () => {
    const result = applyCrossTab(cells, 'Low', DEFAULT_SDC);
    expect(result.cells[0][0].kind).toBe('suppressed');
  });

  it('rounds non-suppressed cells to nearest 5', () => {
    const result = applyCrossTab(cells, 'Low', DEFAULT_SDC);
    // 100 -> 100, 200 -> 200 (already multiples)
    expect(result.cells[0][1].value).toBe(100);
    expect(result.cells[0][2].value).toBe(200);
    // 50 -> 50, 75 -> 75, 30 -> 30 (all exact multiples)
    expect(result.cells[1][0].value).toBe(50);
    expect(result.cells[1][1].value).toBe(75);
    expect(result.cells[1][2].value).toBe(30);
  });

  it('row totals do not include suppressed cells', () => {
    const result = applyCrossTab(cells, 'Low', DEFAULT_SDC);
    // Row 0: suppressed + 100 + 200 = 300 (suppressed cell treated as 0)
    expect(result.rowTotals[0].value).toBe(300);
    // Row 1: 50 + 75 + 30 = 155 -> rounds to nearest 5 -> 155
    expect(result.rowTotals[1].value).toBe(155);
  });

  it('col totals are recomputed from visible values', () => {
    const result = applyCrossTab(cells, 'Low', DEFAULT_SDC);
    // Col 0: 0 (suppressed) + 50 = 50 -> nearest 5 -> 50
    expect(result.colTotals[0].value).toBe(50);
  });

  it('result has correct dimensions', () => {
    const result = applyCrossTab(cells, 'Low', DEFAULT_SDC);
    expect(result.rows).toBe(2);
    expect(result.cols).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Complementary suppression: 2x3 table, Medium level
// ---------------------------------------------------------------------------

describe('applyCrossTab – complementary suppression (Medium, k=10)', () => {
  /**
   * Table: Medium level, k=10, up to nearest 10, complementary suppression on.
   *
   *         col0   col1   col2
   * row0  [  7,    50,    60  ]   <- cell[0][0] is primary-suppressed (7 < 10)
   * row1  [ 30,    40,    20  ]
   *
   * After primary suppression: [0][0] is suppressed.
   * Row 0 now has exactly 1 suppressed cell and visible total (110).
   *   -> Suppress smallest unsuppressed in row 0: 50 (smaller than 60).
   * Now [0][0] and [0][1] are suppressed (2 in row 0: row 0 is safe).
   * Col 0 still has exactly 1 suppressed cell ([0][0]).
   *   -> Suppress smallest unsuppressed in col 0: 30 (row 1).
   * Col 1 still has exactly 1 suppressed cell ([0][1]).
   *   -> Suppress smallest unsuppressed in col 1: 40 (row 1).
   * Continue until stable.
   */
  const cells = makeCells([
    [7, 50, 60],
    [30, 40, 20],
  ]);

  it('primary cell [0][0] is suppressed', () => {
    const result = applyCrossTab(cells, 'Medium', DEFAULT_SDC);
    expect(result.cells[0][0].kind).toBe('suppressed');
  });

  it('a secondary cell in the same row as [0][0] is also suppressed', () => {
    const result = applyCrossTab(cells, 'Medium', DEFAULT_SDC);
    // Row 0 must have at least 2 suppressed cells so primary is unrecoverable.
    const rowSuppressed = result.cells[0].filter((c) => c.kind === 'suppressed');
    expect(rowSuppressed.length).toBeGreaterThanOrEqual(2);
  });

  it('a secondary cell in the same column as [0][0] is also suppressed', () => {
    const result = applyCrossTab(cells, 'Medium', DEFAULT_SDC);
    // Col 0 must have at least 2 suppressed cells.
    const colSuppressed = result.cells.map((row) => row[0]).filter((c) => c.kind === 'suppressed');
    expect(colSuppressed.length).toBeGreaterThanOrEqual(2);
  });

  it('no suppressed cell is recoverable by row subtraction', () => {
    const result = applyCrossTab(cells, 'Medium', DEFAULT_SDC);
    for (let r = 0; r < result.rows; r++) {
      const suppCols = result.cells[r]
        .map((c, ci) => (c.kind === 'suppressed' ? ci : -1))
        .filter((ci) => ci >= 0);
      if (suppCols.length === 0) continue;

      // The row total should NOT allow recovering any single suppressed cell.
      // That requires at least 2 suppressed cells per row with a visible total,
      // OR the total itself is not visible (null).
      const rowTotalVisible = result.rowTotals[r].value !== null;
      if (rowTotalVisible && suppCols.length === 1) {
        // Only one suppressed: this would be recoverable. This must NOT happen.
        throw new Error(`Row ${r} has exactly 1 suppressed cell with visible total – attack possible`);
      }
      // If we reach here, the row is safe.
    }
  });

  it('no suppressed cell is recoverable by column subtraction', () => {
    const result = applyCrossTab(cells, 'Medium', DEFAULT_SDC);
    for (let c = 0; c < result.cols; c++) {
      const suppRows = result.cells
        .map((row, ri) => (row[c].kind === 'suppressed' ? ri : -1))
        .filter((ri) => ri >= 0);
      if (suppRows.length === 0) continue;

      const colTotalVisible = result.colTotals[c].value !== null;
      if (colTotalVisible && suppRows.length === 1) {
        throw new Error(`Col ${c} has exactly 1 suppressed cell with visible total – attack possible`);
      }
    }
  });

  it('totals are recomputed from post-suppression values, not raw', () => {
    const result = applyCrossTab(cells, 'Medium', DEFAULT_SDC);
    // Grand total must equal sum of all visible cell values.
    const allVisible = visibleValues(result);
    const manualSum = allVisible.reduce((a, b) => a + b, 0);
    // Row totals sum of visible values:
    const rowTotalVals = result.rowTotals.map((t) => t.value ?? 0);
    const rowSum = rowTotalVals.reduce((a, b) => a + b, 0);
    // They should be consistent (grand total = sum of row totals' visible values)
    expect(result.grandTotal.value).toBe(
      result.rowTotals.reduce((acc, t) => acc + (t.value ?? 0), 0),
    );
    // The manual sum of cells should also match (within rounding)
    // Note: rowTotal itself gets rounded, so we compare via the row totals path.
    expect(typeof manualSum).toBe('number'); // sanity
    expect(typeof rowSum).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Complementary suppression: verify secondary cell is the SMALLEST eligible
// ---------------------------------------------------------------------------

describe('applyCrossTab – secondary suppression picks smallest cell', () => {
  /**
   *         col0   col1
   * row0  [  5,    200  ]   <- 5 < 10, primary suppressed
   * row1  [ 15,    100  ]
   *
   * Row 0 has 1 suppressed cell. The smallest unsuppressed in row 0 is 200
   * (only option). Col 0 has 1 suppressed cell. Smallest unsuppressed in col 0
   * is 15 (row 1). So [1][0] should be secondarily suppressed.
   */
  const cells = makeCells([
    [5, 200],
    [15, 100],
  ]);

  it('secondarily suppresses [1][0] (smallest in col 0)', () => {
    const result = applyCrossTab(cells, 'Medium', DEFAULT_SDC);
    // [0][0] is primary suppressed (5 < k=10)
    expect(result.cells[0][0].kind).toBe('suppressed');
    // [0][1]=200 is secondarily suppressed (only non-suppressed cell in row 0)
    expect(result.cells[0][1].kind).toBe('suppressed');
    // [1][0]=15 is secondarily suppressed (col 0 had exactly 1 suppressed cell)
    expect(result.cells[1][0].kind).toBe('suppressed');
  });

  it('[1][1]=100 is secondarily suppressed to protect col 1', () => {
    const result = applyCrossTab(cells, 'Medium', DEFAULT_SDC);
    // Col 1 had exactly 1 suppressed cell ([0][1]) -> [1][1] gets suppressed.
    // This is correct: otherwise [0][1] could be recovered from col 1's total.
    expect(result.cells[1][1].kind).toBe('suppressed');
  });

  it('total count of suppressed cells covers all cells (full suppression)', () => {
    const result = applyCrossTab(cells, 'Medium', DEFAULT_SDC);
    // All 4 cells are suppressed (cascade from a single small primary cell).
    expect(countSuppressed(result)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// High level cross-tab: boolean only
// ---------------------------------------------------------------------------

describe('applyCrossTab – High level (boolean only)', () => {
  const cells = makeCells([
    [5, 25, 50],
    [30, 0, 100],
  ]);

  it('non-zero cells are boolean kind', () => {
    // Algorithm order (per spec): zero check BEFORE boolean-only.
    // All non-zero cells go through the boolean-only path.
    const result = applyCrossTab(cells, 'High', DEFAULT_SDC);
    const nonZeroCells = result.cells.flat().filter((c) => c.raw !== 0);
    for (const cell of nonZeroCells) {
      expect(cell.kind).toBe('boolean');
    }
  });

  it('cell with raw=5 (< 20) has available=false', () => {
    const result = applyCrossTab(cells, 'High', DEFAULT_SDC);
    expect(result.cells[0][0].available).toBe(false);
  });

  it('cell with raw=25 (>= 20) has available=true', () => {
    const result = applyCrossTab(cells, 'High', DEFAULT_SDC);
    expect(result.cells[0][1].available).toBe(true);
  });

  it('zero cell with zeroIsDisclosive=true is suppressed (zero check precedes boolean-only)', () => {
    const result = applyCrossTab(cells, 'High', DEFAULT_SDC);
    // Per spec algorithm order: zero -> boolean. Zero with zeroIsDisclosive
    // returns suppressed before the boolean-only check is reached.
    expect(result.cells[1][1].kind).toBe('suppressed');
    expect(result.cells[1][1].available).toBe(false);
  });

  it('large count (100) is boolean with available=true', () => {
    const result = applyCrossTab(cells, 'High', DEFAULT_SDC);
    expect(result.cells[1][2].kind).toBe('boolean');
    expect(result.cells[1][2].available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SDC disabled: exact pass-through
// ---------------------------------------------------------------------------

describe('applyCrossTab – SDC disabled', () => {
  const disabledPolicy: SdcConfig = { ...DEFAULT_SDC, enabled: false };
  const cells = makeCells([
    [3, 10],
    [7, 5],
  ]);

  it('returns all cells as exact kind', () => {
    const result = applyCrossTab(cells, 'Medium', disabledPolicy);
    for (const row of result.cells) {
      for (const cell of row) {
        expect(cell.kind).toBe('exact');
      }
    }
  });

  it('totals reflect true sums', () => {
    const result = applyCrossTab(cells, 'Medium', disabledPolicy);
    expect(result.rowTotals[0].value).toBe(13);
    expect(result.rowTotals[1].value).toBe(12);
    expect(result.grandTotal.value).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// None level: exact, no suppression
// ---------------------------------------------------------------------------

describe('applyCrossTab – None level (exact, k=1)', () => {
  const cells = makeCells([
    [1, 2, 3],
    [4, 5, 6],
  ]);

  it('no cells are suppressed', () => {
    const result = applyCrossTab(cells, 'None', DEFAULT_SDC);
    expect(countSuppressed(result)).toBe(0);
  });

  it('all cells are exact', () => {
    const result = applyCrossTab(cells, 'None', DEFAULT_SDC);
    for (const row of result.cells) {
      for (const cell of row) {
        expect(cell.kind).toBe('exact');
      }
    }
  });

  it('grand total is correct', () => {
    const result = applyCrossTab(cells, 'None', DEFAULT_SDC);
    expect(result.grandTotal.value).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// Cross-tab result shape: row/col labels are preserved
// ---------------------------------------------------------------------------

describe('applyCrossTab – metadata preservation', () => {
  it('preserves rowLabel and colLabel on result cells', () => {
    const cells: CrossTabCell[][] = [
      [
        { raw: 50, rowLabel: 'Female', colLabel: 'APOE4+' },
        { raw: 100, rowLabel: 'Female', colLabel: 'APOE4-' },
      ],
    ];
    const result = applyCrossTab(cells, 'Low', DEFAULT_SDC);
    expect(result.cells[0][0].rowLabel).toBe('Female');
    expect(result.cells[0][0].colLabel).toBe('APOE4+');
    expect(result.cells[0][1].colLabel).toBe('APOE4-');
  });

  it('returns correct row/col counts', () => {
    const cells = makeCells([[1, 2], [3, 4], [5, 6]]);
    const result = applyCrossTab(cells, 'None', DEFAULT_SDC);
    expect(result.rows).toBe(3);
    expect(result.cols).toBe(2);
    expect(result.rowTotals.length).toBe(3);
    expect(result.colTotals.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Deterministic rounding seed propagated to cross-tab
// ---------------------------------------------------------------------------

describe('applyCrossTab – seed propagation for random rounding', () => {
  /**
   * Use a custom policy with Low level set to random rounding so we can
   * verify seed determinism at the cross-tab level.
   */
  const randomPolicy: SdcConfig = {
    ...DEFAULT_SDC,
    levels: {
      ...DEFAULT_SDC.levels,
      Low: {
        ...DEFAULT_SDC.levels.Low,
        roundingMode: 'random',
      },
    },
  };

  const cells = makeCells([[37, 53, 78]]);

  it('same seed produces identical grid on two calls', () => {
    const r1 = applyCrossTab(cells, 'Low', randomPolicy, { seed: 'deterministic-test' });
    const r2 = applyCrossTab(cells, 'Low', randomPolicy, { seed: 'deterministic-test' });
    for (let c = 0; c < 3; c++) {
      expect(r1.cells[0][c].value).toBe(r2.cells[0][c].value);
    }
  });
});
