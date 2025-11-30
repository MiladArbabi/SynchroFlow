"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.table('users', (table) => {
        table.integer('shop_id')
            .unsigned()
            .references('id')
            .inTable('shops')
            .onDelete('SET NULL'); // Or 'CASCADE'
    });
}
async function down(knex) {
    await knex.schema.table('users', (table) => {
        table.dropColumn('shop_id');
    });
}
