// tests/integration/orders/outbound-read-model.contract.test.ts
//
// OUTBOUND SLICE B RED — canonical Orders-domain outbound read model.
//
// Endpoint under test (does not exist yet): GET /api/v1/orders/outbound
// GET /api/v1/orders/fulfilled keeps its commercial-fulfillment semantics and
// is deliberately not exercised here.
//
// Truth sources established during the read-only preflight:
//   - Membership = canonical LaSyncro PHYSICAL shipment truth:
//     order_warehouse_status.status = 'shipped' with shipped_at. shipped_at is
//     written only by confirmShipment (shipConfirmation.service.ts:66-73),
//     reached from the manual ship route (wms.controller.ts:2295) and the
//     carrier-handoff path (confirmShipmentFromCarrierHandoff :200-201).
//     Shopify fulfillment alone writes order_fulfillment_status and
//     line-level status only (orders.fulfilled.ts:315,
//     fulfillmentPhysicalRemoval.service.ts:markLineShipped) — never
//     order_warehouse_status — so it must not admit an order.
//     partially_shipped is out of this contract (not fixtured).
//   - Tracking / carrier status = order_shipment_tracking
//     (carrierLabel.service.ts:145-161, ingestCarrierTrackingObservation.ts:
//     134-142). latest_status vocabulary: announced, in_transit,
//     out_for_delivery, delivered, exception, returned, plus literal
//     'unknown' for unmapped raw statuses (carrierTrackingNormalization.ts).
//     A carrier exception sets is_stalled=true (ingest :133).
//   - carrier_code is the label PROVIDER ('sendcloud' | 'shippo',
//     carrierLabel.service.ts:26-29,150). The physical carrier is only
//     established by provider_carrier_code (Shippo, :125-140,158).
//   - orders.currency is the per-order stored currency; shops.base_currency
//     is a separate shop setting. Value shipped is intentionally NOT asserted
//     (mixed-currency summing is an open contract question).
//   - Shop timezone = shops.timezone (NOT NULL, default 'UTC').
//   - Search identity: order = external_order_identity_map.external_order_id
//     (search.service.ts precedent); SKU = line item / variant sku;
//     customer = orders.shipping_name (the only plain customer identity on
//     orders; customers is not linked to orders by a plain key).
//
// Fixtures: one disposable tenant shop per case (createTenantShop), seeded
// through withTenant. The backend-integration project shares one disposable
// database, so every assertion is scoped to its own shop.

import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let externalSeq = 0;
function nextExternalId(): string {
  externalSeq += 1;
  return `7${Date.now().toString().slice(-8)}${String(externalSeq).padStart(4, '0')}`;
}

async function createShop(timezone = 'UTC'): Promise<{ shopId: number; userId: number }> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `outbound-read-${unique}`);
    await setTenantContext(trx, id);
    await trx('shops').where({ id }).update({ timezone, timezone_source: 'manual' });
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `outbound-read-${unique}@test.example`,
        password_hash: 'not-a-real-hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    await trx('shop_memberships').insert({ shop_id: shopId, user_id: row.id, role: 'owner' });
    return row.id as number;
  });

  return { shopId, userId };
}

type TrackingFixture = {
  carrierCode: string;
  trackingNumber: string | null;
  latestStatus: string | null;
  latestEventAt?: Date | null;
  isStalled?: boolean;
  providerCarrierCode?: string | null;
};

type OrderFixture = {
  shopId: number;
  /** 'shipped' = canonical physical shipment; 'packed' = not yet shipped;
   *  'none' = no warehouse row (e.g. fulfilled only in Shopify). */
  warehouse: 'shipped' | 'packed' | 'none';
  shippedAt?: Date;
  orderCreatedAt?: Date;
  fulfilled?: boolean;
  fulfilledAt?: Date;
  currency?: string;
  totalPrice?: string;
  shippingName?: string | null;
  sku?: string | null;
  tracking?: TrackingFixture | null;
  orderId?: string;
};

