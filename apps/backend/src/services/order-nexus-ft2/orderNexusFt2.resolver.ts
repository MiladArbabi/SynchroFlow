// apps/backend/src/services/order-nexus-ft2/orderNexusFt2.resolver.ts
import { extractOrderFacts } from 'api-src/services/order-facts/orderFacts.service';
import { downgradeObligations, exposeOrderNexusFT2 } from 'api-src/services/order-ftep/orderFtep.service';
import { resolveAlignmentPlanes } from 'api-src/services/alignment-planes/alignmentPlanes.resolver';
import { extractOrderShippingFacts } from '../order-facts/orderShippingFacts.service';
import { extractOrderFulfillmentStatusFacts } from '../order-facts/orderFulfillmentStatusFacts.service';
import { extractOrderShippingDelayFacts } from '../order-facts/orderShippingDelayFacts.service';
import { extractOrderTrendFacts } from 'api-src/services/order-facts/orderTrendFacts.service';
import { extractOrderFulfillmentFacts } from '../order-facts/orderFulfillmentFacts.service';
import { extractFulfilledOrdersCount } from '../order-facts/orderFulfilledCountFacts.service';
import { extractOrderRevenueAllocationFacts } from
  'api-src/services/order-facts/orderRevenueAllocationFacts.service';

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

import type { OrderNexusFT2Snapshot } from './orderNexusFt2.types';
import { FT2DateRangePreset } from 'api-src/utils/ft2Period';
import { deriveOrderIntelligence } from 'api-src/services/order-intelligence/orderIntelligence.service';
import { deriveOrderFulfillmentIntelligence } from '../order-intelligence/orderFulfillmentIntelligence.service';
import { extractOrderCustomerPromiseFacts } from '../order-facts/orderCustomerPromiseFacts.service';

