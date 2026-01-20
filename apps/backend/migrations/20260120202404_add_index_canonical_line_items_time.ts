import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.index(
      ['shop_id', 'order_created_at'],
      'idx_canonical_line_items_shop_time'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.dropIndex(
      ['shop_id', 'order_created_at'],
      'idx_canonical_line_items_shop_time'
    );
  });
}