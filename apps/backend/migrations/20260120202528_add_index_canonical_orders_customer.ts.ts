import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_orders', (table) => {
    table.index(
      ['shop_id', 'customer_hashed_id'],
      'idx_canonical_orders_shop_customer'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_orders', (table) => {
    table.dropIndex(
      ['shop_id', 'customer_hashed_id'],
      'idx_canonical_orders_shop_customer'
    );
  });
}