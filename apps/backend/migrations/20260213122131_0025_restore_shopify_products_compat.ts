/**
 * TEMPORARY COMPATIBILITY TABLE
 *
 * This table exists only to support the legacy Shopify worker.
 *
 * Architectural note:
 * Long-term target is sovereign products + external_product_identity_map.
 * See GitHub issue: Refactor product ingestion to sovereign model.
 *
 * DO NOT extend this table further.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shopify_products', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('platform_product_id').notNullable();

    table.string('title');
    table.string('vendor');
    table.string('product_type');
    table.string('status');

    table.integer('total_inventory')
      .notNullable()
      .defaultTo(0);

    table.timestamps(true, true);

    /**
     * Required for:
     *   ON CONFLICT (shop_id, platform_product_id)
     */
    table.unique(
      ['shop_id', 'platform_product_id'],
      'shopify_products_shop_platform_unique'
    );

    table.index(['shop_id'], 'shopify_products_shop_id_index');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shopify_products');
}
