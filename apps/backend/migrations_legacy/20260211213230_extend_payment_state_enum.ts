import { Knex } from 'knex';

/**
 * ECONOMIC STATE MACHINE — Phase 1
 * --------------------------------
 * Adds `partially_refunded` to canonical_orders.payment_state domain.
 *
 * Rationale:
 * - Enables deterministic economic lifecycle transitions
 * - Required for refund aggregation modeling
 *
 * This migration:
 * - Drops existing CHECK constraint
 * - Recreates it with extended allowed states
 *
 * Idempotency:
 * - Safe on fresh DB
 * - Safe on reset
 */

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE canonical_orders
    DROP CONSTRAINT IF EXISTS canonical_orders_payment_state_check;
  `);

  await knex.raw(`
    ALTER TABLE canonical_orders
    ADD CONSTRAINT canonical_orders_payment_state_check
    CHECK (
      payment_state = ANY (
        ARRAY[
          'unpaid',
          'paid',
          'partially_refunded',
          'refunded',
          'voided',
          'unknown'
        ]
      )
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE canonical_orders
    DROP CONSTRAINT IF EXISTS canonical_orders_payment_state_check;
  `);

  await knex.raw(`
    ALTER TABLE canonical_orders
    ADD CONSTRAINT canonical_orders_payment_state_check
    CHECK (
      payment_state = ANY (
        ARRAY[
          'unpaid',
          'paid',
          'refunded',
          'voided',
          'unknown'
        ]
      )
    );
  `);
}