async function seedOrder(f: OrderFixture): Promise<{ orderId: string; externalOrderId: string }> {
  const orderId = f.orderId ?? crypto.randomUUID();
  const externalOrderId = nextExternalId();
  const now = new Date();
  const shippedAt = f.shippedAt ?? new Date(now.getTime() - 1000);
  const orderCreatedAt = f.orderCreatedAt ?? new Date(shippedAt.getTime() - 12 * HOUR);

  await withTenant(f.shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: f.shopId,
      payment_state: 'paid',
      currency: f.currency ?? 'USD',
      total_price: f.totalPrice ?? '100.00',
      subtotal_price: f.totalPrice ?? '100.00',
      total_tax: '0.00',
      shipping_name: f.shippingName ?? null,
      order_created_at: orderCreatedAt,
      paid_at: orderCreatedAt,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: f.shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });

    if (f.sku) {
      const productId = crypto.randomUUID();
      const variantId = crypto.randomUUID();
      await trx('products').insert({ lasyncro_product_id: productId, shop_id: f.shopId, title: `Product ${f.sku}` });
      await trx('variants').insert({
        lasyncro_variant_id: variantId,
        lasyncro_product_id: productId,
        shop_id: f.shopId,
        sku: f.sku,
        title: `Variant ${f.sku}`,
        status: 'active',
        unit_cost: '1.00',
      });
      await trx('order_line_items').insert({
        lasyncro_line_item_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        lasyncro_product_id: productId,
        lasyncro_variant_id: variantId,
        sku: f.sku,
        title: `Line ${f.sku}`,
        quantity: 1,
        unit_price: f.totalPrice ?? '100.00',
        line_total: f.totalPrice ?? '100.00',
        created_at: now,
        updated_at: now,
      });
    }

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    const fulfilled = f.fulfilled ?? f.warehouse === 'shipped';
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: fulfilled ? 'fulfilled' : 'pending',
      fulfilled_at: fulfilled ? (f.fulfilledAt ?? shippedAt) : null,
    });

    if (f.warehouse !== 'none') {
      await trx('order_warehouse_status').insert({
        lasyncro_order_id: orderId,
        status: f.warehouse,
        packed_at: new Date(shippedAt.getTime() - HOUR),
        shipped_at: f.warehouse === 'shipped' ? shippedAt : null,
        status_updated_at: shippedAt,
      });
    }

    if (f.tracking) {
      await trx('order_shipment_tracking').insert({
        shop_id: f.shopId,
        lasyncro_order_id: orderId,
        carrier_code: f.tracking.carrierCode,
        tracking_number: f.tracking.trackingNumber,
        latest_status: f.tracking.latestStatus,
        latest_event_at: f.tracking.latestEventAt ?? null,
        is_stalled: f.tracking.isStalled ?? false,
        provider_carrier_code: f.tracking.providerCarrierCode ?? null,
      });
    }
  });

  return { orderId, externalOrderId };
}

const tracked = (latestStatus: string | null, extra: Partial<TrackingFixture> = {}): TrackingFixture => ({
  carrierCode: 'sendcloud',
  trackingNumber: `TRK-${crypto.randomBytes(4).toString('hex')}`,
  latestStatus,
  latestEventAt: latestStatus ? new Date(Date.now() - HOUR) : null,
  ...extra,
});

async function getOutbound(
  auth: { shopId: number; userId: number },
  query: Record<string, string | number>
) {
  const token = issueTestToken({ userId: auth.userId, shopId: auth.shopId, tier: 'growth' });
  return request(app)
    .get('/api/v1/orders/outbound')
    .query(query)
    .set('Authorization', `Bearer ${token}`);
}

const ids = (res: request.Response): string[] =>
  (res.body.orders as Array<{ lasyncro_order_id: string }>).map((o) => o.lasyncro_order_id);

const idSet = (res: request.Response): string[] => [...ids(res)].sort();
const sorted = (...values: string[]): string[] => [...values].sort();

// ─── R1 — MEMBERSHIP + TENANT ISOLATION ──────────────────────────────────────

