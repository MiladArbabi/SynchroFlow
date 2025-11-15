"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    return knex.schema.createTable('product_costs', (table) => {
        // The SKU is the primary key. We remove the foreign key constraint
        // because the 'inventory_truth' table has a composite primary key.
        table.string('sku').primary();
        table.decimal('purchase_price', 10, 2).notNullable();
        table.decimal('landed_cost_per_unit', 10, 2).notNullable();
        table.timestamps(true, true);
    });
}
async function down(knex) {
    return knex.schema.dropTable('product_costs');
}
