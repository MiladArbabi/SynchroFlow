/**
 * SHOP-REVIEW-RELEASE-SYSTEM-08 — RELEASE REGRESSION COMPLETION.
 *
 * Behavioural, DB-backed regression coverage for the release-system matrix
 * cases not already protected by Slice A (release-readiness.test.ts), Slice B
 * (order-intake-classification.test.ts), or fresh-install-release-path.test.ts:
 *
 *   R2   several healthy orders → one wave
 *   R9   insufficient pickable inventory → actionable, no partial release
 *   R10  duplicate release request → no duplicate batch / reservation
 *   R11  already-released order → not eligible again
 *   R14  competing stock → reserved never exceeds truth, loser leaves no partial
 *   R16  forced downstream failure mid-release → full transactional rollback
 *        (TEST-ONLY Postgres trigger on the disposable synchroflow_test_* DB;
 *         NO production fault-injection)
 *   R17  batch line-item cap → greedy fill honours it, overflow stays eligible
 *   R18  stale Order Pool state (blocked / fulfilled / batched) → backend
 *        release-time revalidation catches it
 *   R19  cancelled / fulfilled order submitted directly → rejected/skipped
 *
 * Disposable synchroflow_test_* DB only (`npm run test:integration`). Real
 * release service + controller are exercised; DB post-state is asserted, not
 * response shape alone. Slice A/B invariants (HAS_USABLE_WMS_LINE_SQL,
 * NO_ACTIVE_INTAKE_EXCEPTION_SQL, classification precedence, the PickBatch
 * empty-order guard, Blocked semantics) are NOT modified here.
 */
import crypto from 'crypto';
import request from 'supertest';
import { knex as knexFactory } from 'knex';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemQuery, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { issueTestToken } from '../../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as release-readiness.test.ts) ────────────────

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

/** Install → seed healthy reviewer-shaped data → drive the ladder to FT2. */
async function provisionFt2Shop(label: string): Promise<{ shopId: number; userId: number; token: string }> {
  const shopDomain = `rrc-${label}-${Date.now()}.myshopify.com`;
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

function getPool(token: string) {
  return request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
}
function postRelease(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/wms/batch/release')
    .set('Authorization', `Bearer ${token}`).send(body);
}

// ── DB post-state helpers ─────────────────────────────────────────────────

/** Full release-relevant DB snapshot, fixture-scoped by shop. */
async function snapshotReleaseState(shopId: number) {
  return withTenant(shopId, async (trx) => ({
    batches: Number((await trx('pick_batches').where({ shop_id: shopId })
      .count<{ c: string }>('* as c').first())?.c ?? 0),
    batchOrders: Number((await trx('pick_batch_orders').where({ shop_id: shopId })
      .count<{ c: string }>('* as c').first())?.c ?? 0),
    holds: Number((await trx('inventory_movements')
      .where({ shop_id: shopId, movement_type: 'reservation_hold' })
      .count<{ c: string }>('* as c').first())?.c ?? 0),
    allocations: Number((await trx('pick_reservation_allocations').where({ shop_id: shopId })
      .count<{ c: string }>('* as c').first())?.c ?? 0),
    truth: JSON.stringify(
      await trx('inventory_truth').where({ shop_id: shopId })
        .orderBy(['lasyncro_variant_id', 'location_code'])
        .select('lasyncro_variant_id', 'location_code',
          'available_quantity', 'reserved_quantity', 'on_hand_quantity')
    ),
  }));
}

async function truthTotals(shopId: number): Promise<{ available: number; reserved: number; onHand: number }> {
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth').where({ shop_id: shopId }).first(
      db.raw('COALESCE(SUM(available_quantity),0)::int as available'),
      db.raw('COALESCE(SUM(reserved_quantity),0)::int as reserved'),
      db.raw('COALESCE(SUM(on_hand_quantity),0)::int as on_hand')
    )
  );
  return { available: Number(row.available), reserved: Number(row.reserved), onHand: Number(row.on_hand) };
}

async function variantAvailableAtPickable(shopId: number, variantId: string): Promise<number> {
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth as it')
      .join('warehouse_locations as wl', function () {
        this.on('wl.location_code', '=', 'it.location_code').andOn('wl.shop_id', '=', trx.raw('?', [shopId]));
      })
      .where('it.shop_id', shopId)
      .where('it.lasyncro_variant_id', variantId)
      .whereRaw(`(wl.type = 'bin' OR wl.location_code = ?)`, [`WH-${shopId}-ROOT`])
      .first(db.raw('COALESCE(SUM(it.available_quantity),0)::int as q'))
  );
  return Number(row.q);
}

/** Direct healthy-order fixture: orders + identity map + one usable line + pending fulfilment. */
async function seedHealthyOrder(
  shopId: number,
  opts: { quantity: number; variantId?: string; productId?: string }
): Promise<{ orderId: string; variantId: string; productId: string; quantity: number }> {
  const lasyncroOrderId = crypto.randomUUID();
  const now = new Date();

  let { variantId, productId } = opts;
  if (!variantId || !productId) {
    const v = await withTenant(shopId, (trx) =>
      trx('variants').where({ shop_id: shopId }).orderBy('sku', 'asc')
        .first('lasyncro_variant_id', 'lasyncro_product_id')
    );
    variantId = v.lasyncro_variant_id;
    productId = v.lasyncro_product_id;
  }

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId,
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
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id:
        String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: null,
      title: 'Release Regression Fixture Line',
      quantity: opts.quantity,
      unit_price: '10.00',
      line_total: (10 * opts.quantity).toFixed(2),
      created_at: now,
      updated_at: now,
    });
    // order_fulfillment_status is projection-single-writer guarded (migration
    // 0076). Transaction-local guard, same pattern release-readiness.test.ts
    // uses to seed this table for an authorised fixture.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      status: 'pending',
      status_updated_at: now,
    });
  });

  return { orderId: lasyncroOrderId, variantId: variantId!, productId: productId!, quantity: opts.quantity };
}

