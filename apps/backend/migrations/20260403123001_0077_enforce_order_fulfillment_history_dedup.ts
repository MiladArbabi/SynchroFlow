import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_history', (table) => {
    table.unique(
      ['lasyncro_order_id', 'status', 'event_occurred_at'],
      'order_fulfillment_history_dedup_unique'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_history', (table) => {
    table.dropUnique(
      ['lasyncro_order_id', 'status', 'event_occurred_at'],
      'order_fulfillment_history_dedup_unique'
    );
  });
}