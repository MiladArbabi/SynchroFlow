import db from '@lasyncro/backend-core/db.js';

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
 * REFUND FACTS VIA NET VIEW
 * --------------------------
 * refunded_quantity is derived in DB view.
 */
const rows = await db('order_revenue_units_net as runet')
  .join(
    'orders as o',
    'o.lasyncro_order_id',
    'runet.lasyncro_order_id'
  )
  .where('o.shop_id', shopId)
  .where('runet.refunded_quantity', '>', 0)
  .select(
    'runet.lasyncro_order_id',
    'runet.refunded_quantity',
    'runet.unit_price'
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