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