// tests/integration/exports/orders-outbound-export.contract.test.ts
//
// OUTBOUND SLICE F RED — the `orders-outbound` export is the canonical
// Outbound (physical shipment) dataset, the same domain as
// GET /api/v1/orders/outbound.
//
// The report is exercised exactly as the shared ExportDrawer sends it: the
// endpoint and body come from the canonical QUICK_REPORTS entry
// (apps/frontend/src/config/exportReports.ts), POSTed through the real app
// with real auth, capability and action middleware against a disposable DB.
// Nothing that decides membership or columns is mocked.
//
// Truth sources (established in Slice B):
//   - membership: order_warehouse_status.status = 'shipped' AND shipped_at
//     IS NOT NULL — never order_fulfillment_status alone
//   - tracking: latest order_shipment_tracking row (created_at DESC, id DESC)
//   - carrier: provider_carrier_code; carrier_code is the label PROVIDER
//   - currency: orders.currency
//   - shop-local timestamps: shops.timezone, 'YYYY-MM-DD HH24:MI:SS'
//     (existing export precedent, exports.controller.ts)
//
// Deliberately NOT asserted: on-screen state/period/search export (separate
// product decision), partially_shipped, shipped→cancelled, commercial gating
// (covered by the existing export-commercial-access suites).

import crypto from 'crypto';
import request from 'supertest';
import { parseString } from 'fast-csv';

import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { QUICK_REPORTS } from '../../../apps/frontend/src/config/exportReports';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const OUTBOUND_REPORT = QUICK_REPORTS.find((r) => r.id === 'orders-outbound');

// ─── FIXTURES (mirrors outbound-read-model.contract.test.ts) ─────────────────

let externalSeq = 0;
function nextExternalId(): string {
  externalSeq += 1;
  return `8${Date.now().toString().slice(-8)}${String(externalSeq).padStart(4, '0')}`;
}

type Auth = { shopId: number; userId: number };

async function createShop(timezone = 'UTC'): Promise<Auth> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `outbound-export-${unique}`);
    await setTenantContext(trx, id);
    await trx('shops').where({ id }).update({ timezone, timezone_source: 'manual' });
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    // authenticateToken resolves the CURRENT tier from shop_subscriptions
    // (GH-1136); exports.core requires a paid tier.
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'growth',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `outbound-export-${unique}@test.example`,
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
  id?: string;
  carrierCode: string;
  trackingNumber: string | null;
  latestStatus: string | null;
  providerCarrierCode?: string | null;
  isStalled?: boolean;
  createdAt?: Date;
};

type OrderFixture = {
  shopId: number;
  warehouse: 'shipped' | 'packed' | 'none';
  shippedAt?: Date;
  fulfilled?: boolean;
  fulfilledAt?: Date;
  currency?: string;
  totalPrice?: string;
  tracking?: TrackingFixture[];
};

async function seedOrder(f: OrderFixture): Promise<{ orderId: string; externalOrderId: string }> {
  const orderId = crypto.randomUUID();
  const externalOrderId = nextExternalId();
  const now = new Date();
  const shippedAt = f.shippedAt ?? new Date(now.getTime() - HOUR);
  const orderCreatedAt = new Date(shippedAt.getTime() - 12 * HOUR);

  await withTenant(f.shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: f.shopId,
      payment_state: 'paid',
      currency: f.currency ?? 'USD',
      total_price: f.totalPrice ?? '100.00',
      subtotal_price: f.totalPrice ?? '100.00',
      total_tax: '0.00',
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

    for (const t of f.tracking ?? []) {
      await trx('order_shipment_tracking').insert({
        ...(t.id ? { id: t.id } : {}),
        shop_id: f.shopId,
        lasyncro_order_id: orderId,
        carrier_code: t.carrierCode,
        tracking_number: t.trackingNumber,
        latest_status: t.latestStatus,
        latest_event_at: t.latestStatus ? new Date(now.getTime() - HOUR) : null,
        is_stalled: t.isStalled ?? false,
        provider_carrier_code: t.providerCarrierCode ?? null,
        ...(t.createdAt ? { created_at: t.createdAt } : {}),
      });
    }
  });

  return { orderId, externalOrderId };
}

// ─── EXPORT BOUNDARY ─────────────────────────────────────────────────────────

type CsvRow = Record<string, string>;

function parseCsv(text: string): Promise<{ headers: string[]; rows: CsvRow[] }> {
  return new Promise((resolve, reject) => {
    let headers: string[] = [];
    const rows: CsvRow[] = [];
    parseString(text, {
      headers: (h: (string | null | undefined)[]) => {
        headers = h.map((x) => String(x ?? ''));
        return headers;
      },
    })
      .on('error', reject)
      .on('data', (row: CsvRow) => rows.push(row))
      .on('end', () => resolve({ headers, rows }));
  });
}

