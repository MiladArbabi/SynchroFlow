/**
 * ⚠️ FT2 CONTRACT — READ-ONLY, AGGREGATE-ONLY
 * ------------------------------------------
 * This file defines TERMINAL FT2 exposure types.
 *
 * HARD RULES:
 * - No attribution
 * - No causality
 * - No category breakdowns
 * - No execution intelligence
 *
 * If a field answers "why" instead of "what",
 * it does NOT belong here.
 */

import { OrderNexusFT2Exposure } from "../../services/order-ftep/index.js";

// Order-Nexus FT2 Snapshot (Resolver Output)
//
// Composed of:
// - FTEP exposure (terminal truth)
// - FT2-adjacent realities (shipping, promise)
// - Alignment planes (read-only)
//
// This is NOT an FTEP type.


export type OrderNexusFT2Snapshot =
  OrderNexusFT2Exposure & {

  orders: {
    active: number | null;
    fulfilled: number | null;
    added: number | null;
  };

  comparison: {
    orders: {
      // No total comparison — active orders are state-based

      fulfilledPctChange: number | null;
      unfulfilledPctChange: number | null;
      incomingPctChange: number | null;
    };
  };

  /**
   * Revenue Overview (FT2)
   * ---------------------
   * OBSERVED-ONLY revenue.
   *
   * Contract:
   * - Availability-based revenue derived from canonical orders
   * - Execution state only used for L2 allocation, never surfaced
   * - No fulfillment, payment, or settlement semantics
   *
   * - Execution-aware revenue MUST NOT appear here
   * - Allocation by fulfillment state is Phase 6 only
   */
  revenue: {
    totalSales: number | null;

    // Execution-derived, coverage-gated
    earned: number | null;
    pending: number | null;

    // No factual primitive yet
    blocked: number | null;
  }

  ingestion: {
    status: 'present' | 'absent';
  } | null;

  freshness: {
    status: 'recent' | 'stale' | 'unknown';
  } | null;

  revenueContinuity:
    | { status: 'isolated' | 'continuous' }
    | null;
    
  shipping: {
    signal: 'present' | 'absent';
    visibility: 'sufficient' | 'insufficient';
    shippingDelay: {
      signal: 'present' | 'absent';
      visibility: 'sufficient' | 'insufficient';
    };
    customerPromise: {
      signal: 'present' | 'absent';
      visibility: 'sufficient' | 'insufficient';
    };
  };

  alignment: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
    orderVelocityFulfillment?: 'aligned' | 'divergent' | 'unknown';
    shippingFulfillmentCoherence?: 'aligned' | 'divergent' | 'unknown';
    ordersShippingCarrier?: 'aligned' | 'divergent' | 'unknown';
    salesOperations?: 'aligned' | 'divergent' | 'unknown';
    shippingDelayFulfillmentCoherence?: 'aligned' | 'divergent' | 'unknown';
    shippingDelayCustomerPromise?: 'aligned' | 'divergent' | 'unknown';
  };

  obligations?: {
    /**
     * FT2 Obligations (Aggregate Only)
     * --------------------------------
     * - totalBlockedValue: magnitude-only signal
     * - No attribution, causality, or category exposure
     */
    totalBlockedValue: number | null;

    coverage: { status: 'sufficient' | 'insufficient' };
  };
}
