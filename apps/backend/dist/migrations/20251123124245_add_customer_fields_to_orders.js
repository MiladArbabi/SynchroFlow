"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.alterTable('orders', (table) => {
        table.string('customer_name').nullable();
        table.string('customer_email').nullable();
        table.string('customer_phone').nullable();
        table.text('shipping_address').nullable(); // Store as JSON string
    });
}
async function down(knex) {
    await knex.schema.alterTable('orders', (table) => {
        table.dropColumn('customer_name');
        table.dropColumn('customer_email');
        table.dropColumn('customer_phone');
        table.dropColumn('shipping_address');
    });
}
