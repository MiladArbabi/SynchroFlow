import { EpistemicValue } from './epistemic.js';
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
export declare function legacyToEpistemic<T>(value: T | null, explanation?: string): EpistemicValue<T>;
