/**
 * PROJ-CONTRACT-24 — canonical contract violation
 * -----------------------------------------------
 * Thrown when a stored domain event's payload cannot satisfy the canonical
 * order contract (missing currency, total, subtotal, or a malformed ID).
 *
 * WHY A TYPED ERROR: these failures are data-shaped and deterministic — the
 * same event will fail identically on every replay, forever. Infrastructure
 * failures (DB, tenant frame, schema guard) are transient and must stay fatal.
 * Rebuild distinguishes the two by instanceof, NOT by matching error message
 * strings, which silently stop working when a message is reworded.
 *
 * SCOPE: rebuild skips these; the runtime worker still rethrows them. A
 * malformed producer must never be silently tolerated during live ingestion —
 * see projection.engine.ts CANONICAL_NORMALIZATION_FAILED_FATAL.
 */
export class CanonicalContractError extends Error {
  public readonly tag: string;

  constructor(tag: string, message: string) {
    super(message);
    this.name = 'CanonicalContractError';
    this.tag = tag;

    // Required for instanceof to survive TS's ES5 downlevel of Error subclasses.
    Object.setPrototypeOf(this, CanonicalContractError.prototype);
  }
}
