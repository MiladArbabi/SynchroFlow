import type { Knex } from 'knex';

/**
 * SRC-01a
 *
 * A pending reorder request is a LEVEL (the shortfall for a variant), not a
 * running total. Two pending rows for the same variant+supplier would both sum
 * into MOQ progress and inflate it. One pending row per (variant, supplier);
 * re-queueing raises the qty instead of appending.
 * Converted/dismissed rows are excluded so history stays append-only.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE UNIQUE INDEX reorder_requests_pending_unique_idx
    ON reorder_requests (shop_id, lasyncro_variant_id, supplier_id)
    WHERE status = 'pending'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS reorder_requests_pending_unique_idx`);
}
