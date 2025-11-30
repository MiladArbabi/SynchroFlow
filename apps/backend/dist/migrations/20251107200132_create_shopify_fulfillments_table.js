"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('shopify_fulfillments', (table) => {
        table.increments('id').primary();
        table
            .integer('shop_id')
            .unsigned()
            .notNullable()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        table.string('platform_fulfillment_id').notNullable();
        // Link to the generic orders table
        table.string('platform_order_id').notNullable().index();
        table.string('status'); // e.g., 'success', 'pending'
        table.string('tracking_company');
        table.string('tracking_number');
        // The critical "shipping cost"
        table.decimal('total_shipping_cost', 10, 2).notNullable().defaultTo(0);
        table.timestamps(true, true);
        table.unique(['shop_id', 'platform_fulfillment_id']);
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('shopify_fulfillments');
}
