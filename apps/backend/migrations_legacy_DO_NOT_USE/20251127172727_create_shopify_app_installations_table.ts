//apps/backend/migrations/20251127172727_create_shopify_app_installations_table.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shopify_app_installations', (table) => {
    table.increments('id').primary();
    table.integer('shop_id').unsigned().notNullable().references('id').inTable('shops').onDelete('CASCADE');
    table.string('shop_domain').notNullable().unique();
    table.text('access_token').notNullable(); // Encrypted access token
    table.text('scopes').notNullable(); // Comma-separated list of scopes
    table.timestamp('installed_at').defaultTo(knex.fn.now());
    table.timestamp('uninstalled_at').nullable();
    table.timestamps(true, true);
    
    table.index(['shop_domain']);
    table.index(['shop_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shopify_app_installations');
}