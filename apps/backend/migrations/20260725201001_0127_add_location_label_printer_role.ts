// apps/backend/migrations/20260725201001_add_location_label_printer_role.ts
import { Knex } from 'knex';

/**
 *  * MIGRATION 0127 — add_location_label_printer_role
 * --------------------------------------------------
 * Adds location_label to the printer_role enum for existing databases.
 * Fresh installs get this value directly from the amended base migration
 * (0106_create_printers); this migration exists only to bring already-
 * -provisioned shop databases in line, since Postgres requires
 * ALTER TYPE ... ADD VALUE to run outside a surrounding transaction block
 * shared with other DDL.
 *
 * Introduced under GitHub issue 1047 (Unified Printing System) — lets
 * shop admins route Floor Planning bin/lane barcode labels to a printer
 * distinct from unit_label, invoice, and problem_label jobs.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'location_label'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'printer_role')
      ) THEN
        ALTER TYPE printer_role ADD VALUE 'location_label';
      END IF;
    END$$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Postgres does not support removing enum values directly.
  // No-op: rolling back requires recreating the type, which is out of
  // scope for this additive migration. If truly needed, a manual
  // migration recreating printer_role without this value would be
  // required, with a check that no printers rows currently use it.
}