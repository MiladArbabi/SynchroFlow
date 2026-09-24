import type { Knex } from 'knex';

/**
 * Opening inventory reconciliation establishes physical stock observed by a
 * LaSyncro operator. It is deliberately distinct from Shopify opening_balance:
 *
 * Shopify opening expectation -> evidence only
 * opening_inventory_reconcile -> canonical physical warehouse truth
 *
 * PostgreSQL enum additions must commit before the new value may be referenced
 * by the sign constraint, so this migration intentionally runs without the
 * normal migration transaction wrapper.
 */
export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE inventory_movement_type
    ADD VALUE IF NOT EXISTS 'opening_inventory_reconcile'
  `);

  await knex.raw(`
    ALTER TABLE inventory_movements
    DROP CONSTRAINT IF EXISTS inventory_movement_sign_check
  `);

  await knex.raw(`
    ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_movement_sign_check CHECK (
      (
        movement_type = ANY (ARRAY[
          'inbound_purchase'::inventory_movement_type,
          'refund_return'::inventory_movement_type,
          'manual_adjustment'::inventory_movement_type,
          'reservation_hold'::inventory_movement_type,
          'opening_inventory_reconcile'::inventory_movement_type
        ])
        AND quantity_delta > 0
      )
      OR (
        movement_type = ANY (ARRAY[
          'sale'::inventory_movement_type,
          'damage'::inventory_movement_type,
          'shrinkage'::inventory_movement_type,
          'reservation_release'::inventory_movement_type,
          'write_off_return'::inventory_movement_type,
          'pick_removal'::inventory_movement_type,
          'fulfillment_removal'::inventory_movement_type
        ])
        AND quantity_delta < 0
      )
      OR movement_type = 'opening_balance'::inventory_movement_type
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
  const openingMovement = await knex('inventory_movements')
    .where({ movement_type: 'opening_inventory_reconcile' })
    .first('lasyncro_inventory_movement_id');

  if (openingMovement) {
    throw new Error(
      '[MIGRATION_0197_DOWN_BLOCKED] Cannot remove opening-inventory movement semantics while opening_inventory_reconcile movements exist'
    );
  }

  await knex.raw(`
    ALTER TABLE inventory_movements
    DROP CONSTRAINT IF EXISTS inventory_movement_sign_check
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
          'write_off_return'::inventory_movement_type,
          'pick_removal'::inventory_movement_type,
          'fulfillment_removal'::inventory_movement_type
        ])
        AND quantity_delta < 0
      )
      OR movement_type = 'opening_balance'::inventory_movement_type
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

  /**
   * PostgreSQL enum values cannot safely be removed in-place.
   * The value remains present but the restored sign constraint prevents new
   * opening_inventory_reconcile rows after rollback.
   */
}
