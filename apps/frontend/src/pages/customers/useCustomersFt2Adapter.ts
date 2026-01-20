// apps/frontend/src/pages/customers/useCustomersFt2Adapter.ts

import type { CustomersModuleFT2Props } from '@lasyncro/customers';
import type { CustomersFT2Contract } from '@lasyncro/customers';

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

  return {
    // ── Context ──────────────────────────
    period: snapshot.context.period ?? null,
    sessionsPresent: snapshot.context.sessionsPresent ?? null,

    // ── Direction ────────────────────────
    activityDirection: snapshot.activityDirection ?? null,

    // ── Structural Signals ───────────────
    exitIntentDetected: snapshot.signals.exitIntentDetected ?? null,
    funnelsDetected: snapshot.signals.funnelsDetected ?? null,
    multiStepSessionsPresent: snapshot.signals.multiStepSessionsPresent ?? null,
    surfaceBreadthPresent: snapshot.signals.surfaceBreadthPresent ?? null,
    returningSessionsPresent: snapshot.signals.returningSessionsPresent ?? null,
    exitWithoutInteractionPresent:
      snapshot.signals.exitWithoutInteractionPresent ?? null,
    averageSessionDepthPresent:
      snapshot.signals.averageSessionDepthPresent ?? null,

    // ── Coverage ─────────────────────────
    dataCoverage: snapshot.dataCoverage ?? null,
  };
}