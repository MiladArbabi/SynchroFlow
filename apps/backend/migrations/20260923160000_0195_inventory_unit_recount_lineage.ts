import { Knex } from 'knex';

/**
 * Inventory-unit source-neutral lineage.
 *
 * A canonical LSU may originate from exactly one physical-observation boundary:
 *
 *   Receive   -> receive_job_line_id
 *   Reconcile -> recount_line_id
 *
 * receive_sequence remains the immutable 1-based sequence inside whichever
 * source anchor created the physical unit.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE inventory_unit_provenance
    ADD VALUE IF NOT EXISTS 'opening_inventory_reconcile';
  `);

  await knex.schema.alterTable('inventory_units', (table) => {
    table
      .uuid('recount_line_id')
      .nullable()
      .references('recount_line_id')
      .inTable('inventory_recount_lines')
      .onDelete('RESTRICT');

    table.index(
      ['recount_line_id'],
      'inventory_units_recount_line_idx'
    );

    table.unique(
      ['shop_id', 'recount_line_id', 'receive_sequence'],
      'inventory_units_recount_unique'
    );
  });

  await knex.raw(`
    ALTER TABLE inventory_units
    ALTER COLUMN receive_job_line_id DROP NOT NULL;
  `);

  await knex.raw(`
    ALTER TABLE inventory_units
    ADD CONSTRAINT inventory_units_source_anchor_xor
    CHECK (
      (receive_job_line_id IS NOT NULL AND recount_line_id IS NULL)
      OR
      (receive_job_line_id IS NULL AND recount_line_id IS NOT NULL)
    );
  `);

  await knex.raw(`
    ALTER TABLE inventory_units
    ADD CONSTRAINT inventory_units_reconcile_provenance_check
    CHECK (
      (recount_line_id IS NOT NULL AND source::text = 'opening_inventory_reconcile')
      OR
      (recount_line_id IS NULL AND source::text <> 'opening_inventory_reconcile')
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  const reconcileUnit = await knex('inventory_units')
    .whereNotNull('recount_line_id')
    .first('id');

  if (reconcileUnit) {
    throw new Error(
      '[MIGRATION_0195_DOWN_BLOCKED] Cannot restore receive-only inventory-unit lineage while Reconcile-origin units exist'
    );
  }

  await knex.raw(`
    ALTER TABLE inventory_units
    DROP CONSTRAINT IF EXISTS inventory_units_reconcile_provenance_check;
  `);

  await knex.raw(`
    ALTER TABLE inventory_units
    DROP CONSTRAINT IF EXISTS inventory_units_source_anchor_xor;
  `);

  await knex.schema.alterTable('inventory_units', (table) => {
    table.dropUnique(
      ['shop_id', 'recount_line_id', 'receive_sequence'],
      'inventory_units_recount_unique'
    );

    table.dropIndex(
      ['recount_line_id'],
      'inventory_units_recount_line_idx'
    );

    table.dropColumn('recount_line_id');
  });

  await knex.raw(`
    ALTER TABLE inventory_units
    ALTER COLUMN receive_job_line_id SET NOT NULL;
  `);

  /**
   * PostgreSQL enum values are intentionally not removed on down().
   * Removing one safely requires rebuilding the enum type and is unnecessary
   * for restoring the pre-0189 table contract.
   */
}
