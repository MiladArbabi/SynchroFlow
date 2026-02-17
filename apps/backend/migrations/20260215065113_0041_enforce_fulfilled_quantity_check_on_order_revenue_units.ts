// apps/backend/migrations/20260215065113_40_enforce_fulfilled_quantity_check_on_order_revenue_units.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oru_fulfilled_quantity_check'
      ) THEN
        ALTER TABLE order_revenue_units
        ADD CONSTRAINT oru_fulfilled_quantity_check
        CHECK (fulfilled_quantity <= quantity);
      END IF;
    END$$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP CONSTRAINT IF EXISTS oru_fulfilled_quantity_check;
  `);
}
