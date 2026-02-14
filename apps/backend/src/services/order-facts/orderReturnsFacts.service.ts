import db from 'api-src/db';

/**
 * Refund Facts (Layer 1)
 * ---------------------
 * Revenue regression caused by refunds.
 *
 * Semantics:
 * - Platform-reported refunds only
 * - Financial reversal only
 * - NOT physical returns
 * - NOT blockers
 * - NOT eligibility
 * - Pure post-execution regression
 */
export async function extractRefundsFacts(shopId: number): Promise<{
  returnedUnits: number | null;
  returnedRevenue: number | null;
  affectedOrders: number | null;
}> {
    /**
 * SOVEREIGN REFUND ANCHOR (v2)
 * ----------------------------
 * - UUID-anchored via lasyncro_order_id
 * - shop_id derived from orders
 * - Revenue primitive: returned_quantity * unit_price
 */
  const rows = await db('order_revenue_units as ru')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ru.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .where('ru.returned_quantity', '>', 0)
    .select(
      'ru.lasyncro_order_id',
      'ru.returned_quantity',
      'ru.unit_price'
    );

  /**
   * L1 NULL SEMANTICS
   * ----------------
   * No refund rows → epistemic absence, not zero.
   */
  if (rows.length === 0) {
    return {
      returnedUnits: null,
      returnedRevenue: null,
      affectedOrders: null,
    };
  }

  let returnedUnits = 0;
  let returnedRevenue = 0;
  const orders = new Set<string>();


  for (const r of rows) {
    const q = Number(r.returned_quantity);
    const v = q * Number(r.unit_price);
    orders.add(r.lasyncro_order_id);

    returnedUnits += q;
    returnedRevenue += v;
    orders.add(r.lasyncro_order_id);
  }

  return {
    returnedUnits,
    returnedRevenue,
    affectedOrders: orders.size,
  };
}