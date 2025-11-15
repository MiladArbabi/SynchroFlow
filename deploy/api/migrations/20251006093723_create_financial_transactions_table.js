"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    return knex.schema.createTable('financial_transactions', (table) => {
        table.increments('id').primary();
        table.integer('shop_id').unsigned().references('id').inTable('shops').onDelete('CASCADE').notNullable();
        table.date('transaction_date').notNullable();
        table.decimal('amount', 14, 2).notNullable();
        table.string('description').notNullable();
        table.string('category').notNullable();
        table.enum('type', ['inflow', 'outflow']).notNullable();
        // THE FIX: Define 'sku' as an indexed string, NOT a foreign key.
        table.string('sku').index(); // Adding an index is good for performance
        table.timestamps(true, true);
        table.index(['shop_id', 'transaction_date']);
    });
}
async function down(knex) {
    return knex.schema.dropTable('financial_transactions');
}
