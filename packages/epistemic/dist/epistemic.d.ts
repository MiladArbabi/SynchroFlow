/**
 * Epistemic primitives for LaSyncro
 * --------------------------------
 * Canonical, type-authoritative definition of epistemic semantics.
 *
 * CRITICAL:
 * - This file intentionally includes a zero-cost runtime export
 * - This forces TypeScript to emit a declaration file
 * - Without this, downstream packages lose epistemic exhaustiveness
 *
 * This file defines WHAT the system knows — not HOW it behaves.
 */
export type EpistemicState = 'KNOWN' | 'INCOMPLETE' | 'UNKNOWN';
/**
 * EpistemicValue<T>
 * -----------------
 * Canonical, type-enforced epistemic contract.
 *
 * This type encodes epistemic invariants directly into the type system.
 * If these constraints are violated, TypeScript MUST fail the build.
 */
export type EpistemicValue<T> = {
    state: 'KNOWN';
    value: T;
    evaluatedAt: string;
    explanation?: undefined;
    completenessRatio?: undefined;
} | {
    state: 'INCOMPLETE';
    value: T | null;
    evaluatedAt: string;
    explanation?: string;
    completenessRatio?: number;
} | {
    state: 'UNKNOWN';
    value: null;
    evaluatedAt: string;
    explanation?: string;
    completenessRatio?: undefined;
};
/**
 * __EPISTEMIC_DECLARATION_ANCHOR__
 * --------------------------------
 * This export exists solely to force `.d.ts` emission.
 *
 * - It has NO runtime impact
 * - It must NEVER be imported
 * - It must NEVER be removed
 *
 * If this disappears, epistemic exhaustiveness collapses silently.
 */
export declare const __EPISTEMIC_DECLARATION_ANCHOR__ = true;
