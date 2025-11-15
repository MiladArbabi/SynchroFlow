"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // The 'up' function adds the column
    return knex.schema.alterTable('inventory_truth', (table) => {
        table.string('description');
    });
}
async function down(knex) {
    // The 'down' function is for rollbacks; it removes the column
    return knex.schema.alterTable('inventory_truth', (table) => {
        table.dropColumn('description');
    });
}
