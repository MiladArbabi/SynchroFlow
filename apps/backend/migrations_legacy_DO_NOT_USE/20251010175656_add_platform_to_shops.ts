// apps/backend/migrations/20251010175656_add_platform_to_shops.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add the 'platform' column to the existing 'shops' table
  await knex.schema.alterTable('shops', (table) => {
    table.string('platform'); // Can be 'shopify', 'amazon', etc.
  });
}

export async function down(knex: Knex): Promise<void> {
  // Revert the change by dropping the 'platform' column
  await knex.schema.alterTable('shops', (table) => {
    table.dropColumn('platform');
  });
}