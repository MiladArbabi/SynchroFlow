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

  orderVelocity?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  dataCoverage: {
    completenessPct: number | null;
  };

  visibility: {
    status: 'sufficient' | 'insufficient';
  } | null;

  fulfillmentStatus?: {
    status: 'fulfilled' | 'partial' | 'unfulfilled';
  } | null;

  /**
   * Shipping Reality (FT2)
   * ---------------------
   * Downgraded exposure of L1 shipping presence facts.
   *
   * Semantics:
   * - signal = presence only
   * - visibility gates usage
   *
   * No delivery state, no SLA, no lifecycle meaning.
   */
  shipping?: {
    signal: 'present' | 'absent';
    visibility: 'sufficient' | 'insufficient';
    /**
     * Shipping Delay Reality (FT2)
     * ----------------------------
     * Downgraded exposure of L1 shipping delay presence facts.
     *
     * Semantics:
     * - signal = presence only
     * - visibility gates usage
     *
     * No SLA, no duration, no blame.
     */
    shippingDelay?: {
      signal: 'present' | 'absent';
      visibility: 'sufficient' | 'insufficient';
    };

    /**
     * Customer Promise Reality (FT2)
     * ------------------------------
     * Downgraded exposure of L1 customer delivery promise presence.
     *
     * Presence-only.
     * No SLA, no timing, no fulfillment comparison.
     */
    customerPromise?: {
      signal: 'present' | 'absent';
      visibility: 'sufficient' | 'insufficient';
    };
  };


  alignment?: {
    /**
     * Customers ↔ Orders demand alignment
     */
    demandReality?: 'aligned' | 'divergent' | 'unknown';

    /**
     * Engagement ↔ Revenue alignment
     */
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';

    /**
     * Operational ↔ Economic alignment
     */
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';

    /**
     * Order velocity ↔ fulfillment coherence
     */
    orderVelocityFulfillment?: 'aligned' | 'divergent' | 'unknown';

    /**
     * Shipping ↔ fulfillment coherence
     */
    shippingFulfillmentCoherence?: 'aligned' | 'divergent' | 'unknown';

    ordersShippingCarrier?: 'aligned' | 'divergent' | 'unknown';

    /**
     * Sales ↔ Operations execution coherence
     */
    salesOperations?: 'aligned' | 'divergent' | 'unknown';

    /**
     * Shipping delay ↔ fulfillment execution coherence
     */
    shippingDelayFulfillmentCoherence?: 'aligned' | 'divergent' | 'unknown';

    /**
     * Shipping delay ↔ customer promise coherence
     */
    shippingDelayCustomerPromise?: 'aligned' | 'divergent' | 'unknown';

  };

}

/**
 * Input contract for FTEP
 */
export interface OrderFtepInput {
  facts: OrderFacts;
  intelligence: OrderNexusIntelligence;
}