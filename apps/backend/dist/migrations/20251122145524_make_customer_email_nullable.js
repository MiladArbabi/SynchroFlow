"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.alterTable('customers', (table) => {
        table.string('email').nullable().alter();
    });
}
async function down(knex) {
    await knex.schema.alterTable('customers', (table) => {
        table.string('email').notNullable().alter();
    });
}
