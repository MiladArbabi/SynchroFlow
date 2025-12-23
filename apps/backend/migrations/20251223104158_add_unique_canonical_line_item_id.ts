import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.unique(
      ['canonical_line_item_id'],
      'canonical_order_line_items_canonical_line_item_id_unique'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.dropUnique(
      ['canonical_line_item_id'],
      'canonical_order_line_items_canonical_line_item_id_unique'
    );
  });
}