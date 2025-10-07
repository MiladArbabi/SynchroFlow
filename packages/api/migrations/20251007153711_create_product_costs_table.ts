// packages/api/migrations/20251007153711_create_product_costs_table.ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('product_costs', (table) => {
    table.string('sku').primary();
    
    table.decimal('purchase_price', 10, 2).notNullable();
    table.decimal('landed_cost_per_unit', 10, 2).notNullable();
    
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('product_costs');
}