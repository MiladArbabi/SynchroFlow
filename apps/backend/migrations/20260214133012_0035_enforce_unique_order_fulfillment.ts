import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.unique(
      ['lasyncro_order_id'],
      {
        indexName: 'order_fulfillment_status_order_unique',
      }
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.dropUnique(
      ['lasyncro_order_id'],
      'order_fulfillment_status_order_unique'
    );
  });
}
