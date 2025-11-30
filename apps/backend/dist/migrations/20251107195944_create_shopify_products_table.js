"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('shopify_products', (table) => {
        table.increments('id').primary();
        table
            .integer('shop_id')
            .unsigned()
            .notNullable()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE');
        table.string('platform_product_id').notNullable().unique();
        table.string('title');
        table.string('vendor');
        table.string('product_type');
        table.string('status'); // e.g., 'active', 'draft', 'archived'
        table.integer('total_inventory').notNullable().defaultTo(0); // For the "Inventory Health" widget
        table.timestamps(true, true);
        // Unique constraint per shop
        table.unique(['shop_id', 'platform_product_id']);
        table.index(['shop_id']);
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('shopify_products');
}
