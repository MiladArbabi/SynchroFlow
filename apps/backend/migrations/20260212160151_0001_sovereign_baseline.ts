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
     * RECONCILIATION BOUNDARY
     * -----------------------
     * Marks the last successful reconciliation pass.
     *
     * Worker must reconcile only when:
     *   last_reconciled_at IS NULL
     *   OR order_updated_at > last_reconciled_at
     *
     * This enforces delta-based reconciliation
     * and prevents full-dataset rewrites.
     */


    table.timestamps(true, true);

    table.index(['shop_id', 'order_created_at']);
    table.index(['shop_id', 'customer_hashed_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('orders');
  await knex.schema.dropTableIfExists('user_states');
  await knex.schema.dropTableIfExists('shops');
}