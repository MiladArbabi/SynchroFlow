import db from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';

type KnexOrTrx = Knex | Knex.Transaction;


/**
 * Fulfillment Status Facts (Layer 1)
 * ---------------------------------
 * Observes factual fulfillment state of orders.
 *
 * Rules:
 * - Presence-only
 * - Time-scoped
 * - No inference
 * - No lifecycle meaning
 */
export async function extractOrderFulfillmentStatusFacts(
  shopId: number,
  trx?: KnexOrTrx
) {
  const qb = trx ?? db;

  /**
   * NOTE:
   * order_fulfillment_status is STATE-based.
   * status_updated_at is NOT an order timestamp.
   * Do NOT apply FT2 date-range filtering here.
   */
  const rows = await qb('order_fulfillment_status as ofs')
    .join('orders as o', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .select('ofs.status');

  if (rows.length === 0) {
    return {
      fulfillmentStatus: 'absent' as const,
      visibility: 'insufficient' as const,
    };
  }

  const fulfilledCount = rows.filter((r) =>
    ['fulfilled'].includes(r.status)
  ).length;

  if (fulfilledCount === rows.length) {
    return {
      fulfillmentStatus: 'fulfilled' as const,
      visibility: 'sufficient' as const,
    };
  }

  if (fulfilledCount === 0) {
    return {
      fulfillmentStatus: 'unfulfilled' as const,
      visibility: 'sufficient' as const,
    };
  }

  return {
    fulfillmentStatus: 'partial' as const,
    visibility: 'sufficient' as const,
  };
}