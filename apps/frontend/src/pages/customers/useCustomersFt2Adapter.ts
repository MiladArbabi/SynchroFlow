// apps/frontend/src/pages/customers/useCustomersFt2Adapter.ts

import type { CustomersModuleFT2Props } from '@lasyncro/customers';

/**
 * Customers FT2 Snapshot (canonical, post-FTEP)
 * ---------------------------------------------
 * Raw FT2 payload coming from backend transport.
 *
 * Rules:
 * - Already FTEP-sanitized
 * - All fields optional
 * - Adapter must only normalize + gate by entitlement
 */
type CustomersFt2Snapshot = {
  sessionsObserved?: number | null;

  period?: {
    from: string;
    to: string;
  } | null;

  activityDirection?:
    | 'up'
    | 'down'
    | 'flat'
    | 'unknown'
    | null;

  exitIntentDetected?: boolean | null;

   structuredJourneysDetected?: boolean | null;

  /**
   * Existence-only behavioral depth signal.
   */
  multiStepSessionsPresent?: boolean | null;

  /**
   * Existence-only surface breadth signal.
   */
  surfaceBreadthPresent?: boolean | null;

  /**
   * Existence-only returning behavior signal.
   */
  returningSessionsPresent?: boolean | null;

  dataCoverage?: 'complete' | 'partial' | 'insufficient' | null;

  /**
   * Existence-only early exit signal.
   */
  exitWithoutInteractionPresent?: boolean | null;

  /**
   * Existence-only average session depth proxy.
   */
  averageSessionDepthPresent?: boolean | null;


  /**
   * Entitlement context (injected upstream).
   * Adapter does not infer this.
   */
  isPaid?: boolean;
};

/**
 * mapCustomersFt2Props
 * -------------------
 * Canonical Customers FT2 adapter.
 *
 * Invariants:
 * - Pipe-only (no inference, no defaults)
 * - undefined → null normalization
 * - Paid-only structural truth gated here
 * - Output shape matches CustomersModuleFT2Props exactly
 */
export function mapCustomersFt2Props(
  snapshot: CustomersFt2Snapshot
): CustomersModuleFT2Props {
  const isPaid = snapshot.isPaid === true;

  return {
    // ───────── Existence / Context ─────────
    sessionsObserved:
      snapshot.sessionsObserved ?? null,

    period:
      snapshot.period ?? null,

    // ───────── Directional Signal ─────────
    activityDirection:
      snapshot.activityDirection ?? null,

    // ───────── Paid-only Structural Signals ─────────
    exitIntentDetected: isPaid
      ? snapshot.exitIntentDetected ?? null
      : null,

    structuredJourneysDetected: isPaid
      ? snapshot.structuredJourneysDetected ?? null
      : null,

        /**
     * Behavioral depth (FT2-safe).
     * Free-tier visible (existence-only).
     */
    multiStepSessionsPresent:
      snapshot.multiStepSessionsPresent ?? null,

    /**
     * Surface breadth (FT2-safe).
     * Free-tier visible (existence-only).
     */
    surfaceBreadthPresent:
      snapshot.surfaceBreadthPresent ?? null,

    /**
     * Returning behavior (FT2-safe).
     * Free-tier visible (existence-only).
     */
    returningSessionsPresent:
      snapshot.returningSessionsPresent ?? null,

    // ───────── Trust Calibration ─────────
    dataCoverage:
      snapshot.dataCoverage ?? null,

    /**
     * Early exit without interaction (FT2-safe).
     * Free-tier visible (existence-only).
     */
    exitWithoutInteractionPresent:
      snapshot.exitWithoutInteractionPresent ?? null,

        /**
     * Average session depth (FT2-safe).
     * Free-tier visible (existence-only).
     */
    averageSessionDepthPresent:
      snapshot.averageSessionDepthPresent ?? null,

    // ───────── Entitlement Echo ─────────
    isPaid,
  };
}