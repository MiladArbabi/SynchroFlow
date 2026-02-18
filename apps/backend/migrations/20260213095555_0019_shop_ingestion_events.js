export async function up(knex) {
    await knex.schema.createTable('shop_ingestion_events', (table) => {
        table.increments('id').primary();
        table
            .integer('shop_id')
            .unsigned()
            .notNullable()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        table.string('module_id').notNullable(); // e.g. 'product'
        table.string('event').notNullable(); // e.g. 'ingested'
        table.timestamp('created_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.index(['shop_id', 'module_id']);
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('shop_ingestion_events');
}
//# sourceMappingURL=20260213095555_0019_shop_ingestion_events.js.map