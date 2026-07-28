import { Knex } from 'knex';

/**
 * ⚠️ DRIFT WARNING (added post PROD-ZONE1, 2026-07-28)
 * -----------------------------------------------------
 * This migration ran in production on 2026-06-18 (batch 1). The composite
 * FK this file currently declares — warehouse_locations_parent_same_warehouse_fk,
 * referencing (shop_id, warehouse_id, parent_location_code) — was NOT what
 * ran in prod. Prod still has the older two-column FK from this migration's
 * pre-amendment version: warehouse_locations_shop_id_parent_location_code_foreign,
 * referencing (shop_id, parent_location_code) only.
 *
 * Knex marks this migration complete and will NEVER re-run it, so this
 * file's current `up()` does not reflect prod's real constraint set.
 * Confirmed via schema diff 2026-07-28 (see PROD-ZONE1 / migration 0128).
 *
 * DO NOT amend this file's `up()` again expecting it to affect prod.
 * If the composite FK is ever needed in prod, write a new forward
 * migration instead (rule 7).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.dropForeign(['parent_location_code']);
  });

  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.dropPrimary();
  });

  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.dropUnique(['shop_id', 'location_code']);
  });

  // Transitional compatibility key. Operational readers still address
  // locations by shop_id + location_code until warehouse-aware APIs land.
  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.primary(['shop_id', 'location_code']);
  });

  /**
   * Parent and child must belong to the same warehouse.
   *
   * RESTRICT is intentional: deleting a parent with active children must fail
   * clearly rather than attempting to null non-null tenant/warehouse columns.
   */
  await knex.schema.alterTable('warehouse_locations', (table) => {
    table
      .foreign(
        ['shop_id', 'warehouse_id', 'parent_location_code'],
        'warehouse_locations_parent_same_warehouse_fk'
      )
      .references(['shop_id', 'warehouse_id', 'location_code'])
      .inTable('warehouse_locations')
      .onDelete('RESTRICT');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.dropForeign(
      ['shop_id', 'warehouse_id', 'parent_location_code'],
      'warehouse_locations_parent_same_warehouse_fk'
    );
  });

  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.dropPrimary();
  });

  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.primary(['location_code']);
  });

  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.unique(['shop_id', 'location_code']);
  });

  await knex.schema.alterTable('warehouse_locations', (table) => {
    table
      .foreign(['parent_location_code'])
      .references(['location_code'])
      .inTable('warehouse_locations')
      .onDelete('SET NULL');
  });
}