/** Move an existing order's fulfilment status (projection-guarded). */
async function setFulfillmentStatus(shopId: number, orderId: string, status: string): Promise<void> {
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: orderId })
      .update({ status, status_updated_at: new Date() });
  });
}

/**
 * Attach a genuine ACTIVE OPERATIONAL constraint (not an intake exception).
 * order_constraints is projection-single-writer guarded (migration 0076).
 */
async function addActiveOperationalConstraint(shopId: number, orderId: string): Promise<void> {
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_constraints').insert({
      constraint_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      constraint_type: 'operational',
      block_type: 'manual_hold',
      is_active: true,
      started_at: new Date(),
      write_source: 'release_regression_completion_test_fixture',
      created_at: new Date(),
    });
  });
}

async function batchMembership(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('pick_batch_orders').where({ shop_id: shopId, lasyncro_order_id: orderId }).select('*'));
}
async function reservationHoldsForBatch(shopId: number, batchId: string) {
  return withTenant(shopId, (trx) =>
    trx('inventory_movements').where({
      shop_id: shopId, movement_type: 'reservation_hold', reference_id: batchId,
    }));
}

// ── R2 — several healthy orders → one wave ────────────────────────────────

describe('R2 / multiple healthy orders release in one wave', () => {
  it('creates exactly one batch containing exactly the selected orders, with matching reservations and inventory deltas', async () => {
    const { shopId, token } = await provisionFt2Shop('r2');

    const pool = await getPool(token);
    expect(pool.status).toBe(200);
    const poolIds: string[] = pool.body.orders.map((o: any) => o.lasyncro_order_id);
    expect(poolIds.length).toBeGreaterThanOrEqual(3);
    const [a, b, c] = poolIds;

    const demand = await withTenant(shopId, (trx) =>
      trx('order_line_items').whereIn('lasyncro_order_id', [a, b])
        .sum<{ s: string }>('quantity as s').first());
    const releasedUnits = Number(demand?.s ?? 0);
    expect(releasedUnits).toBeGreaterThan(0);

    const preTotals = await truthTotals(shopId);

    const res = await postRelease(token, { priority_order_ids: [a, b], exclusive: true });
    expect(res.status).toBe(201);
    expect(res.body.order_count).toBe(2);
    expect(res.body.pick_batch_id).toBeTruthy();
    const batchId: string = res.body.pick_batch_id;

    const batches = await withTenant(shopId, (trx) =>
      trx('pick_batches').where({ shop_id: shopId }));
    expect(batches).toHaveLength(1);
    expect(batches[0].pick_batch_id).toBe(batchId);

    const members = await withTenant(shopId, (trx) =>
      trx('pick_batch_orders').where({ pick_batch_id: batchId }).select('lasyncro_order_id'));
    const memberIds = members.map((m: any) => m.lasyncro_order_id).sort();
    expect(memberIds).toEqual([a, b].sort());
    expect(new Set(memberIds).size).toBe(memberIds.length); // no duplicate membership
    expect(memberIds).not.toContain(c);                     // explicit selection isolation

    const holds = await reservationHoldsForBatch(shopId, batchId);
    expect(holds.length).toBeGreaterThanOrEqual(1);
    const heldUnits = holds.reduce((s: number, h: any) => s + Number(h.quantity_delta), 0);
    expect(heldUnits).toBe(releasedUnits);

    const postTotals = await truthTotals(shopId);
    expect(postTotals.reserved - preTotals.reserved).toBe(releasedUnits);
    expect(preTotals.available - postTotals.available).toBe(releasedUnits);
    expect(postTotals.onHand).toBe(preTotals.onHand); // reservation does not move on-hand
  }, 120_000);
});

// ── R9 — insufficient pickable inventory ─────────────────────────────────

describe('R9 / a foreseeable inventory shortfall never leaves partial release state', () => {
  it('classifies the order as newly blocked (oversell), creates no batch/membership/reservation, leaves inventory_truth untouched', async () => {
    const { shopId, token } = await provisionFt2Shop('r9');

    const seededVariant = await withTenant(shopId, (trx) =>
      trx('variants').where({ shop_id: shopId }).orderBy('sku', 'asc')
        .first('lasyncro_variant_id', 'lasyncro_product_id'));
    const available = await variantAvailableAtPickable(shopId, seededVariant.lasyncro_variant_id);
    expect(available).toBeGreaterThan(0);

    const { orderId } = await seedHealthyOrder(shopId, {
      quantity: available + 100, // demand provably exceeds pickable stock
      variantId: seededVariant.lasyncro_variant_id,
      productId: seededVariant.lasyncro_product_id,
    });

    const pre = await snapshotReleaseState(shopId);
    const res = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
    const post = await snapshotReleaseState(shopId);

    expect(res.status).not.toBe(500);       // not a raw unclassified 500
    expect(res.status).toBe(201);
    expect(res.body.order_count).toBe(0);
    expect(res.body.pick_batch_id).toBeNull();
    expect(res.body.newly_blocked_orders).toEqual(
      expect.arrayContaining([expect.objectContaining({ order_id: orderId })])
    );

    expect(await batchMembership(shopId, orderId)).toHaveLength(0);
    expect(post.batches).toBe(pre.batches);
    expect(post.batchOrders).toBe(pre.batchOrders);
    expect(post.holds).toBe(pre.holds);
    expect(post.allocations).toBe(pre.allocations);
    expect(post.truth).toBe(pre.truth);      // no partial reservation / no corruption
  }, 120_000);
});

