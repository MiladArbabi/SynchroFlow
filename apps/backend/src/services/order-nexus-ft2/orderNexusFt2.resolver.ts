// apps/backend/src/services/order-nexus-ft2/orderNexusFt2.resolver.ts
import { extractOrderFacts } from 'api-src/services/order-facts/orderFacts.service';
import { exposeOrderNexusFT2 } from 'api-src/services/order-ftep/orderFtep.service';
import { resolveAlignmentPlanes } from 'api-src/services/alignment-planes/alignmentPlanes.resolver';
import { extractOrderShippingFacts } from '../order-facts/orderShippingFacts.service';
import { extractOrderFulfillmentStatusFacts } from '../order-facts/orderFulfillmentStatusFacts.service';
import { extractOrderShippingDelayFacts } from '../order-facts/orderShippingDelayFacts.service';
import { extractOrderTrendFacts } from 'api-src/services/order-facts/orderTrendFacts.service';
import { extractOrderFulfillmentFacts } from '../order-facts/orderFulfillmentFacts.service';

/**
 * NOTE ON TREND WIRING
 * -------------------
 * Trend inputs are canonical facts (Layer 1½),
 * not analytical time-series.
 *
 * The resolver orchestrates:
 * - Facts
 * - Trend Facts
 * - Intelligence
 * - FTEP
 *
 * No analytical surfaces feed intelligence.
 */

import type { OrderNexusFT2Exposure } from 'api-src/services/order-ftep/orderFtep.types';
import { FT2DateRangePreset } from 'api-src/utils/ft2Period';
import { deriveOrderIntelligence } from 'api-src/services/order-intelligence/orderIntelligence.service';
import { deriveOrderFulfillmentIntelligence } from '../order-intelligence/orderFulfillmentIntelligence.service';
import { deriveOrderVelocityReality } from '../order-intelligence/orderVelocityIntelligence.service';
import { extractOrderCustomerPromiseFacts } from '../order-facts/orderCustomerPromiseFacts.service';

/**
 * OrderNexus FT2 Resolver
 * ----------------------
 * Orchestrates:
 *   Facts → Intelligence → FTEP
 *
 * Rules:
 * - No lifecycle logic
 * - No business logic
 * - Deterministic for identical inputs
 */
