"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Use a callback to add multiple columns in one go
    return knex.schema.alterTable('inventory_truth', (table) => {
        table.decimal('price', 10, 2); // Price with precision
        table.integer('quantity');
        table.string('warehouse_location');
    });
}
async function down(knex) {
    return knex.schema.alterTable('inventory_truth', (table) => {
        table.dropColumn('price');
        table.dropColumn('quantity');
        table.dropColumn('warehouse_location');
    });
}
