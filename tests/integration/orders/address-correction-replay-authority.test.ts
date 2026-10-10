/**
 * OPS-RESOLVE-01 / Slice D — SHIPPING ADDRESS AUTHORITY.
 *
 * OPS-RESOLVE-AUTH-01
 * Once a merchant has corrected an order shipping address, later Shopify
 * orders/create or orders/sync replay must not overwrite that operational
 * correction or re-open customer/incomplete_address.
 *
 * OPS-RESOLVE-AUTH-03
 * Orders without merchant-correction provenance must continue accepting
 * normal Shopify shipping-address updates.
 *
 * Real disposable PostgreSQL only. Production source is intentionally
 * unchanged while these contracts establish RED.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  systemQuery,
  withTenant,
  runWithTenantContext,
} from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { evaluateOrderConstraints } from 'api-src/services/constraints/constraintEngine';
import { generateDecisions } from 'api-src/domain/decision/decision.engine';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

/** Every shop this suite provisions — ADDR-DEC-05 sweeps all of them. */
const provisionedShopIds: number[] = [];

// ── canonical helpers (same shapes as the sibling integration contracts) ────

async function hmacInstall(shopDomain: string): Promise<{ shopId: number; userId: number }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k as keyof typeof params]}`)
    .join('&');
  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  const install = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ ...params, hmac })
    .redirects(0);
  expect(install.status).toBe(302);

  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [
      `shopify-install+${shopDomain}@lasyncro.internal`,
    ])
  );
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId })
      .andWhere('id', '>', afterId)
      .orderBy('id', 'asc')
      .select('id')
  );
  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }
  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

async function provisionFt2Shop(label: string): Promise<{ shopId: number; token: string }> {
  const shopDomain = `addr-dec-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  provisionedShopIds.push(shopId);

  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: shopDomain,
      sync_status: 'COMPLETED',
      updated_at: new Date(),
    })
  );

  let cursor = 0;
  cursor = await pumpEvents(shopId, cursor);
  cursor = await pumpEvents(shopId, cursor);
  cursor = await pumpEvents(shopId, cursor);

  const token = issueTestToken({ userId, shopId });
  const confirm = await request(app)
    .post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);

  const atFt2 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
  );
  expect(atFt2?.phase).toBe('FT2');

  return { shopId, token };
}

/** A real, ingestion-mapped variant id (mapper strips the gid prefix). */
async function seededVariantNumericId(shopId: number): Promise<string> {
  const row = await withTenant(shopId, (trx) =>
    trx('external_product_identity_map')
      .where({ shop_id: shopId, platform: 'shopify' })
      .whereNotNull('external_variant_id')
      .first('external_variant_id')
  );
  expect(row?.external_variant_id).toBeTruthy();
  const gid: string = row!.external_variant_id;
  return gid.startsWith('gid://') ? gid.split('/').pop()! : gid;
}

/** Deterministic canonical order id — identical derivation to orders.create.ts. */
function lasyncroOrderIdFor(shopId: number, externalOrderId: string): string {
  const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  return crypto
    .createHash('sha1')
    .update(`${NS}:${shopId}:shopify:${externalOrderId}`)
    .digest('hex')
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
}

async function insertEvent(
  shopId: number,
  eventType: string,
  payload: Record<string, unknown>
): Promise<number> {
  const [row] = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .insert({
        shop_id: shopId,
        event_type: eventType,
        event_payload: payload,
        event_time: new Date(),
        event_version: 1,
        external_event_id: `test:addr-dec:${shopId}:${eventType}:${crypto.randomUUID()}`,
      })
      .returning(['id'])
  );
  return Number(row.id);
}

const projectEvent = (shopId: number, eventId: number) =>
  runWithTenantContext(shopId, () => processDomainEvent(eventId));

/**
 * Ingests a real Shopify-shaped order through orders/create, then makes it
 * genuinely PAID through orders/paid. orders.create.ts hardcodes
 * payment_state='unpaid' by design (payment truth comes only from orders/paid),
 * so both events are required for a real paid order — this is the canonical
 * ingestion path, not a shortcut.
 */
