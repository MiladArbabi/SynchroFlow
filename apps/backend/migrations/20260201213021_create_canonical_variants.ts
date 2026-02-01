import type { Knex } from "knex";


/**
 * Canonical Variants
 * ------------------
 * Purpose:
 * - Bridge canonical_order_line_items → canonical_products
 * - Variant is the join key, product is the anchor
 *
 * Invariants:
 * - One row per (shop_id, canonical_variant_id)
 * - canonical_product_id is REQUIRED
 * - No inference, no synthesis
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('canonical_variants');
    if (!exists) {
    await knex.schema.createTable('canonical_variants', table => {
    table.increments('id').primary();

    table.integer('shop_id').notNullable();
    table.string('canonical_variant_id', 255).notNullable();
    table.string('canonical_product_id', 255).notNullable();

    table.string('sku', 255).nullable();
    table.text('title').nullable();

    table.timestamps(true, true);

    table.unique(['shop_id', 'canonical_variant_id']);
    });
  }
}

export async function down(_: Knex): Promise<void> {
  // NO-OP
  // This table may pre-exist and must never be dropped automatically.
}

