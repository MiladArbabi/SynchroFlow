"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable("user_layouts", (table) => {
        table.increments("id").primary();
        // In a multi-tenant system, this would reference a user ID.
        // For now, we'll use a simple identifier. A default is added for single-user mode.
        table.string("user_id").notNullable().defaultTo("default_user");
        table.string("layout_name").notNullable().defaultTo("dashboard"); // e.g., 'dashboard', 'products_view'
        table.jsonb("configuration").notNullable();
        table.timestamps(true, true);
        // Ensure a user can only have one layout of a specific name
        table.unique(["user_id", "layout_name"]);
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists("user_layouts");
}
