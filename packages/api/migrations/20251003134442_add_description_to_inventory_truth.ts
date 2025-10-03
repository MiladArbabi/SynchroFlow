import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // The 'up' function adds the column
  return knex.schema.alterTable('inventory_truth', (table) => {
    table.string('description');
  });
}

export async function down(knex: Knex): Promise<void> {
  // The 'down' function is for rollbacks; it removes the column
  return knex.schema.alterTable('inventory_truth', (table) => {
    table.dropColumn('description');
  });
}