// apps/backend/migrations/20251201183427_create_canonical_commerce_tables.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Canonical orders
  await knex.schema.createTable('canonical_orders', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    // Canonical + platform IDs
    table.string('canonical_order_id').notNullable();       // CanonicalOrder.id
    table.string('platform').notNullable();                 // 'shopify'
    table.string('platform_order_id').notNullable();        // CanonicalOrder.platformOrderId

    // Core money fields
    table.string('currency', 3).notNullable();
    table.decimal('total_price', 10, 2).notNullable();
    table.decimal('subtotal_price', 10, 2).notNullable();
    table.decimal('total_tax', 10, 2).notNullable();

    // Traffic/source
    table.string('source').nullable();
    table.string('referrer_medium').nullable();

    // Customer reference (PCD-safe)
    table.string('customer_hashed_id').nullable();

    // Timestamps from canonical order
    table.timestamp('order_created_at', { useTz: true }).notNullable();
    table.timestamp('order_updated_at', { useTz: true }).notNullable();
    table.timestamp('order_processed_at', { useTz: true }).nullable();

    // DB timestamps
    table.timestamps(true, true);

    table.unique(['shop_id', 'platform', 'platform_order_id']);
    table.index(['shop_id', 'order_created_at']);
  });

  // Canonical order line items
  await knex.schema.createTable('canonical_order_line_items', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('canonical_line_item_id').notNullable();   // CanonicalOrderLineItem.lineItemId
    table.string('canonical_order_id').notNullable();       // CanonicalOrder.id
    table.string('canonical_product_id').nullable();        // CanonicalOrderLineItem.productId
    table.string('canonical_variant_id').nullable();        // CanonicalOrderLineItem.variantId

    table.string('platform').notNullable();                 // 'shopify'
    table.string('platform_order_id').notNullable();
    table.string('platform_line_item_id').nullable();

    table.string('title').notNullable();
    table.string('sku').nullable();

    table.integer('quantity').notNullable();
    table.decimal('unit_price', 10, 2).notNullable();
    table.decimal('total_price', 10, 2).notNullable();
    table.decimal('estimated_unit_cost', 10, 2).nullable();

    table.timestamps(true, true);

    table.index(['shop_id', 'platform', 'platform_order_id']);
    table.index(['canonical_product_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('canonical_order_line_items');
  await knex.schema.dropTableIfExists('canonical_orders');
}
