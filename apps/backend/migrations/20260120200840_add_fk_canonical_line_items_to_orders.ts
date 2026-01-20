import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table
      .foreign(['canonical_order_id'])
      .references(['canonical_order_id'])
      .inTable('canonical_orders')
      .onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.dropForeign(['canonical_order_id']);
  });
}