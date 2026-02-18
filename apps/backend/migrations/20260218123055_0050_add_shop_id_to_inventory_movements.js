export async function up(knex) {
    // 1️⃣ Add shop_id column (nullable first for safety)
    await knex.schema.alterTable('inventory_movements', (table) => {
        table.integer('shop_id').nullable();
    });
    // 2️⃣ Backfill from variants
    await knex.schema.raw(`
    UPDATE inventory_movements im
    SET shop_id = v.shop_id
    FROM variants v
    WHERE im.lasyncro_variant_id = v.lasyncro_variant_id;
  `);
    // 3️⃣ Make NOT NULL
    await knex.schema.alterTable('inventory_movements', (table) => {
        table.integer('shop_id').notNullable().alter();
    });
    // 4️⃣ Add FK to shops
    await knex.schema.alterTable('inventory_movements', (table) => {
        table
            .foreign('shop_id')
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
    });
    // 5️⃣ Add composite FK to warehouse_locations
    await knex.schema.alterTable('inventory_movements', (table) => {
        table
            .foreign(['shop_id', 'location_code'])
            .references(['shop_id', 'location_code'])
            .inTable('warehouse_locations')
            .onDelete('RESTRICT');
    });
    // 6️⃣ Add supporting index
    await knex.schema.alterTable('inventory_movements', (table) => {
        table.index(['shop_id']);
    });
}
export async function down(knex) {
    await knex.schema.alterTable('inventory_movements', (table) => {
        table.dropForeign(['shop_id', 'location_code']);
    });
    await knex.schema.alterTable('inventory_movements', (table) => {
        table.dropForeign(['shop_id']);
    });
    await knex.schema.alterTable('inventory_movements', (table) => {
        table.dropColumn('shop_id');
    });
}
//# sourceMappingURL=20260218123055_0050_add_shop_id_to_inventory_movements.js.map