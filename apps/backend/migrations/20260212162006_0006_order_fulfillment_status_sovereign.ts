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

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'inventory_block_type'
      ) THEN
        CREATE TYPE inventory_block_type AS ENUM (
          'stockout',
          'oversell'
        );
      END IF;
    END$$;
  `);

  // 2️⃣ Create table using native enum type directly
  await knex.schema.createTable('order_fulfillment_status', (table) => {

    table
     .uuid('lasyncro_fulfillment_id')
     .primary()

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
    
    /**
     * EXECUTION COMPLETION TIMESTAMPS
     * --------------------------------
     * fulfilled_at:
     *   Set when status transitions to 'fulfilled'.
     *
     * This is separate from status_updated_at to preserve:
     * - execution completion truth
     * - SLA measurement capability
     * - latency modeling
     */
    table.timestamp('fulfilled_at', { useTz: true }).nullable();

    table.text('status_reason');

    /**
     * INVENTORY BLOCK
     * ----------------
     * Indicates physical stock constraints.
     *
     * Values:
     * - stockout
     * - oversell
     */
    table
      .specificType('inventory_block_type', 'inventory_block_type')
      .nullable();

    /**
     * CUSTOMER BLOCK
     * ----------------
     * Indicates the order cannot proceed
     * until customer action occurs.
     *
     * Examples:
     * - invalid_address
     * - awaiting_customer_response
     */
    table.text('customer_block_type').nullable();

    /**
     * OPERATIONAL BLOCK
     * ------------------
     * Internal operational constraint
     * preventing fulfillment execution.
     *
     * Examples:
     * - fraud_review
     * - warehouse_delay
     */
    table.text('operational_block_type').nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['lasyncro_order_id']);
  });

  // --- RLS: Enforce tenant isolation ---
  await knex.raw(`
    ALTER TABLE order_fulfillment_status ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_fulfillment_status FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_fulfillment_status_tenant_isolation_policy ON order_fulfillment_status;
  `);

  await knex.raw(`
    CREATE POLICY order_fulfillment_status_tenant_isolation_policy
    ON order_fulfillment_status
    USING (
      lasyncro_order_id IN (
        SELECT lasyncro_order_id
        FROM orders
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  // NOTE:
  // Enforced via orders → no direct shop_id

  // 3️⃣ Monotonic enforcement trigger
  await knex.raw(`
    CREATE OR REPLACE FUNCTION enforce_fulfillment_status_monotonic()
    RETURNS trigger AS $$
    DECLARE
      old_rank INTEGER;
      new_rank INTEGER;
    BEGIN

      -- Precedence model
      old_rank := CASE OLD.status
        WHEN 'pending' THEN 0
        WHEN 'processing' THEN 1
        WHEN 'partially_fulfilled' THEN 2
        WHEN 'fulfilled' THEN 3
        WHEN 'cancelled' THEN 4
        WHEN 'failed' THEN 5
        ELSE 0
      END;

      new_rank := CASE NEW.status
        WHEN 'pending' THEN 0
        WHEN 'processing' THEN 1
        WHEN 'partially_fulfilled' THEN 2
        WHEN 'fulfilled' THEN 3
        WHEN 'cancelled' THEN 4
        WHEN 'failed' THEN 5
        ELSE 0
      END;

      -- Cancellation is terminal
      IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'Cancelled fulfillment cannot transition';
      END IF;

      -- Prevent regression
      IF new_rank < old_rank THEN
        RAISE EXCEPTION 'Fulfillment status cannot regress';
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

  /**
   * =========================================================
   * ORDER FULFILLMENT HISTORY (APPEND-ONLY EXECUTION LOG)
   * =========================================================
   *
   * Purpose:
   * - Preserve full execution timeline
   * - Enable latency analysis
   * - Allow SLA breach reconstruction
   * - Provide replay-safe audit trail
   *
   * This table is:
   * - Append-only
   * - Never updated
   * - Never deleted (except cascade)
   */
  await knex.schema.createTable('order_fulfillment_history', (table) => {

    table
      .uuid('lasyncro_fulfillment_event_id')
      .primary();

    table
      .uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table
      .specificType('status', 'fulfillment_status_type')
      .notNullable();

    table.timestamp('event_occurred_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('recorded_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['lasyncro_order_id']);
  });

  // --- RLS: Enforce tenant isolation ---
  await knex.raw(`
    ALTER TABLE order_fulfillment_history ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_fulfillment_history FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_fulfillment_history_tenant_isolation_policy ON order_fulfillment_history;
  `);

  await knex.raw(`
    CREATE POLICY order_fulfillment_history_tenant_isolation_policy
    ON order_fulfillment_history
    USING (
      lasyncro_order_id IN (
        SELECT lasyncro_order_id
        FROM orders
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  // NOTE:
  // Enforced via orders → no direct shop_id
}

export async function down(knex: Knex): Promise<void> {

  await knex.raw(`
    DROP TRIGGER IF EXISTS fulfillment_status_monotonic_trigger
    ON order_fulfillment_status;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS enforce_fulfillment_status_monotonic;
  `);

  await knex.schema.dropTableIfExists('order_fulfillment_history');
  await knex.schema.dropTableIfExists('order_fulfillment_status');

  await knex.raw(`
    DROP TYPE IF EXISTS inventory_block_type;
  `);

  await knex.raw(`
    DROP TYPE IF EXISTS fulfillment_status_type;
  `);
}