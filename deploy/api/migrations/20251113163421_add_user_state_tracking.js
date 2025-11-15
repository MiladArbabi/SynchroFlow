"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Add columns to users table
    await knex.schema.alterTable('users', (table) => {
        table.enum('preferred_mode', ['survival', 'growth', 'architect']).defaultTo('survival');
        table.enum('detected_mode', ['survival', 'growth', 'architect']).defaultTo('survival');
        table.boolean('shopify_connected').defaultTo(false);
        table.boolean('stripe_connected').defaultTo(false);
        table.boolean('first_insight_delivered').defaultTo(false);
    });
    // Create user_milestones table
    await knex.schema.createTable('user_milestones', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.string('milestone').notNullable(); // e.g., 'shopify_connected', 'first_insight', 'first_action'
        table.timestamp('achieved_at').defaultTo(knex.fn.now());
        // Ensure unique milestone per user
        table.unique(['user_id', 'milestone']);
        // Index for faster queries
        table.index(['user_id']);
        table.index(['milestone']);
    });
}
async function down(knex) {
    await knex.schema.alterTable('users', (table) => {
        table.dropColumn('preferred_mode');
        table.dropColumn('detected_mode');
        table.dropColumn('shopify_connected');
        table.dropColumn('stripe_connected');
        table.dropColumn('first_insight_delivered');
    });
    await knex.schema.dropTableIfExists('user_milestones');
}
