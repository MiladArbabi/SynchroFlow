"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Create new table with platform_product_id
    await knex.schema.createTable('product_costs_new', (table) => {
        table.string('platform_product_id').primary();
        table.decimal('purchase_price', 10, 2).notNullable();
        table.decimal('landed_cost_per_unit', 10, 2).notNullable();
        table.timestamps(true, true);
    });
    // Copy any existing data (if applicable)
    const existingData = await knex('product_costs').select('*');
    if (existingData.length > 0) {
        // Note: This is a placeholder since we don't have SKU to platform_product_id mapping yet
        console.log('Existing product_costs data found, but no migration path without SKU mapping');
    }
    // Drop old table and rename new one
    await knex.schema.dropTable('product_costs');
    await knex.schema.renameTable('product_costs_new', 'product_costs');
}
async function down(knex) {
    // Revert to original structure
    await knex.schema.createTable('product_costs_old', (table) => {
        table.string('sku').primary();
        table.decimal('purchase_price', 10, 2).notNullable();
        table.decimal('landed_cost_per_unit', 10, 2).notNullable();
        table.timestamps(true, true);
    });
    await knex.schema.dropTable('product_costs');
    await knex.schema.renameTable('product_costs_old', 'product_costs');
}