async function ingestPaidOrder(input: {
  shopId: number;
  shippingAddress: Record<string, unknown> | null;
  withRealWmsLine?: boolean;
  /** Raw Shopify customer id; ingestion hashes it to customer_hashed_id. */
  customerId?: string;
}): Promise<{ orderId: string; externalOrderId: string }> {
  const { shopId, shippingAddress, withRealWmsLine = true, customerId } = input;
  const externalOrderId = `${shopId}${Date.now()}${Math.floor(Math.random() * 1e4)}`;

  const lineItems = withRealWmsLine
    ? [
        {
          id: `${Date.now()}`,
          quantity: 1,
          price: '42.00',
          variant_id: await seededVariantNumericId(shopId),
        },
      ]
    : [{ id: `${Date.now()}`, quantity: 1, price: '42.00' }];

  const createId = await insertEvent(shopId, 'orders/create', {
    id: externalOrderId,
    currency: 'USD',
    total_price: 42,
    subtotal_price: 42,
    total_tax: 0,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    shipping_address: shippingAddress,
    line_items: lineItems,
    ...(customerId ? { customer: { id: customerId } } : {}),
  });
  await projectEvent(shopId, createId);

  const paidId = await insertEvent(shopId, 'orders/paid', { id: externalOrderId });
  await projectEvent(shopId, paidId);

  const orderId = lasyncroOrderIdFor(shopId, externalOrderId);

  // The order really is paid — the premise every contract here rests on.
  const order = await withTenant(shopId, (trx) =>
    trx('orders').where({ lasyncro_order_id: orderId }).first('payment_state', 'paid_at')
  );
  expect(order?.payment_state).toBe('paid');
  expect(order?.paid_at).toBeTruthy();

  // Ingestion produced the canonical external identity mapping.
  const identity = await withTenant(shopId, (trx) =>
    trx('external_order_identity_map')
      .where({ shop_id: shopId, platform: 'shopify', lasyncro_order_id: orderId })
      .first('external_order_id')
  );
  expect(identity?.external_order_id).toBe(externalOrderId);

  return { orderId, externalOrderId };
}

const INCOMPLETE_ADDRESS = { name: 'Jane Doe', address1: '9 Partial Way', city: null, zip: null, country_code: null };
const COMPLETE_PATCH = { address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB' };

async function constraintsFor(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('order_constraints')
      .where({ lasyncro_order_id: orderId })
      .select('constraint_type', 'block_type', 'is_active', 'resolved_at')
  );
}

const activeOf = (rows: Array<{ is_active: boolean }>) => rows.filter((r) => r.is_active);

async function poolIds(token: string): Promise<string[]> {
  const res = await request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.orders.map((o: { lasyncro_order_id: string }) => o.lasyncro_order_id);
}

const getDecision = (token: string, orderId: string) =>
  request(app).get(`/api/v1/orders/${orderId}/decision`).set('Authorization', `Bearer ${token}`);

const patchAddress = (token: string, orderId: string, body: Record<string, unknown>) =>
  request(app)
    .patch(`/api/v1/orders/${orderId}/shipping-address`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

async function aggregateVersion(shopId: number, orderId: string): Promise<number> {
  const row = await withTenant(shopId, (trx) =>
    trx('orders').where({ lasyncro_order_id: orderId }).first('aggregate_version')
  );
  return Number(row!.aggregate_version);
}

/** Unprocessed orders/shipping_address_corrected events for this order. */
async function correctionEvents(shopId: number, externalOrderId: string, afterId: number) {
  return withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId, event_type: 'orders/shipping_address_corrected' })
      .andWhere('id', '>', afterId)
      .orderBy('id', 'asc')
      .select('id', 'event_payload')
  );
}

/**
 * The real RECONCILIATION_RUN command payload the runtime dispatcher wrote for
 * this order (reconciliation.handlers.ts), carrying the genuine riskSnapshot
 * derived from real constraint evaluation. commands.consumer.ts feeds exactly
 * this payload into generateDecisions — reading it here lets the canonical
 * Decision Engine run on genuine runtime signals without starting a worker.
 */
async function reconciliationCommandPayload(shopId: number, orderId: string) {
  const row = await withTenant(shopId, (trx) =>
    trx('commands')
      .where({ shop_id: shopId, type: 'RECONCILIATION_RUN' })
      .whereRaw(`payload ->> 'orderId' = ?`, [orderId])
      .orderBy('id', 'desc')
      .first('payload', 'status')
  );
  return row as
    | {
        status: string;
        payload: {
          orderId: string;
          shopId: number;
          aggregateVersion: number;
          riskSnapshot: Record<string, unknown>;
          isAlreadyFulfilled?: boolean;
        };
      }
    | undefined;
}

async function maxEventId(shopId: number): Promise<number> {
  const row = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).max('id as max').first()
  );
  return Number(row?.max ?? 0);
}

// ── ADDR-DEC-01 ────────────────────────────────────────────────────────────

const PROVIDER_UPDATED_ADDRESS = {
  name: 'Jane Doe',
  address1: '77 Provider Street',
  address2: null,
  city: 'Manchester',
  zip: 'M1 1AA',
  phone: null,
  province_code: null,
  country_code: 'GB',
};

async function storedAddress(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('orders')
      .where({ lasyncro_order_id: orderId })
      .first(
        'shipping_name',
        'shipping_address1',
        'shipping_address2',
        'shipping_city',
        'shipping_zip',
        'shipping_phone',
        'shipping_province',
        'shipping_country_code'
      )
  );
}

