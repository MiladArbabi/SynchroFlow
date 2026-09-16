// tests/integration/migrations/carrier-tracking-reconciliation-tenants-1114.migration.test.ts
//
// #1114 STEP 6B — public.list_reconcilable_shipment_tenants() SECURITY
// DEFINER migration contract. PERMANENT regression contract, authored RED.
// ===========================================================================
// REQUIRED RED (at authoring time): no migration defining
// public.list_reconcilable_shipment_tenants() exists yet (next free slot:
// 0182, not created by this test) — every query against it fails with a
// clear "function ... does not exist" Postgres error, narrowly attributable
// to the missing STEP 6B migration.
//
// Mirrors the precedent and security posture of
// tests/integration/migrations/stock-protection-reconciliation-tenants-function.migration.test.ts
// and public.list_stalled_shipment_tenants() (migration 0137): a locator-only
// SECURITY DEFINER function returning ONLY (id uuid, shop_id integer) for
// cross-tenant discovery — actual shipment reads remain a later
// tenant-scoped step, never done by this function.
//
// Ratified eligibility policy under test (WORKSHOP #1114 / STEP 6B brief):
//   A. tracking_number IS NOT NULL
//   B. carrier_code IN ('shippo', 'sendcloud') — NEVER 'sendcloud_v3'
//      (a status-normalization lookup namespace only, never a business
//      carrier identity — see migration 0180 / carrier_status_map).
//   C. an EXISTS-equivalent match against shop_carrier_settings for the
//      EXACT (shop_id, carrier_code, is_active=true) tuple — no
//      "shop has any active carrier" fallback, no cross-carrier fallback.
//   D. latest_status IS DISTINCT FROM 'returned' (absolute terminal,
//      null-safe so never-observed shipments are not excluded by this rule).
//   E. delivered shipments: COALESCE(latest_event_at, created_at) >
//      now() - interval '14 days'.
//   F. every candidate: COALESCE(latest_event_at, created_at) >
//      now() - interval '60 days' (no separate 30-day rule anywhere here).
//   G. carrier_code='shippo' requires provider_carrier_code IS NOT NULL
//      (never inferred from carrier_zone/tracking_number/display text);
//      Sendcloud has no such requirement.

import crypto from 'crypto';
import db, {
  setTenantContext,
  systemTransaction,
  systemQuery,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function createShop(prefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedOrder(shopId: number): Promise<string> {
  const orderId = crypto.randomUUID();
  const now = new Date();
  await withTenant(shopId, (trx) =>
    trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    })
  );
  return orderId;
}

async function seedCarrierSettings(
  shopId: number,
  carrierCode: 'shippo' | 'sendcloud',
  isActive: boolean
): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('shop_carrier_settings').insert({
      shop_id: shopId,
      carrier_code: carrierCode,
      is_active: isActive,
    })
  );
}

interface ShipmentFixture {
  shopId: number;
  orderId: string;
  carrierCode: string;
  trackingNumber: string | null;
  latestStatus: string | null;
  latestEventAt: Date | null;
  createdAt?: Date;
  providerCarrierCode?: string | null;
  carrierZone?: string | null;
}

async function seedShipment(fixture: ShipmentFixture): Promise<string> {
  const id = crypto.randomUUID();
  await withTenant(fixture.shopId, (trx) =>
    trx('order_shipment_tracking').insert({
      id,
      shop_id: fixture.shopId,
      lasyncro_order_id: fixture.orderId,
      carrier_code: fixture.carrierCode,
      tracking_number: fixture.trackingNumber,
      latest_status: fixture.latestStatus,
      latest_event_at: fixture.latestEventAt,
      created_at: fixture.createdAt ?? daysAgo(0),
      provider_carrier_code: fixture.providerCarrierCode ?? null,
      carrier_zone: fixture.carrierZone ?? null,
    })
  );
  return id;
}

async function callSelector(): Promise<Set<string>> {
  const result = await systemQuery(db.raw('SELECT id FROM public.list_reconcilable_shipment_tenants()'));
  return new Set(result.rows.map((r: any) => String(r.id)));
}

