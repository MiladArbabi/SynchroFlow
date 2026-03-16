// apps/backend/src/services/order-nexus-ft2/orderNexusFt2.state.resolver.ts
import db from "@lasyncro/backend-core/db.js";
import { resolveAlignmentPlanes } from "../../services/alignment-planes/alignmentPlanes.resolver.js";
import { extractOrderFulfillmentFacts } from "../../services/order-facts/orderFulfillmentFacts.service.js";
import { extractOrderFulfillmentStatusFacts } from "../../services/order-facts/orderFulfillmentStatusFacts.service.js";
import { extractRefundsFacts } from "../../services/order-facts/orderReturnsFacts.service.js";
import { extractFulfilledOrdersCount } from "../../services/order-facts/orderFulfilledCountFacts.service.js";
import { extractActiveOrdersCount } from "../../services/order-facts/orderActiveCountFacts.service.js";
import { deriveOrderFulfillmentIntelligence } from "../../services/order-intelligence/orderFulfillmentIntelligence.service.js";
import { OrderNexusFT2Snapshot } from "./orderNexusFt2.types.js";

/**
 * STATE-ONLY FT2 RESOLVER
 * ------------------------
 * Operational state snapshot.
 * No temporal windows.
 * Deterministic.
 */
export async function getOrderNexusFt2StateSnapshot(
  shopId: number
): Promise<OrderNexusFT2Snapshot | null> {

  // Fulfillment state
  const fulfillmentFacts = await extractOrderFulfillmentFacts(shopId);
  const fulfillmentStatusFacts = await extractOrderFulfillmentStatusFacts(shopId);
  const fulfilledOrders = await extractFulfilledOrdersCount(shopId);
  const activeOrders = await extractActiveOrdersCount(shopId);

  const fulfillmentIntelligence =
    deriveOrderFulfillmentIntelligence(fulfillmentFacts);

  // Refunds (lifetime)
  const refundsFacts = await extractRefundsFacts(shopId);

    // Freshness (state-based)
  const freshnessRow = await db('orders')
    .where('shop_id', shopId)
    .max('updated_at as last')
    .first();

  let freshnessStatus: 'recent' | 'stale' | 'unknown' = 'unknown';

  if (freshnessRow?.last) {
    const delta =
      Date.now() - new Date(freshnessRow.last as string).getTime();

    freshnessStatus =
      delta < 1000 * 60 * 60 * 24 ? 'recent' : 'stale';
  }

  // Alignment planes (meta only)
  const alignment = resolveAlignmentPlanes({
    meta: {
      visibilities: [
        fulfillmentIntelligence.visibility === 'unknown'
          ? null
          : fulfillmentIntelligence.visibility,
      ],
    },
    planes: [],
  });

  const totalOrdersRow = await db('orders')
    .where('shop_id', shopId)
    .count<{ count: string }>('lasyncro_order_id as count')
    .first();

  const totalOrders =
    totalOrdersRow?.count != null
      ? Number(totalOrdersRow.count)
      : 0;

  /**
   * DETERMINISTIC SNAPSHOT SELECTION
   * --------------------------------
   * Snapshots may share the same snapshot_date because
   * reconciliation jobs run multiple times per day.
   *
   * Deterministic ordering therefore requires:
   *
   * 1. snapshot_date DESC
   * 2. aggregate_version DESC
   *
   * aggregate_version is monotonic within the event stream
   * and guarantees stable replay ordering.
   */
  const operationalControlRow = await db('orders_operational_control_snapshot')
    .where({ shop_id: shopId })
    .orderBy([
      { column: 'snapshot_date', order: 'desc' },
      { column: 'aggregate_version', order: 'desc' },
    ])
    .first();

  /**
   * CONSTRAINED ORDERS (PROJECTION SOURCE)
   * --------------------------------------
   * Must originate from reconciliation projection.
   *
   * DO NOT compute inside resolver.
   *
   * Source:
   *   orders_operational_control_snapshot.constrained_orders
   *
   * Reason:
   * - maintain deterministic replay
   * - prevent resolver-side aggregation drift
   */
  const constrained =
    Number(operationalControlRow?.constrained_orders ?? 0);

  /**
   * SNAPSHOT INTEGRITY GUARD
   * ------------------------
   * Snapshot absence indicates a projection pipeline problem.
   *
   * Instead of crashing the resolver we surface a degraded
   * operational state so the Control Tower can render a
   * system banner and preserve operator visibility.
   *
   * Operational signal:
   * ORDER_NEXUS_FT2_SNAPSHOT_DEGRADED
   */
  if (!operationalControlRow) {

    console.error(
      '[ORDER_NEXUS_FT2_SNAPSHOT_DEGRADED]',
      'orders_operational_control_snapshot row not found for shop',
      shopId
    );

    return null;
  }

  /**
   * OPERATIONAL DECISION BRIEF
   * --------------------------
   * Latest decision snapshot for execution surface.
   *
   * Source:
   *   daily_operational_brief_snapshot
   *
   * This snapshot is produced by reconciliation and must
   * be exposed through the FT2 state surface to avoid
   * multi-API drift in the UI.
   */
  const decisionBriefRow = await db('daily_operational_brief_snapshot')
    .where({ shop_id: shopId })
    .orderBy('brief_date', 'desc')
    .first();

  /**
   * LEGACY PRIORITY STACK
   * ---------------------
   * Previously exposed ranked orders based on
   * order_risk_snapshot.order_health_score.
   *
   * Replaced by Operations Queue architecture.
   *
   * Operational signals now originate from:
   * orders_operational_control_snapshot
   *
   * Query intentionally disabled to prevent
   * accidental reintroduction of the ranking surface.
   */
  const priorityStackRows = [];
  
  /**
   * NUMERIC NORMALIZATION
   * ---------------------
   * PostgreSQL NUMERIC columns are returned as strings by node-postgres.
   * The FT2 resolver contract requires numeric primitives.
   *
   * Normalize once here to prevent:
   * - string concatenation errors
   * - UI runtime crashes
   * - epistemic type violations
   */
  const realizedRevenue = Number(operationalControlRow?.realized_revenue ?? 0);
  const atRiskRevenue = Number(operationalControlRow?.at_risk_revenue ?? 0);
  const blockedRevenue = Number(operationalControlRow?.blocked_revenue ?? 0);

  /**
   * Pending Revenue
   * ---------------
   * Projection value computed by reconciliation.
   *
   * IMPORTANT:
   * Resolver must NEVER recompute revenue projections.
   * This value is a direct passthrough from
   * orders_operational_control_snapshot.pending_revenue.
   */
  const pendingRevenue = Number(
    operationalControlRow?.pending_revenue ?? 0
  );

  // Snapshot placeholder (shape refined next task)
  const snapshot: OrderNexusFT2Snapshot = {
    orders: {
      total: totalOrders,
      fulfilled: fulfilledOrders ?? 0,
      unfulfilled: activeOrders ?? 0,
      constrained, // will wire from existing constrained logic next task
    },

    /**
     * REVENUE — PROJECTION PASSTHROUGH
     * --------------------------------
     * Resolver must NOT recompute economic metrics.
     * All revenue values originate from the reconciliation projection.
     */
    revenue: operationalControlRow
      ? {
          /**
           * TOTAL SALES (GMV)
           * -----------------
           * TOTAL GMV
           * ----------
           * Canonical GMV from projection snapshot.
           * Resolver must never recompute economic metrics.
           *
           * Must include:
           * - realized revenue (fulfilled)
           * - pending revenue (paid but unfulfilled)
           * - at-risk revenue (unpaid)
           *
           * Excludes blocked and leakage values because those
           * represent operational constraints or loss states,
           * not primary order value.
           */
          totalSales: Number(operationalControlRow?.total_gmv ?? 0),
          earned: realizedRevenue,
          pending: pendingRevenue,
          blocked: blockedRevenue,
        } : {
          totalSales: 0,
          earned: 0,
          pending: 0,
          blocked: 0,
        },

    /**
   * Operational Control Snapshot (FT2 Surface)
   * ------------------------------------------
   * Fully derived backend snapshot.
   * Strict passthrough to UI.
   */
  operationalControl: operationalControlRow
    ? {
        snapshot_date: operationalControlRow.snapshot_date,
        aggregate_version: operationalControlRow.aggregate_version ?? 0,

        realized_revenue: operationalControlRow.realized_revenue,
        at_risk_revenue: operationalControlRow.at_risk_revenue,
        blocked_revenue: operationalControlRow.blocked_revenue,
        revenue_leakage: operationalControlRow.revenue_leakage,
        avg_contribution_margin_pct: operationalControlRow.avg_contribution_margin_pct,

        orders_at_sla_risk: operationalControlRow.orders_at_sla_risk,
        aging_24h: operationalControlRow.aging_24h,
        aging_48h: operationalControlRow.aging_48h,
        aging_72h_plus: operationalControlRow.aging_72h_plus,
        pending_fulfillment: operationalControlRow.pending_fulfillment,
        pending_payment: operationalControlRow.pending_payment,
        exception_orders: operationalControlRow.exception_orders,

        constrained_orders: operationalControlRow.constrained_orders,
        revenue_blocked_inventory: operationalControlRow.revenue_blocked_inventory,
        revenue_blocked_customer: operationalControlRow.revenue_blocked_customer,
        revenue_blocked_operational: operationalControlRow.revenue_blocked_operational,

        queue_manual_review: operationalControlRow.queue_manual_review,
        queue_awaiting_inventory: operationalControlRow.queue_awaiting_inventory,
        queue_ready_to_ship: operationalControlRow.queue_ready_to_ship,
        queue_awaiting_customer: operationalControlRow.queue_awaiting_customer,

        /**
         * PARTIAL FULFILLMENT OPPORTUNITY
         * --------------------------------
         * Orders that can ship partially because
         * only some items are inventory-blocked.
         *
         * Derived deterministically by reconciliation projection.
         */
        partial_fulfillment_opportunity:
          operationalControlRow.partial_fulfillment_opportunity,
      }
    : null,

    decision: {
      brief: decisionBriefRow
        ? {
            ready_to_ship: decisionBriefRow.ready_to_ship,
            awaiting_customer: decisionBriefRow.awaiting_customer,
            inventory_blocked_revenue: decisionBriefRow.inventory_blocked_revenue,
            manual_review: decisionBriefRow.manual_review,
          }
        : null,

      /**
       * DEPRECATED FIELD
       * ----------------
       * Retained temporarily for backward compatibility
       * with existing snapshot adapters.
       *
       * Always empty since Operations Queue replaced
       * the Priority Stack architecture.
       */
      priorityStack: [],
    },

    refunds: refundsFacts,
    alignment,
    freshness: {
      status: freshnessStatus,
    },
  } as any;

  return snapshot;
}