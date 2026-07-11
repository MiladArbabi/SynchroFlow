import { Knex } from 'knex';

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