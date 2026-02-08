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
export const __EPISTEMIC_DECLARATION_ANCHOR__ = true;
//# sourceMappingURL=epistemic.js.map