describe('R1 — outbound membership is physical shipment truth', () => {
  it('admits physically shipped orders, excludes Shopify-fulfilled-only and packed orders, and never leaks another tenant', async () => {
    const shopA = await createShop();
    const shopB = await createShop();

    const shipped = await seedOrder({ shopId: shopA.shopId, warehouse: 'shipped', tracking: tracked('in_transit') });
    const shopifyOnly = await seedOrder({ shopId: shopA.shopId, warehouse: 'none', fulfilled: true });
    const packedOnly = await seedOrder({ shopId: shopA.shopId, warehouse: 'packed', fulfilled: false });
    const otherTenant = await seedOrder({ shopId: shopB.shopId, warehouse: 'shipped', tracking: tracked('delivered') });

    const res = await getOutbound(shopA, { state: 'all', period: 'all', limit: 100 });

    expect(res.status).toBe(200);
    expect(idSet(res)).toEqual([shipped.orderId]);
    expect(ids(res)).not.toContain(shopifyOnly.orderId);
    expect(ids(res)).not.toContain(packedOnly.orderId);
    expect(ids(res)).not.toContain(otherTenant.orderId);
    expect(res.body.total).toBe(1);
    expect(res.body.summary.shipped_count).toBe(1);
  });
});

// ─── R2 — STATE × PERIOD ─────────────────────────────────────────────────────

describe('R2 — state and period are independent, intersecting dimensions', () => {
  it('state narrows within period and period narrows within state; neither replaces the other', async () => {
    const auth = await createShop();
    const recent = new Date(Date.now() - 1000);
    const old = new Date(Date.now() - 120 * DAY);

    const deliveredRecent = await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt: recent, tracking: tracked('delivered') });
    const deliveredOld = await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt: old, tracking: tracked('delivered') });
    const missingRecent = await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt: recent, tracking: null });
    const missingOld = await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt: old, tracking: null });

    const deliveredWeek = await getOutbound(auth, { state: 'delivered', period: 'week', limit: 100 });
    expect(deliveredWeek.status).toBe(200);
    expect(idSet(deliveredWeek)).toEqual([deliveredRecent.orderId]);

    const deliveredAll = await getOutbound(auth, { state: 'delivered', period: 'all', limit: 100 });
    expect(deliveredAll.status).toBe(200);
    expect(idSet(deliveredAll)).toEqual(sorted(deliveredRecent.orderId, deliveredOld.orderId));

    const allWeek = await getOutbound(auth, { state: 'all', period: 'week', limit: 100 });
    expect(allWeek.status).toBe(200);
    expect(idSet(allWeek)).toEqual(sorted(deliveredRecent.orderId, missingRecent.orderId));

    const missingMonth = await getOutbound(auth, { state: 'missing_tracking', period: 'month', limit: 100 });
    expect(missingMonth.status).toBe(200);
    expect(idSet(missingMonth)).toEqual([missingRecent.orderId]);
    expect(ids(missingMonth)).not.toContain(missingOld.orderId);
  });
});

// ─── R3 — SEARCH ─────────────────────────────────────────────────────────────

