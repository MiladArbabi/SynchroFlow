import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_revenue_units', (table) => {
    table.unique(
      ['shop_id', 'canonical_order_id', 'sku'],
      'order_revenue_units_shop_order_sku_unique'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_revenue_units', (table) => {
    table.dropUnique(
      ['shop_id', 'canonical_order_id', 'sku'],
      'order_revenue_units_shop_order_sku_unique'
    );
  });
}