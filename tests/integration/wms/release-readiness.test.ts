/**
 * SHOP-REVIEW-RELEASE-SYSTEM-08 / SHOP-REVIEW-ORDER-POOL-READINESS-09 — Slice A.
 *
 * Release-readiness invariant: an order with zero USABLE WMS LINES
 * (no order_line_items row with quantity > 0 AND a non-null lasyncro_variant_id)
 * must never be:
 *   - returned by GET /api/v1/wms/order-pool
 *   - counted in ready_for_release_count
 *   - greedily selected by server-side Release All
 *   - accepted as an explicitly-requested release order (it is classified
 *     `no_releasable_lines` and never mutates state)
 *
 * The final PickBatchService guard ("Refusing to release an empty order")
 * is UNCHANGED and remains fail-closed — after this slice it is simply
 * unreachable through legitimate pool / Release API input.
 *
 * The malformed order is created directly as a fixture (orders row +
 * order_fulfillment_status='pending' + external_order_identity_map, and
 * deliberately NO order_line_items) — the reviewer's exact production shape.
 * Intake classification (why the line was lost) is Slice B and is not
 * touched here.
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
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

/** Drains every unprocessed domain event for the shop, oldest first. */
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

/** HMAC-signed Shopify install → returns the ghost owner + shopId. */
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

  const ghostEmail = `shopify-install+${shopDomain}@lasyncro.internal`;
  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [ghostEmail])
  );
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

/**
 * Install → seed healthy reviewer-shaped data → drive the lifecycle ladder to
 * FT2 through the real endpoint. Returns a shop with several healthy
 * paid/unfulfilled WMS orders and root-only inventory.
 */
