// Hard deprecation of inventory_truth
// -----------------------------------
// Guarantees:
// - No INSERT / UPDATE / DELETE allowed
// - Mutable snapshot inventory is forbidden
// - Future inventory must be append-only (sku_movements)
// - Protection survives DB resets

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Clean state (idempotent)
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_block_inventory_truth_mutation
    ON inventory_truth;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS block_inventory_truth_mutation();
  `);

  await knex.raw(`
    CREATE FUNCTION block_inventory_truth_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        'inventory_truth is deprecated. Inventory must be append-only via sku_movements.';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_block_inventory_truth_mutation
    BEFORE INSERT OR UPDATE OR DELETE
    ON inventory_truth
    FOR EACH ROW
    EXECUTE FUNCTION block_inventory_truth_mutation();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_block_inventory_truth_mutation
    ON inventory_truth;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS block_inventory_truth_mutation();
  `);
}
