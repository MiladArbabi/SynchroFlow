import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.list_stock_protection_reconciliation_tenants()
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    -- status IN ('active', 'trialing')
    AS $$
      SELECT DISTINCT subscription.shop_id
      FROM public.shop_subscriptions AS subscription
      WHERE subscription.status IN ('active', 'trialing')
    $$;

    REVOKE ALL ON FUNCTION public.list_stock_protection_reconciliation_tenants()
    FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION public.list_stock_protection_reconciliation_tenants()
    TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP FUNCTION IF EXISTS public.list_stock_protection_reconciliation_tenants();
  `);
}
