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

export async function extractFulfilledOrdersCount(
  shopId: number,
) {

  /**
   * IMPORTANT (FT2):
   * Fulfilled order count is STATE-based, not time-scoped.
   *
   * order_fulfillment_status does NOT carry order timestamps.
   * Time-scoping execution data would fabricate truth.
   *
   * Sovereign order identity lives in orders (lasyncro_order_id).
   */

  const row = await db('order_fulfillment_status')
  .where({ shop_id: shopId })
  .whereIn('status', ['fulfilled', 'delivered'])
  .countDistinct<{ count: string }>('lasyncro_order_id as count')
  .first();

  if (!row || row.count == null) {
    return null;
  }

  return Number(row.count);
}