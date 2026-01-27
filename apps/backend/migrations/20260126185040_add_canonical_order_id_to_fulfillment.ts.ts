import { Knex } from 'knex';

/**
 * Add canonical_order_id to order_fulfillment_status
 * --------------------------------------------------
 * Purpose:
 * - Establish a canonical join between fulfillment and orders.
 *
 * Notes:
 * - Nullable by design (fail-closed)
 * - Backfilled in a subsequent step
 * - Non-breaking
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.string('canonical_order_id').nullable();
  });

  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.unique(['shop_id', 'canonical_order_id'], {
      indexName: 'order_fulfillment_status_shop_canonical_unique',
    });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.dropUnique(['shop_id', 'canonical_order_id'], 'order_fulfillment_status_shop_canonical_unique');
    table.dropColumn('canonical_order_id');
  });
}