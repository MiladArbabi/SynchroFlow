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

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
    currency: string | null;
  };

  outcome: {
    status: 'positive' | 'negative';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat';
  } | null;

  dataCoverage: {
    completenessPct: number | null;
  };

  visibility: {
    status: 'sufficient' | 'insufficient';
  } | null;

  alignment?: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    /**
     * Operational ↔ Economic alignment
     * -------------------------------
     * Indicates whether economic order outcomes
     * are grounded in operational fulfillment reality.
     */
      operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
    };
}

/**
 * Input contract for FTEP
 */
export interface OrderFtepInput {
  facts: OrderFacts;
  intelligence: OrderNexusIntelligence;
}