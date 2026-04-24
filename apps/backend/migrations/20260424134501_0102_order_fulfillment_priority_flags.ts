// apps/backend/migrations/20260424000001_0102_order_fulfillment_priority_flag.ts
//
// MIGRATION 0102 — ORDER FULFILLMENT PRIORITY FLAG
// --------------------------------------------------
// Adds is_priority_flagged + priority_flagged_at to order_fulfillment_status.
//
// is_priority_flagged: boolean — set by order-nexus when SLA breach is imminent.
//   Auto-cleared by fulfillment queue when order enters a pick batch.
//   Readable by fulfillment queue to surface priority orders at top.
//
// priority_flagged_at: timestamp — audit trail, never cleared.
//   Records when the flag was last set, even after auto-clear.
//
// PROJECTION WRITE GUARD:
// order_fulfillment_status is protected by enforce_projection_writer_order_fulfillment_status.
// Priority flag writes must bypass this via SET LOCAL synchroflow.projection = 'true'
// OR via a dedicated function with SECURITY DEFINER.
// We use a dedicated SQL function to keep the bypass explicit and auditable.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table
      .boolean('is_priority_flagged')
      .notNullable()
      .defaultTo(false);

    table
      .timestamp('priority_flagged_at', { useTz: true })
      .nullable();
  });

  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.index(['is_priority_flagged'], 'idx_ofs_priority_flagged');
  });

  // Dedicated function for priority flag writes — bypasses projection write guard
  // SECURITY DEFINER allows this function to set the projection session variable
  // without requiring the caller to do so explicitly.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_order_priority_flag(
      p_lasyncro_order_id UUID,
      p_flagged BOOLEAN
    ) RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      SET LOCAL "synchroflow.projection" = 'true';
      UPDATE order_fulfillment_status
      SET
        is_priority_flagged = p_flagged,
        priority_flagged_at = CASE WHEN p_flagged THEN NOW() ELSE priority_flagged_at END,
        updated_at = NOW()
      WHERE lasyncro_order_id = p_lasyncro_order_id;
    END;
    $$;
  `);

  // Auto-clear function called by batch release
  await knex.raw(`
    CREATE OR REPLACE FUNCTION clear_priority_flag_on_batch(
      p_lasyncro_order_ids UUID[]
    ) RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      SET LOCAL "synchroflow.projection" = 'true';
      UPDATE order_fulfillment_status
      SET
        is_priority_flagged = false,
        updated_at = NOW()
      WHERE lasyncro_order_id = ANY(p_lasyncro_order_ids)
        AND is_priority_flagged = true;
    END;
    $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP FUNCTION IF EXISTS clear_priority_flag_on_batch(UUID[])`);
  await knex.raw(`DROP FUNCTION IF EXISTS set_order_priority_flag(UUID, BOOLEAN)`);

  await knex.schema.alterTable('order_fulfillment_status', (table) => {
    table.dropIndex([], 'idx_ofs_priority_flagged');
    table.dropColumn('is_priority_flagged');
    table.dropColumn('priority_flagged_at');
  });
}