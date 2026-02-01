/**
 * ⚠️ FTEP COMPILER BOUNDARY
 * ------------------------
 * This function COMPiles L2 intelligence into FT2-safe exposure.
 *
 * Rules:
 * - Output MUST match FT2 types exactly
 * - No pass-through of intelligence structures
 * - No attribution, buckets, or causality
 *
 * Violations here silently corrupt FT2.
 */

// apps/backend/src/services/order-ftep/orderFtep.service.ts

/**
 * Order FTEP Service (Layer 3)
 * ----------------------------
 * Purpose:
 * - Enforce Truth Exposure Policy.
 *
 * Guarantees:
 * - Intelligence NEVER leaks directly
 * - No causation or explanations
 * - Deterministic downgrade only
 */

import type {
  FT2ObligationsExposure,
  OrderFtepInput,
  OrderNexusFT2Exposure,
} from './orderFtep.types';

export function exposeOrderNexusFT2(
  input: OrderFtepInput
): OrderNexusFT2Exposure {
  const { intelligence, facts } = input;

  const exposure: OrderNexusFT2Exposure = {
    context: {
      ordersObserved: facts.ordersObserved,
    },

  /**
   * FT2 Totals (Downgraded)
   * ----------------------
   * - Currency is NOT inferable in FT2 → must not be exposed.
   * - Totals are magnitude-only, observational.
   */
  totals: {
    revenueTotal: facts.totals.revenueTotal,
    /**
     * costTotal is a non-existent fact in Orders FT2.
     * Enforced null to prevent accidental upstream leakage.
     */
    costTotal: null,
  },

  /**
   * Data Coverage (FT2)
   * ------------------
   * Coverage is L1-gated.
   * Intelligence may compute usability, but FT2 exposes
   * downgraded factual coverage only.
   *
   * unknown → null (fail-closed)
   */
  dataCoverage: {
    completenessPct:
      facts.dataCoverage?.completenessPct ?? null,
  },

  visibility:
    intelligence.visibility.status === 'unknown'
      ? null
      : { status: intelligence.visibility.status },
};

  return exposure;
}

/**
 * FTEP — Obligation Downgrade
 * --------------------------
 * Downgrades L2 obligation intelligence into FT2-safe exposure.
 *
 * Hard rules:
 * - Full classification required
 * - Sums must match total blocked revenue
 * - Otherwise: fail closed
 */
export function downgradeObligations(
  revenueBlockedTotal: number | null,
  coverageStatus: 'sufficient' | 'insufficient',
): FT2ObligationsExposure {
  if (revenueBlockedTotal == null) {
    return {
      totalBlockedValue: null,
      coverage: { status: 'insufficient' },
    };
  }

  const round = (n: number) =>
    Math.round(n * 100) / 100;

  return {
    totalBlockedValue: round(revenueBlockedTotal),
    coverage: { status: coverageStatus },
  };
}
