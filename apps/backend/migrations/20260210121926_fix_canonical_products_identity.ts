// apps/backend/migrations/XXXX_fix_canonical_products_identity.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  /**
   * Canonical Product Identity (PRODUCT-LEVEL)
   * -----------------------------------------
   * One row per (shop, platform, product).
   * Product rows ALWAYS have platform_variant_id = NULL.
   *
   * This partial unique index is REQUIRED for:
   * - Correct ON CONFLICT behavior
   * - Transactional product ingestion
   * - FT0 / FT2 correctness
   */
  await knex.schema.alterTable('canonical_products', table => {
    table.dropUnique(
      ['shop_id', 'platform', 'platform_product_id', 'platform_variant_id'],
      'uq_canonical_products_identity'
    );
  });

  await knex.raw(`
    CREATE UNIQUE INDEX uq_canonical_products_identity
    ON canonical_products (shop_id, platform, platform_product_id)
    WHERE platform_variant_id IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS uq_canonical_products_identity
  `);

  await knex.schema.alterTable('canonical_products', table => {
    table.unique(
      ['shop_id', 'platform', 'platform_product_id', 'platform_variant_id'],
      'uq_canonical_products_identity'
    );
  });
}
