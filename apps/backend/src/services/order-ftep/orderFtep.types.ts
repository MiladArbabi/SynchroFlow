//apps/backend/src/services/order-ftep/orderFtep.types.ts
import type { OrderNexusIntelligence } from '../order-intelligence/orderIntelligence.service.js';
import type { OrderFacts } from '../order-facts/orderFacts.types.js';

/**
 * FTEP Input Contract
 * ------------------
 * Explicit boundary between intelligence and exposure.
 *
 * Rules:
 * - Intelligence may be incomplete or null
 * - Facts are L1 only
 * - No exposure logic allowed upstream
 */
export type OrderFtepInput = {
  intelligence: OrderNexusIntelligence;
  facts: OrderFacts;
};

/**
 * FT2 Exposure (Observability Only)
 * --------------------------------
 * No causation. No recommendations. No explanations.
 */
export interface OrderNexusFT2Exposure {
  context: {
    ordersObserved: number | null;
  };

  /**
   * FT2 Totals (Downgraded)
   * ----------------------
   * - Magnitude-only
   * - Currency is NOT inferable in FT2 and must never appear here
   */
  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
  };

  /**
   * Data Coverage (FT2)
   * ------------------
   * - Sourced from L1 facts only
   * - Intelligence usability must never surface here
   * - unknown → null (fail-closed)
   */
  dataCoverage: {
    completenessPct: number | null;
  };

  visibility: {
    status: 'sufficient' | 'insufficient';
  } | null;

  /**
   * Refunds — FT2 (Post-Execution Regression)
   * ----------------------------------------
   * Financial-only.
   * Observed-only.
   * No intelligence.
   * No eligibility impact.
   */
  refunds?: FT2RefundsExposure | null;
}

/**
 * FT2 Obligations Exposure
 * -----------------------
 * Eligibility is explicit to avoid semantic ambiguity:
 * - eligible = true  → constrained value is meaningful (may be 0)
 * - eligible = false → do not reason over this signal
 */
export type FT2ObligationsExposure = {
  totalBlockedValue: number | null;

  eligibility: {
    status: 'eligible' | 'ineligible';
  };

  coverage: {
    status: 'sufficient' | 'insufficient';
  };
};

/**
 * FT2 Refunds Exposure
 * --------------------
 * Pure financial regression caused by refunds.
 *
 * Rules:
 * - Layer 1 facts only
 * - No intelligence input
 * - No execution semantics
 * - null = epistemic absence
 * - 0 = observed zero
 */
export type FT2RefundsExposure = {
  returnedRevenue: number | null;
  returnedUnits: number | null;
  affectedOrders: number | null;
};