// ── R10 — duplicate release request ─────────────────────────────────────

describe('R10 / duplicate release request is idempotent', () => {
  it('a second identical release does not add a second membership, reservation, or inventory decrement', async () => {
    const { shopId, token } = await provisionFt2Shop('r10');
    const pool = await getPool(token);
    const orderId: string = pool.body.orders[0].lasyncro_order_id;

    const first = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
    expect(first.status).toBe(201);
    expect(first.body.order_count).toBe(1);
    const batchId: string = first.body.pick_batch_id;
    const afterFirst = await snapshotReleaseState(shopId);
    expect(afterFirst.batches).toBe(1);
    expect(afterFirst.batchOrders).toBe(1);

    const second = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
    expect(second.status).not.toBe(500);
    expect(second.status).toBe(201);
    expect(second.body.order_count).toBe(0);
    expect(second.body.pick_batch_id).toBeNull();
    expect(second.body.skipped_orders).toEqual(
      expect.arrayContaining([expect.objectContaining({ order_id: orderId, reason: 'already_batched' })])
    );

    const afterSecond = await snapshotReleaseState(shopId);
    expect(afterSecond).toEqual(afterFirst); // batches, batchOrders, holds, allocations, inventory_truth all unchanged

    const members = await batchMembership(shopId, orderId);
    expect(members).toHaveLength(1);
    expect(members[0].pick_batch_id).toBe(batchId);
  }, 120_000);
});

// ── R11 — already-released order cannot re-enter a batch ────────────────

describe('R11 / an order already in a batch is not eligible for another', () => {
  it('re-submitting a batched order yields a controlled skip and no second batch/reservation/decrement', async () => {
    const { shopId, token } = await provisionFt2Shop('r11');
    const pool = await getPool(token);
    const orderId: string = pool.body.orders[0].lasyncro_order_id;

    const release = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
    expect(release.status).toBe(201);
    const firstBatchId: string = release.body.pick_batch_id;

    // order must now be gone from the pool (lifecycle eligibility, not request identity)
    const poolAfter = await getPool(token);
    expect(poolAfter.body.orders.map((o: any) => o.lasyncro_order_id)).not.toContain(orderId);

    const pre = await snapshotReleaseState(shopId);
    const again = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
    const post = await snapshotReleaseState(shopId);

    expect(again.status).not.toBe(500);
    expect(again.body.order_count).toBe(0);
    expect(again.body.pick_batch_id).toBeNull();
    expect(again.body.skipped_orders).toEqual(
      expect.arrayContaining([expect.objectContaining({ order_id: orderId, reason: 'already_batched' })])
    );

    const members = await batchMembership(shopId, orderId);
    expect(members).toHaveLength(1);
    expect(members[0].pick_batch_id).toBe(firstBatchId);
    expect(post).toEqual(pre);
  }, 120_000);
});

// ── R14 — competing stock ──────────────────────────────────────────────

describe('R14 / two orders competing for the same stock never over-reserve', () => {
  it('the first release consumes the stock; the second is blocked with no partial reservation, and truth stays non-negative and consistent', async () => {
    const { shopId, token } = await provisionFt2Shop('r14');

    const seededVariant = await withTenant(shopId, (trx) =>
      trx('variants').where({ shop_id: shopId }).orderBy('sku', 'asc')
        .first('lasyncro_variant_id', 'lasyncro_product_id'));
    const available = await variantAvailableAtPickable(shopId, seededVariant.lasyncro_variant_id);
    expect(available).toBeGreaterThanOrEqual(4);

    // Each order individually satisfiable; combined demand exceeds `available`.
    const each = available - 1;
    const orderA = await seedHealthyOrder(shopId, {
      quantity: each, variantId: seededVariant.lasyncro_variant_id, productId: seededVariant.lasyncro_product_id,
    });
    const orderB = await seedHealthyOrder(shopId, {
      quantity: each, variantId: seededVariant.lasyncro_variant_id, productId: seededVariant.lasyncro_product_id,
    });

    const pre = await truthTotals(shopId);

    const relA = await postRelease(token, { priority_order_ids: [orderA.orderId], exclusive: true });
    expect(relA.status).toBe(201);
    expect(relA.body.order_count).toBe(1);
    const batchA: string = relA.body.pick_batch_id;

    const midHolds = await reservationHoldsForBatch(shopId, batchA);
    const reservedA = midHolds.reduce((s: number, h: any) => s + Number(h.quantity_delta), 0);
    expect(reservedA).toBe(each);

    const snapBeforeB = await snapshotReleaseState(shopId);
    const relB = await postRelease(token, { priority_order_ids: [orderB.orderId], exclusive: true });
    const snapAfterB = await snapshotReleaseState(shopId);

    expect(relB.status).not.toBe(500);
    expect(relB.body.order_count).toBe(0);
    expect(relB.body.pick_batch_id).toBeNull();
    expect(relB.body.newly_blocked_orders).toEqual(
      expect.arrayContaining([expect.objectContaining({ order_id: orderB.orderId })])
    );

    // loser leaves nothing partial
    expect(await batchMembership(shopId, orderB.orderId)).toHaveLength(0);
    expect(snapAfterB.batches).toBe(snapBeforeB.batches);
    expect(snapAfterB.batchOrders).toBe(snapBeforeB.batchOrders);
    expect(snapAfterB.holds).toBe(snapBeforeB.holds);
    expect(snapAfterB.allocations).toBe(snapBeforeB.allocations);
    expect(snapAfterB.truth).toBe(snapBeforeB.truth);

    // global consistency: total reserved == what order A actually got, never more
    const post = await truthTotals(shopId);
    expect(post.reserved - pre.reserved).toBe(each);
    expect(pre.available - post.available).toBe(each);
    expect(post.onHand).toBe(pre.onHand);

    const negatives = await withTenant(shopId, (trx) =>
      trx('inventory_truth').where({ shop_id: shopId })
        .where((qb: any) => qb.where('available_quantity', '<', 0).orWhere('reserved_quantity', '<', 0)));
    expect(negatives).toHaveLength(0);
  }, 150_000);
});

