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
    const rows = await db('order_revenue_units')
    .where('shop_id', shopId)
    .whereNotNull('returned_quantity')
    .select(
      'canonical_order_id',
      'returned_quantity',
      'unit_revenue'
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
    const v = q * Number(r.unit_revenue);
    if (!Number.isFinite(v)) continue;

    returnedUnits += q;
    returnedRevenue += v;
    orders.add(r.canonical_order_id);
  }

  return {
    returnedUnits,
    returnedRevenue,
    affectedOrders: orders.size,
  };
}