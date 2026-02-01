//apps/backend/src/services/order-ftep/orderFtep.types.ts
// apps/backend/src/services/order-ftep/orderFtep.types.ts
import type { OrderNexusIntelligence } from '../order-intelligence/orderIntelligence.service';
import type { OrderFacts } from '../order-facts/orderFacts.types';

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
}

/**
 * Input contract for FTEP
 */
export type FT2ObligationsExposure = {
  /**
   * FT2 Obligations (Aggregate Only)
   * --------------------------------
   * - Magnitude-only blocked revenue signal
   * - No attribution, causality, or category exposure
   */
  totalBlockedValue: number | null;

  coverage: {
    status: 'sufficient' | 'insufficient';
  };
};