// ── R14_CONCURRENT — genuine overlapping releases for the same stock ──────

/**
 * Poll `probe` until it yields a truthy value; return it. The synchronisation
 * BARRIER is the advisory lock installed below — this loop only OBSERVES
 * catalog/lock state and never gates the transactions on wall-clock timing.
 */
async function waitFor<T>(
  probe: () => Promise<T>,
  label: string,
  { tries = 300, intervalMs = 50 } = {}
): Promise<NonNullable<T>> {
  for (let i = 0; i < tries; i++) {
    const v = await probe();
    if (v) return v as NonNullable<T>;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

describe('R14_CONCURRENT / overlapping releases competing for the same stock cannot over-reserve', () => {
  it('forces two release transactions to genuinely overlap; exactly one commits, the loser leaves zero partial state, and inventory_truth reflects only the committed demand', async () => {
    const { shopId, token } = await provisionFt2Shop('r14concurrent');

    const variant = await withTenant(shopId, (trx) =>
      trx('variants').where({ shop_id: shopId }).orderBy('sku', 'asc')
        .first('lasyncro_variant_id', 'lasyncro_product_id'));
    const N = await variantAvailableAtPickable(shopId, variant.lasyncro_variant_id);
    expect(N).toBeGreaterThanOrEqual(4);

    // each individually satisfiable (each < N); together impossible (each + each > N).
    const each = N - 1;
    const A = await seedHealthyOrder(shopId, {
      quantity: each, variantId: variant.lasyncro_variant_id, productId: variant.lasyncro_product_id,
    });
    const B = await seedHealthyOrder(shopId, {
      quantity: each, variantId: variant.lasyncro_variant_id, productId: variant.lasyncro_product_id,
    });

    // both independently READY before either release begins
    const poolBefore = await getPool(token);
    const readyIds: string[] = poolBefore.body.orders.map((o: any) => o.lasyncro_order_id);
    expect(readyIds).toEqual(expect.arrayContaining([A.orderId, B.orderId]));

    const preSnap = await snapshotReleaseState(shopId);
    const preTotals = await truthTotals(shopId);

    const pgdb = assertDisposableTestDb(); // regex-guard PGDATABASE before any DDL
    const uniq = crypto.randomUUID().replace(/-/g, '');
    const K = 1 + Math.floor(Math.random() * 2_000_000_000); // < 2^31 → pg_locks classid=0, objid=K, objsubid=1
    const fnName = `r14_pause_reservation_${uniq}`;
    const trgName = `r14_pause_reservation_trg_${uniq}`;

    const coord = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT),
        user: process.env.PGMIGRATION_USER,
        password: String(process.env.PGMIGRATION_PASSWORD || ''),
        database: pgdb,
      },
      pool: { min: 1, max: 1 }, // one pinned backend → the session advisory lock persists across probes
    });

    let aPid: number | null = null;
    let bPid: number | null = null;
    let aRes: { status: number; body: any } | undefined;
    let bRes: { status: number; body: any } | undefined;
    let bodyOk = false;

    try {
      const who = await coord.raw('SELECT current_database() AS db');
      const connectedDb: string = who.rows[0].db;
      if (connectedDb !== pgdb || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(connectedDb)) {
        throw new Error(`R14: coordinator connection resolved to "${connectedDb}" — refusing to install seam`);
      }

      // TEST-ONLY seam: pause a release inside its open transaction, right after
      // it has written its reservation_hold movement, until the coordinator lets
      // it go. Advisory lock is transaction-scoped inside the trigger, so it is
      // auto-released when the paused release commits or rolls back.
      await coord.raw(
        `CREATE FUNCTION ${fnName}() RETURNS trigger LANGUAGE plpgsql AS $$ ` +
        `BEGIN PERFORM pg_advisory_xact_lock(${K}); RETURN NEW; END; $$;`
      );
      await coord.raw(
        `CREATE TRIGGER ${trgName} AFTER INSERT ON inventory_movements ` +
        `FOR EACH ROW WHEN (NEW.movement_type = 'reservation_hold') EXECUTE FUNCTION ${fnName}();`
      );

      // Coordinator holds K (session-level) → release A's trigger will block.
      await coord.raw(`SELECT pg_advisory_lock(${K})`);

      // Fire release A — do NOT await. It parks inside the reservation_hold trigger.
      const aPromise = postRelease(token, { priority_order_ids: [A.orderId], exclusive: true })
        .then((r) => ({ status: r.status, body: r.body }))
        .catch((e) => ({ status: -1, body: String(e) }));

      // OVERLAP EVIDENCE 1: exactly one non-granted advisory waiter on K → that
      // pid is release A, provably still inside its open transaction (it has
      // already inserted pick_batches, pick_batch_orders and its reservation_hold
      // movement — none committed).
      aPid = await waitFor(async () => {
        const r = await coord.raw(
          `SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${K} AND objsubid=1 AND NOT granted`
        );
        return (r.rows[0]?.pid as number | undefined) ?? null;
      }, 'release A parked in the reservation_hold trigger on advisory lock K');

      // A has not committed: authoritative stock is still the original value.
      const midAvail = await variantAvailableAtPickable(shopId, variant.lasyncro_variant_id);
      expect(midAvail).toBe(N);

      // Fire release B — do NOT await. Its non-locking availability pre-check
      // reads the still-full stock, so B proceeds into reserveBatchInventory and
      // blocks on A's SELECT ... FOR UPDATE row lock.
      const bPromise = postRelease(token, { priority_order_ids: [B.orderId], exclusive: true })
        .then((r) => ({ status: r.status, body: r.body }))
        .catch((e) => ({ status: -1, body: String(e) }));

      // OVERLAP EVIDENCE 2: a second client backend, not A, whose blockers
      // include A's pid → B is executing against A's still-open transaction.
      bPid = await waitFor(async () => {
        const r = await coord.raw(
          `SELECT a.pid FROM pg_stat_activity a
             WHERE a.backend_type = 'client backend'
               AND a.pid <> ${aPid}
               AND ${aPid} = ANY(pg_blocking_pids(a.pid))
             LIMIT 1`
        );
        return (r.rows[0]?.pid as number | undefined) ?? null;
      }, 'release B blocked by release A while A is still open');

      // OVERLAP EVIDENCE 3: at this instant A is STILL parked → both release
      // transactions are open simultaneously.
      const aStill = await coord.raw(
        `SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${K} AND objsubid=1 AND pid=${aPid} AND NOT granted`
      );
      expect(aStill.rows).toHaveLength(1);
      expect(bPid).not.toBe(aPid);

      // Lift the barrier: A's trigger acquires K, A finishes and commits, then B
      // unblocks and re-checks against the now-depleted stock.
      await coord.raw(`SELECT pg_advisory_unlock(${K})`);

      [aRes, bRes] = await Promise.all([aPromise, bPromise]);
      bodyOk = true;

      // Recorded evidence: which concrete outcome each overlapping release got.
      // eslint-disable-next-line no-console
      console.info('[R14_CONCURRENT_OBSERVED]', {
        aPid, bPid,
        aStatus: aRes.status, aOrderCount: aRes.body?.order_count, aBatch: aRes.body?.pick_batch_id ?? null,
        bStatus: bRes.status, bOrderCount: bRes.body?.order_count,
        bBatch: bRes.body?.pick_batch_id ?? null,
        bNewlyBlocked: Array.isArray(bRes.body?.newly_blocked_orders) ? bRes.body.newly_blocked_orders.length : null,
        bSkipped: Array.isArray(bRes.body?.skipped_orders)
          ? bRes.body.skipped_orders.map((s: any) => s.reason) : null,
        bBodySnippet: JSON.stringify(bRes.body).slice(0, 300),
      });
    } finally {
      const cleanupErrors: unknown[] = [];
      try { await coord.raw(`SELECT pg_advisory_unlock_all()`); } catch (e) { cleanupErrors.push(e); }
      try { await coord.raw(`DROP TRIGGER IF EXISTS ${trgName} ON inventory_movements`); } catch (e) { cleanupErrors.push(e); }
      try { await coord.raw(`DROP FUNCTION IF EXISTS ${fnName}()`); } catch (e) { cleanupErrors.push(e); }
      let residualTriggers: string[] = [];
      try {
        const r = await coord.raw(`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'r14_pause_reservation%'`);
        residualTriggers = r.rows.map((x: any) => x.tgname);
      } catch (e) { cleanupErrors.push(e); }
      await coord.destroy();
      // Only raise cleanup/leak problems when the test body itself succeeded, so
      // a real assertion failure is never masked by a finally-block throw.
      if (bodyOk && residualTriggers.length > 0) {
        throw new Error(`R14 test-only trigger leaked: ${residualTriggers.join(', ')}`);
      }
      if (bodyOk && cleanupErrors.length > 0) {
        throw new Error(`R14 cleanup errors: ${cleanupErrors.map(String).join(' | ')}`);
      }
    }

    // ── winner: exactly one committed release (A) ──────────────────────────
    expect(aRes!.status).toBe(201);
    expect(aRes!.body.order_count).toBe(1);
    expect(aRes!.body.pick_batch_id).toBeTruthy();
    const batchId: string = aRes!.body.pick_batch_id;

    // ── loser: a genuine concurrent inventory conflict → controlled 409 ──────
    // The FOR UPDATE re-read saw depleted stock because A committed first. This
    // must be a typed CONFLICT_WITH_NEWER_INVENTORY_STATE, never HTTP 500 and
    // never the R9 controlled-201 path.
    expect(bRes!.status).toBe(409);
    expect(bRes!.body.code).toBe('INVENTORY_CHANGED_DURING_RELEASE');
    expect(typeof bRes!.body.error).toBe('string');
    expect(bRes!.body.error).toMatch(/refresh/i);
    expect(bRes!.body.variant_id).toBe(variant.lasyncro_variant_id);
    expect(bRes!.body.required_quantity).toBe(each);
    expect(bRes!.body.available_quantity).toBe(N - each);
    // no SQL / Knex / Postgres internals leaked
    expect(JSON.stringify(bRes!.body)).not.toMatch(/PICK_BATCH_SERVICE|knex|pg_|SELECT |FOR UPDATE|inventory_truth/i);
    // not a batch, not order_count 1
    expect(bRes!.body.pick_batch_id).toBeUndefined();
    expect(bRes!.body.order_count).toBeUndefined();

    // ── persisted state: only A's release exists ──────────────────────────
    const batches = await withTenant(shopId, (trx) => trx('pick_batches').where({ shop_id: shopId }));
    expect(batches).toHaveLength(1);
    expect(batches[0].pick_batch_id).toBe(batchId);

    const members = await withTenant(shopId, (trx) =>
      trx('pick_batch_orders').where({ shop_id: shopId }).select('lasyncro_order_id', 'pick_batch_id'));
    expect(members).toHaveLength(1);                       // no order in more than one batch, no dup membership
    expect(members[0].lasyncro_order_id).toBe(A.orderId);
    expect(members[0].pick_batch_id).toBe(batchId);
    expect(await batchMembership(shopId, B.orderId)).toHaveLength(0); // loser: no partial membership

    const holds = await withTenant(shopId, (trx) =>
      trx('inventory_movements').where({ shop_id: shopId, movement_type: 'reservation_hold' }));
    expect(holds.every((h: any) => h.reference_id === batchId)).toBe(true); // loser: no partial reservation_hold
    const heldUnits = holds.reduce((s: number, h: any) => s + Number(h.quantity_delta), 0);
    expect(heldUnits).toBe(each);
    const holdKeys = holds.map((h: any) => `${h.reference_id}:${h.lasyncro_variant_id}:${h.location_code}`);
    expect(new Set(holdKeys).size).toBe(holdKeys.length);  // no duplicate reservation movement

    const allocs = await withTenant(shopId, (trx) =>
      trx('pick_reservation_allocations').where({ shop_id: shopId }));
    expect(allocs.every((a: any) => a.pick_batch_id === batchId)).toBe(true); // loser: no partial allocation
    expect(allocs.reduce((s: number, a: any) => s + Number(a.quantity), 0)).toBe(each);

    // ── inventory_truth reflects ONLY the committed (A) demand ────────────
    const postTotals = await truthTotals(shopId);
    expect(postTotals.reserved - preTotals.reserved).toBe(each);
    expect(preTotals.available - postTotals.available).toBe(each);
    expect(postTotals.onHand).toBe(preTotals.onHand);     // reservation never moves on-hand
    expect(each).toBeLessThanOrEqual(N);                  // TOTAL COMMITTED RESERVATION <= original available stock

    const vt = await withTenant(shopId, (trx) =>
      trx('inventory_truth').where({ shop_id: shopId, lasyncro_variant_id: variant.lasyncro_variant_id })
        .select('available_quantity', 'reserved_quantity', 'on_hand_quantity'));
    expect(vt.reduce((s: number, r: any) => s + Number(r.available_quantity), 0)).toBe(N - each);
    expect(vt.reduce((s: number, r: any) => s + Number(r.reserved_quantity), 0)).toBe(each);

    const negatives = await withTenant(shopId, (trx) =>
      trx('inventory_truth').where({ shop_id: shopId })
        .where((qb: any) => qb.where('available_quantity', '<', 0).orWhere('reserved_quantity', '<', 0)));
    expect(negatives).toHaveLength(0);

    // pre-release snapshot had nothing; the delta is entirely A's committed wave
    expect(preSnap.batches).toBe(0);
    expect(preSnap.holds).toBe(0);
    expect(preSnap.allocations).toBe(0);

    // overlap evidence captured
    expect(typeof aPid).toBe('number');
    expect(typeof bPid).toBe('number');
    expect(aPid).not.toBe(bPid);

    // ── the loser produced NO new business state merely by losing the race ──
    const loserConstraints = await withTenant(shopId, (trx) =>
      trx('order_constraints').where({ lasyncro_order_id: B.orderId }));
    expect(loserConstraints).toHaveLength(0);              // no oversell / any constraint
    const loserIntake = await withTenant(shopId, (trx) =>
      trx('order_intake_exceptions').where({ lasyncro_order_id: B.orderId }).first());
    expect(loserIntake).toBeUndefined();                  // not reclassified as an intake exception
    const loserFs = await withTenant(shopId, (trx) =>
      trx('order_fulfillment_status').where({ lasyncro_order_id: B.orderId }).first('status'));
    expect(loserFs?.status).toBe('pending');              // lifecycle untouched — retryable
    expect(await batchMembership(shopId, B.orderId)).toHaveLength(0); // still unbatched
    // exactly one committed release overall → no hidden retry of B occurred
    expect(batches).toHaveLength(1);
  }, 180_000);
});

