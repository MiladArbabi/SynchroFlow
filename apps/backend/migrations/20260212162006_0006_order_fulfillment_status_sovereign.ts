import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {

  // 1️⃣ Create native enum safely
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'fulfillment_status_type'
      ) THEN
        CREATE TYPE fulfillment_status_type AS ENUM (
          'pending',
          'processing',
          'fulfilled',
          'partially_fulfilled',
          'cancelled',
          'failed'
        );
      END IF;
    END$$;
  `);

  // 2️⃣ Create table using native enum type directly
  await knex.schema.createTable('order_fulfillment_status', (table) => {

    table
     .uuid('lasyncro_fulfillment_id')
     .primary()
     .defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table
      .specificType('status', 'fulfillment_status_type')
      .notNullable()
      .defaultTo('pending');

    table.timestamp('status_updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.text('status_reason');

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['lasyncro_order_id']);
  });

  // 3️⃣ Monotonic enforcement trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION enforce_fulfillment_status_monotonic()
    RETURNS trigger AS $$
    BEGIN
      IF OLD.status = 'fulfilled' AND NEW.status <> 'fulfilled' THEN
        RAISE EXCEPTION 'Fulfillment status cannot regress once fulfilled';
      END IF;

      IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'Cancelled fulfillment cannot transition';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER fulfillment_status_monotonic_trigger
    BEFORE UPDATE ON order_fulfillment_status
    FOR EACH ROW
    EXECUTE FUNCTION enforce_fulfillment_status_monotonic();
  `);
}

export async function down(knex: Knex): Promise<void> {

  await knex.raw(`
    DROP TRIGGER IF EXISTS fulfillment_status_monotonic_trigger
    ON order_fulfillment_status;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS enforce_fulfillment_status_monotonic;
  `);

  await knex.schema.dropTableIfExists('order_fulfillment_status');

  await knex.raw(`
    DROP TYPE IF EXISTS fulfillment_status_type;
  `);
}