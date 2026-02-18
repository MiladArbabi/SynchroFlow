export async function up(knex) {
    // 1️⃣ Drop self-referencing FK first
    await knex.schema.alterTable('warehouse_locations', (table) => {
        table.dropForeign(['parent_location_code']);
    });
    // 2️⃣ Drop old PK
    await knex.schema.alterTable('warehouse_locations', (table) => {
        table.dropPrimary();
    });
    // 3️⃣ Drop redundant unique constraint
    await knex.schema.alterTable('warehouse_locations', (table) => {
        table.dropUnique(['shop_id', 'location_code']);
    });
    // 4️⃣ Add composite PK
    await knex.schema.alterTable('warehouse_locations', (table) => {
        table.primary(['shop_id', 'location_code']);
    });
    // 5️⃣ Recreate self-referencing FK (composite-safe)
    await knex.schema.alterTable('warehouse_locations', (table) => {
        table
            .foreign(['shop_id', 'parent_location_code'])
            .references(['shop_id', 'location_code'])
            .inTable('warehouse_locations')
            .onDelete('SET NULL');
    });
}
export async function down(knex) {
    await knex.schema.alterTable('warehouse_locations', (table) => {
        table.dropForeign(['shop_id', 'parent_location_code']);
    });
    await knex.schema.alterTable('warehouse_locations', (table) => {
        table.dropPrimary();
    });
    await knex.schema.alterTable('warehouse_locations', (table) => {
        table.primary(['location_code']);
    });
    await knex.schema.alterTable('warehouse_locations', (table) => {
        table.unique(['shop_id', 'location_code']);
    });
    await knex.schema.alterTable('warehouse_locations', (table) => {
        table
            .foreign(['parent_location_code'])
            .references(['location_code'])
            .inTable('warehouse_locations')
            .onDelete('SET NULL');
    });
}
//# sourceMappingURL=20260218121835_0049_fix_warehouse_locations_pk.js.map