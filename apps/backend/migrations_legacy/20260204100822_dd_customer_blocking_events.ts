// add_customer_blocking_events.ts
/**
 * Canonical Customer Blocking Events (v1)
 * --------------------------------------
 * Deterministic, event-backed customer constraints.
 *
 * Rules:
 * - One event = one explicit customer-side block
 * - No inference
 * - No payment heuristics
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('customer_blocking_events', (t) => {
    t.increments('id').primary();
    t.integer('shop_id').notNullable().index();
    t.string('canonical_order_id').notNullable().index();

    t.enum('reason', [
      'customer_action_required',   // e.g. address confirmation
      'customer_dispute',           // explicit dispute
      'manual_hold',                // merchant-initiated hold
    ]).notNullable();

    t.timestamp('occurred_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at').nullable();

    t.unique(['shop_id', 'canonical_order_id', 'reason']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('customer_blocking_events');
}
