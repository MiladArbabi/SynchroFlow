import { Knex } from 'knex';

/**
 * MIGRATION 0182 — carrier tracking reconciliation shipment selector (#1114)
 *
 * public.list_reconcilable_shipment_tenants() — a locator-only SECURITY
 * DEFINER function (same posture as public.list_stalled_shipment_tenants(),
 * migration 0137) enumerating (id, shop_id) for order_shipment_tracking rows
 * eligible for tracking reconciliation. Cross-tenant discovery ONLY:
 * returns no tracking_number, carrier_code, credentials, provider metadata,
 * order ids, or status payload — actual shipment reads remain a later
 * tenant-scoped step.
 *
 * Eligibility (WORKSHOP #1114 / STEP 6B ratified policy):
 *   A. tracking_number IS NOT NULL
 *   B. carrier_code IN ('shippo', 'sendcloud') — never 'sendcloud_v3', which
 *      is a carrier_status_map lookup namespace only (migration 0180), never
 *      a business carrier identity.
 *   C. an exact (shop_id, carrier_code, is_active=true) match against
 *      shop_carrier_settings — no "shop has any active carrier" fallback,
 *      no cross-carrier fallback.
 *   D. latest_status IS DISTINCT FROM 'returned' — absolute terminal,
 *      null-safe so never-observed shipments are not excluded by this rule.
 *   E. delivered shipments remain eligible only within a 14-day grace
 *      window from COALESCE(latest_event_at, created_at).
 *   F. every candidate must satisfy a 60-day outer age bound from the same
 *      COALESCE fallback (no separate 30-day rule anywhere here — 30
 *      minutes is the later worker's poll cadence, not selector eligibility).
 *   G. Shippo rows require provider_carrier_code IS NOT NULL (the canonical
 *      carrier token resolved from rate.carrier_account — migration 0180);
 *      never inferred from carrier_zone/tracking_number/display text.
 *      Sendcloud has no such requirement.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.list_reconcilable_shipment_tenants()
    RETURNS TABLE (id uuid, shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT tracking.id, tracking.shop_id
      FROM public.order_shipment_tracking AS tracking
      WHERE tracking.tracking_number IS NOT NULL
        AND tracking.carrier_code IN ('shippo', 'sendcloud')
        AND EXISTS (
          SELECT 1
          FROM public.shop_carrier_settings AS settings
          WHERE settings.shop_id = tracking.shop_id
            AND settings.carrier_code = tracking.carrier_code
            AND settings.is_active = true
        )
        AND tracking.latest_status IS DISTINCT FROM 'returned'
        AND (
          tracking.latest_status IS DISTINCT FROM 'delivered'
          OR COALESCE(tracking.latest_event_at, tracking.created_at)
             > pg_catalog.now() - interval '14 days'
        )
        AND COALESCE(tracking.latest_event_at, tracking.created_at)
            > pg_catalog.now() - interval '60 days'
        AND (
          tracking.carrier_code <> 'shippo'
          OR tracking.provider_carrier_code IS NOT NULL
        )
    $$;

    REVOKE ALL ON FUNCTION public.list_reconcilable_shipment_tenants()
    FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION public.list_reconcilable_shipment_tenants()
    TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP FUNCTION IF EXISTS public.list_reconcilable_shipment_tenants();
  `);
}
