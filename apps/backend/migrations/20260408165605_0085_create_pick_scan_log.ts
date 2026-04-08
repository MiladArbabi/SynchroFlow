import { Knex } from 'knex';

/**
 * MIGRATION 0085 — create_pick_scan_log
 * ---------------------------------------
 * Append-only log of every confirmed scan during a pick session.
 *
 * Each row represents one scan confirmation event:
 * - one variant, one quantity, one location, one operator, one timestamp
 *
 * Responsibilities:
 * - Source of truth for UPH computation per operator
 * - Audit trail for pick accuracy
 * - Idempotency anchor for inventory_movements writes
 *   (scan_id → device_event_id on inventory_movements)
 *
 * Invariants:
 * - Append-only — no updates, no deletes
 * - inventory_movement_id written at scan confirmation time
 * - unique on (pick_batch_id, lasyncro_line_item_id) — one confirmed
 *   scan per line item per batch; re-scan after undo replaces via status
 */
export async function up(knex: Knex): Promise<void> {

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'scan_status'
      ) THEN
        CREATE TYPE scan_status AS ENUM (
          'confirmed',
          'undone'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('pick_scan_log', (table) => {
    table
      .uuid('scan_id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .uuid('pick_batch_id')
      .notNullable()
      .references('pick_batch_id')
      .inTable('pick_batches')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_line_item_id')
      .notNullable()
      .references('lasyncro_line_item_id')
      .inTable('order_line_items')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable();

    table
      .string('location_code', 255)
      .notNullable();

    table
      .integer('quantity_confirmed')
      .notNullable();

    table
      .specificType('status', 'scan_status')
      .notNullable()
      .defaultTo('confirmed');

    /**
     * OPERATOR
     * --------
     * Operator who performed the scan.
     * Retained on user deletion for audit integrity.
     */
    table
      .integer('scanned_by')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');

    table
      .timestamp('scanned_at', { useTz: true })
      .notNullable();

    /**
     * INVENTORY MOVEMENT ANCHOR
     * -------------------------
     * Written at scan confirmation.
     * Links this scan to its ledger entry.
     * Null only if movement write failed (error state).
     */
    table
      .uuid('inventory_movement_id')
      .nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['pick_batch_id']);
    table.index(['scanned_by']);
    table.index(['lasyncro_variant_id']);
    table.index(['scanned_at']); // UPH time-window queries
  });

  // Append-only enforcement
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_pick_scan_log_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'pick_scan_log is append-only. % is not allowed.', TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER pick_scan_log_no_update
    BEFORE UPDATE ON pick_scan_log
    FOR EACH ROW EXECUTE FUNCTION prevent_pick_scan_log_mutation();

    CREATE TRIGGER pick_scan_log_no_delete
    BEFORE DELETE ON pick_scan_log
    FOR EACH ROW EXECUTE FUNCTION prevent_pick_scan_log_mutation();
  `);

  await knex.raw(`
    ALTER TABLE pick_scan_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pick_scan_log FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS pick_scan_log_tenant_isolation_policy ON pick_scan_log;
  `);

  await knex.raw(`
    CREATE POLICY pick_scan_log_tenant_isolation_policy
    ON pick_scan_log
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS pick_scan_log_no_update ON pick_scan_log;
    DROP TRIGGER IF EXISTS pick_scan_log_no_delete ON pick_scan_log;
    DROP FUNCTION IF EXISTS prevent_pick_scan_log_mutation();
  `);

  await knex.schema.dropTableIfExists('pick_scan_log');
  await knex.raw(`DROP TYPE IF EXISTS scan_status;`);
}