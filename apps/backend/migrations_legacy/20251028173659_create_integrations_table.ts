// apps/backend/migrations/20251028173659_create_integrations_table.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
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

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('integrations');
}