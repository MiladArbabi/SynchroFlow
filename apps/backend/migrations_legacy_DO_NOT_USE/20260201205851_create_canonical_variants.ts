import type { Knex } from "knex";


/**
 * Canonical Variants
 * ------------------
 * Purpose:
 * - Stable join surface between order line items and products
 *
 * HARD INVARIANTS:
 * - canonical_variant_id MUST be Shopify GID
 * - canonical_product_id MUST be Shopify GID
 * - One row per (shop_id, canonical_variant_id)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('canonical_variants', table => {
    table.increments('id').primary();

    table.integer('shop_id').notNullable();
    table.string('canonical_variant_id', 255).notNullable();
    table.string('canonical_product_id', 255).notNullable();

    table.string('sku', 255).nullable();
    table.text('title').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['shop_id', 'canonical_variant_id']);
    table.index(['shop_id']);
    table.index(['canonical_product_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('canonical_variants');
}