describe('list_reconcilable_shipment_tenants() — SECURITY DEFINER migration contract', () => {
  it('returns exactly the eligible shipments and excludes every ineligible one, per the ratified policy', async () => {
    // ── Shop A — the primary fixture: full positive/negative matrix ──────
    const shopA = await createShop('carrierrecon1114a');
    const orderA = await seedOrder(shopA);
    await seedCarrierSettings(shopA, 'shippo', true);
    await seedCarrierSettings(shopA, 'sendcloud', true);

    // 1. MUST be returned — sendcloud, announced, recent, active settings.
    const eligible1 = await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: 'TN-SC-ANNOUNCED',
      latestStatus: 'announced', latestEventAt: daysAgo(1),
    });

    // 2. MUST be returned — sendcloud, null latest_status, recent created_at.
    const eligible2 = await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: 'TN-SC-NULLSTATUS-RECENT',
      latestStatus: null, latestEventAt: null, createdAt: daysAgo(1),
    });

    // 3. MUST be returned — shippo, in_transit, recent, provider_carrier_code set.
    const eligible3 = await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'shippo', trackingNumber: 'TN-SHIPPO-INTRANSIT',
      latestStatus: 'in_transit', latestEventAt: daysAgo(2), providerCarrierCode: 'usps',
    });

    // 4. MUST be returned — delivered, recent (<14 days).
    const eligible4 = await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: 'TN-DELIVERED-RECENT',
      latestStatus: 'delivered', latestEventAt: daysAgo(10),
    });

    // 15. MUST be returned — sendcloud recent with provider_carrier_code
    // null: Sendcloud has NO provider_carrier_code requirement.
    const eligible15 = await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: 'TN-SC-NO-PROVIDER-CODE',
      latestStatus: 'in_transit', latestEventAt: daysAgo(1), providerCarrierCode: null,
    });

    // Section 5 — timestamp fallback, "recent" side (COALESCE -> created_at).
    const eligibleFallbackRecent = await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: 'TN-FALLBACK-CREATED-RECENT',
      latestStatus: null, latestEventAt: null, createdAt: daysAgo(5),
    });

    // 5. MUST NOT be returned — tracking_number null.
    await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: null,
      latestStatus: 'announced', latestEventAt: daysAgo(1),
    });

    // 6. MUST NOT be returned — unsupported carrier.
    await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'ups', trackingNumber: 'TN-UNSUPPORTED-CARRIER',
      latestStatus: 'in_transit', latestEventAt: daysAgo(1),
    });

    // 10. MUST NOT be returned — returned, recent (absolute terminal).
    await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: 'TN-RETURNED-RECENT',
      latestStatus: 'returned', latestEventAt: daysAgo(1),
    });

    // 11. MUST NOT be returned — delivered, older than 14 days (grace expired).
    await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: 'TN-DELIVERED-OLD',
      latestStatus: 'delivered', latestEventAt: daysAgo(20),
    });

    // 12. MUST NOT be returned — non-delivered, older than 60 days.
    await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: 'TN-STALE-NONDELIVERED',
      latestStatus: 'in_transit', latestEventAt: daysAgo(70),
    });

    // 13. MUST NOT be returned — Shippo, recent, provider_carrier_code null.
    await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'shippo', trackingNumber: 'TN-SHIPPO-NO-CODE',
      latestStatus: 'in_transit', latestEventAt: daysAgo(1), providerCarrierCode: null,
    });

    // 14. MUST NOT be returned — Shippo, carrier_zone='USPS' but
    // provider_carrier_code null: explicit anti-heuristic contract (the
    // function must never infer the canonical token from carrier_zone).
    await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'shippo', trackingNumber: 'TN-SHIPPO-ZONE-USPS-NO-CODE',
      latestStatus: 'in_transit', latestEventAt: daysAgo(1), providerCarrierCode: null, carrierZone: 'USPS',
    });

    // Section 5 — timestamp fallback, "excluded" side.
    await seedShipment({
      shopId: shopA, orderId: orderA, carrierCode: 'sendcloud', trackingNumber: 'TN-FALLBACK-CREATED-OLD',
      latestStatus: null, latestEventAt: null, createdAt: daysAgo(70),
    });

    // ── Shop B — case 7: matching carrier setting entirely absent ────────
    const shopB = await createShop('carrierrecon1114b');
    const orderB = await seedOrder(shopB);
    // No shop_carrier_settings row at all for this shop.
    await seedShipment({
      shopId: shopB, orderId: orderB, carrierCode: 'shippo', trackingNumber: 'TN-NO-SETTINGS-AT-ALL',
      latestStatus: 'in_transit', latestEventAt: daysAgo(1), providerCarrierCode: 'usps',
    });

    // ── Shop C — case 8: matching carrier setting present but inactive ───
    const shopC = await createShop('carrierrecon1114c');
    const orderC = await seedOrder(shopC);
    await seedCarrierSettings(shopC, 'shippo', false);
    await seedShipment({
      shopId: shopC, orderId: orderC, carrierCode: 'shippo', trackingNumber: 'TN-SETTINGS-INACTIVE',
      latestStatus: 'in_transit', latestEventAt: daysAgo(1), providerCarrierCode: 'usps',
    });

    // ── Shop D — case 9: shop has a DIFFERENT active carrier, but the
    // shipment's own carrier is inactive — proves no cross-carrier fallback.
    const shopD = await createShop('carrierrecon1114d');
    const orderD = await seedOrder(shopD);
    await seedCarrierSettings(shopD, 'shippo', true);
    await seedCarrierSettings(shopD, 'sendcloud', false);
    await seedShipment({
      shopId: shopD, orderId: orderD, carrierCode: 'sendcloud', trackingNumber: 'TN-CROSS-CARRIER-NO-FALLBACK',
      latestStatus: 'in_transit', latestEventAt: daysAgo(1),
    });

    // ── Exercise the selector and compare EXACT membership by id ─────────
    const returnedIds = await callSelector();

    const mustBeReturned = [eligible1, eligible2, eligible3, eligible4, eligible15, eligibleFallbackRecent];
    for (const id of mustBeReturned) {
      expect(returnedIds.has(id)).toBe(true);
    }

    // Every OTHER shipment id seeded across all four shops must be absent.
    // (Collected by re-querying each shop's shipments and subtracting the
    // known-eligible set, rather than hand-maintaining a second id list —
    // avoids the list silently drifting out of sync with the seeds above.)
    const allSeededIds = await withTenant(shopA, (trx) =>
      trx('order_shipment_tracking').where({ shop_id: shopA }).pluck('id')
    );
    const shopBIds = await withTenant(shopB, (trx) => trx('order_shipment_tracking').where({ shop_id: shopB }).pluck('id'));
    const shopCIds = await withTenant(shopC, (trx) => trx('order_shipment_tracking').where({ shop_id: shopC }).pluck('id'));
    const shopDIds = await withTenant(shopD, (trx) => trx('order_shipment_tracking').where({ shop_id: shopD }).pluck('id'));

    const allIds = [...allSeededIds, ...shopBIds, ...shopCIds, ...shopDIds];
    const eligibleSet = new Set(mustBeReturned);
    const ineligibleIds = allIds.filter((id) => !eligibleSet.has(id));

    expect(ineligibleIds.length).toBeGreaterThan(0); // sanity: the negative fixtures actually exist
    for (const id of ineligibleIds) {
      expect(returnedIds.has(id)).toBe(false);
    }
  });

  it('PUBLIC cannot execute the function', async () => {
    const result = await systemQuery(
      db.raw(
        `SELECT has_function_privilege('public', 'public.list_reconcilable_shipment_tenants()', 'EXECUTE') as can_execute`
      )
    );
    expect(result.rows[0].can_execute).toBe(false);
  });

  it('sf_app CAN execute the function', async () => {
    const result = await systemQuery(
      db.raw(
        `SELECT has_function_privilege('sf_app', 'public.list_reconcilable_shipment_tenants()', 'EXECUTE') as can_execute`
      )
    );
    expect(result.rows[0].can_execute).toBe(true);
  });

  it('works with no app.current_tenant set — cross-tenant discovery is granted by SECURITY DEFINER, not by an app-level bypass', async () => {
    const shopId = await createShop('carrierrecon1114notenant');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'sendcloud', true);
    const shipmentId = await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-NOTENANT',
      latestStatus: 'announced', latestEventAt: daysAgo(1),
    });

    // Deliberately no setTenantContext / withTenant here — a fresh
    // transaction with app.current_tenant never set.
    const result = await systemTransaction((trx) =>
      systemQuery(trx.raw('SELECT id FROM public.list_reconcilable_shipment_tenants()'))
    );
    const ids = new Set(result.rows.map((r: any) => String(r.id)));
    expect(ids.has(shipmentId)).toBe(true);
  });

  it('the returned row shape exposes ONLY id and shop_id — no tracking_number, carrier_code, or provider metadata', async () => {
    const shopId = await createShop('carrierrecon1114shape');
    const orderId = await seedOrder(shopId);
    await seedCarrierSettings(shopId, 'sendcloud', true);
    await seedShipment({
      shopId, orderId, carrierCode: 'sendcloud', trackingNumber: 'TN-SHAPE',
      latestStatus: 'announced', latestEventAt: daysAgo(1),
    });

    const result = await systemQuery(db.raw('SELECT * FROM public.list_reconcilable_shipment_tenants()'));
    expect(result.rows.length).toBeGreaterThan(0);
    const keys = Object.keys(result.rows[0]).sort();
    expect(keys).toEqual(['id', 'shop_id']);
  });
});
