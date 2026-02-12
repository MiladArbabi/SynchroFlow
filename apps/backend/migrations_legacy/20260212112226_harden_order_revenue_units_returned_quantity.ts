// Permanent hardening of order_revenue_units.returned_quantity
// ------------------------------------------------------------
// Guarantees:
// - No NULL returned quantities
// - Deterministic refund math
// - Schema survives DB resets

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_revenue_units', table => {
    table
      .integer('returned_quantity')
      .notNullable()
      .defaultTo(0)
      .alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_revenue_units', table => {
    table
      .integer('returned_quantity')
      .nullable()
      .defaultTo(null)
      .alter();
  });
}
