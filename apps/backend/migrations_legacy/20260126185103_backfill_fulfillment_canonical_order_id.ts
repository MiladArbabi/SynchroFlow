import { Knex } from 'knex';

/**
 * Backfill canonical_order_id in order_fulfillment_status
 * ------------------------------------------------------
 * Deterministically resolves canonical orders via:
 *   canonical_orders.platform_order_id = order_fulfillment_status.order_id
 *
 * Rules:
 * - Match on shop_id
 * - If no match → leave NULL
 * - No guessing
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE order_fulfillment_status f
    SET canonical_order_id = o.canonical_order_id
    FROM canonical_orders o
    WHERE f.shop_id = o.shop_id
      AND f.order_id = o.platform_order_id
      AND f.canonical_order_id IS NULL
  `);
}

export async function down(): Promise<void> {
  // Non-reversible by design (data backfill)
}
