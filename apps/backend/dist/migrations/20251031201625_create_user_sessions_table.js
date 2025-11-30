"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    return knex.schema.createTable('user_sessions', (table) => {
        table.string('sid').primary();
        table.json('sess').notNullable();
        table.timestamp('expire', { useTz: true }).notNullable().index();
    });
}
async function down(knex) {
    return knex.schema.dropTable('user_sessions');
}
