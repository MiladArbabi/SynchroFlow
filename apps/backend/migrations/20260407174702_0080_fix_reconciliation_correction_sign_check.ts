import type { Knex } from 'knex';

/**
 * FIX: inventory_movement_sign_check
 * -----------------------------------
 * reconciliation_correction movements can be either positive or negative:
 * - Positive: Shopify reports MORE stock than our ledger (restock, return)
 * - Negative: Shopify reports LESS stock than our ledger (shrinkage, loss)
 *
 * The original constraint incorrectly required quantity_delta > 0
 * for reconciliation_correction, blocking legitimate negative corrections.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE inventory_movements
    DROP CONSTRAINT inventory_movement_sign_check;
  `);

  await knex.raw(`
    ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_movement_sign_check
    CHECK (
      (
        movement_type IN (
          'inbound_purchase',
          'refund_return',
          'manual_adjustment',
          'reservation_hold'
        )
        AND quantity_delta > 0
      )
      OR
      (
        movement_type IN (
          'sale',
          'damage',
          'shrinkage',
          'reservation_release'
        )
        AND quantity_delta < 0
      )
      OR
      (
        movement_type = 'opening_balance'
      )
      OR
      (
        movement_type = 'reconciliation_correction'
        AND quantity_delta <> 0
      )
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE inventory_movements
    DROP CONSTRAINT inventory_movement_sign_check;
  `);

  await knex.raw(`
    ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_movement_sign_check
    CHECK (
      (
        movement_type IN (
          'inbound_purchase',
          'refund_return',
          'manual_adjustment',
          'reconciliation_correction',
          'reservation_hold'
        )
        AND quantity_delta > 0
      )
      OR
      (
        movement_type IN (
          'sale',
          'damage',
          'shrinkage',
          'reservation_release'
        )
        AND quantity_delta < 0
      )
      OR
      (
        movement_type = 'opening_balance'
      )
    );
  `);
}