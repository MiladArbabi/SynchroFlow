// Order-Nexus FT2 Snapshot (Resolver Output)
//
// Composed of:
// - FTEP exposure (terminal truth)
// - FT2-adjacent realities (shipping, promise)
// - Alignment planes (read-only)
//
// This is NOT an FTEP type.
import type { OrderNexusFT2Exposure } from 'api-src/services/order-ftep/orderFtep.types';

export type OrderNexusFT2Snapshot =
  OrderNexusFT2Exposure & {

  orders: {
    total: number | null;
    fulfilled: number | null;
    unfulfilled: number | null;
    incoming: number | null;
  };

  comparison: {
    orders: {
      totalPctChange: number | null;
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

    // Explicit epistemic gate
    executionCoverage: 'sufficient' | 'insufficient';
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
}
