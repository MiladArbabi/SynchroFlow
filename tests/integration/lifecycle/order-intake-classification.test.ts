/**
 * SHOP-REVIEW-ORDER-INTAKE-CLASSIFICATION-10 — Slice B.
 *
 * The ingestion boundary: a Shopify record that cannot become a
 * warehouse-executable order is classified explicitly during projection
 * (order_intake_exceptions), NOT silently lost, NOT turned into an operational
 * Blocked order, NOT admitted to Order Pool.
 *
 *   SOURCE_NON_WMS            legitimate source shape with no warehouse identity
 *                             (custom line / deleted variant → variant:null)
 *   INGESTION_INTEGRITY_ERROR Shopify supplied a variant id laSyncro cannot
 *                             resolve — stays fail-closed (throw + rollback);
 *                             diagnostics only, no row persisted in Slice B.
 *
 * Real domain events are projected through the engine so orders.create.ts is
 * genuinely exercised. Disposable synchroflow_test_* DB only
 * (`npm run test:integration`).
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
import { projectDomainEventCore } from 'api-src/projection/projection.engine';
import { issueTestToken } from '../../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── helpers ─────────────────────────────────────────────────────────────────

async function hmacInstall(shopDomain: string): Promise<{ shopId: number; userId: number }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params).sort()
    .map((k) => `${k}=${params[k as keyof typeof params]}`).join('&');
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(message).digest('hex');
  const install = await request(app)
    .get('/api/v1/integrations/shopify/install').query({ ...params, hmac }).redirects(0);
  expect(install.status).toBe(302);
  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value',
      [`shopify-install+${shopDomain}@lasyncro.internal`])
  );
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).andWhere('id', '>', afterId)
      .orderBy('id', 'asc').select('id')
  );
  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }
  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

/** Install + seed healthy reviewer-shaped data + drive the ladder to FT2. */
async function provisionFt2Shop(label: string) {
  const shopDomain = `intake-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
      access_token_encrypted: encrypt('offline-test-token-no-network-call'),
      sync_status: 'COMPLETED', updated_at: new Date(),
    })
  );
  let c = 0;
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  const atFt1 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt1?.phase).toBe('FT1');
  const token = issueTestToken({ userId, shopId });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);
  const atFt2 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt2?.phase).toBe('FT2');
  return { shopId, userId, token };
}

/** Install + seed products/variants only (no FT2). */
async function provisionSeededShop(label: string) {
  const shopDomain = `intake-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  await seedFreshInstall(shopId);
  await pumpEvents(shopId); // project the seeded products so variants exist
  return { shopId, userId };
}

/** A real, mapped variant's numeric external id (mapper strips the gid). */
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

