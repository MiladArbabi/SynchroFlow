import db from 'api-src/db';

/**
 * Returns Facts
 * -----------------
 * Revenue regression caused by returns.
 *
 * Semantics:
 * - Post-execution only
 * - NOT blockers
 * - NOT eligibility
 * - Pure financial regression
 */
export async function extractReturnsFacts(shopId: number): Promise<{
  returnedUnits: number;
  returnedRevenue: number;
  affectedOrders: number;
}> {
  const rows = await db('order_revenue_units')
    .where('shop_id', shopId)
    .whereNotNull('returned_quantity')
    .select(
      'canonical_order_id',
      'returned_quantity',
      'unit_revenue'
    );

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