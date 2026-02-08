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
export function legacyToEpistemic(value, explanation) {
    return {
        value,
        state: value === null ? 'UNKNOWN' : 'KNOWN',
        explanation,
        evaluatedAt: new Date().toISOString(),
    };
}
