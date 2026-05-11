import db from "@lasyncro/backend-core/db.js";
import type { Knex } from 'knex';
type KnexOrTrx = Knex | Knex.Transaction;

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
  shopId: number,
  trx?: KnexOrTrx
): Promise<number | null> {
  const qb = trx ?? db;
  
  /**
   * ACTIVE ORDER DEFINITION (v2)
   * -----------------------------
   * An order is ACTIVE if:
   * - No fulfillment row exists
   * OR
   * - Fulfillment status != 'fulfilled'
   *
   * Anchor: orders table (sovereign identity)
   */
  const row = await qb('orders as o')
    .leftJoin(
      'order_fulfillment_status as ofs',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .where(function () {
      this.whereNull('ofs.status')
          .orWhereNotIn('ofs.status', ['fulfilled']);
    })
    .countDistinct<{ count: string }>('o.lasyncro_order_id as count')
    .first();

  return row?.count !== undefined ? Number(row.count) : null;
}
