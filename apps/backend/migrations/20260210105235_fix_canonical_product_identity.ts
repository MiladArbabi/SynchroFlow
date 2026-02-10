import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  /**
   * FIX: Canonical product identity
   * --------------------------------
   * Product-level canonical rows MUST be unique per:
   *   (shop_id, platform, platform_product_id)
   * where platform_variant_id IS NULL.
   *
   * Variant-level identity is handled separately
   * in canonical_variants.
   */

  await knex.schema.alterTable('canonical_products', (table) => {
    table.dropUnique(
      ['shop_id', 'platform', 'platform_product_id', 'platform_variant_id'],
      'uq_canonical_products_identity'
    );
  });

  await knex.schema.raw(`
    CREATE UNIQUE INDEX uq_canonical_products_identity
    ON canonical_products (shop_id, platform, platform_product_id)
    WHERE platform_variant_id IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(`
    DROP INDEX IF EXISTS uq_canonical_products_identity
  `);

  await knex.schema.alterTable('canonical_products', (table) => {
    table.unique(
      ['shop_id', 'platform', 'platform_product_id', 'platform_variant_id'],
      { indexName: 'uq_canonical_products_identity' }
    );
  });
}