// ── R16 — forced downstream failure → full rollback ───────────────────

/** PGDATABASE must be a disposable synchroflow_test_* database before any DDL. */
function assertDisposableTestDb(): string {
  const pgdb = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(pgdb)) {
    throw new Error(`R16: refusing to run test DDL — PGDATABASE "${pgdb}" is not a disposable synchroflow_test_* database`);
  }
  return pgdb;
}

/**
 * Install a TEST-ONLY trigger on the disposable DB that RAISEs when the release
 * writes its reservation_hold movement — a failure late enough to prove the
 * outer httpReleaseBatch db.transaction rolls back the pick_batches /
 * pick_batch_orders it already wrote. No production source is touched.
 */
async function withReservationHoldFailure<T>(run: () => Promise<T>): Promise<T> {
  const pgdb = assertDisposableTestDb();
  const uniq = crypto.randomUUID().replace(/-/g, '');
  const fnName = `r16_force_reservation_failure_${uniq}`;
  const trgName = `r16_force_reservation_failure_trg_${uniq}`;

  const admin = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGMIGRATION_USER,
      password: String(process.env.PGMIGRATION_PASSWORD || ''),
      database: pgdb,
    },
    pool: { min: 0, max: 1 },
  });

  try {
    const who = await admin.raw('SELECT current_database() AS db');
    const connectedDb: string = who.rows[0].db;
    if (connectedDb !== pgdb || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(connectedDb)) {
      throw new Error(`R16: admin connection resolved to "${connectedDb}" — refusing to install trigger`);
    }

    await admin.raw(`
      CREATE FUNCTION ${fnName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'R16_TEST_FORCED_RESERVATION_FAILURE';
      END;
      $$;
    `);
    await admin.raw(`
      CREATE TRIGGER ${trgName}
      BEFORE INSERT ON inventory_movements
      FOR EACH ROW
      WHEN (NEW.movement_type = 'reservation_hold')
      EXECUTE FUNCTION ${fnName}();
    `);

    return await run();
  } finally {
    try { await admin.raw(`DROP TRIGGER IF EXISTS ${trgName} ON inventory_movements;`); } catch { /* reported by post-assert */ }
    try { await admin.raw(`DROP FUNCTION IF EXISTS ${fnName}();`); } catch { /* reported by post-assert */ }
    await admin.destroy();
  }
}

