/**
 * ORD-DECISION-01 / Slice 4 — ADDRESS & CUSTOMER DECISION CONTRACT.
 *
 * Product invariant under protection:
 *   laSyncro only ever operationally ingests PAID Shopify orders, so
 *   "awaiting_payment" is not a reachable customer blocker. The one live
 *   customer blocker is customer / incomplete_address, derived by
 *   customerConstraintEvaluator.ts from orders.shipping_address* completeness
 *   (address1, city, zip, country_code).
 *
 *   ADDR-DEC-01  a PAID order missing required shipping fields materialises
 *                customer/incomplete_address is_active=true, and is excluded
 *                from the releasable Order Pool while blocked.
 *   ADDR-DEC-02  GET /api/v1/orders/:orderId/decision reports that constraint
 *                truthfully even when decision enrichment is absent or stale;
 *                any returned decision recommends resolve_customer_block; the
 *                response never exposes awaiting_payment.
 *   ADDR-DEC-03  PATCH /api/v1/orders/:orderId/shipping-address with a complete
 *                address returns 200, persists, advances aggregate_version
 *                exactly once, emits orders/shipping_address_corrected, and —
 *                once that event is processed through the real projection seam
 *                — resolves the constraint, drops it from the decision
 *                response, and returns the order to its normal downstream flow.
 *   ADDR-DEC-04  a coexisting real inventory blocker survives the customer
 *                correction: fixing customer data must never clear another
 *                constraint type.
 *   ADDR-DEC-05  no customer/awaiting_payment row is ever written (active or
 *                resolved) for any PAID order this suite creates, and the live
 *                evaluateOrderConstraints never returns one.
 *
 * Everything is driven through canonical paths: HMAC Shopify install →
 * seedFreshInstall → FT2 confirm; orders/create + orders/paid domain events
 * projected through processDomainEvent (so external_order_identity_map,
 * order_line_items and order_revenue_units are all produced by real ingestion);
 * the real authenticated PATCH route for correction; and the same event pump
 * the sibling integration contracts use. No order_constraints row is ever
 * hand-inserted or hand-cleared, and no append-only snapshot is mutated.
 *
 * Disposable synchroflow_test_* DB only (`npm run test:integration`).
 *
 * NOTE: ORD-DECISION-01 Slice 4 removed the dead
 * orderCustomerConstraintProjection.ts and its projection manifest references.
 * Live customer truth remains customerConstraintEvaluator.ts, and this suite
 * protects that canonical lifecycle rather than any legacy payment-state path.
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

describe('ADDR-DEC-01 — a PAID order with an incomplete shipping address is customer-blocked', () => {
  it('materialises customer/incomplete_address active and withholds the order from the Order Pool', async () => {
    const { shopId, token } = await provisionFt2Shop('dec01');
    const { orderId } = await ingestPaidOrder({ shopId, shippingAddress: INCOMPLETE_ADDRESS });

    const rows = await constraintsFor(shopId, orderId);
    const active = activeOf(rows);

    expect(active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint_type: 'customer',
          block_type: 'incomplete_address',
          is_active: true,
        }),
      ])
    );

    // The blocker is real: the persisted address genuinely lacks the fields
    // the evaluator (and the PATCH validator) both call required.
    const order = await withTenant(shopId, (trx) =>
      trx('orders')
        .where({ lasyncro_order_id: orderId })
        .first('shipping_address1', 'shipping_city', 'shipping_zip', 'shipping_country_code')
    );
    expect(order?.shipping_city).toBeNull();
    expect(order?.shipping_zip).toBeNull();
    expect(order?.shipping_country_code).toBeNull();

    // Blocked orders never reach the releasable pool.
    expect(await poolIds(token)).not.toContain(orderId);
  }, 180_000);
});

// ── ADDR-DEC-02 ────────────────────────────────────────────────────────────

describe('ADDR-DEC-02 — the decision endpoint reports the customer blocker truthfully', () => {
  it('returns the active customer constraint with or without decision enrichment, and never awaiting_payment', async () => {
    const { shopId, token } = await provisionFt2Shop('dec02');
    const { orderId } = await ingestPaidOrder({ shopId, shippingAddress: INCOMPLETE_ADDRESS });

    const res = await getDecision(token, orderId);

    // BL-15: constraints are truth, decisions are enrichment. A missing or
    // stale decision must never suppress a real constraint, so the route must
    // answer 200 with the constraint rather than 404.
    expect(res.status).toBe(200);
    expect(res.body.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_type: 'customer', block_type: 'incomplete_address' }),
      ])
    );

    // Decision enrichment is ABSENT here by construction: reconciliation
    // dispatches a RECONCILIATION_RUN command and stops, and no commands
    // consumer runs in this suite — so `decisions` is genuinely empty and the
    // route is answering from constraints alone. That is the contract.
    expect(res.body.decision).toBeNull();

    // awaiting_payment is not a reachable blocker on a paid order.
    expect(JSON.stringify(res.body)).not.toContain('awaiting_payment');
    expect(
      res.body.constraints.filter((c: { block_type: string }) => c.block_type === 'awaiting_payment')
    ).toEqual([]);

    /**
     * CANONICAL DECISION DERIVATION — no worker started.
     *
     * generateDecisions (domain/decision/decision.engine.ts) is the single
     * decision authority; commands.consumer.ts is only its runtime caller.
     * The real reconciliation dispatcher already persisted a
     * RECONCILIATION_RUN command for this order carrying the genuine
     * riskSnapshot derived from real constraint evaluation, so feeding that
     * exact payload into the engine — merging isAlreadyFulfilled the same way
     * commands.consumer.ts does — exercises the customer decision branch on
     * real runtime signals rather than a hand-built input.
     */
    const command = await reconciliationCommandPayload(shopId, orderId);
    expect(command).toBeTruthy();
    expect(command!.payload.riskSnapshot).toBeTruthy();

    // The signal the engine branches on is the real one, not one we supplied.
    expect(command!.payload.riskSnapshot.is_customer_blocked).toBe(true);

    const decisions = generateDecisions({
      orderId: command!.payload.orderId,
      shopId: command!.payload.shopId,
      aggregateVersion: command!.payload.aggregateVersion,
      riskSnapshot: {
        ...command!.payload.riskSnapshot,
        is_already_fulfilled: command!.payload.isAlreadyFulfilled,
      } as never,
    });

    const customerDecisions = decisions.filter(
      (d) => d.recommended_action?.type === 'resolve_customer_block'
    );
    expect(customerDecisions).toHaveLength(1);

    // Unconditional: the generated customer decision's shape is the contract.
    const customerDecision = customerDecisions[0];
    expect(customerDecision.recommended_action.type).toBe('resolve_customer_block');
    expect(customerDecision.recommended_action.execution_mode).toBe('manual');

    // A customer decision must never be derived from, or describe, payment state.
    expect(JSON.stringify(decisions)).not.toContain('awaiting_payment');
  }, 180_000);
});

