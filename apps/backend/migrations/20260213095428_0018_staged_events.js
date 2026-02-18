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
export async function up(knex) {
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
        table.timestamp('created_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.index(['shop_id']);
        table.index(['event_type']);
        table.index(['source_platform']);
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('staged_events');
}
//# sourceMappingURL=20260213095428_0018_staged_events.js.map