describe('R16 / a downstream failure mid-release rolls the whole release back', () => {
  it('after the forced reservation-write failure: no batch, no membership, no reservation, inventory_truth byte-identical, order still releasable', async () => {
    const { shopId, token } = await provisionFt2Shop('r16');
    const pool = await getPool(token);
    const orderId: string = pool.body.orders[0].lasyncro_order_id;

    const pre = await snapshotReleaseState(shopId);

    const res = await withReservationHoldFailure(() =>
      postRelease(token, { priority_order_ids: [orderId], exclusive: true })
    );

    // the induced infra failure surfaces as a controlled 500 from the release txn
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).toMatch(/R16_TEST_FORCED_RESERVATION_FAILURE/);

    const post = await snapshotReleaseState(shopId);
    expect(post.batches).toBe(pre.batches);          // no new pick_batch persisted
    expect(post.batchOrders).toBe(pre.batchOrders);  // no membership persisted
    expect(post.holds).toBe(pre.holds);              // no reservation_hold persisted
    expect(post.allocations).toBe(pre.allocations);
    expect(post.truth).toBe(pre.truth);              // inventory_truth logically identical

    expect(await batchMembership(shopId, orderId)).toHaveLength(0);

    // the trigger is gone; the same order now releases cleanly (still retryable)
    const retry = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
    expect(retry.status).toBe(201);
    expect(retry.body.order_count).toBe(1);
    expect(retry.body.pick_batch_id).toBeTruthy();
  }, 150_000);
});

