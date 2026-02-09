import { EpistemicValue } from './epistemic';

/**
 * legacyToEpistemic
 * -----------------
 * Temporary adapter for Phase A migration.
 *
 * Purpose:
 * - Preserve existing behavior
 * - Make epistemic state explicit
 *
 * Mapping:
 * - non-null value → KNOWN
 * - null value     → UNKNOWN
 *
 * This is intentionally naive.
 * We will replace this logic in later phases.
 */
export function legacyToEpistemic<T>(
  value: T | null,
  explanation?: string
): EpistemicValue<T> {
  if (value === null) {
    return {
      value: null,
      state: 'UNKNOWN',
      explanation,
      evaluatedAt: new Date().toISOString(),
    };
  }

  return {
    value,
    state: 'KNOWN',
    evaluatedAt: new Date().toISOString(),
  };

}
