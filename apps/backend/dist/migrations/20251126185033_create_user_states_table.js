"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Check if user_states table already exists
    const hasUserStatesTable = await knex.schema.hasTable('user_states');
    if (!hasUserStatesTable) {
        await knex.schema.createTable('user_states', (table) => {
            table.increments('id').primary();
            table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
            table.string('key').notNullable();
            table.jsonb('value').notNullable();
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());
            // Unique constraint to ensure one state per user per key
            table.unique(['user_id', 'key']);
        });
        // Create index for faster lookups
        await knex.schema.raw('CREATE INDEX idx_user_states_user_id_key ON user_states(user_id, key)');
    }
}
async function down(knex) {
    const hasUserStatesTable = await knex.schema.hasTable('user_states');
    if (hasUserStatesTable) {
        await knex.schema.dropTable('user_states');
    }
}
