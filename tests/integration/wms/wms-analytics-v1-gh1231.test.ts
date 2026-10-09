// tests/integration/wms/wms-analytics-v1-gh1231.test.ts
//
// GH-1231 — Analytics V1 backend contract, RED PHASE 2A (real Postgres, real HTTP).
// ===========================================================================
// Ratified contract: docs/blueprints/WarehouseAnalyticsModule.md §12B.3–§12B.7
// and GH-1231 U1–U8. The V1 blocks are ADDITIVE:
//
//   GET /api/v1/wms/analytics?days=7|30|90 gains
//     window        { days, timezone, start_at, bucket, today_local }
//     pace          { items_picked_total, points[{ start_date, end_date, items_picked, is_current, is_clipped }] }
//     problems      { total, open_total, by_type, products[{ lasyncro_variant_id, display_label, sku, count }], products_total }
//     team_activity [{ user_id, display_name, items_picked, items_packed, is_current_member }]  (alphabetical)
//   GET /api/v1/wms/analytics/live gains
//     flow.stages.<awaiting_pick|picking|picked|packing|packed> = { count, oldest_age_s }
//
// I1 Pace + Team — confirmed pick_scan_log.quantity_confirmed at scanned_at,
//    credited to scanned_by (never the batch claimer); undone scans excluded;
//    revoked and former members included; Σ Pace = Σ Team picked; packed from
//    confirmed pack_scan_log; last N shop-local calendar dates (not N×24h);
//    23h/25h DST days; dense days, Monday-start clipped weeks; tenant isolation.
// I2 Problems — one pick_exceptions population (V1 window, order_cancelled
//    excluded); total/open_total/by_type reconcile; product + variant labels
//    without "Default Title"; count desc → label asc, top 5 + products_total.
// I3 Live Flow — five recorded statuses incl. picked; orders not batches;
//    oldest age from status_updated_at, uncapped; zero → null age; counts and
//    ages from one /live response; assignment is not activity.
// I4 Compatibility — legacy composite / live / Floor Display keys and
//    meanings unchanged; getLiveCapacity unchanged; no names on the Display;
//    role and commercial gates unchanged.
//
// EXPECTED RED on current main: the V1 blocks do not exist. Every V1 case
// first asserts HTTP 200 (route, middleware and fixture are healthy) and then
// the missing block, so RED reads as EXPECTED_MISSING_V1, never as a gate or
// fixture failure. Compatibility and gate cases are GREEN controls.
//
// CLOCK: historical cases pin the request clock by faking ONLY `Date`
// (timers, nextTick and I/O stay real) at 2026-10-08T10:00Z (the T4 helper
// contract instant) or at the two Stockholm DST weeks. This presumes the V1
// window is derived from the request's JS clock (T4 buildAnalyticsWindow({ now })),
// not from Postgres now(). Live Flow cases use the real clock and tolerate
// request latency.
//
// Real Express app (createApp(), never server.ts); disposable synchroflow_test_*
// DB via `npm run test:integration`; tenants via createTenantShop; tier via the
// canonical transitionShopSubscription path. Rows are inserted directly in the
// shapes production writers persist. No worker, no provider call.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { generateDisplayToken, getLiveCapacity } from 'api-src/services/wms/wmsAnalytics.service';
import { getAnalyticsV1HistoricalBlocks, FLOW_CLOCK_SKEW_TOLERANCE_S } from 'api-src/services/wms/wmsAnalyticsV1.service';
import { resolveV1LiveBlocks } from '../../../apps/frontend/src/pages/wms/analyticsAvailability';
import knexLib, { Knex } from 'knex';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(30000);

const app = createApp();

type Tier = 'starter' | 'core';
type Role = 'owner' | 'admin' | 'operator';
type Membership = 'member' | 'revoked' | 'none';

const STOCKHOLM = 'Europe/Stockholm';
const NOW_ISO = '2026-10-08T10:00:00.000Z'; // Thursday 12:00 Stockholm (CEST)
const SPRING_NOW_ISO = '2026-03-31T10:00:00.000Z'; // 2026-03-29 is 23h in Stockholm
const FALL_NOW_ISO = '2026-10-27T10:00:00.000Z'; // 2026-10-25 is 25h in Stockholm

const FLOW_STATUSES = ['awaiting_pick', 'picking', 'picked', 'packing', 'packed'] as const;
const LEGACY_LIVE_KEYS = [
  'pipeline', 'operators_on_shift', 'active_operators', 'cpt_local', 'hours_to_cpt', 'live_uph', 'required_uph',
  'standard_uph', 'on_track', 'shipped_today', 'shipped_via_wms', 'shipped_via_legacy', 'unfulfilled_orders',
];
const LEGACY_COMPOSITE_KEYS = ['live', 'operators', 'pipeline', 'exceptions', 'cost', 'aging_wip', 'throughput_trend', 'exception_trend', 'days'];
const V1_COMPOSITE_KEYS = ['window', 'pace', 'problems', 'team_activity'];

// ─── clock ───────────────────────────────────────────────────────────────────

/** Fake ONLY Date — pg sockets, timers and supertest keep real time. */
function pinClock(iso: string): void {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
  });
}

afterEach(() => {
  jest.useRealTimers();
});

// ─── fixture builders (minimum persisted shapes) ─────────────────────────────

type Shop = { id: number; ownerId: number; unique: string };

async function createShop(prefix: string, timezone: string): Promise<Shop> {
  const unique = crypto.randomBytes(6).toString('hex');
  const id = await systemTransaction(async (trx) => {
    const shopId = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, shopId);
    await trx('shops').where({ id: shopId }).update({ timezone, timezone_source: 'manual' });
    return shopId;
  });
  const shop = { id, ownerId: 0, unique };
  shop.ownerId = await createUser(shop, 'Owner', 'Fixture', 'member', 'owner');
  await withTenant(id, (trx) =>
    trx('user_lifecycle_snapshot').insert({
      shop_id: id, user_id: shop.ownerId, phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID(),
    }),
  );
  await setTier(id, 'core');
  return shop;
}

/** GH-1136 — authoritative tier via the canonical transition path. */
async function setTier(shopId: number, tier: Tier): Promise<void> {
  await withTenant(shopId, (trx) =>
    transitionShopSubscription(
      {
        shopId,
        to: { tier, status: 'active', billingProvider: 'shopify' },
        source: 'gh1231_analytics_v1_test',
        reason: 'test_tier_fixture',
        actorType: 'shopify',
        actingProvider: 'shopify',
      },
      trx,
    ),
  );
}

