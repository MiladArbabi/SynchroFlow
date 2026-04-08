import { Knex } from 'knex';

/**
 * MIGRATION 0088 — create_warehouse_status_tables
 * -------------------------------------------------
 * Introduces warehouse lifecycle tracking at two levels:
 *
 * 1. order_warehouse_status — per order and per line item
 *    Tracks where each order/line item is in the warehouse pipeline.
 *    Monotonic trigger enforces no regression.
 *    Transitions 'shipped' → drives order_fulfillment_status to 'fulfilled'.
 *
 * 2. inventory_unit_status — per (shop_id, lasyncro_variant_id, location_code)
 *    Tracks physical warehouse state of stock per variant per location.
 *    Application-enforced transitions (may legitimately go backwards
 *    e.g. picked → stowed on order cancellation mid-pick).
 *
 * These are distinct from:
 * - order_fulfillment_status (commercial fulfillment truth)
 * - inventory_movements (stock delta ledger)
 * - inventory_truth (stock quantity projection)
 */

export async function up(knex: Knex): Promise<void> {

  // ─────────────────────────────────────────
  // 1️⃣ ENUMs
  // ─────────────────────────────────────────

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'order_warehouse_status_type'
      ) THEN
        CREATE TYPE order_warehouse_status_type AS ENUM (
          'awaiting_pick',
          'picking',
          'picked',
          'packing',
          'packed',
          'shipped',
          'partially_shipped',
          'cancelled'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'inventory_unit_status_type'
      ) THEN
        CREATE TYPE inventory_unit_status_type AS ENUM (
          'received',
          'stowed',
          'reserved',
          'picked',
          'packed',
          'shipped',
          'returned'
        );
      END IF;
    END$$;
  `);

  // ─────────────────────────────────────────
  // 2️⃣ order_warehouse_status
  // ─────────────────────────────────────────

  await knex.schema.createTable('order_warehouse_status', (table) => {
    table
      .uuid('lasyncro_order_id')
      .primary()
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table
      .specificType('status', 'order_warehouse_status_type')
      .notNullable()
      .defaultTo('awaiting_pick');

    table.timestamp('status_updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * PICK BATCH REFERENCE
     * --------------------
     * Links order to its assigned batch.
     * Nullable — order may not yet be batched.
     */
    table
      .uuid('pick_batch_id')
      .nullable()
      .references('pick_batch_id')
      .inTable('pick_batches')
      .onDelete('SET NULL');

    /**
     * SHIPPING COMPLETION
     * -------------------
     * shipped_at set when status transitions to 'shipped'.
     * Drives order_fulfillment_status → 'fulfilled' transition.
     */
    table.timestamp('shipped_at', { useTz: true }).nullable();
    table.timestamp('packed_at', { useTz: true }).nullable();
    table.timestamp('picked_at', { useTz: true }).nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['pick_batch_id']);
    table.index(['status']);
  });

  // ─────────────────────────────────────────
  // 3️⃣ order_line_item_warehouse_status
  // ─────────────────────────────────────────

  await knex.schema.createTable('order_line_item_warehouse_status', (table) => {
    table
      .uuid('lasyncro_line_item_id')
      .primary()
      .notNullable()
      .references('lasyncro_line_item_id')
      .inTable('order_line_items')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    /**
     * shop_id denormalized for direct RLS enforcement.
     */
    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .specificType('status', 'order_warehouse_status_type')
      .notNullable()
      .defaultTo('awaiting_pick');

    table.timestamp('status_updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['lasyncro_order_id']);
    table.index(['shop_id', 'status']);
  });

  // ─────────────────────────────────────────
  // 4️⃣ Monotonic trigger on order_warehouse_status
  // ─────────────────────────────────────────

  await knex.raw(`
    CREATE OR REPLACE FUNCTION enforce_order_warehouse_status_monotonic()
    RETURNS trigger AS $$
    DECLARE
      old_rank INTEGER;
      new_rank INTEGER;
    BEGIN
      old_rank := CASE OLD.status
        WHEN 'awaiting_pick'     THEN 0
        WHEN 'picking'           THEN 1
        WHEN 'picked'            THEN 2
        WHEN 'packing'           THEN 3
        WHEN 'packed'            THEN 4
        WHEN 'shipped'           THEN 5
        WHEN 'partially_shipped' THEN 5
        WHEN 'cancelled'         THEN 6
        ELSE 0
      END;

      new_rank := CASE NEW.status
        WHEN 'awaiting_pick'     THEN 0
        WHEN 'picking'           THEN 1
        WHEN 'picked'            THEN 2
        WHEN 'packing'           THEN 3
        WHEN 'packed'            THEN 4
        WHEN 'shipped'           THEN 5
        WHEN 'partially_shipped' THEN 5
        WHEN 'cancelled'         THEN 6
        ELSE 0
      END;

      -- Cancelled is terminal
      IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'Cancelled warehouse status cannot transition';
      END IF;

      -- Prevent regression — return OLD silently (replay-safe)
      IF new_rank < old_rank THEN
        RETURN OLD;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER order_warehouse_status_monotonic_trigger
    BEFORE UPDATE ON order_warehouse_status
    FOR EACH ROW
    EXECUTE FUNCTION enforce_order_warehouse_status_monotonic();
  `);

  // RLS — order_warehouse_status (via orders)
  await knex.raw(`
    ALTER TABLE order_warehouse_status ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_warehouse_status FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_warehouse_status_tenant_isolation_policy ON order_warehouse_status;
  `);

  await knex.raw(`
    CREATE POLICY order_warehouse_status_tenant_isolation_policy
    ON order_warehouse_status
    USING (
      lasyncro_order_id IN (
        SELECT lasyncro_order_id FROM orders
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  // RLS — order_line_item_warehouse_status (direct shop_id)
  await knex.raw(`
    ALTER TABLE order_line_item_warehouse_status ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_line_item_warehouse_status FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_line_item_warehouse_status_tenant_isolation_policy ON order_line_item_warehouse_status;
  `);

  await knex.raw(`
    CREATE POLICY order_line_item_warehouse_status_tenant_isolation_policy
    ON order_line_item_warehouse_status
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  // ─────────────────────────────────────────
  // 5️⃣ inventory_unit_status
  // ─────────────────────────────────────────

  await knex.schema.createTable('inventory_unit_status', (table) => {
    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('CASCADE');

    table
      .string('location_code', 255)
      .notNullable();

    table.primary(['shop_id', 'lasyncro_variant_id', 'location_code']);

    table
      .specificType('status', 'inventory_unit_status_type')
      .notNullable()
      .defaultTo('stowed');

    table.timestamp('status_updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id', 'status']);
    table.index(['lasyncro_variant_id']);
  });

  // RLS — inventory_unit_status (direct shop_id)
  await knex.raw(`
    ALTER TABLE inventory_unit_status ENABLE ROW LEVEL SECURITY;
    ALTER TABLE inventory_unit_status FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS inventory_unit_status_tenant_isolation_policy ON inventory_unit_status;
  `);

  await knex.raw(`
    CREATE POLICY inventory_unit_status_tenant_isolation_policy
    ON inventory_unit_status
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS order_warehouse_status_monotonic_trigger ON order_warehouse_status;
    DROP FUNCTION IF EXISTS enforce_order_warehouse_status_monotonic();
  `);

  await knex.schema.dropTableIfExists('inventory_unit_status');
  await knex.schema.dropTableIfExists('order_line_item_warehouse_status');
  await knex.schema.dropTableIfExists('order_warehouse_status');

  await knex.raw(`DROP TYPE IF EXISTS order_warehouse_status_type;`);
  await knex.raw(`DROP TYPE IF EXISTS inventory_unit_status_type;`);
}