// ── R17 — batch line-item cap ────────────────────────────────────────

describe('R17 / greedy fill honours the effective batch line-item cap', () => {
  it('fills up to the cap, leaves the overflow order eligible for a later wave, and reserves only for included orders', async () => {
    const { shopId, token } = await provisionFt2Shop('r17');

    // authoritative cap source: shop_wms_settings.max_batch_line_items
    const seededVariant = await withTenant(shopId, (trx) =>
      trx('variants').where({ shop_id: shopId }).orderBy('sku', 'asc')
        .first('lasyncro_variant_id', 'lasyncro_product_id'));

    const CAP = 2;
    await withTenant(shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: shopId }).update({ max_batch_line_items: CAP }));
    const settings = await withTenant(shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: shopId }).first('max_batch_line_items'));
    expect(Number(settings.max_batch_line_items)).toBe(CAP);

    // three fresh single-line healthy orders on their own shop → combined 3 lines > CAP
    const o1 = await seedHealthyOrder(shopId, { quantity: 1, variantId: seededVariant.lasyncro_variant_id, productId: seededVariant.lasyncro_product_id });
    const o2 = await seedHealthyOrder(shopId, { quantity: 1, variantId: seededVariant.lasyncro_variant_id, productId: seededVariant.lasyncro_product_id });
    const o3 = await seedHealthyOrder(shopId, { quantity: 1, variantId: seededVariant.lasyncro_variant_id, productId: seededVariant.lasyncro_product_id });
    const fixtureIds = new Set([o1.orderId, o2.orderId, o3.orderId]);

    // Exclusive selection of exactly our three fixtures; greedy fill still
    // applies the max_batch_line_items ceiling, so only CAP of them can land in
    // the wave regardless of the pre-seeded pool.
    const wave1 = await postRelease(token, {
      priority_order_ids: [o1.orderId, o2.orderId, o3.orderId], exclusive: true,
    });
    expect(wave1.status).toBe(201);
    const batch1: string = wave1.body.pick_batch_id;
    expect(batch1).toBeTruthy();

    const batch1Row = await withTenant(shopId, (trx) =>
      trx('pick_batches').where({ pick_batch_id: batch1 }).first());
    expect(Number(batch1Row.total_line_items)).toBeLessThanOrEqual(CAP);

    const wave1Members: string[] = (await withTenant(shopId, (trx) =>
      trx('pick_batch_orders').where({ pick_batch_id: batch1 }).select('lasyncro_order_id')))
      .map((r: any) => r.lasyncro_order_id);
    const wave1Fixture = wave1Members.filter((id) => fixtureIds.has(id));
    expect(wave1Fixture.length).toBe(CAP);                 // exactly the cap, from our fixture
    expect(wave1Members.length).toBeLessThanOrEqual(CAP);  // no batch exceeds the cap

    const leftover = [o1, o2, o3].map((o) => o.orderId).find((id) => !wave1Members.includes(id))!;

    // overflow order is not corrupted / not lost: still pending, unbatched, releasable
    const leftoverFs = await withTenant(shopId, (trx) =>
      trx('order_fulfillment_status').where({ lasyncro_order_id: leftover }).first('status'));
    expect(leftoverFs.status).toBe('pending');
    expect(await batchMembership(shopId, leftover)).toHaveLength(0);

    // reservations correspond only to included orders
    const holds1 = await reservationHoldsForBatch(shopId, batch1);
    const reserved1 = holds1.reduce((s: number, h: any) => s + Number(h.quantity_delta), 0);
    expect(reserved1).toBe(wave1Fixture.length); // 1 unit per included fixture order

    const wave2 = await postRelease(token, { priority_order_ids: [leftover], exclusive: true });
    expect(wave2.status).toBe(201);
    expect(wave2.body.order_count).toBe(1);
    expect(wave2.body.pick_batch_id).toBeTruthy();
    expect(wave2.body.pick_batch_id).not.toBe(batch1);
  }, 150_000);
});

