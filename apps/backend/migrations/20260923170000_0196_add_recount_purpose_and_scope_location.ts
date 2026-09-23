import { Knex } from 'knex';

/**
 * Opening inventory reconciliation reuses the existing Recount engine.
 *
 * One opening_inventory recount task represents one physical bin from the
 * initial warehouse snapshot. Those tasks form the durable progress ledger:
 *
 *   dispatched    = not started
 *   claimed/counting = in progress
 *   manual_review = needs review
 *   committed     = complete
 *
 * Existing tasks remain cycle_count automatically.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('inventory_recount_tasks', (table) => {
    table
      .string('purpose', 64)
      .notNullable()
      .defaultTo('cycle_count');

    table
      .string('scope_location_code', 255)
      .nullable();

    table.index(
      ['shop_id', 'purpose', 'status'],
      'inventory_recount_tasks_purpose_status_idx'
    );
  });

  await knex.raw(`
    ALTER TABLE inventory_recount_tasks
    ADD CONSTRAINT inventory_recount_tasks_purpose_check
    CHECK (
      purpose IN ('cycle_count', 'opening_inventory')
    );
  `);

  await knex.raw(`
    ALTER TABLE inventory_recount_tasks
    ADD CONSTRAINT inventory_recount_tasks_opening_scope_check
    CHECK (
      purpose <> 'opening_inventory'
      OR (
        scope::text = 'location'
        AND scope_location_code IS NOT NULL
        AND btrim(scope_location_code) <> ''
      )
    );
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX inventory_recount_tasks_opening_bin_unique
    ON inventory_recount_tasks (
      shop_id,
      warehouse_id,
      scope_location_code
    )
    WHERE purpose = 'opening_inventory';
  `);
}

export async function down(knex: Knex): Promise<void> {
  const openingTask = await knex('inventory_recount_tasks')
    .where({ purpose: 'opening_inventory' })
    .first('recount_task_id');

  if (openingTask) {
    throw new Error(
      '[MIGRATION_0196_DOWN_BLOCKED] Cannot remove opening-inventory Recount semantics while opening_inventory tasks exist'
    );
  }

  await knex.raw(`
    DROP INDEX IF EXISTS inventory_recount_tasks_opening_bin_unique;
  `);

  await knex.raw(`
    ALTER TABLE inventory_recount_tasks
    DROP CONSTRAINT IF EXISTS inventory_recount_tasks_opening_scope_check;
  `);

  await knex.raw(`
    ALTER TABLE inventory_recount_tasks
    DROP CONSTRAINT IF EXISTS inventory_recount_tasks_purpose_check;
  `);

  await knex.schema.alterTable('inventory_recount_tasks', (table) => {
    table.dropIndex(
      ['shop_id', 'purpose', 'status'],
      'inventory_recount_tasks_purpose_status_idx'
    );

    table.dropColumn('scope_location_code');
    table.dropColumn('purpose');
  });
}