import { pctChange } from 'api-src/utils/pctChange';
import { aggregateBlockedRevenue, classifyBlockedRevenue } from '../order-execution-intelligence/blocker.aggregates';

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
}): Promise<OrderNexusFT2Snapshot | null> {
  const { shopId, range } = input;

// Step 1: Extract canonical order facts (Layer 1)
const facts = await extractOrderFacts(shopId, range);
const trendFacts = await extractOrderTrendFacts(shopId, range);
const intelligence = deriveOrderIntelligence(facts, trendFacts);

const fulfilledOrders = await extractFulfilledOrdersCount(shopId);
const revenueAllocationFacts =
  await extractOrderRevenueAllocationFacts(shopId, range);

/**
  * IMPORTANT:
  * -----------
  * This resolver assumes:
  * - Trust FT2 is enforced by the caller (e.g. Overview FT2)
  * - FT2 Completion is checked upstream
  *
  * This resolver MUST remain deterministic and throw-free.
  */

// Step 2: Downgrade intelligence via FTEP
const exposure = exposeOrderNexusFT2({ facts, intelligence });

if (!exposure) {
  return null;
}

/**
 * FT2 Grounding Realities (L1 / L1½)
 * --------------------------------
 * Presence & classification only.
 * Bypass FTEP by design.
 */
const grounding = {
  ingestion: facts.ingestion,
  freshness: facts.freshness,
  revenueContinuity:
    trendFacts.revenueContinuity === null
      ? null
      : { status: trendFacts.revenueContinuity },
};

const fulfillmentFacts = await extractOrderFulfillmentFacts(shopId, range);
const fulfillmentStatusFacts =
  await extractOrderFulfillmentStatusFacts(shopId, range);
const shippingFacts = await extractOrderShippingFacts(shopId, range);
const shippingDelayFacts = await extractOrderShippingDelayFacts(shopId, range);
const fulfillmentIntelligence = deriveOrderFulfillmentIntelligence(
  fulfillmentFacts
);

const executionCoverage =
  fulfillmentStatusFacts.visibility === 'sufficient'
    ? 'sufficient'
    : 'insufficient';

 const blockedRevenueAgg =
   executionCoverage === 'sufficient'
     ? await aggregateBlockedRevenue(shopId)
     : null;
     
const obligationClassification =
  executionCoverage === 'sufficient'
    ? await classifyBlockedRevenue(shopId)
    : null;

const obligations = downgradeObligations(
  obligationClassification,
  blockedRevenueAgg
    ? blockedRevenueAgg.totalBlocked
    : null
);

const unfulfilledOrders =
  fulfillmentFacts.visibility !== 'sufficient'
    ? null
    : facts.ordersObserved == null || fulfilledOrders == null
      ? null
      : Math.max(facts.ordersObserved - fulfilledOrders, 0);

const customerPromiseFacts = await extractOrderCustomerPromiseFacts(shopId, range);

const previousTotal = trendFacts.previousWindowOrders ?? null;
const currentTotal = trendFacts.currentWindowOrders ?? null;

const previousIncoming = trendFacts.previousWindowOrders ?? null;
const currentIncoming = trendFacts.currentWindowOrders ?? null;

const incomingOrders = trendFacts.currentWindowOrders ?? null;

const comparison = {
  orders: {
    totalPctChange: pctChange(previousTotal, currentTotal),

    // BLOCKED:
    // No historical fulfillment state snapshots exist.
    // Any comparison here would fabricate change.
    fulfilledPctChange: null,
    unfulfilledPctChange: null,

    incomingPctChange: pctChange(previousIncoming, currentIncoming),
  },
};

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

        customerPromiseFacts.visibility,
      ],
    },

    planes: [
      // Plane #1 — Shipping ↔ Fulfillment Coherence
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

      // Plane #2 — Orders ↔ Shipping Carrier
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

      // Plane #3 — Shipping Delay ↔ Fulfillment Coherence
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

      // Plane #4 — Shipping Delay ↔ Customer Promise
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

  console.log(
    '[FT2 DEBUG] revenue.blocked =',
    typeof blockedRevenueAgg?.totalBlocked,
    blockedRevenueAgg?.totalBlocked
  );

  // ─────────────────────────────────────────────
  // STEP 4 — FT2 Snapshot Composition (Read-Only)
  // ---------------------------------------------
  // This step MAY:
  // - Attach FT2-adjacent realities (shipping, promise)
  // - Attach alignment classifications
  //
  // This step MUST NOT:
  // - Read intelligence
  // - Infer semantics
  // - Upgrade truth
  return {
    ...exposure,

    ingestion: grounding.ingestion,
    freshness: grounding.freshness,
    revenueContinuity: grounding.revenueContinuity,

    orders: {
      total: facts.ordersObserved,
      fulfilled: fulfilledOrders,
      unfulfilled: unfulfilledOrders,
      incoming: incomingOrders,
    },

   /**
     * Revenue Overview (FT2)
     * ---------------------
     * - totalSales: execution-agnostic availability
     * - earned/pending: execution-derived, coverage-gated
     * - blocked: no primitive → null
     */
    revenue: {
      totalSales: exposure.totals.revenueTotal,

      earned:
        executionCoverage === 'sufficient'
          ? revenueAllocationFacts.fulfilledRevenueTotal
          : null,

      pending:
        executionCoverage === 'sufficient'
          ? Math.max(
              (revenueAllocationFacts.unfulfilledRevenueTotal ?? 0)
              - (blockedRevenueAgg?.totalBlocked ?? 0),
              0
            )
          : null,

      blocked: blockedRevenueAgg?.totalBlocked ?? null,

      executionCoverage,
    },

    obligations,

    comparison,

    /**
     * FT2-ADJACENT REALITIES
     * ---------------------
     * These signals bypass FTEP by design.
     * They are presence-only and non-inferential.
     *
     * They MUST NOT influence:
     * - outcome
     * - trend
     * - visibility
     */

    /**
     * FT2-ADJACENT VISIBILITY PASSTHROUGH
     * ----------------------------------
     * Shipping + Customer Promise are L1 presence realities.
     *
     * Rules:
     * - They bypass FTEP by design.
     * - Visibility is presence-based, not epistemic intelligence.
     * - They MUST NOT influence outcome, trend, or visibility.
     *
     * This passthrough is intentional and contract-approved.
     */

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
      // Customer Promise Reality
      customerPromise: {
        signal: customerPromiseFacts.promiseSignal,
        visibility: customerPromiseFacts.visibility,
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
  };
}