async function createUser(shop: Shop, first: string, last: string | null, membership: Membership, role: Role = 'operator'): Promise<number> {
  return withTenant(shop.id, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shop.id,
        email: `gh1231-${first.toLowerCase()}-${shop.unique}-${crypto.randomBytes(3).toString('hex')}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: first,
        last_name: last,
        role,
      })
      .returning('id');
    const userId = row.id as number;
    if (membership !== 'none') {
      await trx('shop_memberships').insert({
        shop_id: shop.id, user_id: userId, role, revoked_at: membership === 'revoked' ? new Date('2026-09-01T00:00:00Z') : null,
      });
    }
    return userId;
  });
}

type Catalog = { variantId: string; productId: string; lineId: string; orderId: string };

/** One product + variant + order line (the FK anchor for scans and exceptions). */
async function createCatalogLine(shop: Shop, productTitle: string, variantTitle: string | null, sku: string | null): Promise<Catalog> {
  const ids = { variantId: crypto.randomUUID(), productId: crypto.randomUUID(), lineId: crypto.randomUUID(), orderId: crypto.randomUUID() };
  const at = new Date('2026-06-01T00:00:00Z');
  await withTenant(shop.id, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: ids.orderId, shop_id: shop.id, currency: 'USD', total_price: '0.00', subtotal_price: '0.00',
      total_tax: '0.00', order_created_at: at, order_updated_at: at, created_at: at, updated_at: at,
    });
    await trx('products').insert({ lasyncro_product_id: ids.productId, shop_id: shop.id, title: productTitle });
    await trx('variants').insert({
      lasyncro_variant_id: ids.variantId, lasyncro_product_id: ids.productId, shop_id: shop.id,
      sku, title: variantTitle, status: 'active', unit_cost: '1.00',
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: ids.lineId, lasyncro_order_id: ids.orderId, lasyncro_product_id: ids.productId,
      lasyncro_variant_id: ids.variantId, title: `${productTitle} line`, quantity: 1, unit_price: '1.00', line_total: '1.00',
      created_at: at, updated_at: at,
    });
  });
  return ids;
}

async function createBatch(shop: Shop, status: string, claim: { picked_by?: number; packed_by?: number } = {}): Promise<string> {
  const batchId = crypto.randomUUID();
  await withTenant(shop.id, (trx) =>
    trx('pick_batches').insert({
      pick_batch_id: batchId, shop_id: shop.id, status, release_trigger: 'manual', max_line_items: 10,
      total_line_items: 1, total_units: 1, released_at: new Date('2026-06-01T00:00:00Z'), ...claim,
    }),
  );
  return batchId;
}

async function pickScan(shop: Shop, batchId: string, c: Catalog, by: number, qty: number, at: string, status: 'confirmed' | 'undone' = 'confirmed') {
  await withTenant(shop.id, (trx) =>
    trx('pick_scan_log').insert({
      scan_id: crypto.randomUUID(), shop_id: shop.id, pick_batch_id: batchId, lasyncro_line_item_id: c.lineId,
      lasyncro_variant_id: c.variantId, location_code: 'A-01-01', quantity_confirmed: qty, status, scanned_by: by, scanned_at: new Date(at),
    }),
  );
}

async function packScan(shop: Shop, batchId: string, c: Catalog, by: number, qty: number, at: string, status: 'confirmed' | 'undone' = 'confirmed') {
  await withTenant(shop.id, (trx) =>
    trx('pack_scan_log').insert({
      scan_id: crypto.randomUUID(), shop_id: shop.id, pick_batch_id: batchId, lasyncro_order_id: c.orderId,
      lasyncro_line_item_id: c.lineId, lasyncro_variant_id: c.variantId, quantity_confirmed: qty, status, scanned_by: by, scanned_at: new Date(at),
    }),
  );
}

async function raiseProblem(
  shop: Shop, batchId: string, c: Catalog, by: number, type: string, stage: 'pick' | 'pack', at: string, resolved: boolean,
) {
  await withTenant(shop.id, (trx) =>
    trx('pick_exceptions').insert({
      shop_id: shop.id, pick_batch_id: batchId, lasyncro_line_item_id: c.lineId, lasyncro_variant_id: c.variantId,
      exception_type: type, stage, quantity_required: 1, quantity_found: 0, raised_by: by, raised_at: new Date(at), resolved,
      resolved_by: resolved ? by : null, resolved_at: resolved ? new Date(at) : null,
    }),
  );
}

/** One warehouse order in a recorded status since `since`. */
async function warehouseOrder(shop: Shop, batchId: string | null, status: string, since: Date) {
  const orderId = crypto.randomUUID();
  const at = new Date('2026-06-01T00:00:00Z');
  await withTenant(shop.id, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId, shop_id: shop.id, currency: 'USD', total_price: '0.00', subtotal_price: '0.00',
      total_tax: '0.00', order_created_at: at, order_updated_at: at, created_at: at, updated_at: at,
    });
    await trx('order_warehouse_status').insert({ lasyncro_order_id: orderId, pick_batch_id: batchId, status, status_updated_at: since });
  });
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

const bearer = (shopId: number, userId: number, role: Role = 'owner', tier: Tier = 'core') =>
  ({ Authorization: `Bearer ${issueTestToken({ userId, shopId, tier, roles: [role] })}` });

const getHistorical = (shop: Shop, days: number) =>
  request(app).get('/api/v1/wms/analytics').query({ days }).set(bearer(shop.id, shop.ownerId));
const getLive = (shop: Shop) => request(app).get('/api/v1/wms/analytics/live').set(bearer(shop.id, shop.ownerId));

/** 200 first, so RED identifies the missing V1 block, not a gate or fixture failure. */
function ok(res: request.Response): any {
  expect({ status: res.status, error: res.body?.error }).toEqual({ status: 200, error: undefined });
  return res.body;
}

// ─── expectations helpers (literal data, not production logic) ──────────────

function shiftDate(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dense daily expectation: every date from first..today, values from a literal map. */
function dailyPoints(first: string, today: string, values: Record<string, number>) {
  const points = [];
  for (let d = first; d <= today; d = shiftDate(d, 1)) {
    points.push({ start_date: d, end_date: d, items_picked: values[d] ?? 0, is_current: d === today, is_clipped: false });
  }
  return points;
}

// ─── fixture world ───────────────────────────────────────────────────────────

let A: Shop; // Europe/Stockholm — the shop under test
let B: Shop; // Europe/Stockholm — other tenant, same dates, larger numbers
let D: Shop; // Europe/Stockholm — DST weeks only
const U: Record<string, number> = {};
let BEA = 0;
let DANA = 0;
const V: Record<string, Catalog> = {};
let B_VARIANT = '';
let RAW_DISPLAY_TOKEN = '';
const FLOW_SINCE: Record<string, Date> = {};
let B_FLOW_PICKED_SINCE: Date;

beforeAll(async () => {
  // ── Shop A: people ──
  A = await createShop('gh1231-a', STOCKHOLM);
  U.avery = await createUser(A, 'Avery', 'Lind', 'member');
  U.blake = await createUser(A, 'Blake', 'Moss', 'member');
  U.casey = await createUser(A, 'Casey', null, 'revoked'); // revoked member — still credited
  U.drew = await createUser(A, 'Drew', 'Park', 'none'); // former member (no membership row) — still credited
  U.erin = await createUser(A, 'Erin', 'Shaw', 'member'); // pack-only activity
  U.finn = await createUser(A, 'Finn', 'Holt', 'member', 'operator'); // only an undone scan — never credited

  // ── Shop A: catalog (product + variant labels) ──
  V.mug = await createCatalogLine(A, 'Mug', 'Blue', 'MUG-BL');
  V.poster = await createCatalogLine(A, 'Poster', 'Default Title', null);
  V.lamp = await createCatalogLine(A, 'Lamp', 'Large', 'LAMP-L');
  V.tote = await createCatalogLine(A, 'Tote', '', 'TOTE');
  V.bowl = await createCatalogLine(A, 'Bowl', 'Default Title', 'BOWL');
  V.cup = await createCatalogLine(A, 'Cup', 'Red', 'CUP-R');

  // Batches claimed by one person, scanned (partly) by others.
  const b1 = await createBatch(A, 'pick_complete', { picked_by: U.avery }); // reassigned mid-pick to Blake
  const b2 = await createBatch(A, 'pick_complete', { picked_by: U.blake }); // scanned by Casey, Drew and Blake
  const b3 = await createBatch(A, 'pick_complete', { picked_by: U.avery }); // older history
  const p1 = await createBatch(A, 'pack_complete', { packed_by: U.avery }); // packed by others

  // ── Shop A: pick scans (Stockholm CEST = UTC+2 unless noted) ──
  await pickScan(A, b1, V.mug, U.avery, 5, '2026-10-08T08:00:00Z'); //  10-08 10:00 local
  await pickScan(A, b1, V.mug, U.blake, 3, '2026-10-07T21:30:00Z'); //  10-07 23:30 local
  await pickScan(A, b1, V.mug, U.blake, 2, '2026-10-07T22:30:00Z'); //  10-08 00:30 local (UTC date is 10-07)
  await pickScan(A, b3, V.mug, U.avery, 4, '2026-10-06T09:00:00Z', 'undone'); // undone — excluded
  await pickScan(A, b3, V.mug, U.finn, 40, '2026-10-05T09:00:00Z', 'undone'); // undone — excluded
  await pickScan(A, b2, V.cup, U.casey, 6, '2026-10-03T12:00:00Z'); //  10-03 local, revoked member
  await pickScan(A, b2, V.cup, U.drew, 1, '2026-10-02T00:30:00Z'); //   10-02 02:30 local, former member
  await pickScan(A, b2, V.cup, U.blake, 8, '2026-10-01T22:30:00Z'); //  10-02 00:30 local — first 7d date
  await pickScan(A, b3, V.lamp, U.avery, 7, '2026-10-01T21:30:00Z'); // 10-01 23:30 local — outside 7d, inside now−7×24h
  await pickScan(A, b3, V.lamp, U.avery, 10, '2026-09-08T22:00:00Z'); // 09-09 00:00 local — first 30d instant
  await pickScan(A, b3, V.lamp, U.avery, 9, '2026-09-08T21:30:00Z'); //  09-08 23:30 local — outside 30d, inside 90d
  await pickScan(A, b3, V.lamp, U.blake, 12, '2026-07-10T22:00:00Z'); // 07-11 00:00 local (Sat) — first 90d instant
  await pickScan(A, b3, V.lamp, U.blake, 11, '2026-07-10T21:59:59Z'); // 07-10 23:59:59 local — outside 90d
  await pickScan(A, b3, V.lamp, U.avery, 13, '2026-07-12T21:59:00Z'); // 07-12 23:59 local (Sun) — clipped first week
  await pickScan(A, b3, V.lamp, U.avery, 14, '2026-07-12T22:00:00Z'); // 07-13 00:00 local (Mon) — next week
  await pickScan(A, b1, V.mug, U.avery, 30, '2026-10-08T11:00:00Z'); // 10-08 13:00 local — same day, after pinned now (12:00)
  await pickScan(A, b1, V.mug, U.avery, 50, '2026-10-08T22:00:00Z'); // 10-09 00:00 local — after today

  // ── Shop A: pack scans ──
  await packScan(A, p1, V.mug, U.blake, 4, '2026-10-08T08:30:00Z');
  await packScan(A, p1, V.cup, U.casey, 3, '2026-10-05T10:00:00Z');
  await packScan(A, p1, V.cup, U.erin, 2, '2026-10-04T10:00:00Z');
  await packScan(A, p1, V.mug, U.avery, 2, '2026-10-06T10:00:00Z', 'undone'); // excluded
  await packScan(A, p1, V.lamp, U.blake, 5, '2026-09-20T10:00:00Z'); // in 30d/90d only

  // ── Shop A: problems (7d window = 2026-10-01T22:00Z ..) ──
  await raiseProblem(A, b2, V.mug, U.avery, 'short_pick', 'pick', '2026-10-03T09:00:00Z', true);
  await raiseProblem(A, b2, V.mug, U.avery, 'short_pick', 'pick', '2026-10-07T09:00:00Z', false);
  await raiseProblem(A, b2, V.mug, U.avery, 'item_missing', 'pack', '2026-10-08T07:00:00Z', false);
  await raiseProblem(A, b2, V.poster, U.avery, 'wrong_item', 'pick', '2026-10-04T09:00:00Z', true);
  await raiseProblem(A, b2, V.poster, U.avery, 'short_pick', 'pick', '2026-10-01T21:00:00Z', false); // 10-01 23:00 local — outside 7d
  await raiseProblem(A, b2, V.lamp, U.avery, 'product_defect', 'pack', '2026-10-05T09:00:00Z', false);
  for (const hour of ['09', '10', '11']) {
    await raiseProblem(A, b2, V.lamp, U.avery, 'order_cancelled', 'pick', `2026-10-06T${hour}:00:00Z`, false); // excluded type
  }
  await raiseProblem(A, b2, V.tote, U.avery, 'packaging_defect', 'pack', '2026-10-06T10:00:00Z', false);
  await raiseProblem(A, b2, V.bowl, U.avery, 'short_pick', 'pick', '2026-10-02T09:00:00Z', false);
  await raiseProblem(A, b2, V.cup, U.avery, 'wrong_item', 'pick', '2026-10-02T10:00:00Z', true);

  // ── Shop A: live warehouse orders (real clock) ──
  const realNow = Date.now();
  const ago = (s: number) => new Date(realNow - s * 1000);
  FLOW_SINCE.awaiting_pick = ago(3 * 3600);
  FLOW_SINCE.picking = ago(40 * 60);
  FLOW_SINCE.picked = ago(72 * 86_400); // 72 days in recorded status — uncapped
  FLOW_SINCE.packed = ago(2 * 86_400);
  const fPending = await createBatch(A, 'pending');
  const fPicking = await createBatch(A, 'picking', { picked_by: U.avery }); // assigned, no recent scans
  const fPicked = await createBatch(A, 'pick_complete', { picked_by: U.blake });
  const fPacked = await createBatch(A, 'pack_complete', { packed_by: U.blake });
  await warehouseOrder(A, fPending, 'awaiting_pick', ago(10 * 60));
  await warehouseOrder(A, fPending, 'awaiting_pick', FLOW_SINCE.awaiting_pick);
  for (const s of [20 * 60, 40 * 60, 5 * 60]) await warehouseOrder(A, fPicking, 'picking', ago(s)); // 3 orders, ONE batch
  await warehouseOrder(A, fPicked, 'picked', FLOW_SINCE.picked);
  await warehouseOrder(A, fPacked, 'packed', ago(3600));
  await warehouseOrder(A, fPacked, 'packed', FLOW_SINCE.packed);
  await warehouseOrder(A, fPacked, 'shipped', ago(3 * 86_400));
  await warehouseOrder(A, fPacked, 'shipped', ago(4 * 86_400));
  await warehouseOrder(A, null, 'cancelled', ago(86_400));
  await warehouseOrder(A, fPacked, 'partially_shipped', ago(86_400));

  // ── Shop A: Floor Display token ──
  const { raw, hash } = generateDisplayToken(A.id);
  RAW_DISPLAY_TOKEN = raw;
  await withTenant(A.id, (trx) => trx('shop_display_tokens').insert({ shop_id: A.id, token_hash: hash, label: 'gh1231 display' }));

  // ── Shop B: another tenant on the same dates ──
  B = await createShop('gh1231-b', STOCKHOLM);
  BEA = await createUser(B, 'Bea', 'Other', 'member');
  const bLine = await createCatalogLine(B, 'Secret', 'Item', 'SECRET');
  B_VARIANT = bLine.variantId;
  const bBatch = await createBatch(B, 'pick_complete', { picked_by: BEA });
  await pickScan(B, bBatch, bLine, BEA, 1000, '2026-10-08T08:00:00Z');
  await pickScan(B, bBatch, bLine, BEA, 500, '2026-10-02T08:00:00Z');
  await packScan(B, bBatch, bLine, BEA, 700, '2026-10-08T09:00:00Z');
  await raiseProblem(B, bBatch, bLine, BEA, 'short_pick', 'pick', '2026-10-07T09:00:00Z', false);
  const bFlow = await createBatch(B, 'pending');
  for (let i = 0; i < 5; i += 1) await warehouseOrder(B, bFlow, 'awaiting_pick', ago(60));
  B_FLOW_PICKED_SINCE = ago(400 * 86_400);
  await warehouseOrder(B, bFlow, 'picked', B_FLOW_PICKED_SINCE);

  // ── Shop D: both Stockholm DST transitions ──
  D = await createShop('gh1231-dst', STOCKHOLM);
  DANA = await createUser(D, 'Dana', 'Vik', 'member');
  const dLine = await createCatalogLine(D, 'Clock', 'Wall', 'CLK');
  const dBatch = await createBatch(D, 'pick_complete', { picked_by: DANA });
  // Spring forward 2026-03-29: 00:00 CET = 03-28T23:00Z; 03-30 00:00 CEST = 03-29T22:00Z (23h day).
  await pickScan(D, dBatch, dLine, DANA, 1, '2026-03-28T22:30:00Z'); // 03-28 23:30 CET
  await pickScan(D, dBatch, dLine, DANA, 2, '2026-03-28T23:00:00Z'); // 03-29 00:00 CET
  await pickScan(D, dBatch, dLine, DANA, 4, '2026-03-29T21:59:59Z'); // 03-29 23:59:59 CEST
  await pickScan(D, dBatch, dLine, DANA, 8, '2026-03-29T22:00:00Z'); // 03-30 00:00 CEST
  // Fall back 2026-10-25: 00:00 CEST = 10-24T22:00Z; 10-26 00:00 CET = 10-25T23:00Z (25h day).
  await pickScan(D, dBatch, dLine, DANA, 1, '2026-10-24T21:59:59Z'); // 10-24 23:59:59 CEST
  await pickScan(D, dBatch, dLine, DANA, 2, '2026-10-24T22:00:00Z'); // 10-25 00:00 CEST
  await pickScan(D, dBatch, dLine, DANA, 4, '2026-10-25T22:30:00Z'); // 10-25 23:30 CET
  await pickScan(D, dBatch, dLine, DANA, 8, '2026-10-25T23:00:00Z'); // 10-26 00:00 CET
});

afterAll(async () => {
  await db.destroy();
});

// ═════════════════════════════════════════════════════════════════════════════
// Harness GREEN controls — the RED below is meaningful only if these pass
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 RED-2A — harness controls', () => {
  it('GREEN CONTROL: owner @ Core reads the historical composite under the pinned clock (legacy keys, selected days)', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 7));
    expect(Object.keys(body)).toEqual(expect.arrayContaining(LEGACY_COMPOSITE_KEYS));
    expect(body.days).toBe(7);
  });

  it('GREEN CONTROL: owner @ Core reads /analytics/live on the real clock', async () => {
    const body = ok(await getLive(A));
    expect(Object.keys(body)).toEqual(expect.arrayContaining(LEGACY_LIVE_KEYS));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// I1 — Pace + Team
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 I1 — Pace and Team from confirmed scan events', () => {
  const TEAM_7D = () => [
    { user_id: U.avery, display_name: 'Avery Lind', items_picked: 5, items_packed: 0, is_current_member: true },
    { user_id: U.blake, display_name: 'Blake Moss', items_picked: 13, items_packed: 4, is_current_member: true },
    { user_id: U.casey, display_name: 'Casey', items_picked: 6, items_packed: 3, is_current_member: false },
    { user_id: U.drew, display_name: 'Drew Park', items_picked: 1, items_packed: 0, is_current_member: false },
    { user_id: U.erin, display_name: 'Erin Shaw', items_picked: 0, items_packed: 2, is_current_member: true },
  ];

  it('7d window echoes the last 7 Stockholm calendar dates, starting at local midnight (not now − 7×24h)', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 7));
    expect(body).toHaveProperty('window');
    expect(body.window).toEqual({
      days: 7, timezone: STOCKHOLM, start_at: '2026-10-01T22:00:00.000Z', bucket: 'day', today_local: '2026-10-08',
    });
  });

  it('7d Pace: confirmed picks bucketed by shop-local scanned_at date; undone, pre-window, later-today (after request now) and after-today scans excluded', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 7));
    expect(body).toHaveProperty('pace');
    expect(body.pace).toEqual({
      items_picked_total: 25,
      points: dailyPoints('2026-10-02', '2026-10-08', { '2026-10-02': 9, '2026-10-03': 6, '2026-10-07': 3, '2026-10-08': 7 }),
    });
  });

  it('7d Team: credit follows scanned_by (reassignment splits), revoked and former members included, packs from confirmed pack scans, alphabetical', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 7));
    expect(body).toHaveProperty('team_activity');
    expect(body.team_activity).toEqual(TEAM_7D());
    // Claimer of batch b1 (Avery) is NOT credited with Blake's 5 items; owner with no scans and Finn (undone only) absent.
    const ids = body.team_activity.map((r: { user_id: number }) => r.user_id);
    expect(ids).not.toContain(A.ownerId);
    expect(ids).not.toContain(U.finn);
  });

  it.each([7, 30, 90])('%id: Pace total equals Σ Team items_picked (one population)', async (days) => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, days));
    expect(body).toHaveProperty('pace');
    expect(body).toHaveProperty('team_activity');
    const teamPicked = body.team_activity.reduce((n: number, r: { items_picked: number }) => n + r.items_picked, 0);
    expect({ pace: body.pace.items_picked_total, team: teamPicked }).toEqual({ pace: { 7: 25, 30: 42, 90: 90 }[days], team: { 7: 25, 30: 42, 90: 90 }[days] });
  });

  it('30d: 30 dense dates from local midnight 2026-09-09; 09-08 23:30 local excluded, 09-09 00:00 local included', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 30));
    expect(body).toHaveProperty('window');
    expect(body.window).toEqual({ days: 30, timezone: STOCKHOLM, start_at: '2026-09-08T22:00:00.000Z', bucket: 'day', today_local: '2026-10-08' });
    expect(body.pace).toEqual({
      items_picked_total: 42,
      points: dailyPoints('2026-09-09', '2026-10-08', {
        '2026-09-09': 10, '2026-10-01': 7, '2026-10-02': 9, '2026-10-03': 6, '2026-10-07': 3, '2026-10-08': 7,
      }),
    });
    expect(body.team_activity).toEqual([
      { user_id: U.avery, display_name: 'Avery Lind', items_picked: 22, items_packed: 0, is_current_member: true },
      { user_id: U.blake, display_name: 'Blake Moss', items_picked: 13, items_packed: 9, is_current_member: true },
      { user_id: U.casey, display_name: 'Casey', items_picked: 6, items_packed: 3, is_current_member: false },
      { user_id: U.drew, display_name: 'Drew Park', items_picked: 1, items_packed: 0, is_current_member: false },
      { user_id: U.erin, display_name: 'Erin Shaw', items_picked: 0, items_packed: 2, is_current_member: true },
    ]);
  });

  it('90d: Monday-start weeks, clipped first week Sat–Sun, current week Mon–today; 07-10 23:59:59 local excluded', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 90));
    expect(body).toHaveProperty('window');
    expect(body.window).toEqual({ days: 90, timezone: STOCKHOLM, start_at: '2026-07-10T22:00:00.000Z', bucket: 'week', today_local: '2026-10-08' });
    const week = (start: string, end: string, items: number, flags: Partial<{ is_current: boolean; is_clipped: boolean }> = {}) =>
      ({ start_date: start, end_date: end, items_picked: items, is_current: false, is_clipped: false, ...flags });
    expect(body.pace).toEqual({
      items_picked_total: 90,
      points: [
        week('2026-07-11', '2026-07-12', 25, { is_clipped: true }),
        week('2026-07-13', '2026-07-19', 14),
        week('2026-07-20', '2026-07-26', 0),
        week('2026-07-27', '2026-08-02', 0),
        week('2026-08-03', '2026-08-09', 0),
        week('2026-08-10', '2026-08-16', 0),
        week('2026-08-17', '2026-08-23', 0),
        week('2026-08-24', '2026-08-30', 0),
        week('2026-08-31', '2026-09-06', 0),
        week('2026-09-07', '2026-09-13', 19),
        week('2026-09-14', '2026-09-20', 0),
        week('2026-09-21', '2026-09-27', 0),
        week('2026-09-28', '2026-10-04', 22),
        week('2026-10-05', '2026-10-08', 10, { is_current: true }),
      ],
    });
    expect(body.team_activity).toEqual([
      { user_id: U.avery, display_name: 'Avery Lind', items_picked: 58, items_packed: 0, is_current_member: true },
      { user_id: U.blake, display_name: 'Blake Moss', items_picked: 25, items_packed: 9, is_current_member: true },
      { user_id: U.casey, display_name: 'Casey', items_picked: 6, items_packed: 3, is_current_member: false },
      { user_id: U.drew, display_name: 'Drew Park', items_picked: 1, items_packed: 0, is_current_member: false },
      { user_id: U.erin, display_name: 'Erin Shaw', items_picked: 0, items_packed: 2, is_current_member: true },
    ]);
  });

  it('DST spring forward: 2026-03-29 is a 23h Stockholm day; boundary scans land on the correct local dates', async () => {
    pinClock(SPRING_NOW_ISO);
    const body = ok(await getHistorical(D, 7));
    expect(body).toHaveProperty('window');
    expect(body.window).toEqual({ days: 7, timezone: STOCKHOLM, start_at: '2026-03-24T23:00:00.000Z', bucket: 'day', today_local: '2026-03-31' });
    expect(body.pace).toEqual({
      items_picked_total: 15,
      points: dailyPoints('2026-03-25', '2026-03-31', { '2026-03-28': 1, '2026-03-29': 6, '2026-03-30': 8 }),
    });
    expect(body.team_activity).toEqual([
      { user_id: DANA, display_name: 'Dana Vik', items_picked: 15, items_packed: 0, is_current_member: true },
    ]);
  });

  it('DST fall back: 2026-10-25 is a 25h Stockholm day; boundary scans land on the correct local dates', async () => {
    pinClock(FALL_NOW_ISO);
    const body = ok(await getHistorical(D, 7));
    expect(body).toHaveProperty('window');
    expect(body.window).toEqual({ days: 7, timezone: STOCKHOLM, start_at: '2026-10-20T22:00:00.000Z', bucket: 'day', today_local: '2026-10-27' });
    expect(body.pace).toEqual({
      items_picked_total: 15,
      points: dailyPoints('2026-10-21', '2026-10-27', { '2026-10-24': 1, '2026-10-25': 6, '2026-10-26': 8 }),
    });
  });

  it('tenant isolation: Shop B sees only its own activity; Shop A never includes B scans or people', async () => {
    pinClock(NOW_ISO);
    const a = ok(await getHistorical(A, 7));
    expect(a).toHaveProperty('team_activity');
    expect(a.team_activity.map((r: { user_id: number }) => r.user_id)).not.toContain(BEA);
    expect(a.pace.items_picked_total).toBe(25);

    const b = ok(await getHistorical(B, 7));
    expect(b.pace.items_picked_total).toBe(1500);
    expect(b.team_activity).toEqual([
      { user_id: BEA, display_name: 'Bea Other', items_picked: 1500, items_packed: 700, is_current_member: true },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// I2 — Problems
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 I2 — Problems: one pick_exceptions population', () => {
  it('7d: order_cancelled and pre-window rows excluded; total, open_total and by_type reconcile; labels omit Default Title; count desc → label asc, top 5', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 7));
    expect(body).toHaveProperty('problems');
    expect(body.problems).toEqual({
      total: 8,
      open_total: 5,
      by_type: { short_pick: 3, item_missing: 1, wrong_item: 2, product_defect: 1, packaging_defect: 1 },
      products: [
        { lasyncro_variant_id: V.mug.variantId, display_label: 'Mug - Blue', sku: 'MUG-BL', count: 3 },
        { lasyncro_variant_id: V.bowl.variantId, display_label: 'Bowl', sku: 'BOWL', count: 1 },
        { lasyncro_variant_id: V.cup.variantId, display_label: 'Cup - Red', sku: 'CUP-R', count: 1 },
        { lasyncro_variant_id: V.lamp.variantId, display_label: 'Lamp - Large', sku: 'LAMP-L', count: 1 },
        { lasyncro_variant_id: V.poster.variantId, display_label: 'Poster', sku: null, count: 1 },
      ],
      products_total: 6,
    });
  });

  it('never presents a raw "Default Title" or the excluded order_cancelled type', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 7));
    expect(body).toHaveProperty('problems');
    expect(JSON.stringify(body.problems)).not.toMatch(/Default Title|order_cancelled/);
  });

  it('tenant isolation: Shop A excludes B problems; Shop B sees exactly its own', async () => {
    pinClock(NOW_ISO);
    const a = ok(await getHistorical(A, 7));
    expect(a).toHaveProperty('problems');
    expect(a.problems.products.map((p: { lasyncro_variant_id: string }) => p.lasyncro_variant_id)).not.toContain(B_VARIANT);

    const b = ok(await getHistorical(B, 7));
    expect(b.problems).toEqual({
      total: 1,
      open_total: 1,
      by_type: { short_pick: 1 },
      products: [{ lasyncro_variant_id: B_VARIANT, display_label: 'Secret - Item', sku: 'SECRET', count: 1 }],
      products_total: 1,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// I3 — Live Flow (real clock)
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 I3 — live Flow from recorded warehouse statuses', () => {
  /** Age bracket around the request: (before − since) .. (after − since), ±2s rounding. */
  function expectAge(actual: unknown, since: Date, before: number, after: number) {
    expect(typeof actual).toBe('number');
    expect(actual as number).toBeGreaterThanOrEqual(Math.floor((before - since.getTime()) / 1000) - 2);
    expect(actual as number).toBeLessThanOrEqual(Math.ceil((after - since.getTime()) / 1000) + 2);
  }

  it('five stages (incl. picked) count ORDERS, oldest age from status_updated_at uncapped, zero → null; shipped/cancelled not stages', async () => {
    const before = Date.now();
    const body = ok(await getLive(A));
    const after = Date.now();
    expect(body).toHaveProperty('flow');
    expect(Object.keys(body.flow.stages).sort()).toEqual([...FLOW_STATUSES].sort());
    expect(Object.fromEntries(FLOW_STATUSES.map((s) => [s, body.flow.stages[s].count])))
      .toEqual({ awaiting_pick: 2, picking: 3, picked: 1, packing: 0, packed: 2 });
    expect(body.flow.stages.packing).toEqual({ count: 0, oldest_age_s: null });
    expectAge(body.flow.stages.awaiting_pick.oldest_age_s, FLOW_SINCE.awaiting_pick, before, after);
    expectAge(body.flow.stages.picking.oldest_age_s, FLOW_SINCE.picking, before, after);
    expectAge(body.flow.stages.picked.oldest_age_s, FLOW_SINCE.picked, before, after); // ~72 days, not capped
    expectAge(body.flow.stages.packed.oldest_age_s, FLOW_SINCE.packed, before, after);
  });

  it('counts and ages come from the same /live response as the legacy stage counts', async () => {
    const body = ok(await getLive(A));
    expect(body).toHaveProperty('flow');
    expect({
      awaiting_pick: body.flow.stages.awaiting_pick.count,
      picking: body.flow.stages.picking.count,
      packing: body.flow.stages.packing.count,
      packed: body.flow.stages.packed.count,
    }).toEqual({
      awaiting_pick: body.pipeline.awaiting_pick,
      picking: body.pipeline.picking,
      packing: body.pipeline.packing,
      packed: body.pipeline.ship_ready,
    });
  });

  it('stages carry only { count, oldest_age_s } — no people, no activity claim', async () => {
    const body = ok(await getLive(A));
    expect(body).toHaveProperty('flow');
    expect(Object.keys(body.flow)).toEqual(['stages']);
    for (const s of FLOW_STATUSES) expect(Object.keys(body.flow.stages[s]).sort()).toEqual(['count', 'oldest_age_s']);
  });

  it('tenant isolation: Shop A flow excludes Shop B orders and B\'s 400-day status', async () => {
    const before = Date.now();
    const a = ok(await getLive(A));
    const b = ok(await getLive(B));
    const after = Date.now();
    expect(a).toHaveProperty('flow');
    expect(a.flow.stages.awaiting_pick.count).toBe(2);
    expect(a.flow.stages.picked.count).toBe(1);
    expectAge(b.flow.stages.picked.oldest_age_s, B_FLOW_PICKED_SINCE, before, after);
    expect(b.flow.stages.awaiting_pick.count).toBe(5);
  });

  it('GREEN CONTROL: active_operators keeps its batch-assignment meaning — an assigned picker with no recent scans still counts', async () => {
    const body = ok(await getLive(A));
    // Only the 'picking' batch is in progress (picked_by Avery); Avery has no scan in the last hour.
    expect(body.active_operators).toBe(1);
    expect(body.live_uph).toBeNull();
  });

  it('GREEN CONTROL: the historical composite never carries Flow (live ages are never served from the 5-minute request)', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 7));
    expect(body).not.toHaveProperty('flow');
    expect(body.live).not.toHaveProperty('flow');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// I4 — Backward compatibility, Floor Display, gates
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 I4 — legacy payloads and gates unchanged', () => {
  it('composite top-level keys are exactly legacy ∪ the four additive V1 blocks', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 7));
    expect(Object.keys(body).sort()).toEqual([...LEGACY_COMPOSITE_KEYS, ...V1_COMPOSITE_KEYS].sort());
  });

  it('GREEN CONTROL: legacy composite blocks keep their keys', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 7));
    expect(Object.keys(body.live).sort()).toEqual([...LEGACY_LIVE_KEYS].sort());
    expect(Object.keys(body.pipeline).sort()).toEqual(['latencies', 'stages']);
    expect(Object.keys(body.pipeline.stages).sort()).toEqual(['packed_to_shipped_s', 'packing_s', 'picking_s', 'released_to_picking_s']);
    expect(Object.keys(body.exceptions).sort()).toEqual(['heat_grid', 'top_skus']);
    expect(Object.keys(body.aging_wip).sort()).toEqual(['by_stage', 'oldest_overall_s', 'total']);
    expect(Object.keys(body.throughput_trend).sort()).toEqual(['avg_uph', 'latest_uph', 'points']);
    expect(Object.keys(body.exception_trend).sort()).toEqual(['by_type', 'open_total', 'points', 'total']);
    expect(typeof body.cost.unlocked).toBe('boolean');
  });

  it('GREEN CONTROL: legacy meanings unchanged — top_skus keeps the raw variant title and all types; operators exclude revoked members', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 7));
    const bySku = Object.fromEntries(body.exceptions.top_skus.map((r: any) => [r.lasyncro_variant_id, r]));
    // Legacy rolling now − 7×24h window: includes Poster's 10-01T21:00Z row and Lamp's order_cancelled rows.
    expect(bySku[V.poster.variantId]).toMatchObject({ title: 'Default Title', exception_count: 2 });
    expect(bySku[V.lamp.variantId]).toMatchObject({ exception_count: 4 });
    expect(body.operators.map((o: { user_id: number }) => o.user_id)).not.toContain(U.casey);
  });

  it('/live keeps every legacy key; the only additive key is flow', async () => {
    const body = ok(await getLive(A));
    expect(Object.keys(body).sort()).toEqual([...LEGACY_LIVE_KEYS, 'flow'].sort());
  });

  it('GREEN CONTROL: getLiveCapacity output is key-identical to the legacy live payload', async () => {
    const live = await withTenant(A.id, (trx) => getLiveCapacity(A.id, trx));
    expect(Object.keys(live).sort()).toEqual([...LEGACY_LIVE_KEYS].sort());
  });

  it('GREEN CONTROL: Floor Display payload shape unchanged and exposes no named people', async () => {
    const res = await request(app).get('/api/v1/wms/analytics/display').query({ token: RAW_DISPLAY_TOKEN });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['exceptions', 'live', 'pipeline', 'zones']);
    expect(Object.keys(res.body.live).sort()).toEqual([...LEGACY_LIVE_KEYS].sort());
    expect(Object.keys(res.body.exceptions)).toEqual(['top_skus']);
    const text = JSON.stringify(res.body);
    for (const name of ['Avery', 'Lind', 'Blake', 'Moss', 'Casey', 'Drew', 'Erin', 'Finn', 'display_name', 'team_activity', 'user_id']) {
      expect(text).not.toContain(name);
    }
  });

  it('GREEN CONTROL: operator is denied by role (ACTION_FORBIDDEN), never by commerce, with no V1 data', async () => {
    for (const route of ['/api/v1/wms/analytics', '/api/v1/wms/analytics/live']) {
      const res = await request(app).get(route).query({ days: 7 }).set(bearer(A.id, U.finn, 'operator'));
      expect({ status: res.status, error: res.body?.error, action: res.body?.action })
        .toEqual({ status: 403, error: 'ACTION_FORBIDDEN', action: 'wms:analytics:read' });
      for (const key of [...V1_COMPOSITE_KEYS, 'flow']) expect(res.body).not.toHaveProperty(key);
    }
  });

  describe('commercial boundary (Shop A temporarily Starter)', () => {
    beforeAll(async () => setTier(A.id, 'starter'));
    afterAll(async () => setTier(A.id, 'core'));

    it('GREEN CONTROL: owner @ Starter is denied warehouse.analytics on composite, live and Floor Display, with no V1 data', async () => {
      const responses = [
        await request(app).get('/api/v1/wms/analytics').query({ days: 7 }).set(bearer(A.id, A.ownerId, 'owner', 'starter')),
        await request(app).get('/api/v1/wms/analytics/live').set(bearer(A.id, A.ownerId, 'owner', 'starter')),
        await request(app).get('/api/v1/wms/analytics/display').query({ token: RAW_DISPLAY_TOKEN }),
      ];
      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ error: 'COMMERCIAL_ACCESS_DENIED', capabilityId: 'warehouse.analytics' });
        for (const key of [...V1_COMPOSITE_KEYS, 'flow', 'live']) expect(res.body).not.toHaveProperty(key);
      }
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GREEN-3 safeguards — legacy-only window and V1 block failure isolation
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 GREEN-3 — legacy-only window', () => {
  it('GREEN CONTROL: days=14 → 200 unchanged legacy payload and meanings, no fabricated V1 blocks', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(A, 14));
    expect(Object.keys(body).sort()).toEqual([...LEGACY_COMPOSITE_KEYS].sort());
    for (const key of V1_COMPOSITE_KEYS) expect(body).not.toHaveProperty(key);
    expect(body.days).toBe(14);
    expect(Object.keys(body.live).sort()).toEqual([...LEGACY_LIVE_KEYS].sort());
    // Legacy rolling now − 14×24h window: raw variant title, all exception types.
    const bySku = Object.fromEntries(body.exceptions.top_skus.map((r: any) => [r.lasyncro_variant_id, r]));
    expect(bySku[V.poster.variantId]).toMatchObject({ title: 'Default Title', exception_count: 2 });
    expect(bySku[V.lamp.variantId]).toMatchObject({ exception_count: 4 });
    expect(body.operators.map((o: { user_id: number }) => o.user_id)).not.toContain(U.casey);
  });
});

describe('GH-1231 GREEN-3 — V1 block failure isolation (injected SQL failure)', () => {
  // A real SQL error inside ONE V1 block: a RESTRICTIVE read policy on `products`
  // (read only by the V1 Problems block; no legacy composite query touches it)
  // that raises for shop F's tenant context only. Installed through the
  // migration role on the disposable DB, removed after every case — no
  // production test hook.
  const MARKER = 'gh1231-sensitive-row-marker';
  let admin: Knex;
  let F: Shop;
  let fUser = 0;
  let fLine: Catalog;

  async function injectProductsReadFailure(sqlstate: string): Promise<void> {
    await admin.raw(`
      CREATE OR REPLACE FUNCTION gh1231_injected_read_failure(row_shop integer) RETURNS boolean
      LANGUAGE plpgsql AS $fn$
      BEGIN
        IF row_shop = ${F.id} AND current_setting('app.current_tenant', true) = '${F.id}' THEN
          RAISE EXCEPTION '${MARKER}' USING ERRCODE = '${sqlstate}';
        END IF;
        RETURN true;
      END
      $fn$`);
    await admin.raw('CREATE POLICY gh1231_injected_read_failure ON products AS RESTRICTIVE FOR SELECT USING (gh1231_injected_read_failure(shop_id))');
  }

  async function removeInjection(): Promise<void> {
    await admin.raw('DROP POLICY IF EXISTS gh1231_injected_read_failure ON products');
    await admin.raw('DROP FUNCTION IF EXISTS gh1231_injected_read_failure(integer)');
  }

  const v1Logs = (spy: jest.SpyInstance, tag: string) => spy.mock.calls.filter(([first]) => first === tag);

  beforeAll(async () => {
    if (!/^synchroflow_test_/.test(process.env.PGDATABASE ?? '')) {
      throw new Error('GH-1231 failure injection refuses to run outside a disposable synchroflow_test_* database');
    }
    admin = knexLib({
      client: 'pg',
      connection: {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGMIGRATION_USER,
        password: process.env.PGMIGRATION_PASSWORD,
        database: process.env.PGDATABASE,
      },
      pool: { min: 0, max: 1 },
    });
    F = await createShop('gh1231-fail', STOCKHOLM);
    fUser = await createUser(F, 'Faye', 'Lund', 'member');
    fLine = await createCatalogLine(F, 'Kettle', 'Steel', 'KTL');
    const fBatch = await createBatch(F, 'pick_complete', { picked_by: fUser });
    await pickScan(F, fBatch, fLine, fUser, 3, '2026-10-08T08:00:00Z');
    await raiseProblem(F, fBatch, fLine, fUser, 'short_pick', 'pick', '2026-10-07T09:00:00Z', false);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await removeInjection();
  });

  afterAll(async () => {
    await removeInjection();
    await admin.destroy();
  });

  it('control: without injection, shop F returns every V1 block', async () => {
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(F, 7));
    expect(body.problems).toMatchObject({ total: 1, products: [{ lasyncro_variant_id: fLine.variantId, display_label: 'Kettle - Steel', count: 1 }] });
  });

  it('ordinary SQL failure (22003) in Problems → 200; Problems omitted, never zero; legacy, window, Pace and Team intact; log has no row data', async () => {
    await injectProductsReadFailure('22003');
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    pinClock(NOW_ISO);
    const body = ok(await getHistorical(F, 7));

    expect(body).not.toHaveProperty('problems');
    expect(Object.keys(body)).toEqual(expect.arrayContaining([...LEGACY_COMPOSITE_KEYS, 'window', 'pace', 'team_activity']));
    expect(body.window).toMatchObject({ days: 7, today_local: '2026-10-08' });
    expect(body.pace.items_picked_total).toBe(3);
    expect(body.team_activity).toEqual([
      { user_id: fUser, display_name: 'Faye Lund', items_picked: 3, items_packed: 0, is_current_member: true },
    ]);
    // Legacy exceptions never read products, so the legacy block still reports the problem.
    expect(body.exceptions.top_skus.map((r: { lasyncro_variant_id: string }) => r.lasyncro_variant_id)).toContain(fLine.variantId);

    const logged = v1Logs(errors, '[WMS_ANALYTICS_V1_BLOCK_FAILED]');
    expect(logged).toHaveLength(1);
    expect(logged[0][1]).toEqual({
      endpoint: 'historical', shop_id: F.id, days: 7, block: 'problems', sqlstate: '22003', error_class: expect.any(String),
    });
    expect(JSON.stringify(logged)).not.toContain(MARKER);
  });

  it('the failed block rolls back only its savepoint: SQL after it succeeds in the same request transaction', async () => {
    await injectProductsReadFailure('22003');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await withTenant(F.id, async (trx) => {
      const blocks = await getAnalyticsV1HistoricalBlocks(F.id, 7, new Date(NOW_ISO), trx);
      const [{ n }] = await trx('pick_scan_log').where('shop_id', F.id).count<{ n: string }[]>('* as n');
      return { blocks, scans: Number(n) };
    });
    expect(result.blocks).not.toHaveProperty('problems');
    expect(result.blocks.pace?.items_picked_total).toBe(3);
    expect(result.scans).toBe(1);
  });

  it('security failure (42501) in a V1 block fails the whole request closed — never a silent 200', async () => {
    await injectProductsReadFailure('42501');
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    pinClock(NOW_ISO);
    const res = await getHistorical(F, 7);

    expect(res.status).toBe(500);
    for (const key of [...V1_COMPOSITE_KEYS, ...LEGACY_COMPOSITE_KEYS]) expect(res.body).not.toHaveProperty(key);
    const logged = v1Logs(errors, '[WMS_ANALYTICS_V1_BLOCK_FAIL_CLOSED]');
    expect(logged).toHaveLength(1);
    expect(logged[0][1]).toMatchObject({ endpoint: 'historical', shop_id: F.id, block: 'problems', sqlstate: '42501' });
    expect(JSON.stringify(logged)).not.toContain(MARKER);
    expect(v1Logs(errors, '[WMS_ANALYTICS_V1_BLOCK_FAILED]')).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GREEN-3 A3 — live Flow clock safeguard (statement time, 120 s skew tolerance)
// ═════════════════════════════════════════════════════════════════════════════

describe('GH-1231 A3 — live Flow status ages under clock skew and future-dated rows', () => {
  // Real clock. One shop per scenario, because Flow is per shop.
  let VALID: Shop;
  let SKEW: Shop;
  let BEYOND: Shop;
  let GROSS: Shop;
  let MIXED: Shop;
  const SINCE: Record<string, Date> = {};
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  function expectAge(actual: unknown, since: Date, before: number, after: number) {
    expect(typeof actual).toBe('number');
    expect(actual as number).toBeGreaterThanOrEqual(Math.floor((before - since.getTime()) / 1000) - 2);
    expect(actual as number).toBeLessThanOrEqual(Math.ceil((after - since.getTime()) / 1000) + 2);
  }

  const logsTagged = (spy: jest.SpyInstance, tag: string) => spy.mock.calls.filter(([first]) => first === tag);

  beforeAll(async () => {
    expect(FLOW_CLOCK_SKEW_TOLERANCE_S).toBe(120);
    const t = Date.now();
    const at = (seconds: number) => new Date(t + seconds * 1000);

    VALID = await createShop('gh1231-a3-valid', STOCKHOLM);
    SINCE.valid = at(-900);
    await warehouseOrder(VALID, await createBatch(VALID, 'pending'), 'awaiting_pick', SINCE.valid);

    SKEW = await createShop('gh1231-a3-skew', STOCKHOLM);
    SINCE.skewOlder = at(-600);
    await warehouseOrder(SKEW, await createBatch(SKEW, 'pending'), 'awaiting_pick', at(60)); // app clock 60 s ahead
    await warehouseOrder(SKEW, await createBatch(SKEW, 'picking'), 'picking', SINCE.skewOlder);

    BEYOND = await createShop('gh1231-a3-beyond', STOCKHOLM);
    await warehouseOrder(BEYOND, await createBatch(BEYOND, 'packing'), 'packing', at(300)); // 5 min ahead

    GROSS = await createShop('gh1231-a3-gross', STOCKHOLM);
    await warehouseOrder(GROSS, await createBatch(GROSS, 'pick_complete'), 'picked', at(30 * 86_400)); // 30 days ahead
    await warehouseOrder(GROSS, await createBatch(GROSS, 'pending'), 'awaiting_pick', at(-1800));

    MIXED = await createShop('gh1231-a3-mixed', STOCKHOLM);
    const mixedBatch = await createBatch(MIXED, 'pack_complete');
    SINCE.mixedOlder = at(-7200);
    await warehouseOrder(MIXED, mixedBatch, 'packed', SINCE.mixedOlder);
    await warehouseOrder(MIXED, mixedBatch, 'packed', at(86_400)); // 1 day ahead
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('1. ordinary elapsed status age is reported from statement time', async () => {
    const before = Date.now();
    const body = ok(await getLive(VALID));
    const after = Date.now();
    expect(body).toHaveProperty('flow');
    expect(body.flow.stages.awaiting_pick.count).toBe(1);
    expectAge(body.flow.stages.awaiting_pick.oldest_age_s, SINCE.valid, before, after);
    for (const s of ['picking', 'picked', 'packing', 'packed']) expect(body.flow.stages[s]).toEqual({ count: 0, oldest_age_s: null });
  });

  it('2. future skew inside 120 s reads as just recorded (age 0); other stages keep real ages; no anomaly', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await withTenant(SKEW.id, (trx) => trx('order_warehouse_status')
      .where({ status: 'awaiting_pick' })
      .whereIn('lasyncro_order_id', trx('orders').select('lasyncro_order_id').where({ shop_id: SKEW.id }))
      .update({ status_updated_at: trx.raw("statement_timestamp() + interval '60 seconds'") }));
    const before = Date.now();
    const body = ok(await getLive(SKEW));
    const after = Date.now();
    expect(body).toHaveProperty('flow');
    expect(body.flow.stages.awaiting_pick).toEqual({ count: 1, oldest_age_s: 0 });
    expectAge(body.flow.stages.picking.oldest_age_s, SINCE.skewOlder, before, after);
    expect(logsTagged(warn, '[WMS_ANALYTICS_V1_FLOW_CLOCK_ANOMALY]')).toHaveLength(0);
  });

  it('3. a stage whose earliest status is > 120 s in the future omits Flow; legacy live fields stay; sanitized logs', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await withTenant(BEYOND.id, (trx) => trx('order_warehouse_status')
      .where({ status: 'packing' })
      .whereIn('lasyncro_order_id', trx('orders').select('lasyncro_order_id').where({ shop_id: BEYOND.id }))
      .update({ status_updated_at: trx.raw("statement_timestamp() + interval '300 seconds'") }));
    const body = ok(await getLive(BEYOND));

    expect(body).not.toHaveProperty('flow');
    expect(Object.keys(body).sort()).toEqual([...LEGACY_LIVE_KEYS].sort());
    expect(body.pipeline.packing).toBe(1); // legacy count unchanged

    const anomaly = logsTagged(warn, '[WMS_ANALYTICS_V1_FLOW_CLOCK_ANOMALY]');
    expect(anomaly).toHaveLength(1);
    expect(anomaly[0][1]).toEqual({ shop_id: BEYOND.id, stage: 'packing', future_rows: 1, tolerance_s: 120, flow_omitted: true });
    const failed = logsTagged(error, '[WMS_ANALYTICS_V1_BLOCK_FAILED]');
    expect(failed).toHaveLength(1);
    expect(failed[0][1]).toEqual({ endpoint: 'live', shop_id: BEYOND.id, days: null, block: 'flow', sqlstate: null, error_class: 'FlowClockAnomalyError' });
    expect(JSON.stringify([...anomaly, ...failed])).not.toMatch(UUID);
    expect(logsTagged(error, '[WMS_ANALYTICS_V1_BLOCK_FAIL_CLOSED]')).toHaveLength(0);
  });

  it('4. a grossly future-dated status (30 days ahead) never becomes a healthy zero age', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const body = ok(await getLive(GROSS));
    expect(body).not.toHaveProperty('flow');
    expect(JSON.stringify(body)).not.toMatch(/oldest_age_s/);
  });

  it('5. an older valid row beside a future row keeps Flow with the older row\'s real age; the anomaly is logged', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = Date.now();
    const body = ok(await getLive(MIXED));
    const after = Date.now();
    expect(body).toHaveProperty('flow');
    expect(body.flow.stages.packed.count).toBe(2);
    expectAge(body.flow.stages.packed.oldest_age_s, SINCE.mixedOlder, before, after);
    const anomaly = logsTagged(warn, '[WMS_ANALYTICS_V1_FLOW_CLOCK_ANOMALY]');
    expect(anomaly).toHaveLength(1);
    expect(anomaly[0][1]).toEqual({ shop_id: MIXED.id, stage: 'packed', future_rows: 1, tolerance_s: 120, flow_omitted: false });
    expect(logsTagged(error, '[WMS_ANALYTICS_V1_BLOCK_FAILED]')).toHaveLength(0);
  });

  it('6. an omitted Flow leaves the live summary available to the V1 frontend resolver', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const body = ok(await getLive(GROSS));
    const blocks = resolveV1LiveBlocks({ data: body, error: null, isError: false, isPlaceholderData: false, dataUpdatedAt: 1 });
    expect(blocks.flow).toEqual({ status: 'unavailable' });
    expect(blocks.summary).toEqual({
      status: 'ready',
      data: { shipped_today: body.shipped_today, cpt_local: body.cpt_local, hours_to_cpt: body.hours_to_cpt, active_operators: body.active_operators },
      updatedAt: 1,
    });
  });

  it('7. tenant isolation and legacy protection: other shops keep Flow; anomaly shops keep legacy composite and live', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const a = ok(await getLive(A));
    expect(a).toHaveProperty('flow');
    expect(Object.fromEntries(FLOW_STATUSES.map((s) => [s, a.flow.stages[s].count])))
      .toEqual({ awaiting_pick: 2, picking: 3, picked: 1, packing: 0, packed: 2 });

    const gross = ok(await getLive(GROSS));
    expect(Object.keys(gross).sort()).toEqual([...LEGACY_LIVE_KEYS].sort());
    expect(gross.pipeline.awaiting_pick).toBe(1);

    const composite = ok(await getHistorical(GROSS, 7));
    expect(Object.keys(composite.live).sort()).toEqual([...LEGACY_LIVE_KEYS].sort());
    expect(composite).not.toHaveProperty('flow');
    expect(composite).toHaveProperty('window');
  });
});
