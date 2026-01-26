import db from 'api-src/db';

/**
 * Fulfilled Orders Count (Layer 1)
 * -------------------------------
 * Counts orders whose fulfillment status is completed.
 *
 * Rules:
 * - Presence-based
 * - State-based (not time-scoped)
 * - No interpretation
 */
export async function extractFulfilledOrdersCount(shopId: number) {
  const row = await db('order_fulfillment_status')
    .where({ shop_id: shopId })
    .whereIn('status', ['fulfilled', 'delivered'])
    .count<{ count: string }>('id as count')
    .first();

  if (!row || row.count == null) {
    return null;
  }

  return Number(row.count);
}