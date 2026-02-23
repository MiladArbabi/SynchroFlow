import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  /**
   * Restore canonical_products identity to original design.
   *
   * The original migration defines ONE canonical row per:
   *   (shop_id, platform, platform_product_id, platform_variant_id)
   *
   * The partial unique index introduced later breaks Postgres ON CONFLICT
   * semantics and must be removed.
   */

  // Drop the partial unique index (if present)
  await knex.schema.raw(`
    DROP INDEX IF EXISTS uq_canonical_products_identity
  `);

  // Restore full unique constraint
  await knex.schema.alterTable('canonical_products', (table) => {
    table.unique(
      ['shop_id', 'platform', 'platform_product_id', 'platform_variant_id'],
      { indexName: 'uq_canonical_products_identity' }
    );
  });
}

export async function down(knex: Knex): Promise<void> {
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
