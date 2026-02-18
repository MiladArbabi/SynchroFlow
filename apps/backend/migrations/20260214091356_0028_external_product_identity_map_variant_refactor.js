export async function up(knex) {
    await knex.schema.alterTable('external_product_identity_map', (table) => {
        // 1. Drop old FK
        table.dropForeign(['lasyncro_product_id']);
        // 2. Rename column
        table.renameColumn('lasyncro_product_id', 'lasyncro_variant_id');
    });
    await knex.schema.alterTable('external_product_identity_map', (table) => {
        // 3. Add new FK → variants
        table
            .foreign('lasyncro_variant_id')
            .references('lasyncro_variant_id')
            .inTable('variants')
            .onDelete('CASCADE');
    });
}
export async function down(knex) {
    await knex.schema.alterTable('external_product_identity_map', (table) => {
        table.dropForeign(['lasyncro_variant_id']);
        table.renameColumn('lasyncro_variant_id', 'lasyncro_product_id');
    });
    await knex.schema.alterTable('external_product_identity_map', (table) => {
        table
            .foreign('lasyncro_product_id')
            .references('lasyncro_product_id')
            .inTable('products')
            .onDelete('CASCADE');
    });
}
//# sourceMappingURL=20260214091356_0028_external_product_identity_map_variant_refactor.js.map