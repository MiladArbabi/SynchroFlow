import { Knex } from 'knex';

/**
 * INV-SHOPIFY-LOCATION-10
 *
 * Shopify inventory is scoped to Shopify Locations, while laSyncro's
 * authoritative physical boundary is the warehouse. Persist the external
 * Shopify Location identity on warehouses rather than individual bins.
 *
 * warehouse_locations.external_location_id remains temporarily for backward
 * compatibility and will not be used as the authoritative mapping.
 */
export async function up(knex: Knex): Promise<void> {
  const warehousesExist = await knex.schema.hasTable('warehouses');

  if (!warehousesExist) {
    throw new Error(
      'INV-SHOPIFY-LOCATION-10: warehouses table is required before adding Shopify location mapping'
    );
  }

  const hasExternalLocationId = await knex.schema.hasColumn(
    'warehouses',
    'external_location_id'
  );

  if (!hasExternalLocationId) {
    await knex.schema.alterTable('warehouses', (table) => {
      table
        .string('external_location_id', 255)
        .nullable()
        .comment(
          'Shopify Location ID mapped to this physical warehouse. Null means mapping is not configured.'
        );
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS warehouses_shop_external_location_unique
    ON warehouses (shop_id, external_location_id)
    WHERE external_location_id IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  const warehousesExist = await knex.schema.hasTable('warehouses');

  if (!warehousesExist) {
    throw new Error(
      'INV-SHOPIFY-LOCATION-10 rollback: warehouses table does not exist'
    );
  }

  await knex.raw(`
    DROP INDEX IF EXISTS warehouses_shop_external_location_unique;
  `);

  const hasExternalLocationId = await knex.schema.hasColumn(
    'warehouses',
    'external_location_id'
  );

  if (hasExternalLocationId) {
    await knex.schema.alterTable('warehouses', (table) => {
      table.dropColumn('external_location_id');
    });
  }
}
