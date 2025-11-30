"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('order_line_items', (table) => {
        table.increments('id').primary();
        table
            .integer('shop_id')
            .unsigned()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE')
            .notNullable();
        // Foreign key to the 'orders' table
        table
            .string('platform_order_id')
            .references('platform_order_id')
            .inTable('orders')
            .onDelete('CASCADE');
        // Foreign key to the 'shopify_products' table
        table
            .string('platform_product_id')
            .references('platform_product_id')
            .inTable('shopify_products')
            .onDelete('SET NULL'); // Set null if product is deleted
        table.string('platform_line_item_id').notNullable();
        table.integer('quantity').notNullable();
        // We can add price, title, sku etc. later if needed
        // table.decimal('price', 10, 2);
        // table.string('title');
        // table.string('sku');
        table.timestamps(true, true);
        // Unique constraint
        table.unique(['shop_id', 'platform_line_item_id']);
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('order_line_items');
}
