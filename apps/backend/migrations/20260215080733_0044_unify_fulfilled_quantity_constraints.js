export async function up(knex) {
    await knex.raw(`
    DO $$
    BEGIN
      -- Drop legacy constraints if they exist
      ALTER TABLE order_revenue_units
        DROP CONSTRAINT IF EXISTS oru_fulfilled_quantity_check;

      ALTER TABLE order_revenue_units
        DROP CONSTRAINT IF EXISTS oru_fulfilled_quantity_lte_quantity_check;

      ALTER TABLE order_revenue_units
        DROP CONSTRAINT IF EXISTS oru_fulfilled_quantity_nonnegative_check;

      -- Add unified invariant
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oru_fulfilled_quantity_invariant_check'
      ) THEN
        ALTER TABLE order_revenue_units
        ADD CONSTRAINT oru_fulfilled_quantity_invariant_check
        CHECK (
          fulfilled_quantity >= 0
          AND fulfilled_quantity <= quantity
        );
      END IF;
    END$$;
  `);
}
export async function down(knex) {
    await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP CONSTRAINT IF EXISTS oru_fulfilled_quantity_invariant_check;
  `);
}
//# sourceMappingURL=20260215080733_0044_unify_fulfilled_quantity_constraints.js.map