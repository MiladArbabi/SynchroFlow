import db from 'api-db';

/**
 * extractActiveOrdersCount (L1)
 * ----------------------------
 * Returns the count of canonical orders that represent
 * unresolved execution obligations.
 *
 * Definition:
 * - An order is ACTIVE if its fulfillment status
 *   is NOT ('fulfilled', 'delivered')
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
  const row = await db('order_fulfillment_status')
    .where('shop_id', shopId)
    .whereNotIn('status', ['fulfilled', 'delivered'])
    .countDistinct<{ count: string }>('canonical_order_id as count')
    .first();

  return row?.count !== undefined ? Number(row.count) : null;
}
