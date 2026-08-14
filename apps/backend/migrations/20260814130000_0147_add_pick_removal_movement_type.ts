// apps/backend/migrations/20260814130000_0147_add_pick_removal_movement_type.ts
import type { Knex } from 'knex';

/**
 * MIGRATION 0147 — Add pick_removal inventory movement type
 * ----------------------------------------------------------
 * INV-SALE-DOUBLE-01. Two writers debited the same units:
 *
 *   revenue-units.writer.ts:274  'sale' at order ingestion  (universal)
 *   pickScan.service.ts:259      'sale' at operator scan    (floor only)
 *
 * Every on-hand computation counted both. Shop 2, built through the real
 * pipeline, proved ingestion alone reproduces inventory_truth exactly:
 *
 *   variant 1b36716c   opening 60  ingest -5   truth 55  drift 0
 *   variant 40a185ed   opening 40  ingest -3   truth 37  drift 0
 *   variant 8eb8114d   opening 25  ingest -1   truth 24  drift 0
 *                                              total 116 = truth
 *
 * Including the pick debit gave 107 against a true 116.
 *
 * Ingestion keeps 'sale' — it is the only debit covering orders that ship
 * without a pick scan (shop 1: 3 of 3 fulfilled orders never picked), and
 * historicalCanonicalRepair.service.ts:1106 hard-depends on that row,
 * throwing if it is absent.
 *
 * The pick row becomes 'pick_removal': excluded from on-hand, retained as
 * the operator-activity signal (it alone carries operator_id and
 * scan_source — verified 5/5 on pick rows, 0/31 on ingestion rows).
 *
 * WHY transaction: false — same as 0116. PostgreSQL requires
 * ALTER TYPE ... ADD VALUE to commit before a constraint can reference it
 * in the same session (error 55P04).
 *
 * Sign: physical removal, quantity_delta < 0 — same arm as sale/damage/
 * shrinkage/reservation_release.
 *
 * Rollback: PostgreSQL cannot remove enum values. down() restores the
 * constraint without the pick_removal clause, preventing new rows of that
 * type. Only safe on a DB with no existing pick_removal rows.
 */

export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE inventory_movement_type ADD VALUE IF NOT EXISTS 'pick_removal'`);

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
          'reservation_release'::inventory_movement_type,
          'pick_removal'::inventory_movement_type
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
      OR (
        movement_type = 'location_transfer'::inventory_movement_type
        AND quantity_delta <> 0
      )
    )
  `);
  // 'pick_removal' remains in the enum — PostgreSQL cannot remove enum
  // values. The constraint above prevents new rows of that type.
}