async function provisionFt2Shop(label: string): Promise<{
  shopId: number;
  userId: number;
  token: string;
  rootLocationCode: string;
}> {
  const shopDomain = `release-readiness-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  const rootLocationCode = `WH-${shopId}-ROOT`;

  await seedFreshInstall(shopId);

  // FT2 sync guard (ft2-evaluator.service.ts) runs above the NODE_ENV bypass —
  // this row is a genuine precondition, written directly since the OAuth
  // callback cannot run offline. Mirrors fresh-install-release-path.test.ts.
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

  const atFt1 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
  );
  expect(atFt1?.phase).toBe('FT1');

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

  return { shopId, userId, token, rootLocationCode };
}

/**
 * The reviewer's malformed order: a real Paid/Unfulfilled Shopify order that
 * lost its only line during sync. Persisted with NO order_line_items rows.
 */
async function seedZeroLineOrder(shopId: number): Promise<string> {
  const lasyncroOrderId = crypto.randomUUID();
  const now = new Date();
  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '234.51',
      subtotal_price: '234.51',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      platform: 'shopify',
      // external_order_identity_map enforces external_order_id ~ '^[0-9]+$'
      // (constraint external_order_id_numeric_check, migration 0002) — Shopify
      // order ids are numeric. Synthetic numeric id, unique per disposable run.
      external_order_id:
        String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    });
    // order_fulfillment_status is projection-single-writer guarded
    // (enforce_projection_writer_order_fulfillment_status, migration 0076):
    // a direct write outside SET LOCAL synchroflow.projection = 'true' raises
    // [PROJECTION_WRITE_VIOLATION]. Same transaction-local guard the sibling
    // shipped-order-commercial-enforcement.test.ts uses to seed this table.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      status: 'pending',
      status_updated_at: now,
    });
  });
  return lasyncroOrderId;
}

function getPool(token: string) {
  return request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
}
function postRelease(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/wms/batch/release')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function usableLineExists(shopId: number, orderId: string): Promise<boolean> {
  const row = await withTenant(shopId, (trx) =>
    trx('order_line_items')
      .where({ lasyncro_order_id: orderId })
      .andWhere('quantity', '>', 0)
      .whereNotNull('lasyncro_variant_id')
      .first('lasyncro_line_item_id')
  );
  return !!row;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('SHOP-REVIEW-ORDER-POOL-READINESS-09 — zero-line orders are never READY', () => {
  describe('A1 / R4 — zero-line order excluded from Order Pool', () => {
    it('omits the zero-line order from rows and ready_for_release_count; healthy control remains', async () => {
      const { shopId, token } = await provisionFt2Shop('a1');
      const zeroId = await seedZeroLineOrder(shopId);

      const res = await getPool(token);
      expect(res.status).toBe(200);

      const ids: string[] = res.body.orders.map((o: { lasyncro_order_id: string }) => o.lasyncro_order_id);
      expect(ids).not.toContain(zeroId);
      expect(ids.length).toBeGreaterThanOrEqual(1); // healthy controls present

      // rows and the summary count stay in lockstep and both exclude the zero-line order
      expect(res.body.eligible_order_count).toBe(ids.length);
      expect(res.body.summary.ready_for_release_count).toBe(ids.length);

      // every returned order genuinely has a usable WMS line
      for (const id of ids) {
        expect(await usableLineExists(shopId, id)).toBe(true);
      }
    }, 90_000);
  });

  describe('A8 / R7 — missing SKU + valid mapped variant stays eligible', () => {
    it('an order whose only line has sku = NULL but a valid variant + positive qty still appears in the pool', async () => {
      const { shopId, token } = await provisionFt2Shop('a8');

      const before = await getPool(token);
      const targetId: string = before.body.orders[0].lasyncro_order_id;

      const updated = await withTenant(shopId, (trx) =>
        trx('order_line_items').where({ lasyncro_order_id: targetId }).update({ sku: null })
      );
      expect(updated).toBeGreaterThanOrEqual(1);

      const after = await getPool(token);
      const ids: string[] = after.body.orders.map((o: { lasyncro_order_id: string }) => o.lasyncro_order_id);
      expect(ids).toContain(targetId); // SKU is NOT part of the readiness invariant
    }, 90_000);
  });

  describe('A2 / R5 — direct explicit release of a zero-line order is a safe no-op', () => {
    it('returns 201 with reason no_releasable_lines and mutates nothing', async () => {
      const { shopId, token } = await provisionFt2Shop('a2');
      const zeroId = await seedZeroLineOrder(shopId);

      const snap = async () => {
        return withTenant(shopId, async (trx) => ({
          batches: Number((await trx('pick_batches').where({ shop_id: shopId }).count<{ count: string }>('* as count').first())?.count ?? 0),
          batchOrders: Number((await trx('pick_batch_orders').where({ shop_id: shopId }).count<{ count: string }>('* as count').first())?.count ?? 0),
          holds: Number((await trx('inventory_movements').where({ shop_id: shopId, movement_type: 'reservation_hold' }).count<{ count: string }>('* as count').first())?.count ?? 0),
          truth: JSON.stringify(
            await trx('inventory_truth').where({ shop_id: shopId }).orderBy(['lasyncro_variant_id', 'location_code'])
              .select('lasyncro_variant_id', 'location_code', 'available_quantity', 'reserved_quantity', 'on_hand_quantity')
          ),
        }));
      };

      const pre = await snap();
      const res = await postRelease(token, { priority_order_ids: [zeroId], exclusive: true });
      const post = await snap();

      expect(res.status).toBe(201); // NOT 500
      expect(res.body.order_count).toBe(0);
      expect(res.body.pick_batch_id).toBeNull();
      expect(res.body.skipped_orders).toEqual(
        expect.arrayContaining([expect.objectContaining({ order_id: zeroId, reason: 'no_releasable_lines' })])
      );

      expect(post.batches).toBe(pre.batches);
      expect(post.batchOrders).toBe(pre.batchOrders);
      expect(post.holds).toBe(pre.holds);
      expect(post.truth).toBe(pre.truth);

      const membership = await withTenant(shopId, (trx) =>
        trx('pick_batch_orders').where({ lasyncro_order_id: zeroId }).first()
      );
      expect(membership).toBeUndefined();
    }, 90_000);
  });

  describe('A3 / R6 — valid + zero-line: the valid order releases, the invalid one is skipped', () => {
    it('releases the healthy order and classifies the zero-line order no_releasable_lines with no mutation', async () => {
      const { shopId, token } = await provisionFt2Shop('a3');
      const zeroId = await seedZeroLineOrder(shopId);

      const pool = await getPool(token);
      const healthyId: string = pool.body.orders[0].lasyncro_order_id;

      const res = await postRelease(token, { priority_order_ids: [healthyId, zeroId], exclusive: true });
      expect(res.status).toBe(201);
      expect(res.body.order_count).toBe(1);
      expect(res.body.pick_batch_id).toBeTruthy();
      expect(res.body.skipped_orders).toEqual(
        expect.arrayContaining([expect.objectContaining({ order_id: zeroId, reason: 'no_releasable_lines' })])
      );

      const batchOrders = await withTenant(shopId, (trx) =>
        trx('pick_batch_orders').where({ pick_batch_id: res.body.pick_batch_id }).select('lasyncro_order_id')
      );
      const batchIds = batchOrders.map((r: { lasyncro_order_id: string }) => r.lasyncro_order_id);
      expect(batchIds).toContain(healthyId);
      expect(batchIds).not.toContain(zeroId);

      const holds = await withTenant(shopId, (trx) =>
        trx('inventory_movements').where({ shop_id: shopId, movement_type: 'reservation_hold', reference_id: res.body.pick_batch_id })
      );
      expect(holds.length).toBeGreaterThanOrEqual(1);

      const zeroMembership = await withTenant(shopId, (trx) =>
        trx('pick_batch_orders').where({ lasyncro_order_id: zeroId }).first()
      );
      expect(zeroMembership).toBeUndefined();
    }, 90_000);
  });

  describe('A4 / R3 — Release All (greedy fill) skips the zero-line order', () => {
    it('creates a batch of healthy orders only; the zero-line order cannot fail the wave', async () => {
      const { shopId, token } = await provisionFt2Shop('a4');
      const zeroId = await seedZeroLineOrder(shopId);

      const res = await postRelease(token, {});
      expect(res.status).toBe(201); // no 500 from the final empty-order guard
      expect(res.body.order_count).toBeGreaterThanOrEqual(1);
      expect(res.body.pick_batch_id).toBeTruthy();

      const batchOrders = await withTenant(shopId, (trx) =>
        trx('pick_batch_orders').where({ pick_batch_id: res.body.pick_batch_id }).select('lasyncro_order_id')
      );
      const batchIds = batchOrders.map((r: { lasyncro_order_id: string }) => r.lasyncro_order_id);
      expect(batchIds.length).toBeGreaterThanOrEqual(1);
      expect(batchIds).not.toContain(zeroId);
      for (const id of batchIds) {
        expect(await usableLineExists(shopId, id)).toBe(true);
      }
    }, 90_000);
  });

  describe('A5 / R15 — cross-tenant explicit order id preserves not_in_pool semantics', () => {
    it('never selects or mutates the foreign order; the local healthy order releases normally', async () => {
      const local = await provisionFt2Shop('a5-local');

      // A second tenant, only far enough to own a real order row.
      const foreignDomain = `release-readiness-a5-foreign-${Date.now()}.myshopify.com`;
      const foreign = await hmacInstall(foreignDomain);
      await seedFreshInstall(foreign.shopId);
      await pumpEvents(foreign.shopId);
      const foreignOrder = await withTenant(foreign.shopId, (trx) =>
        trx('orders').where({ shop_id: foreign.shopId }).first('lasyncro_order_id')
      );
      expect(foreignOrder?.lasyncro_order_id).toBeTruthy();
      const foreignOrderId: string = foreignOrder!.lasyncro_order_id;

      const pool = await getPool(local.token);
      const healthyId: string = pool.body.orders[0].lasyncro_order_id;

      const res = await postRelease(local.token, {
        priority_order_ids: [healthyId, foreignOrderId],
        exclusive: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.order_count).toBe(1);
      expect(res.body.skipped_orders).toEqual(
        expect.arrayContaining([expect.objectContaining({ order_id: foreignOrderId, reason: 'not_in_pool' })])
      );

      const foreignMembership = await withTenant(foreign.shopId, (trx) =>
        trx('pick_batch_orders').where({ lasyncro_order_id: foreignOrderId }).first()
      );
      expect(foreignMembership).toBeUndefined();
    }, 120_000);
  });

  describe('A7 / R20 — reviewer-shaped populated pool: every READY order is structurally releasable', () => {
    it('GET /wms/order-pool never returns a zero-usable-line order; Release All batches only healthy orders', async () => {
      const { shopId, token } = await provisionFt2Shop('a7');
      const zeroId = await seedZeroLineOrder(shopId);

      const pool = await getPool(token);
      expect(pool.status).toBe(200);
      const ids: string[] = pool.body.orders.map((o: { lasyncro_order_id: string }) => o.lasyncro_order_id);

      expect(ids.length).toBeGreaterThanOrEqual(2);
      expect(ids).not.toContain(zeroId);
      for (const o of pool.body.orders as Array<{ lasyncro_order_id: string; line_item_count: number; unit_count: number }>) {
        expect(o.line_item_count).toBeGreaterThan(0);
        expect(o.unit_count).toBeGreaterThan(0);
        expect(await usableLineExists(shopId, o.lasyncro_order_id)).toBe(true);
      }
      expect(pool.body.summary.ready_for_release_count).toBe(ids.length);

      const res = await postRelease(token, {});
      expect(res.status).toBe(201);
      expect(res.body.pick_batch_id).toBeTruthy();

      const batchOrders = await withTenant(shopId, (trx) =>
        trx('pick_batch_orders').where({ pick_batch_id: res.body.pick_batch_id }).select('lasyncro_order_id')
      );
      const batchIds = batchOrders.map((r: { lasyncro_order_id: string }) => r.lasyncro_order_id);
      expect(batchIds.length).toBeGreaterThanOrEqual(1);
      expect(batchIds).not.toContain(zeroId);
    }, 120_000);
  });

  // A6 / R16 — forced downstream-failure rollback: A6_BLOCKED_BY_TEST_SEAM.
  //
  // After Slice A the only in-code failure paths that throw *after* pick_batches
  // / pick_batch_orders are inserted are (a) the empty-order guard — now
  // unreachable via legitimate input by design — and (b) the "no
  // aggregate_version" throw / a reservation race in reserveBatchInventory.
  // (a) is what this slice removes; (b) requires either a nullable
  // orders.aggregate_version (it is NOT NULL DEFAULT 1, migration 0001) or
  // non-deterministic concurrent timing. Producing a deterministic post-insert
  // failure therefore needs a controlled test seam, which this slice forbids
  // ("Do NOT add a runtime fault-injection mechanism"). Rollback atomicity is
  // already structurally guaranteed by the single db.transaction in
  // httpReleaseBatch (audit §11) and should get behavioural coverage when a
  // safe seam is introduced. No test added here — reported as
  // A6_BLOCKED_BY_TEST_SEAM.
});
