import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Use a callback to add multiple columns in one go
  return knex.schema.alterTable('inventory_truth', (table) => {
    table.decimal('price', 10, 2); // Price with precision
    table.integer('quantity');
    table.string('warehouse_location');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('inventory_truth', (table) => {
    table.dropColumn('price');
    table.dropColumn('quantity');
    table.dropColumn('warehouse_location');
  });
}