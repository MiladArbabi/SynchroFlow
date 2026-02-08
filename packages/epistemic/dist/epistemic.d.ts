/**
 * Epistemic primitives for LaSyncro
 * ---------------------------------
 * This file defines how the system represents knowledge.
 *
 * IMPORTANT:
 * - This does NOT define business logic
 * - This does NOT change behavior
 * - This is a structural contract only
 *
 * If you are tempted to add logic here, stop.
 */
export type EpistemicState = 'KNOWN' | 'INCOMPLETE' | 'UNKNOWN';
/**
 * EpistemicValue<T>
 * -----------------
 * Wraps a computed value with explicit knowledge semantics.
 *
 * Design rules:
 * - `value` may exist even when state !== KNOWN
 * - `null` means "not computable", NOT "zero"
 * - State must ALWAYS be explicit
 */
export interface EpistemicValue<T> {
    /**
     * The computed value.
     * Never hidden by policy.
     */
    value: T | null;
    /**
     * How confident the system is about this value.
     */
    state: EpistemicState;
    /**
     * Optional human-readable explanation.
     * REQUIRED when state !== KNOWN (enforced later).
     */
    explanation?: string;
    /**
     * Optional completeness ratio (0–1).
     * Used only for INCOMPLETE values.
     */
    completenessRatio?: number;
    /**
     * When this value was evaluated.
     * Allows temporal debugging and replay.
     */
    evaluatedAt: string;
}
