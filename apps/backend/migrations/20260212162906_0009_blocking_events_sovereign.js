export async function up(knex) {
    // -------------------------------------------------------
    // 1️⃣ Customer blocking events
    // -------------------------------------------------------
    await knex.schema.createTable('customer_blocking_events', (table) => {
        table
            .uuid('lasyncro_customer_block_id')
            .primary();
        table.uuid('lasyncro_order_id')
            .notNullable()
            .references('lasyncro_order_id')
            .inTable('orders')
            .onDelete('CASCADE');
        table.text('reason').notNullable();
        table.boolean('is_active')
            .notNullable()
            .defaultTo(true);
        table.timestamp('evaluated_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.timestamp('created_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.index(['lasyncro_order_id']);
    });
    // -------------------------------------------------------
    // 2️⃣ Operational blocking events
    // -------------------------------------------------------
    await knex.schema.createTable('operational_blocking_events', (table) => {
        table
            .uuid('lasyncro_operational_block_id')
            .primary();
        table.uuid('lasyncro_order_id')
            .notNullable()
            .references('lasyncro_order_id')
            .inTable('orders')
            .onDelete('CASCADE');
        table.text('reason').notNullable();
        table.boolean('is_active')
            .notNullable()
            .defaultTo(true);
        table.timestamp('evaluated_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.timestamp('created_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.index(['lasyncro_order_id']);
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('operational_blocking_events');
    await knex.schema.dropTableIfExists('customer_blocking_events');
}
//# sourceMappingURL=20260212162906_0009_blocking_events_sovereign.js.map