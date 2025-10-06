import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('financial_transactions', (table) => {
    table.increments('id').primary();
    table.integer('shop_id').unsigned().references('id').inTable('shops').onDelete('CASCADE').notNullable();
    table.date('transaction_date').notNullable();
    table.decimal('amount', 14, 2).notNullable();
    table.string('description').notNullable();
    table.string('category').notNullable();
    table.enum('type', ['inflow', 'outflow']).notNullable();
    
    // THE FIX: Define 'sku' as an indexed string, NOT a foreign key.
    table.string('sku').index(); // Adding an index is good for performance
    
    table.timestamps(true, true);
    table.index(['shop_id', 'transaction_date']);
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('financial_transactions');
}