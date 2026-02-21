import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {

  // 1️⃣ Create ENUM (idempotent-safe)
  await knex.schema.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'warehouse_location_type'
      ) THEN
        CREATE TYPE warehouse_location_type AS ENUM (
          'warehouse',
          'lane',
          'shelf',
          'bin'
        );
      END IF;
    END$$;
  `);

  // 2️⃣ Create warehouse_locations table
  await knex.schema.createTable('warehouse_locations', (table) => {
    table
      .string('location_code', 255)
      .notNullable();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .string('parent_location_code', 255)
      .nullable()
      .references('location_code')
      .inTable('warehouse_locations')
      .onDelete('SET NULL');

    table
      .string('external_location_id', 255)
      .nullable(); // Shopify location_id mapping

    table
      .specificType('type', 'warehouse_location_type')
      .notNullable();

    table
      .boolean('active')
      .notNullable()
      .defaultTo(true);

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['location_code']);

    table.unique(['shop_id', 'location_code']);
    table.unique(['shop_id', 'external_location_id'], 'warehouse_external_location_unique');
    table.index(['shop_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('warehouse_locations');

  await knex.schema.raw(`
    DROP TYPE IF EXISTS warehouse_location_type;
  `);
}
