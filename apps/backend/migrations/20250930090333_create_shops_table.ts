// apps/backend/migrations/20250930090333_create_shops_table.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // The 'up' function creates the table
  return knex.schema.createTable('shops', (table) => {
    table.increments('id').primary(); // Unique ID for the shop
    table.string('name', 255).notNullable();
    table.string('contact_email', 255).notNullable(); // informational only
    
    // Critical for authentication and multi-tenancy:
    table.string('auth_secret', 255).notNullable(); // Encrypted API key/secret for SynchroFlow access

    // Integration Type Tracking (GTM Data)
    table.string('primary_erp_type', 50).notNullable(); // e.g., 'NetSuite', 'SAP'
    table.string('primary_ecomm_type', 50).notNullable(); // e.g., 'Shopify', 'WooCommerce'

    // Timestamps
    table.timestamps(true, true); // Adds 'created_at' and 'updated_at' columns
  });
}

export async function down(knex: Knex): Promise<void> {
  // The 'down' function specifies how to undo the migration
  return knex.schema.dropTable('shops');
}