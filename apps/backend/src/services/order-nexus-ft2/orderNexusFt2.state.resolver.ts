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

import { extractOrderRevenueAllocationFacts } from "../../services/order-facts/orderRevenueAllocationFacts.service.js";

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

  // Revenue state (lifetime, state-anchored)
  const revenueAllocation = await extractOrderRevenueAllocationFacts(shopId);

  /**
   * REVENUE SOURCE OF TRUTH
   * -----------------------
   * Revenue must NEVER be recomputed inside resolvers.
   *
   * Canonical economic projections are produced by the
   * reconciliation engine and materialized into:
   *
   *   orders_operational_control_snapshot
   *
   * This resolver must only READ those projections.
   *
   * Reason:
   * - Prevent projection drift
   * - Ensure deterministic rebuild equivalence
   * - Keep UI metrics aligned with reconciliation layer
   */

  // Refunds (lifetime)
  const refundsFacts = await extractRefundsFacts(shopId);

    // Constrained orders (lifetime, state-based)
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
   * OPERATIONAL CONTROL SNAPSHOT (PHASE 1)
   * --------------------------------------
   * Canonical control-tower compression layer.
   *
   * Rules:
   * - Read-only
   * - Replace-on-reconcile respected
   * - Latest snapshot per shop
   * - No aggregation or inference here
   */
  const operationalControlRow = await db('orders_operational_control_snapshot')
    .where({ shop_id: shopId })
    .orderBy('snapshot_date', 'desc')
    .first();

  // Snapshot placeholder (shape refined next task)
  const snapshot: OrderNexusFT2Snapshot = {
    orders: {
      total: totalOrders,
      fulfilled: fulfilledOrders ?? 0,
      unfulfilled: activeOrders ?? 0,
      constrained, // will wire from existing constrained logic next task
    },
    
    /**
     * Revenue metrics must come from the operational
     * control snapshot to guarantee deterministic parity
     * with reconciliation projections.
     */
    revenue: operationalControlRow
      ? {
          totalSales:
            operationalControlRow.realized_revenue +
            operationalControlRow.at_risk_revenue,

          earned: operationalControlRow.realized_revenue,

          pending:
            operationalControlRow.at_risk_revenue -
            operationalControlRow.blocked_revenue,

          blocked: operationalControlRow.blocked_revenue,
        }
      : {
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
      }
    : null,

    refunds: refundsFacts,
    alignment,
    freshness: {
      status: freshnessStatus,
    },
  } as any;

  return snapshot;
}