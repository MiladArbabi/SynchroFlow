// apps/backend/migrations/20260210182018_fix_order_ingestion_identity.ts

import type { Knex } from 'knex';

/**
 * Fix Order Ingestion Identity
 * ----------------------------
 * `order_ingestion_events.canonical_order_id` was incorrectly used
 * to store the INTERNAL canonical_orders PK (integer).
 *
 * This migration makes the meaning explicit by renaming the column.
 *
 * HARD RULE:
 * - canonical identity (Shopify GID) lives ONLY in canonical_orders
 * - ingestion events must never pretend to carry canonical identity
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_ingestion_events', (table) => {
    table.renameColumn(
      'canonical_order_id',
      'canonical_order_pk'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_ingestion_events', (table) => {
    table.renameColumn(
      'canonical_order_pk',
      'canonical_order_id'
    );
  });
}
