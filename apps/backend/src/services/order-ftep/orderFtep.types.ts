//apps/backend/src/services/order-ftep/orderFtep.types.ts
// apps/backend/src/services/order-ftep/orderFtep.types.ts
import type { OrderNexusIntelligence } from '../order-intelligence/orderIntelligence.service';
import type { OrderFacts } from '../order-facts/orderFacts.types';

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
export interface OrderFtepInput {
  facts: OrderFacts;
  intelligence: OrderNexusIntelligence;
}