// ── ADDR-DEC-03 ────────────────────────────────────────────────────────────

describe('ADDR-DEC-03 — correcting the address through the real route clears the blocker', () => {
  it('persists, advances aggregate_version once, emits the correction event, and resolves the constraint on projection', async () => {
    const { shopId, token } = await provisionFt2Shop('dec03');
    const { orderId, externalOrderId } = await ingestPaidOrder({
      shopId,
      shippingAddress: INCOMPLETE_ADDRESS,
    });

    expect(activeOf(await constraintsFor(shopId, orderId))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_type: 'customer', block_type: 'incomplete_address' }),
      ])
    );

    const versionBefore = await aggregateVersion(shopId, orderId);
    const eventWatermark = await maxEventId(shopId);

    const patch = await patchAddress(token, orderId, COMPLETE_PATCH);
    expect(patch.status).toBe(200);

    // Address persisted exactly as submitted.
    const corrected = await withTenant(shopId, (trx) =>
      trx('orders')
        .where({ lasyncro_order_id: orderId })
        .first('shipping_address1', 'shipping_city', 'shipping_zip', 'shipping_country_code')
    );
    expect(corrected).toMatchObject({
      shipping_address1: COMPLETE_PATCH.address1,
      shipping_city: COMPLETE_PATCH.city,
      shipping_zip: COMPLETE_PATCH.zip,
      shipping_country_code: COMPLETE_PATCH.countryCode,
    });

    // Exactly one version advance for the logical correction.
    expect(await aggregateVersion(shopId, orderId)).toBe(versionBefore + 1);

    // The correction emitted a real domain event carrying the external id.
    const emitted = await correctionEvents(shopId, externalOrderId, eventWatermark);
    expect(emitted).toHaveLength(1);
    expect(String(emitted[0].event_payload.id)).toBe(externalOrderId);

    // Process it through the same projection seam the worker uses.
    await projectEvent(shopId, Number(emitted[0].id));

    // The canonical constraint is resolved by the real projection, not by us.
    const after = await constraintsFor(shopId, orderId);
    const customerRows = after.filter((c) => c.constraint_type === 'customer');
    expect(customerRows.length).toBeGreaterThanOrEqual(1);
    for (const row of customerRows) {
      expect(row.is_active).toBe(false);
      expect(row.resolved_at).toBeTruthy();
    }
    expect(activeOf(after).filter((c) => c.constraint_type === 'customer')).toEqual([]);

    // The decision response stops reporting the customer constraint. With no
    // other blocker and no decision the route legitimately 404s ("no decision
    // AND no constraint"); a 200 must simply not carry a customer row.
    const decision = await getDecision(token, orderId);
    expect([200, 404]).toContain(decision.status);
    if (decision.status === 200) {
      expect(
        (decision.body.constraints ?? []).filter(
          (c: { constraint_type: string }) => c.constraint_type === 'customer'
        )
      ).toEqual([]);
    }

    // Unblocked and back in its normal downstream flow.
    expect(activeOf(after)).toEqual([]);
    expect(await poolIds(token)).toContain(orderId);
  }, 180_000);
});