/** POST the canonical `orders-outbound` report exactly as ExportDrawer does. */
async function exportOutbound(auth: Auth) {
  if (!OUTBOUND_REPORT) throw new Error("QUICK_REPORTS has no 'orders-outbound' report");
  const token = issueTestToken({ userId: auth.userId, shopId: auth.shopId, tier: 'growth' });
  const res = await request(app)
    .post(OUTBOUND_REPORT.endpoint)
    .set('Authorization', `Bearer ${token}`)
    .send(OUTBOUND_REPORT.body ?? {})
    .buffer(true)
    .parse((response, callback) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { data += chunk; });
      response.on('end', () => callback(null, data));
    });
  expect(res.status).toBe(200);
  expect(String(res.headers['content-type'])).toMatch(/text\/csv/);
  return parseCsv(res.body as string);
}

/** Every export row that represents this order, by internal or external identity. */
const rowsFor = (rows: CsvRow[], order: { orderId: string; externalOrderId: string }) =>
  rows.filter((r) => r.external_order_id === order.externalOrderId || Object.values(r).includes(order.orderId));

const valueColumn = (row: CsvRow) => row.total_price ?? row.value;

/** Shop-local 'YYYY-MM-DD HH:MM:SS' (export precedent) for a fixed-offset zone. */
function shopLocal(date: Date, offsetHours: number): string {
  return new Date(date.getTime() + offsetHours * HOUR).toISOString().slice(0, 19).replace('T', ' ');
}

const BLANK = /^(|—)$/;
const normStatus = (v: string | undefined) => (v ?? '').trim().toLowerCase().replace(/\s+/g, '_');

// ─── CONFIG CONTRACT ─────────────────────────────────────────────────────────

describe('F0 — orders-outbound report config', () => {
  it('keeps its id and shared export capability, and no longer defines a fulfilled-status dataset', () => {
    expect(OUTBOUND_REPORT).toBeDefined();
    expect(OUTBOUND_REPORT!.capabilityId).toBe('exports.core');

    const status = (OUTBOUND_REPORT!.body as { filters?: { status?: unknown } } | undefined)?.filters?.status;
    expect(Array.isArray(status) ? status : []).not.toContain('fulfilled');
    expect(OUTBOUND_REPORT!.description).not.toMatch(/\bfulfilled\b/i);
  });
});

// ─── R1 — MEMBERSHIP + TENANT ISOLATION ──────────────────────────────────────

describe('R1 — membership is physical shipment truth', () => {
  it('exports shipped orders only: no Shopify-fulfilled-only, no packed, no other tenant', async () => {
    const shopA = await createShop();
    const shopB = await createShop();

    const shipped = await seedOrder({ shopId: shopA.shopId, warehouse: 'shipped' });
    const shopifyOnly = await seedOrder({ shopId: shopA.shopId, warehouse: 'none', fulfilled: true });
    const packed = await seedOrder({ shopId: shopA.shopId, warehouse: 'packed', fulfilled: false });
    const otherTenant = await seedOrder({ shopId: shopB.shopId, warehouse: 'shipped' });

    const { rows } = await exportOutbound(shopA);

    expect(rowsFor(rows, shipped)).toHaveLength(1);
    expect(rowsFor(rows, shopifyOnly)).toHaveLength(0);
    expect(rowsFor(rows, packed)).toHaveLength(0);
    expect(rowsFor(rows, otherTenant)).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });
});

// ─── R2 — REQUIRED COLUMNS ───────────────────────────────────────────────────

describe('R2 — Outbound-specific columns', () => {
  it('exposes external_order_id, shipped_at, value, currency, tracking_number, carrier, live_status', async () => {
    const auth = await createShop();
    await seedOrder({ shopId: auth.shopId, warehouse: 'shipped' });

    const { headers } = await exportOutbound(auth);

    for (const key of ['external_order_id', 'shipped_at', 'currency', 'tracking_number', 'carrier', 'live_status']) {
      expect(headers).toContain(key);
    }
    expect(headers.some((h) => h === 'total_price' || h === 'value')).toBe(true);
  });
});

// ─── R3 — SHIPPED TIMESTAMP ──────────────────────────────────────────────────

describe('R3 — shipped_at is the canonical shipment time, shop-local', () => {
  it('derives from order_warehouse_status.shipped_at, not a conflicting fulfilled_at', async () => {
    // Asia/Tokyo: fixed UTC+9, no DST.
    const auth = await createShop('Asia/Tokyo');
    const shippedAt = new Date(Date.now() - 3 * HOUR);
    shippedAt.setUTCMilliseconds(0);
    const fulfilledAt = new Date(shippedAt.getTime() - 5 * DAY);

    const order = await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', shippedAt, fulfilledAt });

    const { rows } = await exportOutbound(auth);
    const [row] = rowsFor(rows, order);

    expect(row).toBeDefined();
    expect(row.shipped_at).toBe(shopLocal(shippedAt, 9));
    expect(row.shipped_at).not.toBe(shopLocal(fulfilledAt, 9));
  });
});

// ─── R4 — CURRENCY ───────────────────────────────────────────────────────────

