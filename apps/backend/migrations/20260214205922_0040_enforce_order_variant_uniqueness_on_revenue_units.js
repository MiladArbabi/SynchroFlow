export async function up(knex) {
    await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'order_revenue_units_order_variant_unique'
      ) THEN
        ALTER TABLE order_revenue_units
        ADD CONSTRAINT order_revenue_units_order_variant_unique
        UNIQUE (lasyncro_order_id, lasyncro_variant_id);
      END IF;
    END$$;
  `);
}
export async function down(knex) {
    await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP CONSTRAINT IF EXISTS order_revenue_units_order_variant_unique;
  `);
}
//# sourceMappingURL=20260214205922_0040_enforce_order_variant_uniqueness_on_revenue_units.js.map