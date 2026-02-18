export async function up(knex) {
    await knex.schema.createTable('products', (table) => {
        table
            .uuid('lasyncro_product_id')
            .primary();
        table.integer('shop_id')
            .unsigned()
            .notNullable()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        // Stable commercial identity
        table.string('sku').nullable();
        table.string('title').nullable();
        table.string('status').notNullable().defaultTo('active');
        table.timestamp('created_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true })
            .notNullable()
            .defaultTo(knex.fn.now());
        // SKU must be unique per shop
        table.unique(['shop_id', 'sku']);
        table.index(['shop_id']);
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('products');
}
//# sourceMappingURL=20260212160532_0003_products_sovereign.js.map