// ── ADDR-DEC-04 ────────────────────────────────────────────────────────────

describe('ADDR-DEC-04 — a coexisting blocker survives the customer correction', () => {
  it('resolves customer/incomplete_address while a real inventory blocker stays active and the order stays blocked', async () => {
    const { shopId, token } = await provisionFt2Shop('dec04');
    const { orderId, externalOrderId } = await ingestPaidOrder({
      shopId,
      shippingAddress: INCOMPLETE_ADDRESS,
    });

    // Genuine oversell on this order's own variants — the same canonical
    // inventory fixture shape the SLA decision contract uses: strip pickable
    // availability so evaluateInventoryConstraint derives the block from
    // inventory_truth rather than from a hand-written constraint row.
    await withTenant(shopId, async (trx) => {
      const variants = await trx('order_revenue_units')
        .where({ lasyncro_order_id: orderId })
        .distinct('lasyncro_variant_id')
        .pluck('lasyncro_variant_id');
      expect(variants.length).toBeGreaterThanOrEqual(1);
      await trx('inventory_truth')
        .where({ shop_id: shopId })
        .whereIn('lasyncro_variant_id', variants)
        .update({ available_quantity: 0 });
    });

    // Re-evaluate through a real order-entity event so both evaluators run.
    const reeval = await insertEvent(shopId, 'orders/constraints_reevaluated', { id: externalOrderId });
    await projectEvent(shopId, reeval);

    const before = activeOf(await constraintsFor(shopId, orderId));
    expect(before).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_type: 'customer', block_type: 'incomplete_address' }),
        expect.objectContaining({ constraint_type: 'inventory', block_type: 'oversell' }),
      ])
    );

    const watermark = await maxEventId(shopId);
    const patch = await patchAddress(token, orderId, COMPLETE_PATCH);
    expect(patch.status).toBe(200);

    const emitted = await correctionEvents(shopId, externalOrderId, watermark);
    expect(emitted).toHaveLength(1);
    await projectEvent(shopId, Number(emitted[0].id));

    const after = await constraintsFor(shopId, orderId);

    // Customer blocker cleared…
    expect(activeOf(after).filter((c) => c.constraint_type === 'customer')).toEqual([]);

    // …and the unrelated blocker is untouched. Correcting customer data must
    // never clear another constraint type.
    expect(activeOf(after)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_type: 'inventory', block_type: 'oversell', is_active: true }),
      ])
    );

    // The order is still blocked, so it stays out of the releasable pool.
    expect(activeOf(after).length).toBeGreaterThanOrEqual(1);
    expect(await poolIds(token)).not.toContain(orderId);
  }, 180_000);
});

// ── ADDR-DEC-05 ────────────────────────────────────────────────────────────


