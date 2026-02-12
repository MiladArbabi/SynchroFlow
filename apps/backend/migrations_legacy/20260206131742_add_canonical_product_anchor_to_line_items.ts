import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table
      .integer('canonical_product_anchor_id')
      .nullable()
      .comment('FK anchor to canonical_products.canonical_product_id (INT)');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.dropColumn('canonical_product_anchor_id');
  });
}