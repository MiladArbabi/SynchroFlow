// add_operational_blocking_events.ts
/**
 * Canonical Operational Blocking Events (v1)
 * ------------------------------------------
 * Deterministic, system-backed operational constraints.
 *
 * Rules:
 * - Explicit events only
 * - No aging, no risk, no heuristics
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('operational_blocking_events', (t) => {
    t.increments('id').primary();
    t.integer('shop_id').notNullable().index();
    t.string('canonical_order_id').notNullable().index();

    t.enum('reason', [
      'carrier_rejection',      // carrier explicitly rejects shipment
      'warehouse_failure',     // WMS cannot proceed
      'fulfillment_deadlock',  // system-declared deadlock
      'manual_operational_hold'
    ]).notNullable();

    t.timestamp('occurred_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at').nullable();

    t.unique(['shop_id', 'canonical_order_id', 'reason']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('operational_blocking_events');
}