// ── ADDR-ASSIST-01..06 — Address Assist v1 (RED: feature not implemented) ───
//
// Approved Order Detail response contract:
//
//   addressAssist: {
//     source: "historical_fulfilled_orders",
//     candidate: { address1, address2, city, zip, province, countryCode },
//     usageCount,
//     lastUsedAt
//   } | null
//
// Evidence must come from the SAME customer's own complete, fulfilled,
// same-tenant historical orders. The blocked order itself is never evidence.

/** Ingestion's own identity derivation: sha256(`${shopId}:${customerId}`). */
function customerHash(shopId: number, customerId: string): string {
  return crypto.createHash('sha256').update(`${shopId}:${customerId}`).digest('hex');
}

const COMPLETE_HISTORICAL_ADDRESS = {
  name: 'Jane Doe',
  address1: '221B Baker Street',
  address2: 'Flat 2',
  city: 'London',
  zip: 'NW1 6XE',
  provinceCode: 'Greater London',
  country_code: 'GB',
};

/**
 * Marks a genuinely persisted order fulfilled through the projection-guarded
 * table — order_fulfillment_status is single-writer enforced (migration 0076),
 * the same guard the ADDR-DEC-05 fixture above uses.
 */
async function markFulfilled(shopId: number, orderId: string, fulfilledAt: Date) {
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    const updated = await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: orderId })
      .update({ status: 'fulfilled', fulfilled_at: fulfilledAt });
    expect(updated).toBeGreaterThanOrEqual(1);
  });
}

/** Forces a customer identity onto an order (cross-tenant isolation fixture). */
async function forceCustomerHash(shopId: number, orderId: string, hash: string) {
  await withTenant(shopId, (trx) =>
    trx('orders').where({ lasyncro_order_id: orderId }).update({ customer_hashed_id: hash })
  );
}

/** Seeds one complete, fulfilled historical order for a customer. */
async function seedHistoricalFulfilled(input: {
  shopId: number;
  customerId?: string;
  forcedHash?: string;
  address: Record<string, unknown>;
  fulfilledAt: Date;
}): Promise<string> {
  const { shopId, customerId, forcedHash, address, fulfilledAt } = input;
  const { orderId } = await ingestPaidOrder({
    shopId,
    shippingAddress: address,
    customerId,
  });
  if (forcedHash) await forceCustomerHash(shopId, orderId, forcedHash);
  await markFulfilled(shopId, orderId, fulfilledAt);
  return orderId;
}

