"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('users', (table) => {
        table.increments('id').primary(); // Standard auto-incrementing primary key
        table.string('email').notNullable().unique(); // User's email, must be unique
        table.string('password_hash').notNullable(); // Store the hashed password
        table.string('first_name'); // Optional first name
        table.string('last_name'); // Optional last name
        // Timestamps
        table.timestamps(true, true); // Adds created_at and updated_at columns
        // Index for faster email lookups (important for login)
        table.index(['email']);
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('users');
}
