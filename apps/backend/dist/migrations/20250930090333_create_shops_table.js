"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // The 'up' function creates the table
    return knex.schema.createTable('shops', (table) => {
        table.increments('id').primary(); // Unique ID for the shop
        table.string('name', 255).notNullable();
        table.string('contact_email', 255).unique().notNullable(); // For communication
        // Critical for authentication and multi-tenancy:
        table.string('auth_secret', 255).notNullable(); // Encrypted API key/secret for SynchroFlow access
        // Integration Type Tracking (GTM Data)
        table.string('primary_erp_type', 50).notNullable(); // e.g., 'NetSuite', 'SAP'
        table.string('primary_ecomm_type', 50).notNullable(); // e.g., 'Shopify', 'WooCommerce'
        // Timestamps
        table.timestamps(true, true); // Adds 'created_at' and 'updated_at' columns
    });
}
async function down(knex) {
    // The 'down' function specifies how to undo the migration
    return knex.schema.dropTable('shops');
}
