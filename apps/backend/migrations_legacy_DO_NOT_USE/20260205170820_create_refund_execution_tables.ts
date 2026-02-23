// apps/backend/migrations/20260205170820_create_refund_execution_tables.ts

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ─────────────────────────────────────────────
  // refund_executions (authoritative execution)
  // ─────────────────────────────────────────────
  await knex.schema.createTable('refund_executions', (table) => {
    table.increments('id').primary();

    // Authority & identity
    table
      .integer('shop_id')
      .nullable()
      .references('id')
      .inTable('shops')
      .onDelete('SET NULL');
    /**
     * shop_id may be NULL at execution time.
     * Refunds can arrive before shop resolution.
      */
    table.string('platform').notNullable(); // e.g. 'shopify'
    table.string('platform_refund_id').notNullable(); // admin_graphql_api_id

    // Order binding
    table
      .string('canonical_order_id')
      .nullable();
      /**
       * canonical_order_id is resolved later.
       * Execution must not depend on order ingestion timing.
       */

    table.string('platform_order_id').nullable();

    // Temporal semantics
    table.timestamp('refund_created_at', { useTz: true }).notNullable();
    table.timestamp('observed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Execution state
    table
      .enu(
        'execution_status',
        ['observed', 'applied', 'voided'],
        {
          useNative: true,
          enumName: 'refund_execution_status',
        }
      )
      .notNullable()
      .defaultTo('observed');

    table
      .enu(
        'execution_source',
        ['observed', 'replay', 'backfill'],
        {
          useNative: true,
          enumName: 'refund_execution_source',
        }
      )
      .notNullable();
    /**
     * execution_source reflects HOW execution was materialized:
     * - observed: direct platform signal (webhook)
     * - replay: deterministic reprocessing
     * - backfill: historical reconstruction
     */

    // Financial scope (non-authoritative, optional)
    table.string('currency').nullable();
    table.decimal('total_refunded_amount', 14, 4).nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Idempotency boundary
    table.unique(
      ['platform', 'platform_refund_id'],
      'uq_refund_execution_identity'
    );

    // Access paths
    table.index(['shop_id', 'refund_created_at'], 'idx_refund_executions_shop_time');
    table.index(['canonical_order_id'], 'idx_refund_executions_order');
  });

  // ─────────────────────────────────────────────
  // refund_execution_line_items (atomic effects)
  // ─────────────────────────────────────────────
  await knex.schema.createTable('refund_execution_line_items', (table) => {
    table.increments('id').primary();

    table
      .integer('refund_execution_id')
      .notNullable()
      .references('id')
      .inTable('refund_executions')
      .onDelete('CASCADE');

    table
      .string('canonical_order_id')
      .nullable();
      /**
       * Line items may exist before order resolution.
       * Resolver backfills canonical linkage.
       */

    table.string('sku').notNullable();
    table.integer('quantity_refunded').notNullable();
    table.decimal('unit_refund_amount', 14, 4).nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // One effect per SKU per refund
    table.unique(
      ['refund_execution_id', 'sku'],
      'uq_refund_execution_line_identity'
    );

    table.index(['canonical_order_id', 'sku'], 'idx_refund_line_items_order_sku');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refund_execution_line_items');
  await knex.schema.dropTableIfExists('refund_executions');

  await knex.raw('DROP TYPE IF EXISTS refund_execution_status');
  await knex.raw('DROP TYPE IF EXISTS refund_execution_source');
}