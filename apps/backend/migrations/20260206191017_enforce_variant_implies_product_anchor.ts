import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE canonical_order_line_items
    ADD CONSTRAINT chk_variant_requires_product_anchor
    CHECK (
      canonical_variant_id IS NULL
      OR canonical_product_anchor_id IS NOT NULL
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE canonical_order_line_items
    DROP CONSTRAINT IF EXISTS chk_variant_requires_product_anchor
  `);
}
