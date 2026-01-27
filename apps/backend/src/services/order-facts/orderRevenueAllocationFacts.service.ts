//apps/backend/src/services/order-facts/orderRevenueAllocationFacts.service.ts
import db from 'api-src/db';
import { resolveFt2Range } from 'api-src/utils/ft2Period';

/**
 * Order Revenue Allocation Facts (Layer 1)
 * ----------------------------------------
 * Allocates order-level revenue by fulfillment state.
 *
 * Purpose:
 * - Expose where positive revenue is structurally sitting.
 *
 * Guarantees:
 * - Canonical facts only
 * - Order-level allocation
 * - No interpretation
 * - No proportional math
 * - No settlement or payment inference
 *
 * IMPORTANT:
 * - Revenue is sourced from canonical_orders.total_price
 * - Fulfillment is order-level and state-based
 * - Partial fulfillment is NOT supported
 */

/**
 * ⚠️ EXECUTION-AWARE REVENUE (INTERNAL)
 * ---------------------------------------------
 * This service MUST NOT be used by FT1 or FT2.
 *
 * Semantics:
 * - Uses webhook-driven fulfillment truth
 * - Preserves unknown when execution is missing
 * - Does NOT infer delivery, payment, or settlement
 *
 * Valid consumers:
 * - Phase 6 execution-aware revenue resolvers ONLY
 */

export async function extractOrderRevenueAllocationFacts(
  shopId: number,
  range: Parameters<typeof resolveFt2Range>[0]
): Promise<{
  fulfilledRevenueTotal: number;
  unfulfilledRevenueTotal: number;
  unknownRevenueTotal: number;
}> {
  const { from, to } = resolveFt2Range(range);

  /**
   * Join canonical orders with fulfillment state.
   * Classification rules:
   * - fulfilled / delivered → fulfilled revenue
   * - all other states       → unfulfilled revenue
   *
   * No time semantics beyond order_created_at window.
   */
  const rows = await db('canonical_orders as o')
    .leftJoin(
      'order_fulfillment_status as f',
      'o.canonical_order_id',
      'f.canonical_order_id'
    )
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '>=', from)
    .andWhere('o.order_created_at', '<=', to)
    .select(
      'o.total_price as revenue',
      'f.status as fulfillmentStatus'
    );

  if (!rows || rows.length === 0) {
    /**
     * No orders in scope.
     *
     * This is NOT an epistemic unknown.
     * It is a real, observed zero.
     *
     * Visibility insufficiency (if any) is handled
     * by the execution-aware resolver.
     */
    return {
      fulfilledRevenueTotal: 0,
      unfulfilledRevenueTotal: 0,
      unknownRevenueTotal: 0,
    };
  }

  let fulfilled = 0;
  let unfulfilled = 0;
  let unknown = 0;

  for (const row of rows) {
    if (row.revenue == null) continue;

    if (row.fulfillmentStatus === null) {
      // Missing execution truth → epistemic unknown
      unknown += Number(row.revenue);
      continue;
    }

    if (
      row.fulfillmentStatus === 'fulfilled' ||
      row.fulfillmentStatus === 'delivered'
    ) {
      fulfilled += Number(row.revenue);
    } else {
      unfulfilled += Number(row.revenue);
    }
  }

  return {
    fulfilledRevenueTotal: fulfilled,
    unfulfilledRevenueTotal: unfulfilled,
    unknownRevenueTotal: unknown,
  };
}
