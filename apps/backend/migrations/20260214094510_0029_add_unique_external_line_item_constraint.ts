import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_line_items', (table) => {
    table.unique(
      ['platform', 'external_line_item_id'],
      'order_line_items_platform_external_line_unique'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_line_items', (table) => {
    table.dropUnique(
      ['platform', 'external_line_item_id'],
      'order_line_items_platform_external_line_unique'
    );
  });
}
