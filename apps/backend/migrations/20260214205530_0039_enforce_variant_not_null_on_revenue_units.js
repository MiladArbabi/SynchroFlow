export async function up(knex) {
    await knex.raw(`
    ALTER TABLE order_revenue_units
    ALTER COLUMN lasyncro_variant_id SET NOT NULL;
  `);
}
export async function down(knex) {
    await knex.raw(`
    ALTER TABLE order_revenue_units
    ALTER COLUMN lasyncro_variant_id DROP NOT NULL;
  `);
}
//# sourceMappingURL=20260214205530_0039_enforce_variant_not_null_on_revenue_units.js.map