//packages/api/migrations/20251105132228_create_orders_table.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('orders', (table) => {
    table.increments('id').primary();
    table.integer('shop_id').unsigned().notNullable().references('id').inTable('shops').onDelete('CASCADE');
    table.integer('customer_id').unsigned().notNullable().references('id').inTable('users').onDelete('SET NULL');
    
    table.string('platform_order_id').unique(); // e.g., Shopify's order ID
    table.string('order_number').notNullable();
    
    table.string('fulfillment_status').notNullable().defaultTo('pending');
    table.string('financial_status');
    
    table.decimal('total_price', 10, 2).notNullable();
    table.string('currency', 3).notNullable().defaultTo('USD');

    table.string('source_name');

    table.text('notes');
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index(['shop_id']);
    table.index(['customer_id']);
    table.index(['fulfillment_status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists('orders');
}