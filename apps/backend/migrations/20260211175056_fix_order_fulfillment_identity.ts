import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Remove old transport identity (shop_id, order_id)
  await knex.raw(`
    ALTER TABLE order_fulfillment_status
    DROP CONSTRAINT IF EXISTS order_fulfillment_status_shop_id_order_id_unique;
  `);

  // Enforce canonical business identity (shop_id, canonical_order_id)
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'order_fulfillment_status_shop_canonical_unique'
      ) THEN
        ALTER TABLE order_fulfillment_status
        ADD CONSTRAINT order_fulfillment_status_shop_canonical_unique
        UNIQUE (shop_id, canonical_order_id);
      END IF;
    END$$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE order_fulfillment_status
    DROP CONSTRAINT IF EXISTS order_fulfillment_status_shop_canonical_unique;
  `);

  await knex.raw(`
    ALTER TABLE order_fulfillment_status
    ADD CONSTRAINT order_fulfillment_status_shop_id_order_id_unique
    UNIQUE (shop_id, order_id);
  `);
}
