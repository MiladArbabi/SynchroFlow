import type { Knex } from "knex";

export async function up(knex: Knex) {
  await knex.schema.alterTable('order_fulfillment_status', (t) => {
    t.timestamp('synthetic_created_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('order_fulfillment_status', (t) => {
    t.dropColumn('synthetic_created_at');
  });
}