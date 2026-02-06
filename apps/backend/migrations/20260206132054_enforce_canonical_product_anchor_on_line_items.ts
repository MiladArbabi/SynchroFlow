import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.integer('canonical_product_anchor_id').notNullable().alter();
    table
      .foreign('canonical_product_anchor_id')
      .references('canonical_products.canonical_product_id')
      .onDelete('RESTRICT');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.dropForeign(['canonical_product_anchor_id']);
    table.integer('canonical_product_anchor_id').nullable().alter();
  });
}
