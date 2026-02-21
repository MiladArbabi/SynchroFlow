// apps/backend/src/services/order-nexus-ft2/orderNexusFt2.resolver.ts
import { resolveAlignmentPlanes } from "../../services/alignment-planes/alignmentPlanes.resolver.js";
import { aggregateBlockedRevenue, aggregatePendingRevenue } from "../../services/order-execution-intelligence/blocker.aggregates.js";
import { extractOrderCustomerPromiseFacts } from "../../services/order-facts/orderCustomerPromiseFacts.service.js";
import { extractOrderFacts } from "../../services/order-facts/orderFacts.service.js";
import { extractOrderFulfillmentFacts } from "../../services/order-facts/orderFulfillmentFacts.service.js";
import { extractOrderFulfillmentStatusFacts } from "../../services/order-facts/orderFulfillmentStatusFacts.service.js";
import { extractRefundsFacts } from "../../services/order-facts/orderReturnsFacts.service.js";
import { extractOrderRevenueAllocationFacts } from "../../services/order-facts/orderRevenueAllocationFacts.service.js";
import { extractOrderShippingDelayFacts } from "../../services/order-facts/orderShippingDelayFacts.service.js";
import { extractOrderShippingFacts } from "../../services/order-facts/orderShippingFacts.service.js";
import { extractOrderTrendFacts } from "../../services/order-facts/orderTrendFacts.service.js";
import { exposeRefunds, exposeOrderNexusFT2 } from "../../services/order-ftep/orderFtep.service.js";
import { extractFulfilledOrdersCount } from "../../services/order-facts/orderFulfilledCountFacts.service.js";
import { extractActiveOrdersCount } from "../../services/order-facts/orderActiveCountFacts.service.js";
import { deriveOrderFulfillmentIntelligence } from "../../services/order-intelligence/orderFulfillmentIntelligence.service.js";
import { deriveOrderIntelligence } from "../../services/order-intelligence/orderIntelligence.service.js";
import { FT2DateRangePreset } from "@lasyncro/backend-core/utils/ft2Period.js";
import { pctChange } from "../../utils/pctChange.js";
import { OrderNexusFT2Snapshot } from "./orderNexusFt2.types.js";
import db from "@lasyncro/backend-core/db.js";

export async function getOrderNexusFt2Snapshot(input: {
  shopId: number;
  range: FT2DateRangePreset | { preset: 'custom'; from: string; to: string },
}): Promise<OrderNexusFT2Snapshot | null> {
const { shopId, range } = input;

// Step 1: Extract canonical order facts (Layer 1)
const facts = await extractOrderFacts(shopId, range);
const trendFacts = await extractOrderTrendFacts(shopId, range);
const intelligence = deriveOrderIntelligence(facts, trendFacts);

const revenueAllocationFacts =
  await extractOrderRevenueAllocationFacts(shopId, range);

const refundsFacts = await extractRefundsFacts(shopId);
const refundsExposure = exposeRefunds(refundsFacts);

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
const fulfillmentStatusFacts = await extractOrderFulfillmentStatusFacts(shopId, range);
const fulfilledOrders = await extractFulfilledOrdersCount(shopId);
const activeOrders = await extractActiveOrdersCount(shopId);

const shippingFacts = await extractOrderShippingFacts(shopId, range);
const shippingDelayFacts = await extractOrderShippingDelayFacts(shopId, range);
const fulfillmentIntelligence = deriveOrderFulfillmentIntelligence(
  fulfillmentFacts
);

const obligationFresh = null;
const executionCoverage =
  fulfillmentStatusFacts.visibility === 'sufficient' && obligationFresh
    ? 'sufficient'
    : 'insufficient';

const obligationCoverage =
  obligationFresh ? 'sufficient' : 'insufficient';

 const constrainedRevenueAgg =
  executionCoverage === 'sufficient'
    ? await aggregateBlockedRevenue(shopId)
    : null;

const pendingRevenueAgg =
  executionCoverage === 'sufficient'
    ? await aggregatePendingRevenue(shopId)
    : null;

  /**
   * NOTE:
   * -----
   * Obligations use obligationCoverage (freshness-based),
   * Revenue uses executionCoverage (execution + freshness).
   *
   * This is intentional:
   * - Obligations may be observable even when revenue is not.
   * - Revenue must never outpace obligation freshness.
  */

const customerPromiseFacts = await extractOrderCustomerPromiseFacts(shopId, range);

const previousTotal = trendFacts.previousWindowOrders ?? null;
const currentTotal = trendFacts.currentWindowOrders ?? null;

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

  const constrainedRow = await db('order_fulfillment_status as ofs')
  .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
  .where('o.shop_id', shopId)
  .where('ofs.status', '!=', 'fulfilled')
  .whereNotNull('ofs.inventory_block_type')
  .countDistinct<{ count: string }>('ofs.lasyncro_order_id as count')
  .first();

  const constrained =
    constrainedRow?.count != null
      ? Number(constrainedRow.count)
      : 0;

  const fulfilled = fulfilledOrders ?? 0;
  const unfulfilled = activeOrders ?? 0;
  const total = fulfilled + unfulfilled;

  return {
    ...exposure,

    ingestion: grounding.ingestion,
    freshness: grounding.freshness,
    revenueContinuity: grounding.revenueContinuity,

    refunds: refundsExposure,

    orders: {
      total,
      fulfilled,
      unfulfilled,
      constrained,
    },

    comparison: {
      orders: {
        fulfilledPctChange: null,
        unfulfilledPctChange: null,
        incomingPctChange: pctChange(previousTotal, currentTotal),
      },
    },

    revenue: {
      totalSales: exposure.totals.revenueTotal,

      earned:
        executionCoverage === 'sufficient'
          ? revenueAllocationFacts.fulfilledRevenueTotal
          : null,

      pending:
        executionCoverage === 'sufficient'
          ? pendingRevenueAgg?.pendingTotal ?? null
          : null,

      blocked:
        typeof constrainedRevenueAgg?.constrainedBlockedTotal === 'number'
          ? Math.round(constrainedRevenueAgg.constrainedBlockedTotal * 100) / 100
          : null,
    },

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