describe('R3 — search by order identity, SKU and customer, combined with state and period', () => {
  it('matches each identity and intersects with state/period instead of replacing them', async () => {
    const auth = await createShop();
    const unique = crypto.randomBytes(3).toString('hex').toUpperCase();
    const recent = new Date(Date.now() - 1000);
    const old = new Date(Date.now() - 120 * DAY);

    const ada = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped', shippedAt: recent,
      shippingName: `Ada Lovelace ${unique}`, sku: `OUT-ALPHA-${unique}`, tracking: tracked('delivered'),
    });
    const graceRecent = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped', shippedAt: recent,
      shippingName: `Grace Hopper ${unique}`, sku: `OUT-BETA-${unique}`, tracking: null,
    });
    const graceOld = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped', shippedAt: old,
      shippingName: `Grace Hopper ${unique}`, sku: `OUT-GAMMA-${unique}`, tracking: tracked('delivered'),
    });

    const byOrder = await getOutbound(auth, { state: 'all', period: 'all', q: ada.externalOrderId, limit: 100 });
    expect(byOrder.status).toBe(200);
    expect(idSet(byOrder)).toEqual([ada.orderId]);

    const bySku = await getOutbound(auth, { state: 'all', period: 'all', q: `OUT-BETA-${unique}`, limit: 100 });
    expect(bySku.status).toBe(200);
    expect(idSet(bySku)).toEqual([graceRecent.orderId]);

    const byCustomer = await getOutbound(auth, { state: 'all', period: 'all', q: `Grace Hopper ${unique}`, limit: 100 });
    expect(byCustomer.status).toBe(200);
    expect(idSet(byCustomer)).toEqual(sorted(graceRecent.orderId, graceOld.orderId));

    const customerDelivered = await getOutbound(auth, { state: 'delivered', period: 'all', q: `Grace Hopper ${unique}`, limit: 100 });
    expect(customerDelivered.status).toBe(200);
    expect(idSet(customerDelivered)).toEqual([graceOld.orderId]);

    const customerWeek = await getOutbound(auth, { state: 'all', period: 'week', q: `Grace Hopper ${unique}`, limit: 100 });
    expect(customerWeek.status).toBe(200);
    expect(idSet(customerWeek)).toEqual([graceRecent.orderId]);
  });
});

// ─── R4 — AUTHORITATIVE SUMMARY ──────────────────────────────────────────────

describe('R4 — summary is computed over the full matching population', () => {
  it('is independent of page and page size, and with/missing/coverage share one population', async () => {
    const auth = await createShop();
    const base = Date.now() - 2 * HOUR;
    const shippedAt = (i: number) => new Date(base - i * 60_000);
    // created → shipped: 10h, 20h, 30h, 40h  ⇒ average 25h
    const created = (i: number, hours: number) => new Date(shippedAt(i).getTime() - hours * HOUR);

    await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt: shippedAt(0), orderCreatedAt: created(0, 10), tracking: tracked('in_transit') });
    await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt: shippedAt(1), orderCreatedAt: created(1, 20), tracking: tracked('delivered') });
    await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt: shippedAt(2), orderCreatedAt: created(2, 30), tracking: tracked('announced') });
    await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt: shippedAt(3), orderCreatedAt: created(3, 40), tracking: null });
    // Not a member: must not enter the summary population.
    await seedOrder({ shopId: auth.shopId, warehouse: 'none', fulfilled: true });

    const pages = [
      await getOutbound(auth, { state: 'all', period: 'all', limit: 1, page: 1 }),
      await getOutbound(auth, { state: 'all', period: 'all', limit: 1, page: 3 }),
      await getOutbound(auth, { state: 'all', period: 'all', limit: 100, page: 1 }),
    ];

    for (const res of pages) {
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(4);
      const s = res.body.summary;
      expect(s.shipped_count).toBe(4);
      expect(s.with_tracking_count).toBe(3);
      expect(s.missing_tracking_count).toBe(1);
      expect(s.with_tracking_count + s.missing_tracking_count).toBe(s.shipped_count);
      expect(s.tracking_coverage_pct).toBe(75);
      expect(s.avg_time_to_ship_hours).toBeCloseTo(25, 5);
    }

    expect(pages[0].body.orders).toHaveLength(1);
    expect(pages[1].body.orders).toHaveLength(1);
    expect(pages[2].body.orders).toHaveLength(4);
    expect(pages[0].body.summary).toEqual(pages[2].body.summary);
    expect(pages[1].body.summary).toEqual(pages[2].body.summary);
  });
});

// ─── R5 — STATUS TRUTH ───────────────────────────────────────────────────────

