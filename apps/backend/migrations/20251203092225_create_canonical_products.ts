// apps/backend/migrations/XXXX_create_canonical_products.ts

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('canonical_products', (table) => {
    table.increments('canonical_product_id').primary(); // numeric canonical id
    table.integer('shop_id').notNullable();

    table.string('platform').notNullable(); // 'shopify' in FT0
    table.string('platform_product_id').notNullable();
    table.string('platform_variant_id').nullable();
    table.string('sku').nullable();
    table.text('title').notNullable();

    table
      .enu('status', ['active', 'inactive', 'archived'], {
        useNative: false,
        enumName: 'canonical_product_status',
      })
      .notNullable()
      .defaultTo('active');

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // One canonical row per (shop, platform, product, variant)
    table.unique(['shop_id', 'platform', 'platform_product_id', 'platform_variant_id'], {
      indexName: 'uq_canonical_products_identity',
    });

    table.index(['shop_id', 'platform_product_id'], 'idx_canonical_products_shop_product');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('canonical_products');
  // optional: drop enum if your DB engine actually created one
}
