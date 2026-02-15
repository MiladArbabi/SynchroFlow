import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {

  // 1️⃣ Add lasyncro_variant_id (nullable initially)
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'order_revenue_units'
          AND column_name = 'lasyncro_variant_id'
      ) THEN
        ALTER TABLE order_revenue_units
        ADD COLUMN lasyncro_variant_id uuid;
      END IF;
    END$$;
  `);

  // 2️⃣ Add fulfilled_quantity
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'order_revenue_units'
          AND column_name = 'fulfilled_quantity'
      ) THEN
        ALTER TABLE order_revenue_units
        ADD COLUMN fulfilled_quantity integer NOT NULL DEFAULT 0;
      END IF;
    END$$;
  `);

  // 3️⃣ Add FK constraint safely
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'oru_variant_fk'
      ) THEN
        ALTER TABLE order_revenue_units
        ADD CONSTRAINT oru_variant_fk
        FOREIGN KEY (lasyncro_variant_id)
        REFERENCES variants(lasyncro_variant_id)
        ON DELETE RESTRICT;
      END IF;
    END$$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP CONSTRAINT IF EXISTS oru_variant_fk;
  `);

  await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP COLUMN IF EXISTS fulfilled_quantity;
  `);

  await knex.raw(`
    ALTER TABLE order_revenue_units
    DROP COLUMN IF EXISTS lasyncro_variant_id;
  `);
}