describe('R5 — carrier status states stay distinct', () => {
  it('discriminates missing tracking, in transit, delivered and needs-action without collapsing them', async () => {
    const auth = await createShop();
    const seed = (tracking: TrackingFixture | null) => seedOrder({ shopId: auth.shopId, warehouse: 'shipped', tracking });

    const noTrackingRow = await seed(null);
    const nullTrackingNumber = await seed(tracked(null, { trackingNumber: null }));
    const inTransit = await seed(tracked('in_transit'));
    const outForDelivery = await seed(tracked('out_for_delivery'));
    const delivered = await seed(tracked('delivered'));
    const announced = await seed(tracked('announced'));
    const exception = await seed(tracked('exception', { isStalled: true }));
    const returned = await seed(tracked('returned'));
    const unknown = await seed(tracked('unknown'));

    const q = (state: string) => getOutbound(auth, { state, period: 'all', limit: 100 });

    const missing = await q('missing_tracking');
    expect(missing.status).toBe(200);
    expect(idSet(missing)).toEqual(sorted(noTrackingRow.orderId, nullTrackingNumber.orderId));

    const transit = await q('in_transit');
    expect(transit.status).toBe(200);
    expect(idSet(transit)).toEqual(sorted(inTransit.orderId, outForDelivery.orderId));
    expect(ids(transit)).not.toContain(announced.orderId);
    expect(ids(transit)).not.toContain(unknown.orderId);
    expect(ids(transit)).not.toContain(exception.orderId);

    const done = await q('delivered');
    expect(done.status).toBe(200);
    expect(idSet(done)).toEqual([delivered.orderId]);

    const action = await q('needs_action');
    expect(action.status).toBe(200);
    expect(idSet(action)).toEqual(sorted(
      noTrackingRow.orderId,
      nullTrackingNumber.orderId,
      exception.orderId,
      returned.orderId,
      unknown.orderId,
    ));

    const all = await q('all');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(9);
    const byId = new Map((all.body.orders as Array<Record<string, unknown>>).map((o) => [o.lasyncro_order_id, o]));
    expect(byId.get(exception.orderId)).toMatchObject({ latest_status: 'exception', is_stalled: true });
    expect(byId.get(unknown.orderId)).toMatchObject({ latest_status: 'unknown', is_stalled: false });
    expect(byId.get(announced.orderId)).toMatchObject({ latest_status: 'announced' });
  });
});

// ─── R6 — CALENDAR PERIODS IN SHOP TIMEZONE ON shipped_at ───────────────────

describe('R6 — week/month are calendar periods in the shop timezone, keyed on shipped_at', () => {
  it('uses shop-local calendar boundaries rather than rolling server-time windows or fulfilled_at', async () => {
    // Pacific/Kiritimati is a fixed UTC+14 zone (no DST), so shop-local
    // calendar boundaries fall on a different UTC date than server UTC.
    const OFFSET = 14 * HOUR;
    const auth = await createShop('Pacific/Kiritimati');

    const now = Date.now();
    const shopNow = new Date(now + OFFSET);
    const y = shopNow.getUTCFullYear();
    const m = shopNow.getUTCMonth();
    const d = shopNow.getUTCDate();
    const monthStart = Date.UTC(y, m, 1) - OFFSET;
    const todayStart = Date.UTC(y, m, d) - OFFSET;
    // Contract week = Monday 00:00 shop-local. getUTCDay() of the shifted
    // clock is the shop-local weekday (0 = Sunday ⇒ Monday was 6 days ago).
    const daysSinceMonday = (shopNow.getUTCDay() + 6) % 7;
    const mondayStart = todayStart - daysSinceMonday * DAY;

    // Each "in" boundary is 00:00:01 shop-local = 10:00:01 UTC on the PREVIOUS
    // UTC day, so a server-UTC calendar boundary would exclude it. Each "out"
    // fixture is one minute before its boundary, inside a rolling 7/30-day
    // window. fulfilled_at always points the opposite way from shipped_at.
    const monthIn = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped', tracking: tracked('delivered'),
      shippedAt: new Date(monthStart + 1000), fulfilledAt: new Date(monthStart - 2 * DAY),
    });
    const monthOut = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped', tracking: tracked('delivered'),
      shippedAt: new Date(monthStart - 60_000), fulfilledAt: new Date(now - 1000),
    });
    const weekIn = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped', tracking: tracked('delivered'),
      shippedAt: new Date(mondayStart + 1000), fulfilledAt: new Date(mondayStart - 2 * DAY),
    });
    const weekOut = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped', tracking: tracked('delivered'),
      shippedAt: new Date(mondayStart - 60_000), fulfilledAt: new Date(now - 1000),
    });

    const fixtures = [
      { id: monthIn.orderId, shippedAt: monthStart + 1000 },
      { id: monthOut.orderId, shippedAt: monthStart - 60_000 },
      { id: weekIn.orderId, shippedAt: mondayStart + 1000 },
      { id: weekOut.orderId, shippedAt: mondayStart - 60_000 },
    ];
    // Exact expected membership per period. When the current week straddles
    // the month start, month fixtures may legitimately fall inside the week
    // (and vice versa); the expectation is derived from the contract
    // boundary, not hard-coded.
    const expectedSince = (boundary: number) =>
      sorted(...fixtures.filter((f) => f.shippedAt >= boundary).map((f) => f.id));

    const month = await getOutbound(auth, { state: 'all', period: 'month', limit: 100 });
    expect(month.status).toBe(200);
    expect(ids(month)).toContain(monthIn.orderId);
    expect(ids(month)).not.toContain(monthOut.orderId);
    expect(idSet(month)).toEqual(expectedSince(monthStart));

    const week = await getOutbound(auth, { state: 'all', period: 'week', limit: 100 });
    expect(week.status).toBe(200);
    expect(ids(week)).toContain(weekIn.orderId);
    expect(ids(week)).not.toContain(weekOut.orderId);
    expect(idSet(week)).toEqual(expectedSince(mondayStart));

    const all = await getOutbound(auth, { state: 'all', period: 'all', limit: 100 });
    expect(all.status).toBe(200);
    expect(idSet(all)).toEqual(sorted(monthIn.orderId, monthOut.orderId, weekIn.orderId, weekOut.orderId));
  });
});

