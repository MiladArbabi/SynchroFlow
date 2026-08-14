import type { Knex } from 'knex';

/**
 * INV-INGEST-TRUTH-01
 *
 * `sale` records economic order demand at ingestion.
 *
 * Physical outbound movement is represented separately:
 * - pick_removal        → confirmed WMS pick
 * - fulfillment_removal → Shopify fulfillment for quantity not already picked
 */
export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE inventory_movement_type
    ADD VALUE IF NOT EXISTS 'fulfillment_removal'
  `);

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