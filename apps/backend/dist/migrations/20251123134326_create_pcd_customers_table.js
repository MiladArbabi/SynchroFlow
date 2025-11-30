"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    return knex.schema.createTable('pcd_customers', (table) => {
        table.increments('id').primary();
        table.integer('shop_id').unsigned().notNullable().references('id').inTable('shops').onDelete('CASCADE');
        // PCD-Allowed Fields Only
        table.string('platform_customer_id').notNullable(); // Shopify customer ID
        table.text('tags').nullable(); // Customer tags as JSON array
        table.integer('total_orders').defaultTo(0);
        table.decimal('total_spent', 10, 2).defaultTo(0);
        table.string('last_order_id').nullable();
        table.string('last_order_name').nullable();
        // Derived metrics (calculated from orders)
        table.decimal('average_order_value', 10, 2).defaultTo(0);
        table.integer('days_since_last_order').nullable();
        table.string('customer_segment').defaultTo('new'); // new, returning, vip, at_risk
        table.timestamp('platform_created_at').nullable();
        table.timestamp('platform_updated_at').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.unique(['shop_id', 'platform_customer_id']);
        table.index(['shop_id']);
        table.index(['customer_segment']);
        table.index(['total_orders']);
    });
}
async function down(knex) {
    return knex.schema.dropTable('pcd_customers');
}