// ─── R7 — DETERMINISTIC SORT ─────────────────────────────────────────────────

describe('R7 — equal primary sort values use a stable canonical tiebreaker', () => {
  it('orders shipped_at ties by lasyncro_order_id and pages them without duplicates or gaps', async () => {
    const auth = await createShop();
    const tiedAt = new Date(Date.now() - 3 * HOUR);
    const orderIds = Array.from({ length: 5 }, () => crypto.randomUUID()).sort();

    // Insert in reverse canonical order so physical/insertion order differs
    // from the expected tiebreak order.
    for (const orderId of [...orderIds].reverse()) {
      await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt: tiedAt, tracking: tracked('delivered'), orderId });
    }

    const full = await getOutbound(auth, { state: 'all', period: 'all', sort: 'shipped_at', dir: 'desc', limit: 100 });
    expect(full.status).toBe(200);
    expect(ids(full)).toEqual(orderIds);

    const paged: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await getOutbound(auth, { state: 'all', period: 'all', sort: 'shipped_at', dir: 'desc', limit: 2, page });
      expect(res.status).toBe(200);
      paged.push(...ids(res));
    }
    expect(paged).toEqual(orderIds);

    const again = await getOutbound(auth, { state: 'all', period: 'all', sort: 'shipped_at', dir: 'desc', limit: 100 });
    expect(ids(again)).toEqual(orderIds);
  });
});

// ─── R8 — ROW CONTRACT ───────────────────────────────────────────────────────

