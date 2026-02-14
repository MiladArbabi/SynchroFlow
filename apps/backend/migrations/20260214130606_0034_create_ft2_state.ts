import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("ft2_state", (table) => {
    table.increments("id").primary();

    table
      .integer("shop_id")
      .notNullable()
      .unique()
      .references("id")
      .inTable("shops")
      .onDelete("CASCADE");

    table.timestamp("completed_at", { useTz: true }).nullable();

    table.string("evaluator_version", 255).nullable();

    table
      .jsonb("evaluation_snapshot")
      .notNullable()
      .defaultTo("{}");

    table
      .timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("ft2_state");
}