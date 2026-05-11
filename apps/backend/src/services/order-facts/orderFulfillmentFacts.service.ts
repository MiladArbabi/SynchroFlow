import db from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
type KnexOrTrx = Knex | Knex.Transaction;

/**
 * Fulfillment Facts (Layer 1)
 * ---------------------------
 * Observes whether operational fulfillment signals exist.
 *
 * Guarantees:
 * - Presence-only
 * - Time-scoped
 * - No interpretation
 */
export async function extractOrderFulfillmentFacts(
  shopId: number,
  trx?: KnexOrTrx
) {
  const qb = trx ?? db;
  /**
   * order_fulfillment_status is STATE-based.
   * DO NOT apply FT2 time ranges here.
   */
  const row = await qb('order_fulfillment_status as ofs')
    .join('orders as o', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .count<{ total: string }>('ofs.lasyncro_fulfillment_id as total')
    .first();

  if (!row || Number(row.total) === 0) {
    return {
      fulfillmentSignal: 'absent' as const,
      visibility: 'insufficient' as const,
    };
  }

  return {
    fulfillmentSignal: 'present' as const,
    visibility: 'sufficient' as const,
  };
}