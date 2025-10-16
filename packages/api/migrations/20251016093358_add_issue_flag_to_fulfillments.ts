import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.boolean('has_issue').defaultTo(false).notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.dropColumn('has_issue');
  });
}