/** Insert an orders/create domain event (Shopify REST snake_case). */
async function insertOrdersCreateEvent(
  shopId: number,
  lineItems: Array<Record<string, unknown>>,
  externalOrderId?: string
): Promise<{ eventId: number; externalOrderId: string }> {
  const extId = externalOrderId ?? `${shopId}${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const [row] = await withTenant(shopId, (trx) =>
    trx('domain_events').insert({
      shop_id: shopId,
      event_type: 'orders/create',
      event_payload: {
        id: extId,
        currency: 'USD',
        total_price: 42,
        subtotal_price: 42,
        total_tax: 0,
        displayFinancialStatus: 'PAID',
        displayFulfillmentStatus: 'UNFULFILLED',
        shipping_address: {
          address1: '1 Test St', city: 'Testville', zip: '00000', country_code: 'US',
        },
        line_items: lineItems,
      },
      event_time: new Date(),
      event_version: 1,
      external_event_id: `test:intake:${shopId}:${extId}:${Math.random()}`,
    }).returning(['id'])
  );
  return { eventId: Number(row.id), externalOrderId: extId };
}

async function projectEvent(shopId: number, eventId: number): Promise<void> {
  await runWithTenantContext(shopId, () => processDomainEvent(eventId));
}

function lasyncroOrderIdFor(shopId: number, externalOrderId: string): string {
  const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  return crypto.createHash('sha1')
    .update(`${NS}:${shopId}:shopify:${externalOrderId}`)
    .digest('hex').slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
}

const q = (shopId: number) => <T = any>(fn: (trx: any) => Promise<T>) => withTenant(shopId, fn);

// ── B1 — null variant / only line ──────────────────────────────────────────

describe('B1 / null-variant-only order → SOURCE_NON_WMS intake exception, not READY', () => {
  it('persists the order for traceability, zero usable lines, an explicit intake exception, no constraint, absent from Order Pool', async () => {
    const { shopId, token } = await provisionFt2Shop('b1');
    const { eventId, externalOrderId } = await insertOrdersCreateEvent(shopId, [
      { id: '111', quantity: 2, price: '21.00' }, // no variant_id, no product_id
    ]);
    await projectEvent(shopId, eventId);
    const orderId = lasyncroOrderIdFor(shopId, externalOrderId);

    const order = await q(shopId)((trx) => trx('orders').where({ lasyncro_order_id: orderId }).first());
    expect(order).toBeTruthy(); // traceability retained

    const lines = await q(shopId)((trx) => trx('order_line_items').where({ lasyncro_order_id: orderId }));
    expect(lines).toHaveLength(0);

    const exc = await q(shopId)((trx) => trx('order_intake_exceptions').where({ lasyncro_order_id: orderId }).first());
    expect(exc).toBeTruthy();
    expect(exc.exception_kind).toBe('SOURCE_NON_WMS');
    expect(exc.reason_code).toBe('NO_USABLE_WMS_LINES');
    expect(Number(exc.source_line_count)).toBe(1);
    expect(Number(exc.usable_line_count)).toBe(0);
    expect(exc.resolved_at).toBeNull();

    const constraints = await q(shopId)((trx) =>
      trx('order_constraints').where({ lasyncro_order_id: orderId, is_active: true }));
    expect(constraints).toHaveLength(0);

    const pool = await request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
    expect(pool.status).toBe(200);
    const ids = pool.body.orders.map((o: any) => o.lasyncro_order_id);
    expect(ids).not.toContain(orderId);
  }, 120_000);
});

// ── B2 — custom / non-WMS-like line ────────────────────────────────────────

describe('B2 / custom Shopify line with no variant → SOURCE_NON_WMS, no fabrication, not READY', () => {
  it('classifies SOURCE_NON_WMS, fabricates no variant, writes no operational Blocked row', async () => {
    const { shopId, token } = await provisionFt2Shop('b2');
    const { eventId, externalOrderId } = await insertOrdersCreateEvent(shopId, [
      { id: '222', title: 'Gift wrapping (custom)', quantity: 1, price: '5.00' },
    ]);
    await projectEvent(shopId, eventId);
    const orderId = lasyncroOrderIdFor(shopId, externalOrderId);

    const lines = await q(shopId)((trx) => trx('order_line_items').where({ lasyncro_order_id: orderId }));
    expect(lines).toHaveLength(0); // nothing fabricated

    const exc = await q(shopId)((trx) => trx('order_intake_exceptions').where({ lasyncro_order_id: orderId }).first());
    expect(exc?.exception_kind).toBe('SOURCE_NON_WMS');

    const constraints = await q(shopId)((trx) =>
      trx('order_constraints').where({ lasyncro_order_id: orderId, is_active: true }));
    expect(constraints).toHaveLength(0);

    const pool = await request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
    expect(pool.body.orders.map((o: any) => o.lasyncro_order_id)).not.toContain(orderId);
  }, 120_000);
});

// ── B3 — partial order (fail closed) ───────────────────────────────────────

describe('B3 / partially-mapped order → intake exception + NOT READY (fail closed)', () => {
  it('persists the mapped line, records PARTIALLY_MAPPED, keeps the order out of Order Pool', async () => {
    const { shopId, token } = await provisionFt2Shop('b3');
    const variantId = await seededVariantNumericId(shopId);
    const { eventId, externalOrderId } = await insertOrdersCreateEvent(shopId, [
      { id: '333a', variant_id: variantId, quantity: 1, price: '20.00' }, // mapped
      { id: '333b', quantity: 1, price: '22.00' },                        // null variant
    ]);
    await projectEvent(shopId, eventId);
    const orderId = lasyncroOrderIdFor(shopId, externalOrderId);

    const lines = await q(shopId)((trx) => trx('order_line_items').where({ lasyncro_order_id: orderId }));
    expect(lines).toHaveLength(1); // the mapped line persists

    const exc = await q(shopId)((trx) => trx('order_intake_exceptions').where({ lasyncro_order_id: orderId }).first());
    expect(exc).toBeTruthy();
    expect(exc.exception_kind).toBe('SOURCE_NON_WMS');
    expect(exc.reason_code).toBe('PARTIALLY_MAPPED');
    expect(Number(exc.source_line_count)).toBe(2);
    expect(Number(exc.usable_line_count)).toBe(1);

    const constraints = await q(shopId)((trx) =>
      trx('order_constraints').where({ lasyncro_order_id: orderId, is_active: true }));
    expect(constraints).toHaveLength(0);

    const pool = await request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
    expect(pool.body.orders.map((o: any) => o.lasyncro_order_id)).not.toContain(orderId);
    // ready count stays in lockstep with the returned rows
    expect(pool.body.summary.ready_for_release_count).toBe(pool.body.orders.length);

    // ── B3 DIRECT RELEASE PROOF ─────────────────────────────────────────────
    // A partially-mapped order must not bypass Order Pool through the direct
    // Release API either: POST /api/v1/wms/batch/release classifies it
    // `intake_exception` and mutates nothing.
    const snap = () =>
      withTenant(shopId, async (trx) => ({
        batches: Number(
          (await trx('pick_batches').where({ shop_id: shopId })
            .count<{ count: string }>('* as count').first())?.count ?? 0
        ),
        holds: Number(
          (await trx('inventory_movements')
            .where({ shop_id: shopId, movement_type: 'reservation_hold' })
            .count<{ count: string }>('* as count').first())?.count ?? 0
        ),
        truth: JSON.stringify(
          await trx('inventory_truth').where({ shop_id: shopId })
            .orderBy(['lasyncro_variant_id', 'location_code'])
            .select('lasyncro_variant_id', 'location_code',
              'available_quantity', 'reserved_quantity', 'on_hand_quantity')
        ),
      }));

    const pre = await snap();
    const release = await request(app)
      .post('/api/v1/wms/batch/release')
      .set('Authorization', `Bearer ${token}`)
      .send({ priority_order_ids: [orderId], exclusive: true });
    const post = await snap();

    expect(release.status).not.toBe(500);
    expect(release.body.order_count).toBe(0);
    expect(release.body.pick_batch_id).toBeNull();
    expect(release.body.skipped_orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ order_id: orderId, reason: 'intake_exception' }),
      ])
    );

    const batchMembership = await withTenant(shopId, (trx) =>
      trx('pick_batch_orders').where({ lasyncro_order_id: orderId }).first()
    );
    expect(batchMembership).toBeUndefined();     // no pick_batch_orders row

    expect(post.holds).toBe(pre.holds);          // no reservation_hold movement
    expect(post.truth).toBe(pre.truth);          // inventory_truth unchanged
    expect(post.batches).toBe(pre.batches);      // pick_batches count unchanged
  }, 120_000);
});

// ── B4 — healthy order ────────────────────────────────────────────────────

describe('B4 / fully-mapped healthy order → no intake exception, normal lines', () => {
  it('persists lines, writes no intake exception, appears in Order Pool', async () => {
    const { shopId, token } = await provisionFt2Shop('b4');
    const variantId = await seededVariantNumericId(shopId);
    const { eventId, externalOrderId } = await insertOrdersCreateEvent(shopId, [
      { id: '444', variant_id: variantId, quantity: 3, price: '14.00', sku: 'MCS-001' },
    ]);
    await projectEvent(shopId, eventId);
    const orderId = lasyncroOrderIdFor(shopId, externalOrderId);

    const lines = await q(shopId)((trx) => trx('order_line_items').where({ lasyncro_order_id: orderId }));
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].quantity)).toBe(3);

    const exc = await q(shopId)((trx) => trx('order_intake_exceptions').where({ lasyncro_order_id: orderId }).first());
    expect(exc).toBeUndefined();

    const pool = await request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
    expect(pool.body.orders.map((o: any) => o.lasyncro_order_id)).toContain(orderId);
  }, 120_000);
});

// ── B5 — missing SKU / valid variant (protects Slice A R7) ─────────────────

describe('B5 / mapped variant + null SKU → no intake exception', () => {
  it('null SKU alone does not create an intake exception; order stays structurally valid', async () => {
    const { shopId, token } = await provisionFt2Shop('b5');
    const variantId = await seededVariantNumericId(shopId);
    const { eventId, externalOrderId } = await insertOrdersCreateEvent(shopId, [
      { id: '555', variant_id: variantId, quantity: 1, price: '9.00' }, // no sku
    ]);
    await projectEvent(shopId, eventId);
    const orderId = lasyncroOrderIdFor(shopId, externalOrderId);

    const exc = await q(shopId)((trx) => trx('order_intake_exceptions').where({ lasyncro_order_id: orderId }).first());
    expect(exc).toBeUndefined();

    const lines = await q(shopId)((trx) => trx('order_line_items').where({ lasyncro_order_id: orderId }));
    expect(lines).toHaveLength(1);

    const pool = await request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
    expect(pool.body.orders.map((o: any) => o.lasyncro_order_id)).toContain(orderId);
  }, 120_000);
});

// ── B6 — replay ──────────────────────────────────────────────────────────

describe('B6 / replay is idempotent', () => {
  it('re-projecting the same event does not duplicate the intake exception', async () => {
    const { shopId } = await provisionSeededShop('b6');
    const { eventId, externalOrderId } = await insertOrdersCreateEvent(shopId, [
      { id: '666', quantity: 1, price: '10.00' },
    ]);
    await projectEvent(shopId, eventId);
    await projectEvent(shopId, eventId); // replay
    const orderId = lasyncroOrderIdFor(shopId, externalOrderId);

    const rows = await q(shopId)((trx) => trx('order_intake_exceptions').where({ lasyncro_order_id: orderId }));
    expect(rows).toHaveLength(1);
    expect(rows[0].reason_code).toBe('NO_USABLE_WMS_LINES');
  }, 120_000);
});

// ── B7 — Blocked separation ──────────────────────────────────────────────

describe('B7 / intake exception is not an operational Blocked order', () => {
  it('produces no active order_constraints, is not in blocked_count, and is absent from Order Pool', async () => {
    const { shopId, token } = await provisionFt2Shop('b7');
    const { eventId, externalOrderId } = await insertOrdersCreateEvent(shopId, [
      { id: '777', quantity: 1, price: '31.00' },
    ]);
    await projectEvent(shopId, eventId);
    const orderId = lasyncroOrderIdFor(shopId, externalOrderId);

    const constraints = await q(shopId)((trx) =>
      trx('order_constraints').where({ lasyncro_order_id: orderId }));
    expect(constraints.filter((c: any) => c.is_active)).toHaveLength(0);

    const pool = await request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
    const ids = pool.body.orders.map((o: any) => o.lasyncro_order_id);
    expect(ids).not.toContain(orderId);
    // blocked_count counts orders with an active constraint — the intake order
    // has none, so it is not counted as an operational blocker.
    const blockedByConstraint = await q(shopId)((trx) =>
      trx('orders as o')
        .join('order_constraints as oc', 'oc.lasyncro_order_id', 'o.lasyncro_order_id')
        .where({ 'o.shop_id': shopId, 'oc.is_active': true })
        .select('o.lasyncro_order_id'));
    expect(blockedByConstraint.map((r: any) => r.lasyncro_order_id)).not.toContain(orderId);
  }, 120_000);
});

// ── B8 — tenant isolation ───────────────────────────────────────────────

describe('B8 / intake exceptions are tenant scoped', () => {
  it('two shops with the same source shape keep independent, non-colliding exception rows', async () => {
    const a = await provisionSeededShop('b8a');
    const b = await provisionSeededShop('b8b');
    const shared = `900${Date.now()}`;

    const ea = await insertOrdersCreateEvent(a.shopId, [{ id: 'x', quantity: 1, price: '10.00' }], shared);
    await projectEvent(a.shopId, ea.eventId);
    const eb = await insertOrdersCreateEvent(b.shopId, [{ id: 'x', quantity: 1, price: '10.00' }], shared);
    await projectEvent(b.shopId, eb.eventId);

    const aId = lasyncroOrderIdFor(a.shopId, shared);
    const bId = lasyncroOrderIdFor(b.shopId, shared);
    expect(aId).not.toBe(bId); // order id is shop-namespaced

    const aRows = await withTenant(a.shopId, (trx) => trx('order_intake_exceptions').select('*'));
    const bRows = await withTenant(b.shopId, (trx) => trx('order_intake_exceptions').select('*'));
    expect(aRows.map((r: any) => r.lasyncro_order_id)).toEqual([aId]);
    expect(bRows.map((r: any) => r.lasyncro_order_id)).toEqual([bId]);
    expect(aRows.every((r: any) => r.shop_id === a.shopId)).toBe(true);
    expect(bRows.every((r: any) => r.shop_id === b.shopId)).toBe(true);
  }, 150_000);
});

// ── B9 — present variant but missing identity → INGESTION_INTEGRITY_ERROR ──

describe('B9 / unresolvable variant identity stays fail-closed (INGESTION_INTEGRITY_ERROR)', () => {
  it('throws the existing integrity error inside a rolled-back tx; no order, no intake-exception row, and no poison domain_event ever commits', async () => {
    const { shopId } = await provisionSeededShop('b9');

    // Test isolation: the poison orders/create event is NEVER inserted into
    // domain_events. It is a synthetic in-memory event driven through the
    // canonical projection seam (projectDomainEventCore) inside a test-owned
    // transaction that is always rolled back. domain_events stays immutable and
    // untouched; production projection behaviour is unchanged (this is the same
    // core the runtime path calls); and no committed poison row can survive to
    // stall a later global-cursor suite.
    const externalOrderId = `${shopId}${Date.now()}${Math.floor(Math.random() * 1e4)}`;
    const syntheticExternalEventId = `test:intake:b9:${shopId}:${externalOrderId}:${Math.random()}`;
    const syntheticEvent = {
      id: -1, // synthetic — never a real domain_events row
      shop_id: shopId,
      event_type: 'orders/create',
      event_payload: {
        id: externalOrderId,
        currency: 'USD',
        total_price: 42,
        subtotal_price: 42,
        total_tax: 0,
        displayFinancialStatus: 'PAID',
        displayFulfillmentStatus: 'UNFULFILLED',
        shipping_address: {
          address1: '1 Test St', city: 'Testville', zip: '00000', country_code: 'US',
        },
        line_items: [
          { id: '999', variant_id: '99999999', quantity: 1, price: '5.00' }, // no identity-map row
        ],
      },
      event_time: new Date(),
      event_version: 1,
      external_event_id: syntheticExternalEventId,
    };

    let caught: unknown;
    let committed = false;
    await runWithTenantContext(shopId, async () => {
      try {
        await db.transaction(async (trx) => {
          await projectDomainEventCore({
            domainEvent: syntheticEvent,
            domain_event_id: syntheticEvent.id,
            trx,
          });
          committed = true; // unreachable — the core must throw first
        });
      } catch (err) {
        caught = err; // knex has already rolled the transaction back
      }
    });

    // still proves INGESTION_INTEGRITY_ERROR remains fail-closed
    expect(committed).toBe(false);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      /\[ORDER_LINE_ITEM_VARIANT_(IDENTITY|ROW)_MISSING\]/
    );

    // no poison event survives the test
    const poison = await withTenant(shopId, (trx) =>
      trx('domain_events').where({ external_event_id: syntheticExternalEventId }).first()
    );
    expect(poison).toBeUndefined();

    const orderId = lasyncroOrderIdFor(shopId, externalOrderId);
    const order = await q(shopId)((trx) => trx('orders').where({ lasyncro_order_id: orderId }).first());
    expect(order).toBeUndefined(); // transaction rolled back

    const exc = await q(shopId)((trx) => trx('order_intake_exceptions').where({ lasyncro_order_id: orderId }).first());
    expect(exc).toBeUndefined(); // NOT converted into SOURCE_NON_WMS

    const lines = await q(shopId)((trx) => trx('order_line_items').where({ lasyncro_order_id: orderId }));
    expect(lines).toHaveLength(0);
  }, 120_000);
});