describe('R4 — each order keeps its own currency', () => {
  it('EUR stays EUR and USD stays USD, with their own amounts', async () => {
    const auth = await createShop();
    const eur = await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', currency: 'EUR', totalPrice: '42.50' });
    const usd = await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', currency: 'USD', totalPrice: '19.99' });

    const { rows } = await exportOutbound(auth);
    const [eurRow] = rowsFor(rows, eur);
    const [usdRow] = rowsFor(rows, usd);

    expect(eurRow?.currency).toBe('EUR');
    expect(Number(valueColumn(eurRow))).toBe(42.5);
    expect(usdRow?.currency).toBe('USD');
    expect(Number(valueColumn(usdRow))).toBe(19.99);
  });
});

// ─── R5 — CARRIER TRUTH ──────────────────────────────────────────────────────

describe('R5 — carrier is the physical carrier, never the label provider', () => {
  it('exports provider_carrier_code as carrier, not shippo', async () => {
    const auth = await createShop();
    const order = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped',
      tracking: [{ carrierCode: 'shippo', providerCarrierCode: 'usps', trackingNumber: 'TRK-USPS-1', latestStatus: 'in_transit' }],
    });

    const { rows } = await exportOutbound(auth);
    const [row] = rowsFor(rows, order);

    expect(row).toBeDefined();
    expect(row.carrier).toMatch(/^usps$/i);
    expect(row.carrier).not.toMatch(/shippo/i);
    expect(row.tracking_number).toBe('TRK-USPS-1');
  });
});

// ─── R6 — NULL TRUTH ─────────────────────────────────────────────────────────

describe('R6 — untracked shipped orders stay truthfully blank', () => {
  it('no tracking row: blank tracking, carrier and live status; nothing fabricated', async () => {
    const auth = await createShop();
    const order = await seedOrder({ shopId: auth.shopId, warehouse: 'shipped', tracking: [] });

    const { headers, rows } = await exportOutbound(auth);
    const [row] = rowsFor(rows, order);

    expect(headers).toEqual(expect.arrayContaining(['tracking_number', 'carrier', 'live_status']));
    expect(row).toBeDefined();
    expect(row.tracking_number).toMatch(BLANK);
    expect(row.carrier).toMatch(BLANK);
    expect(row.live_status).toMatch(BLANK);
    for (const value of Object.values(row)) {
      expect(value).not.toMatch(/not sent|no carrier/i);
    }
  });
});

// ─── R7 — LATEST TRACKING ROW ────────────────────────────────────────────────

describe('R7 — one export row per order, from the latest tracking row', () => {
  it('latest created_at wins; created_at ties resolve like the Outbound read model and stay stable', async () => {
    const auth = await createShop();
    const older = new Date(Date.now() - 6 * HOUR);
    const newer = new Date(Date.now() - 1 * HOUR);

    const twoRows = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped',
      tracking: [
        { carrierCode: 'shippo', providerCarrierCode: 'ups', trackingNumber: 'TRK-OLD', latestStatus: 'in_transit', createdAt: older },
        { carrierCode: 'shippo', providerCarrierCode: 'usps', trackingNumber: 'TRK-NEW', latestStatus: 'delivered', createdAt: newer },
      ],
    });

    // Same created_at; ids chosen so their order is known.
    const tiedAt = new Date(Date.now() - 2 * HOUR);
    const tied = await seedOrder({
      shopId: auth.shopId, warehouse: 'shipped',
      tracking: [
        { id: '00000000-0000-4000-8000-00000000000a', carrierCode: 'sendcloud', trackingNumber: 'TRK-TIE-A', latestStatus: 'in_transit', createdAt: tiedAt },
        { id: 'ffffffff-0000-4000-8000-00000000000b', carrierCode: 'sendcloud', trackingNumber: 'TRK-TIE-B', latestStatus: 'in_transit', createdAt: tiedAt },
      ],
    });

    const first = await exportOutbound(auth);
    const twoRowMatches = rowsFor(first.rows, twoRows);
    expect(twoRowMatches).toHaveLength(1);
    expect(twoRowMatches[0].tracking_number).toBe('TRK-NEW');
    expect(twoRowMatches[0].carrier).toMatch(/^usps$/i);
    expect(normStatus(twoRowMatches[0].live_status)).toBe('delivered');

    const tiedMatches = rowsFor(first.rows, tied);
    expect(tiedMatches).toHaveLength(1);

    // The tie resolves exactly as GET /api/v1/orders/outbound resolves it.
    const token = issueTestToken({ userId: auth.userId, shopId: auth.shopId, tier: 'growth' });
    const readModel = await request(app)
      .get('/api/v1/orders/outbound')
      .query({ state: 'all', period: 'all', limit: 100 })
      .set('Authorization', `Bearer ${token}`);
    expect(readModel.status).toBe(200);
    const readTied = (readModel.body.orders as Array<{ lasyncro_order_id: string; tracking_number: string | null }>)
      .find((o) => o.lasyncro_order_id === tied.orderId);
    expect(tiedMatches[0].tracking_number).toBe(readTied?.tracking_number);

    const second = await exportOutbound(auth);
    expect(rowsFor(second.rows, tied)[0]?.tracking_number).toBe(tiedMatches[0].tracking_number);
  });
});
