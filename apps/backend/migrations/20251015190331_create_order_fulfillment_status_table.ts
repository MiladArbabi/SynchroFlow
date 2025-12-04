// apps/backend/migrations/20251015190331_create_order_fulfillment_status_table.ts
/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('order_fulfillment_status', (table) => {
    table.increments('id').primary();
    table.integer('shop_id').unsigned().notNullable().references('id').inTable('shops').onDelete('CASCADE');
    table.string('order_id').notNullable(); // The order ID from the source platform (e.g., Shopify)
    table.enum('status', ['processing', 'in_transit', 'delivered', 'cancelled']).notNullable();
    table.timestamp('status_updated_at').defaultTo(knex.fn.now());

    table.unique(['shop_id', 'order_id']); // Each order can only have one current status
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('order_fulfillment_status');
};