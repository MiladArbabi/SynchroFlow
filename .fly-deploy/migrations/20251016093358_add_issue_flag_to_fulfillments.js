"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    return knex.schema.alterTable('order_fulfillment_status', (table) => {
        table.boolean('has_issue').defaultTo(false).notNullable();
    });
}
async function down(knex) {
    return knex.schema.alterTable('order_fulfillment_status', (table) => {
        table.dropColumn('has_issue');
    });
}