async function hasAddressCorrectionHistory(
  shopId: number,
  orderId: string
): Promise<boolean> {
  const row = await withTenant(shopId, (trx) =>
    trx('order_fulfillment_history')
      .where({
        lasyncro_order_id: orderId,
        status: 'address_corrected',
      })
      .first('status')
  );

  return Boolean(row);
}

function hasActiveAddressConstraint(
  rows: Array<{
    constraint_type: string;
    block_type: string;
    is_active: boolean;
  }>
): boolean {
  return rows.some(
    (row) =>
      row.is_active &&
      row.constraint_type === 'customer' &&
      row.block_type === 'incomplete_address'
  );
}

describe('OPS-RESOLVE-AUTH-01 — merchant correction owns operational shipping address', () => {
  it.each(['orders/create', 'orders/sync'] as const)(
    '%s replay cannot overwrite a merchant-corrected address or re-open the blocker',
    async (eventType) => {
      const label = `auth01-${eventType.replace('/', '-')}`;
      const { shopId, token } = await provisionFt2Shop(label);

      const { orderId, externalOrderId } = await ingestPaidOrder({
        shopId,
        shippingAddress: INCOMPLETE_ADDRESS,
      });

      expect(
        hasActiveAddressConstraint(await constraintsFor(shopId, orderId))
      ).toBe(true);

      const beforeCorrectionEvent = await maxEventId(shopId);

      const correction = await patchAddress(
        token,
        orderId,
        COMPLETE_PATCH
      );

      expect(correction.status).toBe(200);

      // Process the real orders/shipping_address_corrected event so canonical
      // constraint truth reflects the merchant correction before replay.
      await pumpEvents(shopId, beforeCorrectionEvent);

      expect(
        await hasAddressCorrectionHistory(shopId, orderId)
      ).toBe(true);

      expect(await storedAddress(shopId, orderId)).toMatchObject({
        shipping_address1: COMPLETE_PATCH.address1,
        shipping_city: COMPLETE_PATCH.city,
        shipping_zip: COMPLETE_PATCH.zip,
        shipping_country_code: COMPLETE_PATCH.countryCode,
      });

      expect(
        hasActiveAddressConstraint(await constraintsFor(shopId, orderId))
      ).toBe(false);

      // Shopify still carries the original stale/incomplete address.
      const replayId = await insertEvent(shopId, eventType, {
        id: externalOrderId,
        currency: 'USD',
        total_price: 42,
        subtotal_price: 42,
        total_tax: 0,
        displayFinancialStatus: 'PAID',
        displayFulfillmentStatus: 'UNFULFILLED',
        shipping_address: INCOMPLETE_ADDRESS,
        line_items: [],
      });

      await projectEvent(shopId, replayId);

      // Permanent contract: replay cannot destroy explicit merchant truth.
      expect(await storedAddress(shopId, orderId)).toMatchObject({
        shipping_address1: COMPLETE_PATCH.address1,
        shipping_city: COMPLETE_PATCH.city,
        shipping_zip: COMPLETE_PATCH.zip,
        shipping_country_code: COMPLETE_PATCH.countryCode,
      });

      expect(
        hasActiveAddressConstraint(await constraintsFor(shopId, orderId))
      ).toBe(false);
    }
  );
});

describe('OPS-RESOLVE-AUTH-03 — uncorrected orders still converge from Shopify', () => {
  it('applies a later Shopify shipping-address update when no merchant correction exists', async () => {
    const { shopId } = await provisionFt2Shop('auth03');

    const { orderId, externalOrderId } = await ingestPaidOrder({
      shopId,
      shippingAddress: {
        name: 'Jane Doe',
        address1: '10 Original Street',
        city: 'London',
        zip: 'SW1A 1AA',
        country_code: 'GB',
      },
    });

    expect(
      await hasAddressCorrectionHistory(shopId, orderId)
    ).toBe(false);

    const replayId = await insertEvent(shopId, 'orders/sync', {
      id: externalOrderId,
      currency: 'USD',
      total_price: 42,
      subtotal_price: 42,
      total_tax: 0,
      displayFinancialStatus: 'PAID',
      displayFulfillmentStatus: 'UNFULFILLED',
      shipping_address: PROVIDER_UPDATED_ADDRESS,
      line_items: [],
    });

    await projectEvent(shopId, replayId);

    expect(await storedAddress(shopId, orderId)).toMatchObject({
      shipping_name: PROVIDER_UPDATED_ADDRESS.name,
      shipping_address1: PROVIDER_UPDATED_ADDRESS.address1,
      shipping_city: PROVIDER_UPDATED_ADDRESS.city,
      shipping_zip: PROVIDER_UPDATED_ADDRESS.zip,
      shipping_country_code: PROVIDER_UPDATED_ADDRESS.country_code,
    });
  });
});