describe('R8 — row truth: real currency, honest carrier identity, nullable unknowns', () => {
  it('keeps stored currency, separates provider from physical carrier, and leaves unknown truth null', async () => {
    const auth = await createShop();
    const shippedAt = new Date(Date.now() - 4 * HOUR);
    const eventAt = new Date(Date.now() - 2 * HOUR);

    const shippoEur = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped', shippedAt, currency: 'EUR', totalPrice: '42.50',
      tracking: {
        carrierCode: 'shippo', trackingNumber: 'TRK-SHIPPO-1', latestStatus: 'in_transit',
        latestEventAt: eventAt, providerCarrierCode: 'usps',
      },
    });
    const sendcloud = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped', shippedAt,
      tracking: { carrierCode: 'sendcloud', trackingNumber: 'TRK-SC-1', latestStatus: null, latestEventAt: null },
    });
    const untracked = await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt, tracking: null });

    const res = await getOutbound(auth, { state: 'all', period: 'all', limit: 100 });
    expect(res.status).toBe(200);
    const byId = new Map((res.body.orders as Array<Record<string, unknown>>).map((o) => [o.lasyncro_order_id, o]));

    const eur = byId.get(shippoEur.orderId)!;
    expect(eur).toBeDefined();
    expect(eur.external_order_id).toBe(shippoEur.externalOrderId);
    expect(new Date(eur.shipped_at as string).toISOString()).toBe(shippedAt.toISOString());
    expect(Number(eur.total_price)).toBe(42.5);
    expect(eur.currency).toBe('EUR');
    expect(eur.tracking_number).toBe('TRK-SHIPPO-1');
    expect(eur.carrier).toBe('usps');
    expect(eur.carrier_provider).toBe('shippo');
    expect(eur.latest_status).toBe('in_transit');
    expect(new Date(eur.latest_event_at as string).toISOString()).toBe(eventAt.toISOString());
    expect(eur.is_stalled).toBe(false);

    const sc = byId.get(sendcloud.orderId)!;
    expect(sc).toBeDefined();
    expect(sc.currency).toBe('USD');
    expect(sc.carrier_provider).toBe('sendcloud');
    // The provider is not proof of the physical carrier.
    expect(sc).toHaveProperty('carrier', null);
    expect(sc).toHaveProperty('latest_status', null);
    expect(sc).toHaveProperty('latest_event_at', null);

    const none = byId.get(untracked.orderId)!;
    expect(none).toBeDefined();
    expect(none).toHaveProperty('tracking_number', null);
    expect(none).toHaveProperty('carrier', null);
    expect(none).toHaveProperty('carrier_provider', null);
    expect(none).toHaveProperty('latest_status', null);
    expect(none).toHaveProperty('latest_event_at', null);
    // No tracking row ⇒ stall state is unknown, not false.
    expect(none).toHaveProperty('is_stalled', null);
  });
});

// ─── R9 — CANONICAL EXTERNAL IDENTITY ────────────────────────────────────────

describe('R9 — multiple external identities resolve to the earliest mapping', () => {
  it('returns one row whose external_order_id is the mapping with the smallest id, stable across requests', async () => {
    const auth = await createShop();
    const order = await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', tracking: tracked('in_transit') });

    // external_order_id must be numeric (external_order_id_numeric_check).
    const canonical = nextExternalId();
    const later = nextExternalId();

    const ids = await withTenant(auth.shopId, async (trx) => {
      const [laterRow] = await trx('external_order_identity_map')
        .insert({
          lasyncro_order_id: order.orderId,
          shop_id: auth.shopId,
          platform: 'shopify',
          external_order_id: later,
        })
        .returning('id');
      // Rewriting the first mapping keeps its (smaller) id but moves its
      // tuple physically after the later mapping, so an unordered LIMIT 1
      // would tend to pick the later one.
      const [earliest] = await trx('external_order_identity_map')
        .where({ lasyncro_order_id: order.orderId, external_order_id: order.externalOrderId })
        .update({ external_order_id: canonical })
        .returning('id');
      return { earliestId: Number(earliest.id), laterId: Number(laterRow.id) };
    });
    expect(ids.earliestId).toBeLessThan(ids.laterId);

    const first = await getOutbound(auth, { state: 'all', period: 'all', limit: 100 });
    expect(first.status).toBe(200);
    const rows = (first.body.orders as Array<{ lasyncro_order_id: string; external_order_id: string }>)
      .filter((o) => o.lasyncro_order_id === order.orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0].external_order_id).toBe(canonical);

    const again = await getOutbound(auth, { state: 'all', period: 'all', limit: 100 });
    const repeat = (again.body.orders as Array<{ lasyncro_order_id: string; external_order_id: string }>)
      .find((o) => o.lasyncro_order_id === order.orderId);
    expect(repeat?.external_order_id).toBe(canonical);
  });
});
