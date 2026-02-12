import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_orders', (table) => {
    table
      .enum('payment_state', [
        'unpaid',
        'paid',
        'refunded',
        'voided',
        'unknown',
      ])
      .notNullable()
      .defaultTo('unknown')
      .comment(`
Customer Obligation v2 — Payment State
-------------------------------------
Presence-only factual field.

Semantics:
- unpaid   → customer obligation MAY exist
- paid     → no customer obligation
- refunded → no customer obligation
- voided   → no customer obligation
- unknown  → obligation visibility insufficient

This column carries NO failure, blame, or outcome semantics.
`);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_orders', (table) => {
    table.dropColumn('payment_state');
  });
}
