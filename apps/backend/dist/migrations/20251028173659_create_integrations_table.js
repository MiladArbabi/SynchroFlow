"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('integrations', (table) => {
        table.increments('id').primary();
        // Foreign key to the 'shops' table
        table.integer('shop_id')
            .unsigned()
            .references('id')
            .inTable('shops')
            .onDelete('CASCADE'); // If a shop is deleted, delete its integrations
        table.string('platform').notNullable(); // e.g., 'shopify', 'quickbooks'
        table.string('platform_shop_name'); // e.g., 'my-store.myshopify.com'
        // Store the encrypted token
        table.text('access_token_encrypted').notNullable();
        // Timestamps
        table.timestamps(true, true);
        // Index for faster lookups
        table.index(['shop_id', 'platform']);
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('integrations');
}
