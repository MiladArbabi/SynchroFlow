// apps/backend/migrations/20251008083937_create_product_costs_table.ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('product_costs', (table) => {
    // The SKU is the primary key. We remove the foreign key constraint
    // because the 'inventory_truth' table has a composite primary key.
    table.string('sku').primary();
    
    table.decimal('purchase_price', 10, 2).notNullable();
    table.decimal('landed_cost_per_unit', 10, 2).notNullable();
    
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('product_costs');
}