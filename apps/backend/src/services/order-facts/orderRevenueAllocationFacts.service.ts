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
export async function extractOrderRevenueAllocationFacts(
  shopId: number,
  range: Parameters<typeof resolveFt2Range>[0]
): Promise<{
  fulfilledRevenueTotal: number | null;
  unfulfilledRevenueTotal: number | null;
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
    return {
      fulfilledRevenueTotal: null,
      unfulfilledRevenueTotal: null,
    };
  }

  let fulfilled = 0;
  let unfulfilled = 0;

  for (const row of rows) {
    if (row.revenue == null) continue;

    if (row.fulfillmentStatus === 'fulfilled' || row.fulfillmentStatus === 'delivered') {
      fulfilled += Number(row.revenue);
    } else {
      unfulfilled += Number(row.revenue);
    }
  }

  return {
    fulfilledRevenueTotal: fulfilled,
    unfulfilledRevenueTotal: unfulfilled,
  };
}
