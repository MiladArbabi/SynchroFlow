//apps/backend/migrations/20251020184310_create_user_layouts_table.ts
import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
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

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("user_layouts");
}