import { demandRealityPlane } from './demandReality.plane.js';
import { engagementRevenuePlane } from './planes/engagementRevenue.plane.js';
import { operationalEconomicPlane } from './planes/operationalEconomic.plane.js';
import { ordersShippingCarrierPlane } from './planes/ordersShippingCarrier.plane.js';
import { orderVelocityFulfillmentPlane } from './planes/orderVelocityFulfillment.plane.js';
import { salesOperationsPlane } from './planes/salesOperations.plane.js';
import { shippingDelayCustomerPromisePlane } from './planes/shippingDelayCustomerPromise.plane.js';
import { shippingDelayFulfillmentCoherencePlane } from './planes/shippingDelayFulfillmentCoherence.plane.js';
import { shippingFulfillmentCoherencePlane } from './planes/shippingFulfillmentCoherence.plane.js';
/**
 * Alignment Plane Registry
 * -----------------------
 * Explicit wiring only.
 */
export const alignmentPlaneRegistry = [
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
