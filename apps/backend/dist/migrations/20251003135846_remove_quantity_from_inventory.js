"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    return knex.schema.alterTable('inventory_truth', (table) => {
        table.dropColumn('quantity');
    });
}
async function down(knex) {
    return knex.schema.alterTable('inventory_truth', (table) => {
        // We add it back in the 'down' function for rollbacks
        table.integer('quantity');
    });
}
