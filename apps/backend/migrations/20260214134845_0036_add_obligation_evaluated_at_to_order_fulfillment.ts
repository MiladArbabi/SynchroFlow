//apps/backend/migrations/20260214134845_0036_add_obligation_evaluated_at_to_order_fulfillment.ts

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.timestamp('obligation_evaluated_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.dropColumn('obligation_evaluated_at');
  });
}
