// packages/api/migrations/20251120113200_create_customers_table.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('customers', (table) => {
    table.increments('id').primary();
    table.integer('shop_id').unsigned().notNullable().references('id').inTable('shops').onDelete('CASCADE');
    
    table.string('platform_customer_id').notNullable(); // Shopify's customer ID
    table.string('email').notNullable();
    table.string('first_name');
    table.string('last_name');
    table.string('phone');
    table.string('currency', 3).defaultTo('USD');
    table.boolean('verified_email').defaultTo(false);
    table.string('state').defaultTo('enabled'); // enabled, disabled, invited
    table.text('note');
    table.string('tags');
    table.integer('total_orders').defaultTo(0);
    table.decimal('total_spent', 10, 2).defaultTo(0);
    table.bigInteger('last_order_id'); // Shopify's last order ID
    table.string('last_order_name'); // Order name like #1001
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.unique(['shop_id', 'platform_customer_id']);
    table.index(['shop_id']);
    table.index(['email']);
    table.index(['state']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTableIfExists('customers');
}