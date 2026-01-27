// apps/backend/src/utils/pctChange.ts

/**
 * pctChange (FT2-adjacent)
 * -----------------------
 * Computes percentage change between two magnitudes.
 *
 * Rules:
 * - No inference
 * - No thresholds
 * - No formatting
 * - Fail-closed
 *
 * Semantics:
 * - null → epistemically unavailable
 * - 0    → exactly flat
 */
export function pctChange(
  previous: number | null,
  current: number | null
): number | null {
  if (previous === null || current === null) return null;
  if (previous === 0) return null;

  return Math.round(((current - previous) / previous) * 100);
}
