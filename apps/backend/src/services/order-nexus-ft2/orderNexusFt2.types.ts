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
