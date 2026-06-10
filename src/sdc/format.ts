/**
 * Formatting helpers for the SDC engine.
 * Kept intentionally tiny: no external deps, pure functions only.
 */

/**
 * Format a non-negative integer with thousands separators.
 * British convention: comma as thousands separator.
 * Examples: 1240 -> "1,240", 999 -> "999", 1000000 -> "1,000,000"
 */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}
