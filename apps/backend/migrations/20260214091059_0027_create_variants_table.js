export async function up(knex) {
    await knex.schema.createTable('variants', (table) => {
        table.uuid('lasyncro_variant_id').primary();
        table
            .uuid('lasyncro_product_id')
            .notNullable()
            .references('lasyncro_product_id')
            .inTable('products')
            .onDelete('CASCADE');
        table
            .integer('shop_id')
            .notNullable()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        table.string('sku', 255).nullable();
        table.string('title', 255).nullable();
        table.string('status', 255).notNullable().defaultTo('active');
        table.timestamps(true, true);
        table.unique(['shop_id', 'sku']);
        table.index(['shop_id']);
    });
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('variants');
}
//# sourceMappingURL=20260214091059_0027_create_variants_table.js.map