// ── R18 — stale Order Pool revalidation ────────────────────────────

describe('R18 / backend release-time revalidation defeats a stale client pool', () => {
  it('A — order that became operationally blocked after the client saw it is skipped, nothing mutated', async () => {
    const { shopId, token } = await provisionFt2Shop('r18a');
    const pool = await getPool(token);
    const orderId: string = pool.body.orders[0].lasyncro_order_id;

    await addActiveOperationalConstraint(shopId, orderId); // genuine operational constraint, not intake

    const pre = await snapshotReleaseState(shopId);
    const res = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
    const post = await snapshotReleaseState(shopId);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(201);
    expect(res.body.order_count).toBe(0);
    expect(res.body.pick_batch_id).toBeNull();
    expect(res.body.skipped_orders).toEqual(
      expect.arrayContaining([expect.objectContaining({ order_id: orderId, reason: 'blocked' })])
    );
    expect(await batchMembership(shopId, orderId)).toHaveLength(0);
    expect(post).toEqual(pre);
  }, 120_000);

  it('B — order that became fulfilled after the client saw it is skipped, nothing mutated', async () => {
    const { shopId, token } = await provisionFt2Shop('r18b');
    const pool = await getPool(token);
    const orderId: string = pool.body.orders[0].lasyncro_order_id;

    await setFulfillmentStatus(shopId, orderId, 'fulfilled');

    const pre = await snapshotReleaseState(shopId);
    const res = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
    const post = await snapshotReleaseState(shopId);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(201);
    expect(res.body.order_count).toBe(0);
    expect(res.body.pick_batch_id).toBeNull();
    expect(res.body.skipped_orders).toEqual(
      expect.arrayContaining([expect.objectContaining({ order_id: orderId, reason: 'status_changed' })])
    );
    expect(await batchMembership(shopId, orderId)).toHaveLength(0);
    expect(post).toEqual(pre);
  }, 120_000);

  it('C — order already batched by a prior wave is skipped when re-submitted, nothing mutated', async () => {
    const { shopId, token } = await provisionFt2Shop('r18c');
    const pool = await getPool(token);
    const [first, stale] = pool.body.orders.map((o: any) => o.lasyncro_order_id);

    const w1 = await postRelease(token, { priority_order_ids: [stale], exclusive: true });
    expect(w1.status).toBe(201);
    expect(w1.body.order_count).toBe(1);

    const pre = await snapshotReleaseState(shopId);
    const res = await postRelease(token, { priority_order_ids: [stale], exclusive: true });
    const post = await snapshotReleaseState(shopId);

    expect(res.status).not.toBe(500);
    expect(res.body.order_count).toBe(0);
    expect(res.body.pick_batch_id).toBeNull();
    expect(res.body.skipped_orders).toEqual(
      expect.arrayContaining([expect.objectContaining({ order_id: stale, reason: 'already_batched' })])
    );
    expect((await batchMembership(shopId, stale))).toHaveLength(1);
    expect(post).toEqual(pre);
    expect(first).toBeTruthy();
  }, 120_000);
});

// ── R19 — cancelled / fulfilled direct submission ────────────────────

describe('R19 / cancelled or fulfilled orders submitted directly cannot be released', () => {
  it('a cancelled order is skipped: no batch, no reservation, inventory unchanged, no 500', async () => {
    const { shopId, token } = await provisionFt2Shop('r19cancel');
    const pool = await getPool(token);
    const orderId: string = pool.body.orders[0].lasyncro_order_id;

    await setFulfillmentStatus(shopId, orderId, 'cancelled');

    const pre = await snapshotReleaseState(shopId);
    const res = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
    const post = await snapshotReleaseState(shopId);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(201);
    expect(res.body.order_count).toBe(0);
    expect(res.body.pick_batch_id).toBeNull();
    expect(res.body.skipped_orders).toEqual(
      expect.arrayContaining([expect.objectContaining({ order_id: orderId, reason: 'status_changed' })])
    );
    expect(await batchMembership(shopId, orderId)).toHaveLength(0);
    expect(post).toEqual(pre);
  }, 120_000);

  it('a fulfilled order is skipped: no batch, no reservation, inventory unchanged, no 500', async () => {
    const { shopId, token } = await provisionFt2Shop('r19fulfilled');
    const pool = await getPool(token);
    const orderId: string = pool.body.orders[0].lasyncro_order_id;

    await setFulfillmentStatus(shopId, orderId, 'fulfilled');

    const pre = await snapshotReleaseState(shopId);
    const res = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
    const post = await snapshotReleaseState(shopId);

    expect(res.status).not.toBe(500);
    expect(res.status).toBe(201);
    expect(res.body.order_count).toBe(0);
    expect(res.body.pick_batch_id).toBeNull();
    expect(res.body.skipped_orders).toEqual(
      expect.arrayContaining([expect.objectContaining({ order_id: orderId, reason: 'status_changed' })])
    );
    expect(await batchMembership(shopId, orderId)).toHaveLength(0);
    expect(post).toEqual(pre);
  }, 120_000);
});
