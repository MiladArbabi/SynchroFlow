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
    /**
     * Domain 2 — Activity Presence Reality
     *
     * Customers FT2 consumes Specter activity directly.
     * Sessions are the existence proxy.
     */
    sessionsPresent: snapshot.context.sessionsPresent ?? null,

    // ── Direction ────────────────────────
    activityDirection: null,

    // ── Structural Signals (Specter FT2 passthrough) ─────────
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
    dataCoverage: snapshot.dataCoverage ?? null
  };
}