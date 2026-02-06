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
  FT2RefundsExposure
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
 * FTEP — Refunds Downgrade (FT2)
 * -----------------------------
 * Rules:
 * - Refunds are post-execution financial regression
 * - No eligibility impact
 * - No intelligence
 * - Pure passthrough of L1 facts
 *
 * Semantics:
 * - null  → epistemic absence
 * - 0     → observed zero
 */
export function exposeRefunds(
  input: {
    returnedRevenue: number | null;
    returnedUnits: number | null;
    affectedOrders: number | null;
  } | null
): FT2RefundsExposure | null {

  if (input == null) {
    return null;
  }

  return {
    returnedRevenue: input.returnedRevenue ?? null,
    returnedUnits: input.returnedUnits ?? null,
    affectedOrders: input.affectedOrders ?? null,
  };
}

/**
 * FTEP — Obligation Downgrade (FT2)
 * --------------------------------
 * Rules:
 * - Eligibility is explicit and independent
 * - Constrained value of 0 is meaningful if eligible
 * - Null means epistemically unavailable
 */
export function downgradeObligations(
  constrainedBlockedTotal: number | null,
  coverageStatus: 'sufficient' | 'insufficient',
): FT2ObligationsExposure {
  // Epistemic absence: cannot reason about obligations
  if (constrainedBlockedTotal == null) {
    return {
      totalBlockedValue: null,
      eligibility: { status: 'ineligible' },
      coverage: { status: 'insufficient' },
    };
  }

  // Eligible whenever constrained value is explicitly computed
  return {
    totalBlockedValue: Math.round(constrainedBlockedTotal * 100) / 100,
    eligibility: { status: 'eligible' },
    coverage: { status: coverageStatus },
  };
}