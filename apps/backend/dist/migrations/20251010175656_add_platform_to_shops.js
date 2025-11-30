"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Add the 'platform' column to the existing 'shops' table
    await knex.schema.alterTable('shops', (table) => {
        table.string('platform'); // Can be 'shopify', 'amazon', etc.
    });
}
async function down(knex) {
    // Revert the change by dropping the 'platform' column
    await knex.schema.alterTable('shops', (table) => {
        table.dropColumn('platform');
    });
}
