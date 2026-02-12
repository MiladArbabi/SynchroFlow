import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE order_fulfillment_status
    DROP CONSTRAINT IF EXISTS order_fulfillment_status_canonical_order_id_foreign,
    DROP CONSTRAINT IF EXISTS fk_fulfillment_canonical_order;
  `);

  await knex.raw(`
    ALTER TABLE canonical_returns
    DROP CONSTRAINT IF EXISTS canonical_returns_canonical_order_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE canonical_order_line_items
    DROP CONSTRAINT IF EXISTS canonical_order_line_items_canonical_order_id_foreign;
  `);

  await knex.schema.dropTableIfExists('canonical_order_line_items');
  await knex.schema.dropTableIfExists('canonical_orders');
}

export async function down(): Promise<void> {}