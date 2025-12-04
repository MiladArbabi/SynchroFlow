// apps/backend/migrations/20251007100452_create_historical_sales_table.ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('historical_sales', (table) => {
    table.increments('id').primary();
    table.integer('shop_id').unsigned().references('id').inTable('shops').onDelete('CASCADE').notNullable();
    table.string('sku').notNullable();
    table.date('sale_date').notNullable();
    table.integer('quantity_sold').notNullable();
    table.timestamps(true, true);

    // Add an index for faster queries on SKU and date
    table.index(['sku', 'sale_date']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('historical_sales');
}