const getOrderDetail = (token: string, orderId: string) =>
  request(app).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${token}`);

/** The blocked order every assist scenario is anchored on. */
async function seedBlockedOrderForCustomer(shopId: number, customerId: string) {
  const { orderId } = await ingestPaidOrder({
    shopId,
    shippingAddress: INCOMPLETE_ADDRESS,
    customerId,
  });
  const active = activeOf(await constraintsFor(shopId, orderId));
  expect(active).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ constraint_type: 'customer', block_type: 'incomplete_address' }),
    ])
  );
  return orderId;
}

describe('ADDR-ASSIST-01 — historical fulfilled address is offered as evidence', () => {
  it('returns the same customer’s complete fulfilled historical address, and null without an active blocker', async () => {
    const { shopId, token } = await provisionFt2Shop('assist01');
    const customerId = '7001';

    const historicalId = await seedHistoricalFulfilled({
      shopId,
      customerId,
      address: COMPLETE_HISTORICAL_ADDRESS,
      fulfilledAt: new Date('2026-08-01T10:00:00.000Z'),
    });

    const blockedId = await seedBlockedOrderForCustomer(shopId, customerId);

    const res = await getOrderDetail(token, blockedId);
    expect(res.status).toBe(200);

    expect(res.body.addressAssist).toEqual(
      expect.objectContaining({
        source: 'historical_fulfilled_orders',
        usageCount: 1,
        lastUsedAt: expect.any(String),
        candidate: expect.objectContaining({
          address1: '221B Baker Street',
          address2: 'Flat 2',
          city: 'London',
          zip: 'NW1 6XE',
          province: 'Greater London',
          countryCode: 'GB',
        }),
      })
    );

    // The blocked order itself is never evidence.
    expect(res.body.addressAssist.candidate.address1).not.toBe(INCOMPLETE_ADDRESS.address1);

    // An otherwise eligible order with NO active customer/incomplete_address
    // constraint gets no assist at all.
    const healthyRes = await getOrderDetail(token, historicalId);
    expect(healthyRes.status).toBe(200);
    expect(healthyRes.body.addressAssist).toBeNull();
  }, 240_000);
});

describe('ADDR-ASSIST-02 — evidence is customer- and tenant-isolated', () => {
  it('excludes another customer in the same tenant and an identical hash in another tenant', async () => {
    const { shopId, token } = await provisionFt2Shop('assist02');
    const customerId = '7002';

    // Same tenant, DIFFERENT customer — must never be borrowed.
    await seedHistoricalFulfilled({
      shopId,
      customerId: '9999',
      address: { ...COMPLETE_HISTORICAL_ADDRESS, address1: '1 Other Person Way' },
      fulfilledAt: new Date('2026-08-20T10:00:00.000Z'),
    });

    // Another tenant, SAME customer_hashed_id forced — real RLS must exclude it.
    const foreign = await provisionFt2Shop('assist02-foreign');
    await seedHistoricalFulfilled({
      shopId: foreign.shopId,
      forcedHash: customerHash(shopId, customerId),
      address: { ...COMPLETE_HISTORICAL_ADDRESS, address1: '2 Foreign Tenant Road' },
      fulfilledAt: new Date('2026-08-25T10:00:00.000Z'),
    });

    const blockedId = await seedBlockedOrderForCustomer(shopId, customerId);

    const res = await getOrderDetail(token, blockedId);
    expect(res.status).toBe(200);

    // No eligible same-customer, same-tenant evidence exists.
    expect(res.body.addressAssist).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('1 Other Person Way');
    expect(JSON.stringify(res.body)).not.toContain('2 Foreign Tenant Road');
  }, 300_000);
});

describe('ADDR-ASSIST-03 — unfulfilled history is not evidence', () => {
  it('excludes a complete but never-fulfilled historical order', async () => {
    const { shopId, token } = await provisionFt2Shop('assist03');
    const customerId = '7003';

    // Complete address, same customer, but deliberately NOT fulfilled.
    await ingestPaidOrder({
      shopId,
      shippingAddress: { ...COMPLETE_HISTORICAL_ADDRESS, address1: '3 Never Shipped Lane' },
      customerId,
    });

    const blockedId = await seedBlockedOrderForCustomer(shopId, customerId);

    const res = await getOrderDetail(token, blockedId);
    expect(res.status).toBe(200);
    expect(res.body.addressAssist).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('3 Never Shipped Lane');
  }, 240_000);
});

describe('ADDR-ASSIST-04 — incomplete history is not evidence', () => {
  it.each([
    ['address1', { address1: null }],
    ['city', { city: null }],
    ['zip', { zip: null }],
    ['countryCode', { country_code: null }],
  ])('excludes a fulfilled historical order missing %s', async (_field, override) => {
    const { shopId, token } = await provisionFt2Shop(`assist04-${_field.toLowerCase()}`);
    const customerId = '7004';

    await seedHistoricalFulfilled({
      shopId,
      customerId,
      address: { ...COMPLETE_HISTORICAL_ADDRESS, ...override },
      fulfilledAt: new Date('2026-08-05T10:00:00.000Z'),
    });

    const blockedId = await seedBlockedOrderForCustomer(shopId, customerId);

    const res = await getOrderDetail(token, blockedId);
    expect(res.status).toBe(200);
    expect(res.body.addressAssist).toBeNull();
  }, 240_000);
});

describe('ADDR-ASSIST-05 — ranking and provenance are deterministic', () => {
  it('ranks by usageCount, then most recent fulfilled_at, and normalises for grouping only', async () => {
    const { shopId, token } = await provisionFt2Shop('assist05');
    const customerId = '7005';

    // WINNING GROUP — three eligible orders that normalise to one address:
    // surrounding whitespace, collapsed internal whitespace, mixed case, and
    // null-vs-empty optional fields are all equivalent for grouping.
    await seedHistoricalFulfilled({
      shopId, customerId, fulfilledAt: new Date('2026-08-01T10:00:00.000Z'),
      address: {
        ...COMPLETE_HISTORICAL_ADDRESS,
        address1: '10 Repeat Street', address2: null,
        city: 'Manchester', zip: 'M1 2AB', province: null, country_code: 'GB',
      },
    });
    await seedHistoricalFulfilled({
      shopId, customerId, fulfilledAt: new Date('2026-08-02T10:00:00.000Z'),
      address: {
        ...COMPLETE_HISTORICAL_ADDRESS,
        address1: '  10   repeat   street  ', address2: '',
        city: ' MANCHESTER ', zip: ' m1 2ab ', province: '', country_code: 'gb',
      },
    });
    // Most recently fulfilled member of the winning group — the returned
    // candidate must come from THIS row, trimmed, with countryCode uppercased.
    await seedHistoricalFulfilled({
      shopId, customerId, fulfilledAt: new Date('2026-08-09T10:00:00.000Z'),
      address: {
        ...COMPLETE_HISTORICAL_ADDRESS,
        address1: ' 10 Repeat Street ', address2: null,
        city: 'Manchester ', zip: 'M1 2AB', province: null, country_code: 'gb',
      },
    });

    // LOSING GROUP — more recent, but used only twice.
    await seedHistoricalFulfilled({
      shopId, customerId, fulfilledAt: new Date('2026-08-20T10:00:00.000Z'),
      address: {
        ...COMPLETE_HISTORICAL_ADDRESS,
        address1: '99 Recent Road', address2: null,
        city: 'Leeds', zip: 'LS1 4AB', province: null, country_code: 'GB',
      },
    });
    await seedHistoricalFulfilled({
      shopId, customerId, fulfilledAt: new Date('2026-08-21T10:00:00.000Z'),
      address: {
        ...COMPLETE_HISTORICAL_ADDRESS,
        address1: '99 Recent Road', address2: null,
        city: 'Leeds', zip: 'LS1 4AB', province: null, country_code: 'GB',
      },
    });

    const blockedId = await seedBlockedOrderForCustomer(shopId, customerId);

    const res = await getOrderDetail(token, blockedId);
    expect(res.status).toBe(200);

    const assist = res.body.addressAssist;
    expect(assist).toBeTruthy();
    expect(assist.source).toBe('historical_fulfilled_orders');

    // Highest usageCount wins outright, even though the loser is more recent.
    expect(assist.usageCount).toBe(3);
    expect(assist.candidate.address1).toBe('10 Repeat Street');
    expect(assist.candidate.city).toBe('Manchester');
    expect(assist.candidate.zip).toBe('M1 2AB');
    // Returned strings are trimmed; countryCode is uppercased.
    expect(assist.candidate.countryCode).toBe('GB');
    // lastUsedAt is the maximum fulfilled_at within the winning group.
    expect(new Date(assist.lastUsedAt).toISOString()).toBe('2026-08-09T10:00:00.000Z');
  }, 300_000);
});

describe('ADDR-ASSIST-05b — recency breaks a usageCount tie', () => {
  it('ranks the more recently fulfilled group first when usageCount is equal, and takes provenance from its newest row', async () => {
    const { shopId, token } = await provisionFt2Shop('assist05b');
    const customerId = '7015';

    // GROUP A — twice used, most recent fulfilment 2026-08-15.
    // The two members normalise to one address (whitespace/case only), so the
    // display values must come from the NEWEST member below.
    await seedHistoricalFulfilled({
      shopId, customerId, fulfilledAt: new Date('2026-08-03T10:00:00.000Z'),
      address: {
        ...COMPLETE_HISTORICAL_ADDRESS,
        address1: '  12   winner   way  ', address2: null,
        city: ' sheffield ', zip: ' s1 2cd ', province: null, country_code: 'gb',
      },
    });
    await seedHistoricalFulfilled({
      shopId, customerId, fulfilledAt: new Date('2026-08-15T10:00:00.000Z'),
      address: {
        ...COMPLETE_HISTORICAL_ADDRESS,
        address1: '12 Winner Way', address2: null,
        city: 'Sheffield', zip: 'S1 2CD', province: null, country_code: 'GB',
      },
    });

    // GROUP B — also twice used, but its most recent fulfilment is older.
    await seedHistoricalFulfilled({
      shopId, customerId, fulfilledAt: new Date('2026-08-04T10:00:00.000Z'),
      address: {
        ...COMPLETE_HISTORICAL_ADDRESS,
        address1: '13 Older Way', address2: null,
        city: 'Sheffield', zip: 'S1 3EF', province: null, country_code: 'GB',
      },
    });
    await seedHistoricalFulfilled({
      shopId, customerId, fulfilledAt: new Date('2026-08-10T10:00:00.000Z'),
      address: {
        ...COMPLETE_HISTORICAL_ADDRESS,
        address1: '13 Older Way', address2: null,
        city: 'Sheffield', zip: 'S1 3EF', province: null, country_code: 'GB',
      },
    });

    const blockedId = await seedBlockedOrderForCustomer(shopId, customerId);

    const res = await getOrderDetail(token, blockedId);
    expect(res.status).toBe(200);

    const assist = res.body.addressAssist;
    expect(assist).toBeTruthy();
    expect(assist.source).toBe('historical_fulfilled_orders');

    // The tie is real: both groups were used exactly twice.
    expect(assist.usageCount).toBe(2);

    // Recency decides, and provenance is the newest row of the winning group.
    expect(assist.candidate.address1).toBe('12 Winner Way');
    expect(assist.candidate.city).toBe('Sheffield');
    expect(assist.candidate.zip).toBe('S1 2CD');
    expect(assist.candidate.countryCode).toBe('GB');
    expect(new Date(assist.lastUsedAt).toISOString()).toBe('2026-08-15T10:00:00.000Z');

    // The older group is not offered.
    expect(assist.candidate.address1).not.toBe('13 Older Way');
    expect(assist.candidate.zip).not.toBe('S1 3EF');
  }, 300_000);
});

describe('ADDR-ASSIST-05c — normalized fingerprint is the final tie-break', () => {
  it('ranks the lexicographically smaller normalized fingerprint first when usageCount and fulfilled_at are both equal', async () => {
    const { shopId, token } = await provisionFt2Shop('assist05c');
    const customerId = '7016';

    // Every eligible row shares this exact fulfilment instant, so usageCount and
    // recency are both tied and only the normalized fingerprint can decide.
    const sharedFulfilledAt = new Date('2026-08-18T10:00:00.000Z');

    // GROUP A — normalizes to ["1 alpha avenue","","bristol","bs1 1aa","","gb"].
    const alphaAddress = {
      ...COMPLETE_HISTORICAL_ADDRESS,
      address1: '1 Alpha Avenue', address2: null,
      city: 'Bristol', zip: 'BS1 1AA', province: null, country_code: 'GB',
    };
    // GROUP B — identical except address1, which sorts strictly after 'alpha'.
    const zuluAddress = {
      ...COMPLETE_HISTORICAL_ADDRESS,
      address1: '1 Zulu Avenue', address2: null,
      city: 'Bristol', zip: 'BS1 1AA', province: null, country_code: 'GB',
    };

    // Seeded loser-first so insertion order cannot be mistaken for the reason
    // the winner is chosen.
    await seedHistoricalFulfilled({ shopId, customerId, address: zuluAddress, fulfilledAt: sharedFulfilledAt });
    await seedHistoricalFulfilled({ shopId, customerId, address: alphaAddress, fulfilledAt: sharedFulfilledAt });
    await seedHistoricalFulfilled({ shopId, customerId, address: zuluAddress, fulfilledAt: sharedFulfilledAt });
    await seedHistoricalFulfilled({ shopId, customerId, address: alphaAddress, fulfilledAt: sharedFulfilledAt });

    const blockedId = await seedBlockedOrderForCustomer(shopId, customerId);

    const res = await getOrderDetail(token, blockedId);
    expect(res.status).toBe(200);

    const assist = res.body.addressAssist;
    expect(assist).toBeTruthy();
    expect(assist.source).toBe('historical_fulfilled_orders');

    // Both prior criteria really are tied.
    expect(assist.usageCount).toBe(2);
    expect(new Date(assist.lastUsedAt).toISOString()).toBe(sharedFulfilledAt.toISOString());

    // The lexicographically smaller normalized fingerprint wins.
    expect(assist.candidate.address1).toBe('1 Alpha Avenue');
    expect(assist.candidate.city).toBe('Bristol');
    expect(assist.candidate.zip).toBe('BS1 1AA');
    expect(assist.candidate.countryCode).toBe('GB');
    expect(assist.candidate.address1).not.toBe('1 Zulu Avenue');
  }, 300_000);
});

describe('ADDR-ASSIST-06 — evidence retrieval is strictly read-only', () => {
  it('changes no order version, constraint, event or shipping field', async () => {
    const { shopId, token } = await provisionFt2Shop('assist06');
    const customerId = '7006';

    await seedHistoricalFulfilled({
      shopId,
      customerId,
      address: COMPLETE_HISTORICAL_ADDRESS,
      fulfilledAt: new Date('2026-08-11T10:00:00.000Z'),
    });
    const blockedId = await seedBlockedOrderForCustomer(shopId, customerId);

    const snapshot = async () => ({
      version: await aggregateVersion(shopId, blockedId),
      eventWatermark: await maxEventId(shopId),
      eventCount: Number(
        (await withTenant(shopId, (trx) =>
          trx('domain_events').where({ shop_id: shopId }).count<{ count: string }>('* as count').first()
        ))?.count ?? 0
      ),
      constraints: JSON.stringify(await constraintsFor(shopId, blockedId)),
      shipping: JSON.stringify(
        await withTenant(shopId, (trx) =>
          trx('orders')
            .where({ lasyncro_order_id: blockedId })
            .first(
              'shipping_address1', 'shipping_address2', 'shipping_city',
              'shipping_zip', 'shipping_province', 'shipping_country_code'
            )
        )
      ),
    });

    const before = await snapshot();

    const res = await getOrderDetail(token, blockedId);
    expect(res.status).toBe(200);
    expect(res.body.addressAssist).toBeTruthy();

    const after = await snapshot();

    expect(after.version).toBe(before.version);
    expect(after.eventWatermark).toBe(before.eventWatermark);
    expect(after.eventCount).toBe(before.eventCount);
    expect(after.constraints).toBe(before.constraints);
    expect(after.shipping).toBe(before.shipping);
  }, 240_000);
});

describe('ADDR-DEC-05 — awaiting_payment is unreachable for paid orders', () => {
  it('writes no customer/awaiting_payment row for any order in this suite, and the live evaluator never returns one', async () => {
    expect(provisionedShopIds.length).toBeGreaterThanOrEqual(4); // ADDR-DEC-01..04 ran

    // Every order_constraints row this suite's shops ever produced — active or
    // resolved. block_type is free text at the DB level, so a stray writer
    // would show up here rather than being rejected by an enum.
    for (const shopId of provisionedShopIds) {
      const rows = await withTenant(shopId, (trx) =>
        trx('order_constraints as oc')
          .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
          .where('o.shop_id', shopId)
          .select('oc.constraint_type', 'oc.block_type', 'oc.is_active')
      );
      expect(rows.filter((r) => r.block_type === 'awaiting_payment')).toEqual([]);
      expect(
        rows.filter((r) => r.constraint_type === 'customer' && r.block_type === 'awaiting_payment')
      ).toEqual([]);
    }

    // And the live evaluation path itself: a freshly ingested PAID order with
    // an incomplete address yields incomplete_address, never awaiting_payment.
    const { shopId } = await provisionFt2Shop('dec05');
    const { orderId } = await ingestPaidOrder({ shopId, shippingAddress: INCOMPLETE_ADDRESS });

    const evaluations = await withTenant(shopId, (trx) =>
      evaluateOrderConstraints(trx, orderId, shopId)
    );

    const customer = evaluations.filter((e) => e.type === 'customer');
    expect(customer.length).toBeGreaterThanOrEqual(1);
    expect(customer.map((e) => e.meta?.blockType)).not.toContain('awaiting_payment');
    expect(customer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'customer',
          isActive: true,
          meta: expect.objectContaining({ blockType: 'incomplete_address' }),
        }),
      ])
    );
    expect(
      evaluations.filter((e) => e.meta?.blockType === 'awaiting_payment')
    ).toEqual([]);

    // A complete address on a paid order yields no customer block at all —
    // proving the evaluator's only customer signal is address completeness.
    const { orderId: healthyId } = await ingestPaidOrder({
      shopId,
      shippingAddress: { name: 'Jane Doe', address1: '1 Test St', city: 'Testville', zip: '00000', country_code: 'US' },
    });
    const healthy = await withTenant(shopId, (trx) =>
      evaluateOrderConstraints(trx, healthyId, shopId)
    );
    expect(healthy.filter((e) => e.type === 'customer' && e.isActive)).toEqual([]);
  }, 240_000);
});
