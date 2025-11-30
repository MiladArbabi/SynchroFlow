"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
// Define the table name and constraints outside for clarity
const TABLE_NAME = 'inventory_truth';
async function up(knex) {
    // 1. Create the base table structure without the problematic inline checks
    await knex.schema.createTable(TABLE_NAME, (table) => {
        // Foreign Key and Primary Key structure remains the same
        table.integer('shop_id').unsigned().references('id').inTable('shops').onDelete('CASCADE').notNullable();
        table.string('sku', 100).notNullable();
        // Core Inventory Data
        table.integer('quantity_available').notNullable().defaultTo(0);
        table.integer('quantity_reserved').notNullable().defaultTo(0);
        table.integer('quantity_buffer').notNullable().defaultTo(0);
        // Composite Primary Key
        table.primary(['shop_id', 'sku']);
        // Timestamps
        table.timestamp('last_synced_at').defaultTo(knex.fn.now());
        table.timestamps(true, true);
    });
    // 2. ✅ FINAL FIX: Apply the CHECK constraints as a separate raw schema operation.
    // This avoids the internal Knex compiler bug with table.check(knex.raw(...)).
    await knex.schema.raw(`
    ALTER TABLE ${TABLE_NAME}
    ADD CONSTRAINT inventory_available_check
    CHECK (quantity_available >= 0);
  `);
    await knex.schema.raw(`
    ALTER TABLE ${TABLE_NAME}
    ADD CONSTRAINT inventory_reserved_check
    CHECK (quantity_reserved >= 0);
  `);
    await knex.schema.raw(`
    ALTER TABLE ${TABLE_NAME}
    ADD CONSTRAINT inventory_buffer_check
    CHECK (quantity_buffer >= 0);
  `);
}
async function down(knex) {
    return knex.schema.dropTable(TABLE_NAME);
}
