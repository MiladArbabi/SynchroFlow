import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Enable UUID generation
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // ============================
  // SHOPS (Root tenant anchor)
  // ============================
  await knex.schema.createTable('shops', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();

    /**
     * Shop-Level Insight State
     * ------------------------
     * FT0 readiness anchor.
     */
    table.boolean('first_insight_delivered')
      .notNullable()
      .defaultTo(false);

    table.timestamps(true, true);
  });

  // ============================
  // ORDERS (Sovereign Identity)
  // ============================
  await knex.schema.createTable('orders', (table) => {
    table
    .uuid('lasyncro_order_id')
      .primary()
      
    table.integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.text('payment_state')
      .notNullable()
      .defaultTo('unknown');

    table.string('currency', 3).notNullable();
    table.decimal('total_price', 12, 2).notNullable();
    table.decimal('subtotal_price', 12, 2).notNullable();
    table.decimal('total_tax', 12, 2).notNullable();

    table.string('source');
    table.string('referrer_medium');
    table.string('customer_hashed_id');

    table.timestamp('order_created_at', { useTz: true }).notNullable();
    table.timestamp('order_updated_at', { useTz: true }).notNullable();
    table.timestamp('order_processed_at', { useTz: true });

    /**
     * CASH REALIZATION LAYER
     * -----------------------
     * These timestamps represent economic execution truth.
     *
     * paid_at:
     *   When payment is authorized/confirmed.
     *
     * captured_at:
     *   When funds are captured from payment processor.
     *
     * settlement_at:
     *   When funds settle into merchant account.
     *
     * These fields are nullable and must only be set
     * by canonical ingestion boundaries.
     */
    table.timestamp('paid_at', { useTz: true }).nullable();
    table.timestamp('captured_at', { useTz: true }).nullable();
    table.timestamp('settlement_at', { useTz: true }).nullable();

    /**
     * SLA PROMISE LAYER
     * -----------------
     * Represents merchant commitment timestamps.
     *
     * promised_ship_by:
     *   Latest time order must be shipped.
     *
     * promised_delivery_at:
     *   Expected delivery completion time.
     *
     * These fields enable:
     * - SLA breach detection
     * - Operational latency modeling
     * - Aging classification
     *
     * They are canonical truth inputs,
     * not derived values.
     */
    table.timestamp('promised_ship_by', { useTz: true }).nullable();
    table.timestamp('promised_delivery_at', { useTz: true }).nullable();

    table.timestamp('last_reconciled_at', { useTz: true })
      .nullable()
      .index();

    /**
     * AGGREGATE VERSION (Monotonic)
     * -----------------------------
     * Strictly increments on every domain mutation.
     *
     * Purpose:
     * - Deterministic ordering
     * - Event sequencing
     * - Outbox stabilization
     * - Concurrency conflict detection
     *
     * Must ONLY be incremented inside canonical
     * ingestion or reconciliation boundaries.
     */
    table.integer('aggregate_version')
      .notNullable()
      .defaultTo(1) // Version 1 = first domain mutation (creation)
      .index();

    /**
     * PROJECTION VERSION TRACKER
     * ---------------------------
     * Highest aggregate_version successfully projected.
     * Enforces idempotent reconciliation.
     */
    table
      .integer('last_projected_version')
      .notNullable()
      .defaultTo(0);

    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();

    table.index(['shop_id', 'order_created_at']);
    table.index(['shop_id', 'customer_hashed_id']);
  });

  /**
   * PROJECTION CONSISTENCY ANCHOR
   * -----------------------------
   * Enables snapshot tables to enforce
   * (lasyncro_order_id, aggregate_version) binding.
   *
   * REQUIRED for composite FK integrity.
   */
  await knex.raw(`
    ALTER TABLE orders
    ADD CONSTRAINT orders_id_version_unique
    UNIQUE (lasyncro_order_id, aggregate_version)
  `);

  /**
   * SNAPSHOT WRITE GUARD FUNCTION
   * ------------------------------
   * Blocks writes to snapshot tables unless explicitly
   * executed inside reconciliation boundary.
   *
   * Reconciliation must execute:
   *   SET LOCAL synchroflow.reconciliation = 'true';
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION enforce_reconciliation_guard()
    RETURNS trigger AS $$
    BEGIN
      IF current_setting('synchroflow.reconciliation', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION
          'SNAPSHOT_WRITE_BLOCKED: must execute inside reconciliation boundary';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  /**
   * PROJECTION WRITE AUDIT LOG (IMMUTABLE)
   * ---------------------------------------
   * Records every successful projection pass.
   *
   * Purpose:
   * - Deterministic replay verification
   * - Divergence detection
   * - Operational forensics
   *
   * Append-only.
   * No updates.
   * No deletes.
   */
  await knex.schema.createTable('order_projection_audit_log', (table) => {
    table.uuid('audit_id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.integer('aggregate_version')
      .notNullable();

    table.timestamp('projected_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.text('source')
      .notNullable(); // e.g. "reconciliation_worker"

    table.index(['lasyncro_order_id']);
  });

  /**
   * Projection binding guarantee.
   */
  await knex.raw(`
    ALTER TABLE order_projection_audit_log
    ADD CONSTRAINT order_projection_audit_fk
    FOREIGN KEY (lasyncro_order_id, aggregate_version)
    REFERENCES orders (lasyncro_order_id, aggregate_version)
    ON DELETE CASCADE
  `);

  /**
   * VERSION INVARIANTS (HARD GUARANTEE)
   * ------------------------------------
   * aggregate_version:
   *   - Must always be strictly positive.
   *
   * last_projected_version:
   *   - Must be >= 0
   *   - Must never exceed aggregate_version
   *
   * These constraints seal projection correctness
   * at the database level and prevent structural corruption.
   */
  await knex.raw(`
    ALTER TABLE orders
    ADD CONSTRAINT orders_aggregate_version_positive
      CHECK (aggregate_version > 0),
    ADD CONSTRAINT orders_last_projected_version_non_negative
      CHECK (last_projected_version >= 0),
    ADD CONSTRAINT orders_projection_not_ahead_of_aggregate
      CHECK (last_projected_version <= aggregate_version)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_projection_audit_log');
  await knex.schema.dropTableIfExists('orders');
  await knex.schema.dropTableIfExists('user_states');
  await knex.schema.dropTableIfExists('shops');
}