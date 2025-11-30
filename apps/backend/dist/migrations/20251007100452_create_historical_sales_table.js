"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    return knex.schema.createTable('historical_sales', (table) => {
        table.increments('id').primary();
        table.integer('shop_id').unsigned().references('id').inTable('shops').onDelete('CASCADE').notNullable();
        table.string('sku').notNullable();
        table.date('sale_date').notNullable();
        table.integer('quantity_sold').notNullable();
        table.timestamps(true, true);
        // Add an index for faster queries on SKU and date
        table.index(['sku', 'sale_date']);
    });
}
async function down(knex) {
    return knex.schema.dropTable('historical_sales');
}
