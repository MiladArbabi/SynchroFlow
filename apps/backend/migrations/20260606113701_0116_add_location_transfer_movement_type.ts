// apps/backend/migrations/20260606113701_0116_add_location_transfer_movement_type.ts
import type { Knex } from 'knex';

/**
 * MIGRATION 0116 — Add location_transfer inventory movement type
 * ---------------------------------------------------------------
 * The stow process transfers stock from a warehouse root (e.g. WH-1-ROOT)
 * to a specific bin (e.g. A-1). This movement was never auditable because
 * the inventory_movement_type enum had no transfer variant and the sign
 * check constraint had no clause for it.
 *
 * Changes:
 *   1. Add 'location_transfer' to inventory_movement_type enum
 *   2. Drop inventory_movement_sign_check constraint
 *   3. Recreate constraint with location_transfer clause (quantity_delta <> 0,
 *      either direction — negative at source, positive at destination)
 *
 * WHY transaction: false
 *   PostgreSQL requires ALTER TYPE ... ADD VALUE to commit before the new
 *   enum value can be referenced in a constraint in the same session.
 *   Wrapping both in one transaction causes error 55P04 "unsafe use of new
 *   enum value". Disabling the transaction wrapper lets the ADD VALUE commit
 *   immediately so the subsequent ADD CONSTRAINT can reference it safely.
 *
 * Rollback note:
 *   PostgreSQL cannot remove enum values once added. The down migration
 *   restores the constraint without the location_transfer clause, preventing
 *   new rows of that type. Only safe to run down() on a DB with no
 *   existing location_transfer rows.
 */

// Required: prevents Knex from wrapping in a transaction so ADD VALUE
// commits before the constraint references it (PostgreSQL 55P04).
export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  // 1. Extend the enum — IF NOT EXISTS prevents error on re-run
  await knex.raw(`ALTER TYPE inventory_movement_type ADD VALUE IF NOT EXISTS 'location_transfer'`);

  // 2. Drop the existing sign check — must be replaced, not altered
  await knex.raw(`
    ALTER TABLE inventory_movements
    DROP CONSTRAINT inventory_movement_sign_check
  `);

  // 3. Recreate with location_transfer: quantity_delta <> 0, either direction
  await knex.raw(`
    ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_movement_sign_check CHECK (
      (
        movement_type = ANY (ARRAY[
          'inbound_purchase'::inventory_movement_type,
          'refund_return'::inventory_movement_type,
          'manual_adjustment'::inventory_movement_type,
          'reservation_hold'::inventory_movement_type
        ])
        AND quantity_delta > 0
      )
      OR (
        movement_type = ANY (ARRAY[
          'sale'::inventory_movement_type,
          'damage'::inventory_movement_type,
          'shrinkage'::inventory_movement_type,
          'reservation_release'::inventory_movement_type
        ])
        AND quantity_delta < 0
      )
      OR (movement_type = 'opening_balance'::inventory_movement_type)
      OR (
        movement_type = 'reconciliation_correction'::inventory_movement_type
        AND quantity_delta <> 0
      )
      OR (
        movement_type = 'location_transfer'::inventory_movement_type
        AND quantity_delta <> 0
      )
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Restore original constraint — safe only when no location_transfer rows exist
  await knex.raw(`
    ALTER TABLE inventory_movements
    DROP CONSTRAINT inventory_movement_sign_check
  `);

  await knex.raw(`
    ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_movement_sign_check CHECK (
      (
        movement_type = ANY (ARRAY[
          'inbound_purchase'::inventory_movement_type,
          'refund_return'::inventory_movement_type,
          'manual_adjustment'::inventory_movement_type,
          'reservation_hold'::inventory_movement_type
        ])
        AND quantity_delta > 0
      )
      OR (
        movement_type = ANY (ARRAY[
          'sale'::inventory_movement_type,
          'damage'::inventory_movement_type,
          'shrinkage'::inventory_movement_type,
          'reservation_release'::inventory_movement_type
        ])
        AND quantity_delta < 0
      )
      OR (movement_type = 'opening_balance'::inventory_movement_type)
      OR (
        movement_type = 'reconciliation_correction'::inventory_movement_type
        AND quantity_delta <> 0
      )
    )
  `);
  // Note: 'location_transfer' remains in the enum — PostgreSQL does not support
  // removing enum values. The constraint above prevents new rows of that type.
}