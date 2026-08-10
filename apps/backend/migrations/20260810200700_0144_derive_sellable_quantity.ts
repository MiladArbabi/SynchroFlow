import type { Knex } from 'knex';

/**
 * MIGRATION 0144 — derive_sellable_quantity
 * -----------------------------------------
 * INV-BLOCK-08 + INV-BLOCK-14
 *
 * sellable_quantity has no independent business meaning:
 * sellable_quantity === available_quantity by definition.
 *
 * Make PostgreSQL the sole authority so incremental writers cannot drift.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE inventory_truth
      DROP COLUMN sellable_quantity;

    ALTER TABLE inventory_truth
      ADD COLUMN sellable_quantity integer
      GENERATED ALWAYS AS (available_quantity) STORED;

    ALTER TABLE inventory_truth
      ALTER COLUMN sellable_quantity SET NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE inventory_truth
      DROP COLUMN sellable_quantity;

    ALTER TABLE inventory_truth
      ADD COLUMN sellable_quantity integer;

    UPDATE inventory_truth
    SET sellable_quantity = available_quantity;

    ALTER TABLE inventory_truth
      ALTER COLUMN sellable_quantity SET NOT NULL;
  `);
}