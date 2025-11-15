"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.alterTable('staged_events', (table) => {
        table.integer('shop_id').unsigned().notNullable().index();
        table.foreign('shop_id').references('id').inTable('shops').onDelete('CASCADE');
    });
}
async function down(knex) {
    await knex.schema.alterTable('staged_events', (table) => {
        table.dropForeign('shop_id');
        table.dropColumn('shop_id');
    });
}
