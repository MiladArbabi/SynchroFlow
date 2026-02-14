import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // -------------------------------
  // 1️⃣ order_line_items — add variant anchor
  // -------------------------------
  await knex.schema.alterTable("order_line_items", (table) => {
    table
      .uuid("lasyncro_variant_id")
      .nullable()
      .index("order_line_items_lasyncro_variant_id_index");

    table
      .foreign("lasyncro_variant_id")
      .references("lasyncro_variant_id")
      .inTable("variants")
      .onDelete("RESTRICT");
  });

  // -------------------------------
  // 2️⃣ order_revenue_units — add variant anchor
  // -------------------------------
  await knex.schema.alterTable("order_revenue_units", (table) => {
    table
      .uuid("lasyncro_variant_id")
      .nullable()
      .index("order_revenue_units_lasyncro_variant_id_index");

    table
      .foreign("lasyncro_variant_id")
      .references("lasyncro_variant_id")
      .inTable("variants")
      .onDelete("RESTRICT");

    table.unique(
      ["lasyncro_order_id", "lasyncro_variant_id"],
      "order_revenue_units_order_variant_unique"
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("order_revenue_units", (table) => {
    table.dropUnique(
      ["lasyncro_order_id", "lasyncro_variant_id"],
      "order_revenue_units_order_variant_unique"
    );
    table.dropForeign(["lasyncro_variant_id"]);
    table.dropColumn("lasyncro_variant_id");
  });

  await knex.schema.alterTable("order_line_items", (table) => {
    table.dropForeign(["lasyncro_variant_id"]);
    table.dropColumn("lasyncro_variant_id");
  });
}
