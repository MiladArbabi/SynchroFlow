import type { Knex } from 'knex';

/**
 * GH-1262 A2.2 — Shopify product source freshness watermark.
 *
 * Ordered after the protected 0212/0215 reconnect tail and the 0216/0217
 * security evolutions; it touches no reconnect-authority object.
 *
 * One row per external Shopify product: the Shopify source timestamp
 * (REST updated_at / GraphQL updatedAt) of the newest catalog input applied.
 * Keyed by the external identity, not by a LaSyncro parent, so historically
 * split parents of one Shopify product share a single watermark.
 *
 * No backfill: a watermark is only ever written from a real source timestamp
 * during ingestion. Existing products start without one.
 *
 * Deletion tombstone (is_deleted): products/delete marks the external product
 * deleted even when it was never ingested, so a delayed products/create cannot
 * resurrect it. A products/delete payload carries no source timestamp, so only
 * a tombstone may hold none; every other row must hold a real one.
 *
 * Equal-timestamp reconciliation (B1): a conflicting input carrying the SAME
 * source timestamp as the watermark cannot be ordered, so it records a durable
 * obligation on this row (reconcile_generation + reconcile_requested_at). A
 * worker claims it per tenant (claim_token + DB-time lease_expires_at), fetches
 * the authoritative product from Shopify outside any transaction, and applies
 * it only while its token, generation and live lease all still hold. Failures
 * are counted (reconcile_attempts, sanitized reconcile_last_error) and bounded.
 *
 * Cross-tenant discovery is list_shopify_product_reconciliation_tenants():
 * shop ids only. Every claim, read and write runs as sf_app under FORCE RLS.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shopify_product_source_watermarks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable()
      .references('id').inTable('shops').onDelete('CASCADE');
    table.text('platform').notNullable();
    table.text('external_product_id').notNullable();
    table.timestamp('source_updated_at', { useTz: true }).nullable();
    table.boolean('is_deleted').notNullable().defaultTo(false);
    table.integer('reconcile_generation').notNullable().defaultTo(0);
    table.timestamp('reconcile_requested_at', { useTz: true }).nullable();
    table.uuid('claim_token').nullable();
    table.timestamp('lease_expires_at', { useTz: true }).nullable();
    table.integer('reconcile_attempts').notNullable().defaultTo(0);
    table.timestamp('reconcile_last_attempt_at', { useTz: true }).nullable();
    table.text('reconcile_last_error').nullable();
    table.timestamps(true, true);
    table.unique(
      ['shop_id', 'platform', 'external_product_id'],
      'shopify_product_source_watermarks_identity_unique'
    );
  });

  const tenantExpression = `
    shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
    AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
  `;

  await knex.raw(`
    ALTER TABLE shopify_product_source_watermarks
      ADD CONSTRAINT shopify_product_source_watermarks_platform_check
      CHECK (platform = 'shopify');

    ALTER TABLE shopify_product_source_watermarks
      ADD CONSTRAINT shopify_product_source_watermarks_timestamp_or_tombstone_check
      CHECK (is_deleted OR source_updated_at IS NOT NULL);

    ALTER TABLE shopify_product_source_watermarks
      ADD CONSTRAINT shopify_product_source_watermarks_reconcile_generation_check
      CHECK (reconcile_generation >= 0);

    ALTER TABLE shopify_product_source_watermarks
      ADD CONSTRAINT shopify_product_source_watermarks_reconcile_attempts_check
      CHECK (reconcile_attempts >= 0);

    ALTER TABLE shopify_product_source_watermarks
      ADD CONSTRAINT shopify_product_source_watermarks_claim_lease_check
      CHECK ((claim_token IS NULL) = (lease_expires_at IS NULL));

    CREATE INDEX shopify_product_source_watermarks_pending_idx
      ON shopify_product_source_watermarks (shop_id, reconcile_requested_at)
      WHERE reconcile_requested_at IS NOT NULL;

    ALTER TABLE shopify_product_source_watermarks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shopify_product_source_watermarks FORCE ROW LEVEL SECURITY;

    CREATE POLICY shopify_product_source_watermarks_select_policy
      ON shopify_product_source_watermarks FOR SELECT
      USING (${tenantExpression});

    CREATE POLICY shopify_product_source_watermarks_insert_policy
      ON shopify_product_source_watermarks FOR INSERT
      WITH CHECK (${tenantExpression});

    CREATE POLICY shopify_product_source_watermarks_update_policy
      ON shopify_product_source_watermarks FOR UPDATE
      USING (${tenantExpression})
      WITH CHECK (${tenantExpression});

    GRANT SELECT, INSERT, UPDATE ON shopify_product_source_watermarks TO sf_app;
    REVOKE DELETE ON shopify_product_source_watermarks FROM sf_app;
  `);

  /**
   * Identifier-only cross-tenant discovery: shops with at least one claimable
   * obligation (pending, not tombstoned, not exhausted, lease free or expired,
   * backoff elapsed). It returns shop ids and nothing else; the worker re-checks every
   * condition while claiming under the tenant's own RLS context.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.list_shopify_product_reconciliation_tenants(
      p_limit integer DEFAULT 20,
      p_max_attempts integer DEFAULT 8,
      p_backoff_base_ms integer DEFAULT 5000,
      p_backoff_cap_ms integer DEFAULT 300000
    )
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT watermark.shop_id
      FROM public.shopify_product_source_watermarks AS watermark
      WHERE watermark.reconcile_requested_at IS NOT NULL
        AND NOT watermark.is_deleted
        AND watermark.reconcile_attempts < p_max_attempts
        AND (watermark.lease_expires_at IS NULL
             OR watermark.lease_expires_at <= pg_catalog.now())
        AND (watermark.reconcile_attempts = 0
             OR watermark.reconcile_last_attempt_at IS NULL
             OR watermark.reconcile_last_attempt_at + pg_catalog.make_interval(
                  secs => LEAST(
                    p_backoff_cap_ms::double precision,
                    p_backoff_base_ms * pg_catalog.power(2, LEAST(watermark.reconcile_attempts - 1, 30))
                  ) / 1000.0
                ) <= pg_catalog.now())
      GROUP BY watermark.shop_id
      ORDER BY MIN(watermark.reconcile_requested_at), watermark.shop_id
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    $$;

    REVOKE ALL ON FUNCTION public.list_shopify_product_reconciliation_tenants(integer, integer, integer, integer)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_shopify_product_reconciliation_tenants(integer, integer, integer, integer)
      TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP FUNCTION IF EXISTS public.list_shopify_product_reconciliation_tenants(integer, integer, integer, integer);
  `);
  await knex.schema.dropTableIfExists('shopify_product_source_watermarks');
}
