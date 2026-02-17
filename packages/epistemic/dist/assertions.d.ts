import type { EpistemicValue } from './epistemic.js';
/**
 * assertKnown
 * -----------
 * Narrows an EpistemicValue<T> to KNOWN at compile time.
 *
 * - NO runtime behavior
 * - NO mutation
 * - Fails compilation if misused
 */
export declare function assertKnown<T>(value: EpistemicValue<T>): asserts value is Extract<EpistemicValue<T>, {
    state: 'KNOWN';
}>;
/**
 * assertIncomplete
 * ----------------
 * Narrows to INCOMPLETE epistemic state.
 */
export declare function assertIncomplete<T>(value: EpistemicValue<T>): asserts value is Extract<EpistemicValue<T>, {
    state: 'INCOMPLETE';
}>;
