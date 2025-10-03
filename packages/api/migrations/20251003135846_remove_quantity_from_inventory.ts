import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.alterTable('inventory_truth', (table) => {
    table.dropColumn('quantity');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('inventory_truth', (table) => {
    // We add it back in the 'down' function for rollbacks
    table.integer('quantity');
  });
}