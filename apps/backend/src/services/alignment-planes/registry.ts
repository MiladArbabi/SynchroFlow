import type { AlignmentPlane } from './alignmentPlane.types';
import { demandRealityPlane } from './demandReality.plane';
import { engagementRevenuePlane } from './planes/engagementRevenue.plane';
import { operationalEconomicPlane } from './planes/operationalEconomic.plane';
import { ordersShippingCarrierPlane } from './planes/ordersShippingCarrier.plane';
import { orderVelocityFulfillmentPlane } from './planes/orderVelocityFulfillment.plane';
import { salesOperationsPlane } from './planes/salesOperations.plane';
import { shippingDelayCustomerPromisePlane } from './planes/shippingDelayCustomerPromise.plane';
import { shippingDelayFulfillmentCoherencePlane } from './planes/shippingDelayFulfillmentCoherence.plane';
import { shippingFulfillmentCoherencePlane } from './planes/shippingFulfillmentCoherence.plane';

/**
 * Alignment Plane Registry
 * -----------------------
 * Explicit wiring only.
 */
export const alignmentPlaneRegistry: AlignmentPlane<any>[] = [
  demandRealityPlane,
  engagementRevenuePlane,
  operationalEconomicPlane,

  // FT2 — Execution coherence
  orderVelocityFulfillmentPlane,
  shippingFulfillmentCoherencePlane,

  // FT2 — Sales execution coherence
  salesOperationsPlane,

  ordersShippingCarrierPlane,

  shippingDelayFulfillmentCoherencePlane,

  // FT2 — Customer promise coherence
  shippingDelayCustomerPromisePlane,
];
