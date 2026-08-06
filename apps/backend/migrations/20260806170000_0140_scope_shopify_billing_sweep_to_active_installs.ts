import type { Knex } from 'knex';

/**
 * BILL-21 — list_shopify_billed_tenants swept every shop that ever carried a
 * Shopify subscription row, regardless of whether the app was still installed.
 * Reviewer tenants 14 and 15 uninstalled (2026-07-29, 2026-08-05) but kept
 * being reconciled, so every cycle issued a GraphQL call against a revoked
 * token and logged a 401. Shop 14 had been failing for a week; the v270 crash
 * only made it visible.
 *
 * Scope the resolver to shops with a live installation. Uninstalled shops are
 * handled by the uninstall grace worker, not by billing reconciliation.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.list_shopify_billed_tenants()
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT subscription.shop_id
      FROM public.shop_subscriptions AS subscription
      WHERE subscription.billing_provider = 'shopify'
        AND EXISTS (
          SELECT 1
          FROM public.shopify_app_installations AS installation
          WHERE installation.shop_id = subscription.shop_id
            AND installation.uninstalled_at IS NULL
        )
    $$;

    REVOKE ALL ON FUNCTION public.list_shopify_billed_tenants() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_shopify_billed_tenants() TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.list_shopify_billed_tenants()
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT subscription.shop_id
      FROM public.shop_subscriptions AS subscription
      WHERE subscription.billing_provider = 'shopify'
    $$;

    REVOKE ALL ON FUNCTION public.list_shopify_billed_tenants() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_shopify_billed_tenants() TO sf_app;
  `);
}