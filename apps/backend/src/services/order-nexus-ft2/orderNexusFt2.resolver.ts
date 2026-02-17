// apps/backend/src/services/order-nexus-ft2/orderNexusFt2.resolver.ts
import { resolveAlignmentPlanes } from "../../services/alignment-planes/alignmentPlanes.resolver.js";
import { aggregateBlockedRevenue, aggregatePendingRevenue } from "../../services/order-execution-intelligence/blocker.aggregates.js";
import { extractActiveOrdersCount } from "../../services/order-facts/orderActiveCountFacts.service.js";
import { extractOrderCustomerPromiseFacts } from "../../services/order-facts/orderCustomerPromiseFacts.service.js";
import { extractOrderFacts } from "../../services/order-facts/orderFacts.service.js";
import { extractFulfilledOrdersCount } from "../../services/order-facts/orderFulfilledCountFacts.service.js";
import { extractOrderFulfillmentFacts } from "../../services/order-facts/orderFulfillmentFacts.service.js";
import { extractOrderFulfillmentStatusFacts } from "../../services/order-facts/orderFulfillmentStatusFacts.service.js";
import { extractRefundsFacts } from "../../services/order-facts/orderReturnsFacts.service.js";
import { extractOrderRevenueAllocationFacts } from "../../services/order-facts/orderRevenueAllocationFacts.service.js";
import { extractOrderShippingDelayFacts } from "../../services/order-facts/orderShippingDelayFacts.service.js";
import { extractOrderShippingFacts } from "../../services/order-facts/orderShippingFacts.service.js";
import { extractOrderTrendFacts } from "../../services/order-facts/orderTrendFacts.service.js";
import { exposeRefunds, exposeOrderNexusFT2 } from "../../services/order-ftep/orderFtep.service.js";
import { deriveOrderFulfillmentIntelligence } from "../../services/order-intelligence/orderFulfillmentIntelligence.service.js";
import { deriveOrderIntelligence } from "../../services/order-intelligence/orderIntelligence.service.js";
import { FT2DateRangePreset } from "@lasyncro/backend-core/utils/ft2Period.js";
import { pctChange } from "../../utils/pctChange.js";
import { OrderNexusFT2Snapshot } from "./orderNexusFt2.types.js";

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


// ⚠️ FT2 RESOLVER BOUNDARY
// Allowed: aggregate-only downgrade helpers
// Forbidden: classifiers, intelligence, attribution

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
const activeOrders = await extractActiveOrdersCount(shopId);

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
const shippingFacts = await extractOrderShippingFacts(shopId, range);
const shippingDelayFacts = await extractOrderShippingDelayFacts(shopId, range);
const fulfillmentIntelligence = deriveOrderFulfillmentIntelligence(
  fulfillmentFacts
);

/**
 * Obligation Freshness Gate (FT2)
 * ------------------------------
 * FT2 may only expose constrained value if:
 * - execution coverage is sufficient
 * - obligation signals were evaluated recently
 */
/* const obligationFreshnessRow = await db('order_fulfillment_status')
  .where('shop_id', shopId)
  .max('obligation_evaluated_at as last_eval')
  .first<{ last_eval: Date | null }>(); */

const FRESHNESS_WINDOW_MS = 15 * 60 * 1000;

const obligationFresh = null;
/* 
  obligationFreshnessRow?.last_eval != null &&
  Date.now() - new Date(obligationFreshnessRow.last_eval).getTime() <=
    FRESHNESS_WINDOW_MS; */

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

const comparison = {
  orders: {
    /**
     * Active Orders (FT2 · L1 · Execution-based)
     * -----------------------------------------
     * Orders that still represent open obligations.
     * Lifetime, state-based, NOT time-windowed.
     */
    active: activeOrders,

    /**
     * Fulfilled Orders (FT2 · L1 · Execution-based)
     * --------------------------------------------
     * Orders that have completed execution.
     * Lifetime, state-based.
     */
    fulfilled: fulfilledOrders,

    /**
     * Orders Added (FT2 · L1 · Temporal)
     * ---------------------------------
     * Orders created within the selected FT2 window.
     * Windowed via order_created_at.
     */
    added: facts.ordersObserved,
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

    /**
     * Orders Overview (FT2 · L1)
     * -------------------------
     * Fully owned by FT2.
     * MUST NOT inherit comparison semantics from FTEP exposure.
     */
    orders: {
      /**
       * Active Orders (FT2 · L1)
       * -----------------------
       * Requires a dedicated L1 count primitive.
       * Not inferred from totals.
       */
      active: activeOrders,

      /**
       * Fulfilled Orders (FT2 · L1)
       * ---------------------------
       * Lifetime fulfilled orders.
       */
      fulfilled: fulfilledOrders,

      /**
       * Orders Added (FT2 · L1 · Temporal)
       * ---------------------------------
       * Orders created within the selected FT2 window.
       */
      added: facts.ordersObserved,
    },

    refunds: refundsExposure,

    /**
     * Orders Comparison (FT2)
     * ----------------------
     * Explicitly overridden to avoid exposure contract bleed.
     */
    comparison: {
      orders: {
        fulfilledPctChange: null,
        unfulfilledPctChange: null,
        incomingPctChange: pctChange(previousTotal, currentTotal),
      },
    },

    /**
     * Revenue Semantics (FT2)
     * ----------------------
     * earned     = fulfilled revenue
     * pending    = unfulfilled AND unconstrained
     * blocked    = explicitly constrained (inventory/customer/operational)
     *
     * Rule:
     * pending + earned + blocked === totalSales
     * (subject to rounding)
     */

    /**
     * Invariant (FT2):
     * earned + pending + blocked === totalSales
     * (subject to rounding)
     */

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