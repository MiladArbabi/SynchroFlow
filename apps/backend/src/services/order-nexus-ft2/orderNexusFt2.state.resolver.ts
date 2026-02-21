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

  // Snapshot placeholder (shape refined next task)
  const snapshot: OrderNexusFT2Snapshot = {
    orders: {
      total: (fulfilledOrders ?? 0) + (activeOrders ?? 0),
      fulfilled: fulfilledOrders ?? 0,
      unfulfilled: activeOrders ?? 0,
      constrained, // will wire from existing constrained logic next task
    },
    revenue: {
      pending: revenueAllocation.unfulfilledRevenueTotal,
      blocked: 0, // blocked handled separately next task
      earned: revenueAllocation.fulfilledRevenueTotal,
    },
    refunds: refundsFacts,
    alignment,
    freshness: {
      status: freshnessStatus,
    },
  } as any;

  return snapshot;
}