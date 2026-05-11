import db from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
type KnexOrTrx = Knex | Knex.Transaction;

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
  trx?: KnexOrTrx
) {
  const qb = trx ?? db;

  /**
   * FULFILLED ORDER DEFINITION (v2)
   * --------------------------------
   * An order is fulfilled if:
   * - A fulfillment row exists
   * - status = 'fulfilled'
   *
   * Anchor: orders table
   */
  const row = await qb('orders as o')
    .leftJoin(
      'order_fulfillment_status as ofs',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .where('ofs.status', 'fulfilled')
    .countDistinct<{ count: string }>('o.lasyncro_order_id as count')
    .first();

  if (!row || row.count == null) {
    return null;
  }

  return Number(row.count);
}