import db from 'api-db';

/**
 * extractActiveOrdersCount (L1)
 * ----------------------------
 * Returns the count of canonical orders that represent
 * unresolved execution obligations.
 *
 * Definition:
 * - An order is ACTIVE if its fulfillment status
 *   is NOT ('fulfilled')
 *
 * Scope:
 * - Lifetime (NOT time-windowed)
 * - State-based (execution truth)
 *
 * HARD RULES:
 * - DB-only reads
 * - No trends
 * - No inference
 * - Deterministic
 * - Null represents epistemic absence
 */
export async function extractActiveOrdersCount(
  shopId: number
): Promise<number | null> {
  
  /**
   * SOVEREIGN IDENTITY (v2)
   * -----------------------
   * Active orders are UUID-anchored.
   * shop_id must be derived from orders.
   */
  const row = await db('order_fulfillment_status as ofs')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .whereNotIn('ofs.status', ['fulfilled'])
    .countDistinct<{ count: string }>('ofs.lasyncro_order_id as count')
    .first();

  return row?.count !== undefined ? Number(row.count) : null;
}