export async function getOrderNexusFt2Snapshot(input: {
  shopId: number;
  range: FT2DateRangePreset | { preset: 'custom'; from: string; to: string },
}): Promise<OrderNexusFT2Exposure> {
  const { shopId, range } = input;

// Step 1: Extract canonical order facts (Layer 1)
const facts = await extractOrderFacts(shopId, range);

const trendFacts = await extractOrderTrendFacts(shopId, range);
const orderVelocity = deriveOrderVelocityReality(trendFacts);

const intelligence = deriveOrderIntelligence(facts, trendFacts);

// Step 4: Downgrade intelligence via FTEP
const exposure = exposeOrderNexusFT2({ facts, intelligence });

const fulfillmentFacts = await extractOrderFulfillmentFacts(shopId, range);
const fulfillmentStatusFacts =
  await extractOrderFulfillmentStatusFacts(shopId, range);
const shippingFacts = await extractOrderShippingFacts(shopId, range);
const shippingDelayFacts = await extractOrderShippingDelayFacts(shopId, range);
const fulfillmentIntelligence = deriveOrderFulfillmentIntelligence(
  fulfillmentFacts
);

const customerPromiseFacts = await extractOrderCustomerPromiseFacts(shopId, range);

  // ─────────────────────────────────────────────
  // Alignment Planes (META + Plane Inputs)
  // ─────────────────────────────────────────────
  const alignment = resolveAlignmentPlanes({
    meta: {
      visibilities: [
        intelligence.visibility.status === 'unknown'
          ? null
          : intelligence.visibility.status,

        fulfillmentIntelligence.visibility === 'unknown'
          ? null
          : fulfillmentIntelligence.visibility,
      ],
    },

    planes: [
      // Plane #1 — Demand Reality (Customers ↔ Orders)
      {
        planeId: 'demand-reality',
        input: {
          customers: {
            engagementTrend: null, // wired later from Specter
            visibility: null,
          },
          orders: {
            trend: intelligence.trend.direction,
            outcome: exposure.outcome?.status ?? null,
            visibility:
              intelligence.visibility.status === 'unknown'
                ? null
                : intelligence.visibility.status,
          },
        },
      },

      // Plane #2 — Engagement ↔ Revenue (Customers ↔ Orders)
      {
        planeId: 'engagement-revenue',
        input: {
          customers: {
            engagementTrend: null, // wired later from Specter
            visibility: null,
          },
          orders: {
            outcome: exposure.outcome?.status ?? null,
            visibility:
              intelligence.visibility.status === 'unknown'
                ? null
                : intelligence.visibility.status,
          },
        },
      },

      // Plane #3 — Operational ↔ Economic (Orders ↔ Fulfillment)
      {
        planeId: 'operational-economic',
        input: {
          orders: {
            outcome: exposure.outcome?.status ?? null,
            visibility:
              intelligence.visibility.status === 'unknown'
                ? null
                : intelligence.visibility.status,
          },
          fulfillment: {
            operationalReality: fulfillmentIntelligence.operationalReality,
            visibility:
              fulfillmentIntelligence.visibility === 'unknown'
                ? null
                : fulfillmentIntelligence.visibility,
          },
        },
      },
      
      // Plane #4 — Order Velocity ↔ Fulfillment
      {
        planeId: 'order-velocity-fulfillment',
        input: {
          orders: {
            velocity: orderVelocity,
            visibility:
              intelligence.visibility.status === 'unknown'
                ? null
                : intelligence.visibility.status,
          },
          fulfillment: {
            operationalReality: fulfillmentIntelligence.operationalReality,
            visibility:
              fulfillmentIntelligence.visibility === 'unknown'
                ? null
                : fulfillmentIntelligence.visibility,
          },
        },
      },

      // Plane #5 — Shipping ↔ Fulfillment Coherence
      {
        planeId: 'shipping-fulfillment-coherence',
        input: {
          fulfillment: {
            operationalReality: fulfillmentIntelligence.operationalReality,
            visibility:
              fulfillmentIntelligence.visibility === 'unknown'
                ? null
                : fulfillmentIntelligence.visibility,
          },
          shipping: {
            signal: shippingFacts.shippingSignal,
            visibility: shippingFacts.visibility,
          },
        },
      },

      /**
       * Fulfillment Status Reality (L1)
       * ------------------------------
       * 'absent' indicates no fulfillment records,
       * not an execution state → mapped to null.
       */
      // Plane #6 — Sales ↔ Operations
      {
        planeId: 'sales-operations',
        input: {
          orders: {
            velocity: orderVelocity,
            visibility:
              intelligence.visibility.status === 'unknown'
                ? null
                : intelligence.visibility.status,
          },
          fulfillment: {
            status:
              fulfillmentStatusFacts.fulfillmentStatus === 'absent'
                ? null
                : fulfillmentStatusFacts.fulfillmentStatus,

            visibility: fulfillmentStatusFacts.visibility,
          },
        },
      },

      // Plane #7 — Orders ↔ Shipping Carrier
      {
        planeId: 'orders-shipping-carrier',
        input: {
          orders: {
            fulfillmentStatus:
              fulfillmentStatusFacts.fulfillmentStatus === 'absent'
                ? null
                : fulfillmentStatusFacts.fulfillmentStatus,
            visibility: fulfillmentStatusFacts.visibility,
          },
          shipping: {
            signal: shippingFacts.shippingSignal,
            visibility: shippingFacts.visibility,
          },
        },
      },

      // Plane #8 — Shipping Delay ↔ Fulfillment Coherence
      {
        planeId: 'shipping-delay-fulfillment-coherence',
        input: {
          fulfillment: {
            operationalReality: fulfillmentIntelligence.operationalReality,
            visibility:
              fulfillmentIntelligence.visibility === 'unknown'
                ? null
                : fulfillmentIntelligence.visibility,
          },
          shippingDelay: {
            signal: shippingDelayFacts.delaySignal,
            visibility: shippingDelayFacts.visibility,
          },
        },
      },

      // Plane #9 — Shipping Delay ↔ Customer Promise
      {
        planeId: 'shipping-delay-customer-promise',
        input: {
          shippingDelay: {
            signal: shippingDelayFacts.delaySignal,
            visibility: shippingDelayFacts.visibility,
          },
          customerPromise: {
            signal: customerPromiseFacts.promiseSignal,
            visibility: customerPromiseFacts.visibility,
          },
        },
      },
    ],
  });

    return {
    ...exposure,

    orderVelocity:
    orderVelocity === 'unknown'
      ? null
      : { direction: orderVelocity },

    /**
     * Shipping Reality (L1 → FT2)
     * --------------------------
     * Shipping facts do not emit 'unknown'.
     * Absence is represented as:
     *   signal = 'absent'
     *   visibility = 'insufficient'
     *
     * FT2 passes visibility through without downgrading.
     */

    shipping: {
      signal: shippingFacts.shippingSignal,
      visibility: shippingFacts.visibility,
      /**
       * Shipping Delay Reality (L1 → FT2)
       * --------------------------------
       * Presence-only exposure.
       *
       * No timing, no SLA, no explanation.
       */
      shippingDelay: {
        signal: shippingDelayFacts.delaySignal,
        visibility: shippingDelayFacts.visibility,
      },
    },

    alignment: {
      demandReality: alignment['demand-reality'],
      engagementRevenue: alignment['engagement-revenue'],
      operationalEconomic: alignment['operational-economic'],

      // FT2 — Execution coherence
      orderVelocityFulfillment:
        alignment['order-velocity-fulfillment'],

      shippingFulfillmentCoherence:
        alignment['shipping-fulfillment-coherence'],

      //Orders ↔ Shipping Carrier
      ordersShippingCarrier: alignment['orders-shipping-carrier'],
      
      salesOperations: alignment['sales-operations'],

      shippingDelayFulfillmentCoherence:
        alignment['shipping-delay-fulfillment-coherence'],
      
      shippingDelayCustomerPromise:
        alignment['shipping-delay-customer-promise'],
    },

    // Customer Promise Reality
    customerPromise: {
      signal: customerPromiseFacts.promiseSignal,
      visibility: customerPromiseFacts.visibility,
    },
  };
}