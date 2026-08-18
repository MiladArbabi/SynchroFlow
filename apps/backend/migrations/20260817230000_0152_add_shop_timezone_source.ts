import type { Knex } from 'knex';

/**
 * SRC-05a
 *
 * shops.timezone is populated from Shopify's ianaTimezone on install, but a
 * merchant may override it (warehouse in a different zone than the storefront
 * registration, multi-region operation, etc). Without provenance, the next
 * OAuth sync would silently clobber that choice.
 *
 * 'shopify' = auto-populated, safe to refresh on sync.
 * 'manual'  = merchant chose it; sync must never overwrite.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE shops
    ADD COLUMN timezone_source text NOT NULL DEFAULT 'shopify'
  `);
  await knex.raw(`
    ALTER TABLE shops
    ADD CONSTRAINT shops_timezone_source_check
    CHECK (timezone_source IN ('shopify', 'manual'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_timezone_source_check`);
  await knex.raw(`ALTER TABLE shops DROP COLUMN IF EXISTS timezone_source`);
}
