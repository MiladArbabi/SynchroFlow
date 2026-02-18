export async function up(knex) {
    await knex.raw(`
    DO $$
    BEGIN

      -- fulfilled_quantity >= 0
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'oru_fulfilled_quantity_nonnegative_check'
      ) THEN
        ALTER TABLE order_revenue_units
        ADD CONSTRAINT oru_fulfilled_quantity_nonnegative_check
        CHECK (fulfilled_quantity >= 0);
      END IF;

      -- fulfilled_quantity <= quantity
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'oru_fulfilled_quantity_lte_quantity_check'
      ) THEN
        ALTER TABLE order_revenue_units
        ADD CONSTRAINT oru_fulfilled_quantity_lte_quantity_check
        CHECK (fulfilled_quantity <= quantity);
      END IF;

    END$$;
  `);
}
export async function down(knex) {
    await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP CONSTRAINT IF EXISTS oru_fulfilled_quantity_nonnegative_check;
  `);
    await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP CONSTRAINT IF EXISTS oru_fulfilled_quantity_lte_quantity_check;
  `);
}
//# sourceMappingURL=20260215070107_0043_enforce_fulfilled_quantity_bounds.js.map