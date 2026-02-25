import type { Knex } from 'knex';

/**
 * STAGED EVENTS
 * -------------
 * Durable raw event buffer for:
 * - Shopify webhooks
 * - Replayable ingestion
 * - Deterministic worker processing
 *
 * This table is intentionally platform-agnostic.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('staged_events', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    // e.g. 'product.created', 'order.updated'
    table.string('event_type').notNullable();

    // Raw JSON payload from platform
    table.jsonb('raw_payload').notNullable();

    // 'shopify', 'woocommerce', etc.
    table.string('source_platform').notNullable();

    /**
     * IDEMPOTENCY BOUNDARY
     * --------------------
     * External event identity from upstream platform.
     * Required for replay safety and duplicate suppression.
     *
     * Must be unique per (shop_id, source_platform, external_event_id).
     */
    table.string('external_event_id').nullable();

    /**
     * INGESTION STATE TRACKING
     * ------------------------
     * Enables deterministic replay visibility and dead-letter modeling.
     */
    table.timestamp('processed_at', { useTz: true }).nullable();
    table.timestamp('failed_at', { useTz: true }).nullable();
    table.integer('retry_count').notNullable().defaultTo(0);
    table.text('error_message').nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * HARD IDEMPOTENCY ENFORCEMENT
     */
    table.unique(
      ['shop_id', 'source_platform', 'external_event_id'],
      'staged_events_external_identity_unique'
    );

    table.index(['shop_id']);
    table.index(['event_type']);
    table.index(['source_platform']);
    table.index(['processed_at']);
    table.index(['failed_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('staged_events');
}
