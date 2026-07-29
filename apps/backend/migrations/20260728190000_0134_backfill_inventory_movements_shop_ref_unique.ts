import { Knex } from 'knex';

/**
 * MIGRATION 0134 — backfill_inventory_movements_shop_ref_unique
 * -----------------------------------------------------------------
 * E2E-011 forward fix.
 *
 * Migration 0037 ran in production on 2026-06-18 before
 * inventory_movements_shop_ref_unique was added to that already-applied
 * migration on 2026-07-06 and expanded with movement_type on 2026-07-08.
 *
 * Fresh databases already contain this constraint. Upgraded production
 * databases do not, so ON CONFLICT against these six columns fails.
 *
 * Production was audited before this migration and contained no duplicate
 * rows for the six-column logical reference key.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'inventory_movements'::regclass
          AND conname = 'inventory_movements_shop_ref_unique'
          AND contype = 'u'
      ) THEN
        ALTER TABLE inventory_movements
        ADD CONSTRAINT inventory_movements_shop_ref_unique
        UNIQUE (
          shop_id,
          reference_type,
          reference_id,
          lasyncro_variant_id,
          location_code,
          movement_type
        );
      END IF;
    END
    $$;
  `);
}

export async function down(_knex: Knex): Promise<void> {
  /**
   * Intentionally retained.
   *
   * The constraint is part of migration 0037's canonical fresh-schema
   * definition. Removing it during rollback would recreate the same drift
   * between fresh and upgraded databases and break existing ON CONFLICT
   * writers.
   */
}