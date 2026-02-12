import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table
      .timestamp('order_created_at', { useTz: true })
      .notNullable()
      .index();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.dropIndex(['order_created_at']);
    table.dropColumn('order_created_at');
  });
}