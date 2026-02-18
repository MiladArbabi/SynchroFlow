export async function up(knex) {
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
    });
}
export async function down(knex) {
    await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP CONSTRAINT IF EXISTS order_revenue_units_order_variant_unique;
  `);
    await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP CONSTRAINT IF EXISTS order_revenue_units_lasyncro_variant_id_foreign;
  `);
    await knex.raw(`
    ALTER TABLE order_line_items
    DROP CONSTRAINT IF EXISTS order_line_items_lasyncro_variant_id_foreign;
  `);
    await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP COLUMN IF EXISTS lasyncro_variant_id;
  `);
    await knex.raw(`
    ALTER TABLE order_line_items
    DROP COLUMN IF EXISTS lasyncro_variant_id;
  `);
}
;
//# sourceMappingURL=20260214120547_0033_variant_atomic_phase1.js.map