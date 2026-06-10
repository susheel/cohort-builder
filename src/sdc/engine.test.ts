/**
 * Tests for the SDC engine: applyCount, rounding, differencing guards,
 * and DEFAULT_SDC sanity checks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyCount,
  roundTo,
  checkQuerySetSize,
  canonicalizeQuery,
  RepeatedQueryTracker,
  type CountResult,
} from './engine';
import { DEFAULT_SDC, type SdcConfig } from '../spec/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SdcConfig with SDC disabled. */
function disabledPolicy(): SdcConfig {
  return { ...DEFAULT_SDC, enabled: false };
}

// ---------------------------------------------------------------------------
// SDC disabled
// ---------------------------------------------------------------------------

describe('applyCount – SDC disabled', () => {
  it('returns exact kind with the raw value', () => {
    const result = applyCount(42, 'High', disabledPolicy());
    expect(result.kind).toBe('exact');
    expect(result.value).toBe(42);
    expect(result.available).toBe(true);
    expect(result.displayLabel).toBe('42');
    expect(result.raw).toBe(42);
  });

  it('returns exact even for counts below any threshold', () => {
    const result = applyCount(3, 'Medium', disabledPolicy());
    expect(result.kind).toBe('exact');
    expect(result.value).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// None level: exact pass-through
// ---------------------------------------------------------------------------

describe('applyCount – None sensitivity (exact)', () => {
  it('returns exact for a normal count', () => {
    const result = applyCount(500, 'None', DEFAULT_SDC);
    expect(result.kind).toBe('exact');
    expect(result.value).toBe(500);
    expect(result.available).toBe(true);
    expect(result.displayLabel).toBe('500');
  });

  it('returns exact even for count of 1 (k=1 for None)', () => {
    const result = applyCount(1, 'None', DEFAULT_SDC);
    expect(result.kind).toBe('exact');
    expect(result.value).toBe(1);
  });

  it('returns zero kind for count of 0 (zeroIsDisclosive=false for None)', () => {
    const result = applyCount(0, 'None', DEFAULT_SDC);
    expect(result.kind).toBe('zero');
    expect(result.value).toBe(0);
    expect(result.available).toBe(false);
    expect(result.displayLabel).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Low level: k=5, round to nearest 5
// ---------------------------------------------------------------------------

describe('applyCount – Low sensitivity (k=5, nearest 5)', () => {
  it('suppresses count of 1', () => {
    const result = applyCount(1, 'Low', DEFAULT_SDC);
    expect(result.kind).toBe('suppressed');
    expect(result.value).toBeNull();
    expect(result.displayLabel).toBe('<5');
    expect(result.raw).toBe(1);
  });

  it('suppresses count of 4', () => {
    const result = applyCount(4, 'Low', DEFAULT_SDC);
    expect(result.kind).toBe('suppressed');
    expect(result.displayLabel).toBe('<5');
  });

  it('boundary: count exactly at k=5 is not suppressed', () => {
    const result = applyCount(5, 'Low', DEFAULT_SDC);
    expect(result.kind).not.toBe('suppressed');
    expect(result.available).toBe(true);
  });

  it('boundary: count k-1 = 4 is suppressed', () => {
    const result = applyCount(4, 'Low', DEFAULT_SDC);
    expect(result.kind).toBe('suppressed');
  });

  it('rounds 7 to nearest 5 -> 5', () => {
    const result = applyCount(7, 'Low', DEFAULT_SDC);
    expect(result.kind).toBe('rounded');
    expect(result.value).toBe(5);
    expect(result.displayLabel).toBe('≈ 5');
  });

  it('rounds 8 to nearest 5 -> 10', () => {
    const result = applyCount(8, 'Low', DEFAULT_SDC);
    expect(result.kind).toBe('rounded');
    expect(result.value).toBe(10);
  });

  it('rounds 10 to nearest 5 -> 10 (already exact multiple)', () => {
    const result = applyCount(10, 'Low', DEFAULT_SDC);
    expect(result.kind).toBe('rounded');
    expect(result.value).toBe(10);
  });

  it('rounds 1237 to nearest 5 -> 1235', () => {
    const result = applyCount(1237, 'Low', DEFAULT_SDC);
    expect(result.kind).toBe('rounded');
    expect(result.value).toBe(1235);
  });

  it('rounds 1238 to nearest 5 -> 1240', () => {
    const result = applyCount(1238, 'Low', DEFAULT_SDC);
    expect(result.kind).toBe('rounded');
    expect(result.value).toBe(1240);
    expect(result.displayLabel).toBe('≈ 1,240');
  });

  it('zero is not disclosive for Low -> returns zero kind', () => {
    const result = applyCount(0, 'Low', DEFAULT_SDC);
    expect(result.kind).toBe('zero');
    expect(result.value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Medium level: k=10, round up to nearest 10
// ---------------------------------------------------------------------------

describe('applyCount – Medium sensitivity (k=10, up to nearest 10)', () => {
  it('suppresses count of 9', () => {
    const result = applyCount(9, 'Medium', DEFAULT_SDC);
    expect(result.kind).toBe('suppressed');
    expect(result.displayLabel).toBe('<10');
  });

  it('boundary: count exactly 10 is not suppressed', () => {
    const result = applyCount(10, 'Medium', DEFAULT_SDC);
    expect(result.kind).not.toBe('suppressed');
    expect(result.available).toBe(true);
  });

  it('rounds up: 11 -> 20', () => {
    const result = applyCount(11, 'Medium', DEFAULT_SDC);
    expect(result.kind).toBe('rounded');
    expect(result.value).toBe(20);
  });

  it('rounds up: 20 -> 20 (already multiple)', () => {
    const result = applyCount(20, 'Medium', DEFAULT_SDC);
    expect(result.kind).toBe('rounded');
    expect(result.value).toBe(20);
  });

  it('rounds up: 100 -> 100', () => {
    const result = applyCount(100, 'Medium', DEFAULT_SDC);
    expect(result.value).toBe(100);
  });

  it('rounds up: 101 -> 110', () => {
    const result = applyCount(101, 'Medium', DEFAULT_SDC);
    expect(result.value).toBe(110);
  });
});

// ---------------------------------------------------------------------------
// High level: k=20, boolean only, zeroIsDisclosive
// ---------------------------------------------------------------------------

describe('applyCount – High sensitivity (boolean only, k=20)', () => {
  it('returns boolean with available=true when count >= 20', () => {
    const result = applyCount(20, 'High', DEFAULT_SDC);
    expect(result.kind).toBe('boolean');
    expect(result.value).toBeNull();
    expect(result.available).toBe(true);
    expect(result.displayLabel).toBe('Data available (≥20)');
  });

  it('returns boolean with available=false when count < 20', () => {
    const result = applyCount(19, 'High', DEFAULT_SDC);
    expect(result.kind).toBe('boolean');
    expect(result.available).toBe(false);
    expect(result.displayLabel).toBe('Insufficient data (<20)');
  });

  it('returns boolean for any large count', () => {
    const result = applyCount(999, 'High', DEFAULT_SDC);
    expect(result.kind).toBe('boolean');
    expect(result.available).toBe(true);
  });

  it('suppresses zero when zeroIsDisclosive=true (High)', () => {
    const result = applyCount(0, 'High', DEFAULT_SDC);
    expect(result.kind).toBe('suppressed');
    expect(result.available).toBe(false);
    expect(result.displayLabel).toBe('<20');
  });

  it('display label for boolean does not contain raw count', () => {
    const result = applyCount(7, 'High', DEFAULT_SDC);
    expect(result.displayLabel).not.toContain('7');
  });
});

// ---------------------------------------------------------------------------
// Random rounding determinism
// ---------------------------------------------------------------------------

describe('roundTo – random mode', () => {
  it('same seed + same value produces the same result on repeated calls', () => {
    const seed = 'my-query-hash';
    const r1 = roundTo(13, 5, 'random', seed);
    const r2 = roundTo(13, 5, 'random', seed);
    expect(r1).toBe(r2);
  });

  it('different seeds may produce different results', () => {
    // This is probabilistic; with base 5 and value 13, there are only two
    // outcomes (10 or 15). Run enough distinct seeds to see both.
    const results = new Set<number>();
    for (let i = 0; i < 40; i++) {
      results.add(roundTo(13, 5, 'random', `seed-${i}`));
    }
    // Should have seen both 10 and 15 across 40 different seeds.
    expect(results.size).toBeGreaterThan(1);
  });

  it('random output is always a valid multiple of the base', () => {
    for (let i = 0; i < 20; i++) {
      const r = roundTo(37, 10, 'random', `s${i}`);
      expect(r % 10).toBe(0);
    }
  });

  it('same seed in applyCount produces identical displayLabel on repeat', () => {
    const result1 = applyCount(37, 'Low', DEFAULT_SDC, 'stable-seed');
    const result2 = applyCount(37, 'Low', DEFAULT_SDC, 'stable-seed');
    expect(result1.displayLabel).toBe(result2.displayLabel);
    expect(result1.value).toBe(result2.value);
  });
});

// ---------------------------------------------------------------------------
// roundTo – mode coverage
// ---------------------------------------------------------------------------

describe('roundTo – mode coverage', () => {
  it('nearest: 7 with base 5 -> 5', () => {
    expect(roundTo(7, 5, 'nearest')).toBe(5);
  });

  it('nearest: 8 with base 5 -> 10', () => {
    expect(roundTo(8, 5, 'nearest')).toBe(10);
  });

  it('up: 11 with base 10 -> 20', () => {
    expect(roundTo(11, 10, 'up')).toBe(20);
  });

  it('up: 20 with base 10 -> 20 (already multiple)', () => {
    expect(roundTo(20, 10, 'up')).toBe(20);
  });

  it('none: returns value unchanged', () => {
    expect(roundTo(37, 10, 'none')).toBe(37);
  });

  it('base 1 returns value unchanged', () => {
    expect(roundTo(37, 1, 'nearest')).toBe(37);
  });
});

// ---------------------------------------------------------------------------
// Query set size guard
// ---------------------------------------------------------------------------

describe('checkQuerySetSize', () => {
  it('ok when population >= minQuerySetSize', () => {
    const policy: SdcConfig = {
      ...DEFAULT_SDC,
      global: { minQuerySetSize: 10, queryRepetitionLimit: 25 },
    };
    expect(checkQuerySetSize(10, policy).ok).toBe(true);
    expect(checkQuerySetSize(100, policy).ok).toBe(true);
  });

  it('fails when population < minQuerySetSize', () => {
    const policy: SdcConfig = {
      ...DEFAULT_SDC,
      global: { minQuerySetSize: 10, queryRepetitionLimit: 25 },
    };
    const result = checkQuerySetSize(9, policy);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('9');
  });

  it('ok when minQuerySetSize is 0 (disabled)', () => {
    const result = checkQuerySetSize(0, DEFAULT_SDC);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Repeated-query tracker
// ---------------------------------------------------------------------------

describe('RepeatedQueryTracker', () => {
  let tracker: RepeatedQueryTracker;

  beforeEach(() => {
    tracker = new RepeatedQueryTracker(DEFAULT_SDC); // limit=25
  });

  it('does not warn below the limit', () => {
    const key = 'query-abc';
    for (let i = 0; i < 25; i++) {
      const w = tracker.record(key);
      expect(w).toBeNull();
    }
  });

  it('warns when limit is exceeded', () => {
    const key = 'query-abc';
    const limit = DEFAULT_SDC.global.queryRepetitionLimit;
    for (let i = 0; i < limit; i++) {
      tracker.record(key);
    }
    const w = tracker.record(key);
    expect(w).not.toBeNull();
    expect(w?.warning).toContain(String(limit));
  });

  it('tracks different keys independently', () => {
    for (let i = 0; i < 30; i++) {
      tracker.record('query-A');
    }
    const w = tracker.record('query-B');
    expect(w).toBeNull(); // B has only 1 call
  });

  it('reset clears all counts', () => {
    const key = 'query-abc';
    const limit = DEFAULT_SDC.global.queryRepetitionLimit;
    for (let i = 0; i <= limit; i++) {
      tracker.record(key);
    }
    tracker.reset();
    expect(tracker.getCount(key)).toBe(0);
    // After reset, recording once more should not warn.
    expect(tracker.record(key)).toBeNull();
  });

  it('getCount returns accurate count', () => {
    tracker.record('q');
    tracker.record('q');
    expect(tracker.getCount('q')).toBe(2);
  });

  it('warns immediately above limit with a custom low limit', () => {
    const strictPolicy: SdcConfig = {
      ...DEFAULT_SDC,
      global: { minQuerySetSize: 0, queryRepetitionLimit: 3 },
    };
    const t = new RepeatedQueryTracker(strictPolicy);
    t.record('k');
    t.record('k');
    t.record('k');
    const w = t.record('k');
    expect(w).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// canonicalizeQuery
// ---------------------------------------------------------------------------

describe('canonicalizeQuery', () => {
  it('produces identical output regardless of key insertion order', () => {
    const a = canonicalizeQuery({ z: 1, a: 2, m: 3 });
    const b = canonicalizeQuery({ m: 3, z: 1, a: 2 });
    expect(a).toBe(b);
  });

  it('produces different output for different values', () => {
    const a = canonicalizeQuery({ x: 1 });
    const b = canonicalizeQuery({ x: 2 });
    expect(a).not.toBe(b);
  });

  it('handles nested objects with sorted keys', () => {
    const a = canonicalizeQuery({ b: { y: 1, x: 2 } });
    const b = canonicalizeQuery({ b: { x: 2, y: 1 } });
    expect(a).toBe(b);
  });

  it('handles arrays', () => {
    const r = canonicalizeQuery([1, 2, 3]);
    expect(r).toBe('[1,2,3]');
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SDC sanity checks
// ---------------------------------------------------------------------------

describe('DEFAULT_SDC sanity', () => {
  it('High is booleanOnly with k=20', () => {
    const high = DEFAULT_SDC.levels.High;
    expect(high.booleanOnly).toBe(true);
    expect(high.thresholdK).toBe(20);
    expect(high.zeroIsDisclosive).toBe(true);
  });

  it('None is exact (k=1, no rounding, no booleanOnly)', () => {
    const none = DEFAULT_SDC.levels.None;
    expect(none.booleanOnly).toBe(false);
    expect(none.thresholdK).toBe(1);
    expect(none.roundingMode).toBe('none');
    expect(none.complementarySuppression).toBe(false);
  });

  it('Low has k=5 and nearest rounding', () => {
    const low = DEFAULT_SDC.levels.Low;
    expect(low.thresholdK).toBe(5);
    expect(low.roundingMode).toBe('nearest');
    expect(low.roundingBase).toBe(5);
  });

  it('Medium has k=10, up rounding, and complementary suppression', () => {
    const med = DEFAULT_SDC.levels.Medium;
    expect(med.thresholdK).toBe(10);
    expect(med.roundingMode).toBe('up');
    expect(med.roundingBase).toBe(10);
    expect(med.complementarySuppression).toBe(true);
  });

  it('SDC is enabled by default', () => {
    expect(DEFAULT_SDC.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CountResult shape contract
// ---------------------------------------------------------------------------

describe('CountResult shape', () => {
  it('suppressed cell has value=null and raw present', () => {
    const r: CountResult = applyCount(3, 'Medium', DEFAULT_SDC);
    expect(r.kind).toBe('suppressed');
    expect(r.value).toBeNull();
    expect(r.raw).toBe(3);
    expect(r.displayLabel).not.toContain('3');
  });

  it('boolean cell has value=null regardless of raw', () => {
    const r: CountResult = applyCount(100, 'High', DEFAULT_SDC);
    expect(r.kind).toBe('boolean');
    expect(r.value).toBeNull();
    // Label must not expose the raw count
    expect(r.displayLabel).not.toContain('100');
  });

  it('rounded cell has a numeric value', () => {
    const r: CountResult = applyCount(12, 'Medium', DEFAULT_SDC);
    expect(r.kind).toBe('rounded');
    expect(typeof r.value).toBe('number');
  });
});
