// apps/backend/migrations/XXXX_normalize_shopify_platform_order_id.ts

import { Knex } from 'knex';

/**
 * Normalize Shopify platform_order_id
 * -----------------------------------
 * Converts:
 *   gid://shopify/Order/16567328080242
 * → 16567328080242
 *
 * Rules:
 * - Shopify only
 * - Idempotent
 * - Fail-closed
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE canonical_orders
    SET platform_order_id = regexp_replace(
      platform_order_id,
      '^gid://shopify/Order/',
      ''
    )
    WHERE platform = 'shopify'
      AND platform_order_id LIKE 'gid://shopify/Order/%'
  `);
}

export async function down(): Promise<void> {
  // Non-reversible by design
}