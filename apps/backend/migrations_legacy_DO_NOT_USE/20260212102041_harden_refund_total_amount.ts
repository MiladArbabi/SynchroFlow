// Permanent hardening of refund_executions.total_refunded_amount
// --------------------------------------------------------------
// Guarantees:
// - No NULL economic totals
// - Deterministic refund execution state
// - Schema survives DB resets
//
// This migration is SAFE because:
// - All existing rows already have non-null totals
// - Derived layer overwrites totals deterministically

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('refund_executions', table => {
    table
      .decimal('total_refunded_amount', 14, 4)
      .notNullable()
      .defaultTo(0)
      .alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('refund_executions', table => {
    table
      .decimal('total_refunded_amount', 14, 4)
      .nullable()
      .defaultTo(null)
      .alter();
  });
}
