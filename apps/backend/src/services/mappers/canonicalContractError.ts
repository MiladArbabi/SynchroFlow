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
 * SCOPE (PROJECTION-CURSOR-STALL-08): this typed class is fatal to the EVENT,
 * never to the pipeline. On encountering one:
 * - all projection writes for that event roll back (projection.engine.ts
 *   CANONICAL_NORMALIZATION_FAILED_FATAL — no partial state)
 * - rebuild records it in domain_event_projection_failures and skips it
 * - the runtime DB projection worker records it in the same table and advances
 *   the global cursor past it (atomically), logs [PROJECTION_EVENT_QUARANTINED]
 *   at ERROR, and continues — one deterministic poison event can no longer stall
 *   projection for every tenant
 * Non-canonical failures (DB, tenant frame, handler, schema guard) stay fatal to
 * the worker in both paths.
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
