// packages/api/migrations/20251010161654_create_data_mapping_rules_table.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('data_mapping_rules', (table) => {
    table.increments('id').primary();
    
    // Foreign key to the 'shops' table to associate rules with a user/shop
    table.integer('shop_id').unsigned().notNullable();
    table.foreign('shop_id').references('id').inTable('shops').onDelete('CASCADE');

    table.string('source_platform').notNullable().index(); // e.g., 'shopify', 'netsuite'
    table.string('source_field_path').notNullable(); // e.g., 'line_items[0].sku'
    table.string('target_field_path').notNullable(); // e.g., 'order.product_sku'
    
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('data_mapping_rules');
}