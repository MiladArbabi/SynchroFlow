import { Knex } from 'knex';

/**
 * MIGRATION 0137 — enforce_runtime_rls_boundary
 * ------------------------------------------------
 * SEC-RLS-P0 forward fix.
 *
 * Production audit (2026-08-05) proved that:
 * - the live runtime connected as superuser `synchroflow`;
 * - `sf_app` could still read domain_events, integrations, and
 *   shopify_app_installations under a deliberately invalid tenant;
 * - 15 RLS-enabled tables were not FORCEd; and
 * - revenue_projection_daily_bak_20260802 was a public shop_id table with
 *   RLS disabled.
 *
 * This migration is intentionally forward-only. Rolling it back would
 * reintroduce a confirmed cross-tenant exposure surface.
 */
export async function up(knex: Knex): Promise<void> {
  const tenantExpression = `
    shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
    AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
  `;

  for (const table of [
    'domain_events',
    'integrations',
    'shopify_app_installations',
  ]) {
    await knex.raw(`
      ALTER TABLE ?? ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ?? FORCE ROW LEVEL SECURITY;
    `, [table, table]);
  }

  await knex.raw(`
    DROP POLICY IF EXISTS domain_events_tenant_isolation_policy ON domain_events;
    DROP POLICY IF EXISTS domain_events_select_policy ON domain_events;
    DROP POLICY IF EXISTS domain_events_write_policy ON domain_events;

    CREATE POLICY domain_events_select_policy
      ON domain_events FOR SELECT
      USING (${tenantExpression});

    CREATE POLICY domain_events_write_policy
      ON domain_events FOR ALL
      USING (${tenantExpression})
      WITH CHECK (${tenantExpression});
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS integrations_tenant_isolation_policy ON integrations;
    DROP POLICY IF EXISTS integrations_select_policy ON integrations;
    DROP POLICY IF EXISTS integrations_write_policy ON integrations;

    CREATE POLICY integrations_select_policy
      ON integrations FOR SELECT
      USING (${tenantExpression});

    CREATE POLICY integrations_write_policy
      ON integrations FOR ALL
      USING (${tenantExpression})
      WITH CHECK (${tenantExpression});
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS shopify_app_installations_tenant_isolation_policy
      ON shopify_app_installations;
    DROP POLICY IF EXISTS shopify_app_installations_select_policy
      ON shopify_app_installations;
    DROP POLICY IF EXISTS shopify_app_installations_write_policy
      ON shopify_app_installations;

    CREATE POLICY shopify_app_installations_select_policy
      ON shopify_app_installations FOR SELECT
      USING (${tenantExpression});

    CREATE POLICY shopify_app_installations_write_policy
      ON shopify_app_installations FOR ALL
      USING (${tenantExpression})
      WITH CHECK (${tenantExpression});
  `);

  const forceRlsTables = [
    'alerts',
    'daily_operational_brief_snapshot',
    'decisions',
    'expansion_eligibility_state',
    'fulfillment_executions',
    'lifecycle_events',
    'order_constraints',
    'orders_operational_control_snapshot',
    'pack_decision_requests',
    'reorder_requests',
    'shop_operational_settings',
    'shop_snapshot_jobs',
    'shopify_products',
    'supplier_product_preferences',
    'system_readiness_state',
  ];

  for (const table of forceRlsTables) {
    await knex.raw(`ALTER TABLE ?? FORCE ROW LEVEL SECURITY`, [table]);
  }

  /**
   * App Store reinstall is necessarily pre-tenant: the signed Shopify shop
   * domain is the only identity available at this point. Expose only shop_id;
   * never expose installation credentials or scopes to the runtime lookup.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.resolve_shopify_reinstall_shop(
      p_shop_domain text
    )
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT installation.shop_id
      FROM public.shopify_app_installations AS installation
      WHERE installation.shop_domain = p_shop_domain
      LIMIT 1
    $$;

    REVOKE ALL ON FUNCTION public.resolve_shopify_reinstall_shop(text)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.resolve_shopify_reinstall_shop(text)
      TO sf_app;
  `);

  /**
   * Cross-tenant workers may discover only tenant identifiers. All payload,
   * credential, and mutation work happens afterward under withTenant().
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.resolve_integration_tenant(
      p_integration_id integer
    )
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT integration.shop_id
      FROM public.integrations AS integration
      WHERE integration.id = p_integration_id
      LIMIT 1
    $$;

    REVOKE ALL ON FUNCTION public.resolve_integration_tenant(integer)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.resolve_integration_tenant(integer)
      TO sf_app;

    CREATE OR REPLACE FUNCTION public.list_due_shop_snapshot_tenants(
      p_limit integer DEFAULT 20
    )
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT job.shop_id
      FROM public.shop_snapshot_jobs AS job
      WHERE job.scheduled_at <= pg_catalog.now() - interval '2 seconds'
      ORDER BY job.scheduled_at
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    $$;

    REVOKE ALL ON FUNCTION public.list_due_shop_snapshot_tenants(integer)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_due_shop_snapshot_tenants(integer)
      TO sf_app;

    CREATE OR REPLACE FUNCTION public.list_morning_brief_tenants()
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT DISTINCT subscription.shop_id
      FROM public.shop_subscriptions AS subscription
      WHERE subscription.status IN ('active', 'trialing')
    $$;

    REVOKE ALL ON FUNCTION public.list_morning_brief_tenants()
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_morning_brief_tenants()
      TO sf_app;

    CREATE OR REPLACE FUNCTION public.list_active_wms_tenants()
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT DISTINCT batch.shop_id
      FROM public.pick_batches AS batch
      WHERE batch.status IN ('picking', 'packing')
    $$;

    REVOKE ALL ON FUNCTION public.list_active_wms_tenants()
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_active_wms_tenants()
      TO sf_app;

    CREATE OR REPLACE FUNCTION public.list_wms_auto_release_tenants()
    RETURNS TABLE (shop_id integer, auto_release_interval_minutes integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT setting.shop_id, setting.auto_release_interval_minutes
      FROM public.shop_wms_settings AS setting
      WHERE setting.auto_release_enabled = true
    $$;

    REVOKE ALL ON FUNCTION public.list_wms_auto_release_tenants()
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_wms_auto_release_tenants()
      TO sf_app;

    CREATE OR REPLACE FUNCTION public.list_trialing_tenants()
    RETURNS TABLE (shop_id integer, trial_ends_at timestamptz)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT subscription.shop_id, subscription.trial_ends_at
      FROM public.shop_subscriptions AS subscription
      WHERE subscription.status = 'trialing'
        AND subscription.trial_ends_at IS NOT NULL
    $$;

    REVOKE ALL ON FUNCTION public.list_trialing_tenants() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_trialing_tenants() TO sf_app;

    CREATE OR REPLACE FUNCTION public.list_expired_shopify_grace_tenants()
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT subscription.shop_id
      FROM public.shop_subscriptions AS subscription
      WHERE subscription.billing_provider = 'shopify'
        AND subscription.tier <> 'starter'
        AND subscription.status IN ('canceled', 'past_due')
        AND subscription.current_period_end < pg_catalog.now()
    $$;

    REVOKE ALL ON FUNCTION public.list_expired_shopify_grace_tenants()
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_expired_shopify_grace_tenants()
      TO sf_app;

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

    CREATE OR REPLACE FUNCTION public.list_margin_drift_tenants()
    RETURNS TABLE (shop_id integer, lasyncro_order_id uuid)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT snapshot.shop_id, snapshot.lasyncro_order_id
      FROM public.order_margin_snapshot AS snapshot
      JOIN (
        SELECT net.lasyncro_order_id, SUM(net.net_revenue) AS live
        FROM public.order_revenue_units_net AS net
        GROUP BY net.lasyncro_order_id
      ) AS revenue ON revenue.lasyncro_order_id = snapshot.lasyncro_order_id
      WHERE ROUND(snapshot.gross_revenue::numeric, 2)
        <> ROUND(revenue.live::numeric, 2)
    $$;

    REVOKE ALL ON FUNCTION public.list_margin_drift_tenants() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_margin_drift_tenants() TO sf_app;

    CREATE OR REPLACE FUNCTION public.list_stalled_shipment_tenants()
    RETURNS TABLE (id uuid, shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT tracking.id, tracking.shop_id
      FROM public.order_shipment_tracking AS tracking
      WHERE tracking.is_stalled = false
        AND tracking.latest_status IN ('in_transit', 'out_for_delivery', 'announced')
        AND tracking.latest_event_at < pg_catalog.now() - interval '72 hours'
    $$;

    REVOKE ALL ON FUNCTION public.list_stalled_shipment_tenants() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_stalled_shipment_tenants() TO sf_app;

    CREATE OR REPLACE FUNCTION public.dispatch_domain_event_outbox_batch(
      p_limit integer DEFAULT 20
    )
    RETURNS TABLE (outbox_id bigint, domain_event_id bigint)
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      WITH candidates AS (
        SELECT outbox.id
        FROM public.domain_event_outbox AS outbox
        WHERE outbox.published_at IS NULL
        ORDER BY outbox.id
        LIMIT LEAST(GREATEST(p_limit, 1), 100)
        FOR UPDATE SKIP LOCKED
      )
      UPDATE public.domain_event_outbox AS outbox
      SET published_at = pg_catalog.now(), last_error = NULL
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id, outbox.domain_event_id
    $$;

    REVOKE ALL ON FUNCTION public.dispatch_domain_event_outbox_batch(integer)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.dispatch_domain_event_outbox_batch(integer)
      TO sf_app;

    CREATE OR REPLACE FUNCTION public.get_projection_worker_state()
    RETURNS TABLE (last_processed_event_id bigint, max_event_id bigint)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT
        COALESCE(cursor.last_processed_event_id, 0)::bigint,
        COALESCE((SELECT MAX(event.id) FROM public.domain_events AS event), 0)::bigint
      FROM (SELECT 1) AS singleton
      LEFT JOIN public.projection_cursors AS cursor
        ON cursor.projection_name = 'orders_projection'
    $$;

    REVOKE ALL ON FUNCTION public.get_projection_worker_state() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.get_projection_worker_state() TO sf_app;

    CREATE OR REPLACE FUNCTION public.get_latest_operational_snapshot_at()
    RETURNS timestamptz
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT MAX(snapshot.updated_at)
      FROM public.orders_operational_control_snapshot AS snapshot
    $$;

    REVOKE ALL ON FUNCTION public.get_latest_operational_snapshot_at()
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.get_latest_operational_snapshot_at()
      TO sf_app;

    CREATE OR REPLACE FUNCTION public.list_projection_event_tenants(
      p_after_id bigint,
      p_limit integer DEFAULT 1
    )
    RETURNS TABLE (id bigint, shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT event.id, event.shop_id
      FROM public.domain_events AS event
      WHERE event.id > p_after_id
      ORDER BY event.id
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    $$;

    REVOKE ALL ON FUNCTION public.list_projection_event_tenants(bigint, integer)
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_projection_event_tenants(bigint, integer)
      TO sf_app;

    CREATE OR REPLACE FUNCTION public.list_reconciliation_intent_tenants()
    RETURNS TABLE (reconciliation_intent_id uuid, shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT intent.reconciliation_intent_id, intent.shop_id
      FROM public.order_reconciliation_intents AS intent
      ORDER BY intent.created_at
    $$;

    REVOKE ALL ON FUNCTION public.list_reconciliation_intent_tenants()
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_reconciliation_intent_tenants()
      TO sf_app;
  `);

  /**
   * Preserve the production backup, but remove it from the runtime/public
   * schema and revoke all app access. Fresh databases do not have this table.
   */
  await knex.raw(`
    CREATE SCHEMA IF NOT EXISTS lasyncro_archive;
    REVOKE ALL ON SCHEMA lasyncro_archive FROM PUBLIC;
    REVOKE ALL ON SCHEMA lasyncro_archive FROM sf_app;

    DO $$
    BEGIN
      IF to_regclass('public.revenue_projection_daily_bak_20260802') IS NOT NULL THEN
        ALTER TABLE public.revenue_projection_daily_bak_20260802
          SET SCHEMA lasyncro_archive;

        REVOKE ALL ON TABLE
          lasyncro_archive.revenue_projection_daily_bak_20260802
          FROM PUBLIC;
        REVOKE ALL ON TABLE
          lasyncro_archive.revenue_projection_daily_bak_20260802
          FROM sf_app;
      END IF;
    END
    $$;
  `);
}

export async function down(_knex: Knex): Promise<void> {
  throw new Error(
    'SECURITY_MIGRATION_IRREVERSIBLE: rollback would reintroduce SEC-RLS-P0'
  );
}
