// apps/frontend/src/pages/customers/useCustomersFt2Adapter.ts
import type { CustomersModuleFT2Props } from '@lasyncro/customers';
import type { CustomersFT2Contract } from '@lasyncro/customers';

const NULL_SIGNALS: CustomersFT2Contract['signals'] = {
  exitIntentDetected: null,
  funnelsDetected: null,
  multiStepSessionsPresent: null,
  surfaceBreadthPresent: null,
  returningSessionsPresent: null,
  exitWithoutInteractionPresent: null,
  averageSessionDepthPresent: null,
};

/**
 * mapCustomersFt2Props
 * -------------------
 * Canonical Customers FT2 adapter.
 *
 * Invariants:
 * - Pipe-only (no inference, no defaults)
 * - undefined → null normalization
 * - Output shape matches CustomersModuleFT2Props exactly
 */
export function mapCustomersFt2Props(
  snapshot: CustomersFT2Contract
): CustomersModuleFT2Props {

  const signals =
    snapshot.signals ?? NULL_SIGNALS;

  return {
    // ── Domain 2 — Activity Presence ─────────
    sessionsPresent: snapshot.context.sessionsPresent ?? null,

    // ── Direction (always null in Customers FT2) ──
    activityDirection: null,

    // ── Structural Signals (FT2-safe passthrough) ──
    exitIntentDetected: signals.exitIntentDetected,
    funnelsDetected: signals.funnelsDetected,
    multiStepSessionsPresent: signals.multiStepSessionsPresent,
    surfaceBreadthPresent: signals.surfaceBreadthPresent,
    returningSessionsPresent: signals.returningSessionsPresent,
    exitWithoutInteractionPresent:
      signals.exitWithoutInteractionPresent,
    averageSessionDepthPresent:
      signals.averageSessionDepthPresent,

    // ── Coverage ─────────────────────────────
    dataCoverage: snapshot.dataCoverage ?? null,
  };
}
