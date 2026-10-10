/**
 * GH-1145 R0-1 / R2 — CONCURRENT UNWIND vs PENDING-BATCH CANCELLATION.
 *
 * Verification-only regression (no production change). Question under test:
 * can an order-level reservation release (order-cancellation unwind, or Shopify
 * fulfillment physical removal) and a concurrent pending-batch cancellation
 * both release the SAME reservation ownership?
 *
 * Invariant (both scenarios, independent of which transaction wins):
 *   Reservation quantity is released AT MOST ONCE per allocation. Afterwards,
 *   for the target variant + location:
 *     inventory_truth.reserved  == Σ surviving pick_reservation_allocations
 *     inventory_truth.available == on_hand − reserved
 *     per batch: hold + Σ its releases (pick_batch + per-allocation) − surviving = 0
 *     batch B (bystander) keeps its full reservation and allocation
 *     batch status / membership / allocations are mutually consistent.
 *
 * Fixture: one variant at WH-{shopId}-ROOT (seedFreshInstall: stock at ROOT,
 * zero bins). Batch A = A1 (2) + A2 (1); batch B = B1 (3), same location, so the
 * location-wide `reserved_quantity >= q` guards cannot reject a stale release.
 *
 * DETERMINISTIC INTERLEAVING (no sleeps, no timing races):
 *   A TEST-ONLY trigger is installed on the disposable synchroflow_test_* DB:
 *     BEFORE INSERT ON inventory_movements
 *     WHEN movement_type = 'reservation_release'
 *      AND reference_type = 'pick_reservation_allocation'
 *     → pg_advisory_xact_lock(K)
 *   A coordinator connection holds K (session level). The order-level path (T1)
 *   therefore parks at the first write it makes after SELECTing the allocation it
 *   intends to release — BEFORE its release row, its inventory_truth update and
 *   its allocation DELETE. That is exactly the window "ownership observed, not
 *   yet released/deleted". Batch cancellation (T2) writes reference_type
 *   'pick_batch' releases, so it is never trapped by the trigger.
 *   While T1 is provably parked (non-granted advisory waiter), T2 is started.
 *   The coordinator then records whether T2 COMPLETED while T1 was parked or
 *   became BLOCKED BY T1 (pg_blocking_pids), releases K, and both settle.
 *
 * Real paths exercised:
 *   Release        POST /api/v1/wms/batch/release
 *   R2-A T1        registered orders/cancelled handler (handleOrdersCancelled →
 *                  ingestStatus + unwindCancelledOrder) in a transaction prepared
 *                  as projectDomainEventCore prepares one (projection + tenant GUC)
 *   R2-B T1        applyFulfillmentPhysicalRemoval (the physical service the
 *                  orders/fulfilled handler calls), same transaction preparation
 *   T2             POST /api/v1/wms/batch/:batchId/cancel
 *
 * Disposable synchroflow_test_* DB only (`npm run test:integration`).
 */
import crypto from 'crypto';
import request from 'supertest';
import { knex as knexFactory, Knex } from 'knex';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemQuery, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { handleOrdersCancelled } from 'api-src/projection/handlers/orders.cancelled';
import { applyFulfillmentPhysicalRemoval } from 'api-src/services/wms/fulfillmentPhysicalRemoval.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as release-regression-completion.test.ts) ────

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

async function provisionFt2Shop(label: string): Promise<{ shopId: number; token: string }> {
  const shopDomain = `r2-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
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
  return { shopId, token };
}

function postRelease(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/wms/batch/release')
    .set('Authorization', `Bearer ${token}`).send(body);
}

function postCancelBatch(token: string, batchId: string) {
  return request(app).post(`/api/v1/wms/batch/${batchId}/cancel`)
    .set('Authorization', `Bearer ${token}`).send({});
}

// ── fixtures ────────────────────────────────────────────────────────────────

async function pickRootVariant(shopId: number, minAvailable: number) {
  const locationCode = `WH-${shopId}-ROOT`;
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth as it')
      .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
      .where('it.shop_id', shopId)
      .where('it.location_code', locationCode)
      .orderBy('it.available_quantity', 'desc')
      .first('it.lasyncro_variant_id', 'v.lasyncro_product_id', 'it.available_quantity', 'it.reserved_quantity')
  );
  expect(row).toBeTruthy();
  expect(Number(row.available_quantity)).toBeGreaterThanOrEqual(minAvailable);
  expect(Number(row.reserved_quantity)).toBe(0);
  const pickableRows = await withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: row.lasyncro_variant_id })
      .where('available_quantity', '>', 0)
      .select('location_code')
  );
  expect(pickableRows.map((r: { location_code: string }) => r.location_code)).toEqual([locationCode]);
  return { variantId: row.lasyncro_variant_id as string, productId: row.lasyncro_product_id as string, locationCode };
}

async function seedHealthyOrder(
  shopId: number,
  opts: { quantity: number; variantId: string; productId: string }
): Promise<{ orderId: string; externalOrderId: string; lineItemId: string }> {
  const orderId = crypto.randomUUID();
  const lineItemId = crypto.randomUUID();
  const externalOrderId =
    String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  const now = new Date();
  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId, shop_id: shopId, payment_state: 'paid', currency: 'USD',
      total_price: '100.00', subtotal_price: '100.00', total_tax: '0.00',
      order_created_at: now, order_updated_at: now, created_at: now, updated_at: now,
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId, shop_id: shopId, platform: 'shopify', external_order_id: externalOrderId,
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineItemId, lasyncro_order_id: orderId,
      lasyncro_product_id: opts.productId, lasyncro_variant_id: opts.variantId,
      sku: null, title: 'R2 Fixture Line', quantity: opts.quantity,
      unit_price: '10.00', line_total: (10 * opts.quantity).toFixed(2), created_at: now, updated_at: now,
    });
    // order_fulfillment_status is projection-single-writer guarded (0076);
    // transaction-local guard for this authorised fixture only.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(), lasyncro_order_id: orderId,
      status: 'pending', status_updated_at: now,
    });
  });
  return { orderId, externalOrderId, lineItemId };
}

/** Transaction prepared exactly as projectDomainEventCore prepares one. */
function inProjectionTransaction(shopId: number, body: (trx: Knex.Transaction) => Promise<void>) {
  return runWithTenantContext(shopId, () =>
    db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await trx.raw(`SET LOCAL "app.current_tenant" = '${Number(shopId)}'`);
      await body(trx);
    })
  );
}

function cancelOrderThroughProjectionHandler(shopId: number, externalOrderId: string) {
  const cancelledAt = new Date();
  return inProjectionTransaction(shopId, (trx) =>
    handleOrdersCancelled({
      domainEvent: {
        shop_id: shopId,
        event_type: 'orders/cancelled',
        event_payload: { id: externalOrderId, cancelled_at: cancelledAt.toISOString() },
      },
      domain_event_id: 0,
      canonicalEventTime: cancelledAt,
      trx,
    })
  );
}

function fulfillOrderPhysically(shopId: number, orderId: string) {
  const fulfilledAt = new Date();
  return inProjectionTransaction(shopId, (trx) =>
    applyFulfillmentPhysicalRemoval(trx, shopId, orderId, fulfilledAt)
  );
}

// ── state readers ───────────────────────────────────────────────────────────

type LedgerRow = { movement_type: string; reference_type: string; reference_id: string; quantity_delta: number };

async function ledgerAt(shopId: number, variantId: string, locationCode: string): Promise<LedgerRow[]> {
  const rows = await withTenant(shopId, (trx) =>
    trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode })
      .whereIn('movement_type', ['reservation_hold', 'reservation_release', 'fulfillment_removal'])
      .select('movement_type', 'reference_type', 'reference_id', 'quantity_delta')
  );
  return rows
    .map((r: any) => ({
      movement_type: r.movement_type, reference_type: r.reference_type,
      reference_id: String(r.reference_id), quantity_delta: Number(r.quantity_delta),
    }))
    .sort((a: LedgerRow, b: LedgerRow) =>
      `${a.movement_type}|${a.reference_type}|${a.reference_id}`.localeCompare(`${b.movement_type}|${b.reference_type}|${b.reference_id}`));
}

async function truthAt(shopId: number, variantId: string, locationCode: string) {
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode })
      .first('on_hand_quantity', 'reserved_quantity', 'available_quantity'));
  return { onHand: Number(row.on_hand_quantity), reserved: Number(row.reserved_quantity), available: Number(row.available_quantity) };
}

async function otherTruth(shopId: number, variantId: string, locationCode: string) {
  const rows = await withTenant(shopId, (trx) =>
    trx('inventory_truth').where({ shop_id: shopId })
      .whereNot((qb) => qb.where({ lasyncro_variant_id: variantId, location_code: locationCode }))
      .orderBy(['lasyncro_variant_id', 'location_code'])
      .select('lasyncro_variant_id', 'location_code', 'on_hand_quantity', 'reserved_quantity', 'available_quantity'));
  return JSON.stringify(rows);
}

type AllocationRow = { allocation_id: string; pick_batch_id: string; lasyncro_order_id: string; quantity: number };

async function allocationsAt(shopId: number, variantId: string, locationCode: string): Promise<AllocationRow[]> {
  const rows = await withTenant(shopId, (trx) =>
    trx('pick_reservation_allocations')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode })
      .select('allocation_id', 'pick_batch_id', 'lasyncro_order_id', 'quantity'));
  return rows
    .map((r: any) => ({ ...r, quantity: Number(r.quantity) }))
    .sort((a: AllocationRow, b: AllocationRow) =>
      `${a.pick_batch_id}|${a.lasyncro_order_id}`.localeCompare(`${b.pick_batch_id}|${b.lasyncro_order_id}`));
}

async function batchStatus(shopId: number, batchId: string): Promise<string | null> {
  const row = await withTenant(shopId, (trx) =>
    trx('pick_batches').where({ shop_id: shopId, pick_batch_id: batchId }).first('status'));
  return row?.status ?? null;
}

async function batchMembers(shopId: number, batchId: string): Promise<string[]> {
  const rows = await withTenant(shopId, (trx) =>
    trx('pick_batch_orders').where({ shop_id: shopId, pick_batch_id: batchId })
      .orderBy('lasyncro_order_id').select('lasyncro_order_id'));
  return rows.map((r: { lasyncro_order_id: string }) => r.lasyncro_order_id);
}

/** Net reservation ledger owned by one batch (aggregate rows + its per-allocation releases). */
function batchReservationLedgerNet(ledger: LedgerRow[], batchId: string, allocationIds: string[]): number {
  return ledger
    .filter((r) => r.movement_type === 'reservation_hold' || r.movement_type === 'reservation_release')
    .filter((r) =>
      (r.reference_type === 'pick_batch' && r.reference_id === batchId) ||
      (r.reference_type === 'pick_reservation_allocation' && allocationIds.includes(r.reference_id)))
    .reduce((s, r) => s + r.quantity_delta, 0);
}

// ── deterministic barrier (pattern: R14_CONCURRENT) ──────────────────────────

function assertDisposableTestDb(): string {
  const pgdb = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(pgdb)) {
    throw new Error(`R2: refusing to run test DDL — PGDATABASE "${pgdb}" is not a disposable synchroflow_test_* database`);
  }
  return pgdb;
}

async function waitFor<T>(probe: () => Promise<T>, label: string, { tries = 400, intervalMs = 25 } = {}): Promise<NonNullable<T>> {
  for (let i = 0; i < tries; i++) {
    const v = await probe();
    if (v) return v as NonNullable<T>;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

type T1Outcome = { committed: true } | { committed: false; code: string | null; message: string };
type T2Outcome = { status: number; body: any };

type Interleaving = {
  t1Pid: number;
  t2Relation: 'T2_COMPLETED_WHILE_T1_PARKED' | 'T2_BLOCKED_BY_T1';
  t2BlockedPid: number | null;
  t1StillParkedWhenT2Observed: boolean;
  t1: T1Outcome;
  t2: T2Outcome;
};

/**
 * Park T1 at its first per-allocation reservation_release insert, start T2,
 * record the observed relation, then lift the barrier and let both settle.
 */
async function runInterleaving(
  startT1: () => Promise<void>,
  startT2: () => Promise<T2Outcome>
): Promise<Interleaving> {
  const pgdb = assertDisposableTestDb();
  const uniq = crypto.randomUUID().replace(/-/g, '');
  const K = 1 + Math.floor(Math.random() * 2_000_000_000);
  const fnName = `r2_pause_alloc_release_${uniq}`;
  const trgName = `r2_pause_alloc_release_trg_${uniq}`;
  const coord = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGMIGRATION_USER,
      password: String(process.env.PGMIGRATION_PASSWORD || ''),
      database: pgdb,
    },
    pool: { min: 1, max: 1 },
  });

  let t1Promise: Promise<T1Outcome> | null = null;
  let t2Promise: Promise<T2Outcome> | null = null;
  try {
    const who = await coord.raw('SELECT current_database() AS db');
    if (who.rows[0].db !== pgdb) throw new Error(`R2: coordinator resolved to "${who.rows[0].db}"`);

    await coord.raw(
      `CREATE FUNCTION ${fnName}() RETURNS trigger LANGUAGE plpgsql AS $$ ` +
      `BEGIN PERFORM pg_advisory_xact_lock(${K}); RETURN NEW; END; $$;`
    );
    await coord.raw(
      `CREATE TRIGGER ${trgName} BEFORE INSERT ON inventory_movements FOR EACH ROW ` +
      `WHEN (NEW.movement_type = 'reservation_release' AND NEW.reference_type = 'pick_reservation_allocation') ` +
      `EXECUTE FUNCTION ${fnName}();`
    );
    await coord.raw(`SELECT pg_advisory_lock(${K})`);

    t1Promise = startT1().then(
      () => ({ committed: true } as T1Outcome),
      (e: any) => ({ committed: false, code: e?.code ?? null, message: String(e?.message ?? e) } as T1Outcome)
    );

    const t1Pid = await waitFor(async () => {
      const r = await coord.raw(
        `SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${K} AND objsubid=1 AND NOT granted`);
      return (r.rows[0]?.pid as number | undefined) ?? null;
    }, 'T1 parked at its per-allocation reservation_release insert');

    let t2Settled = false;
    t2Promise = startT2().then((r) => { t2Settled = true; return r; });

    const relation = await waitFor(async () => {
      if (t2Settled) return { kind: 'T2_COMPLETED_WHILE_T1_PARKED' as const, pid: null };
      const r = await coord.raw(
        `SELECT a.pid FROM pg_stat_activity a
           WHERE a.backend_type = 'client backend' AND a.pid <> ${t1Pid}
             AND ${t1Pid} = ANY(pg_blocking_pids(a.pid)) LIMIT 1`);
      const pid = (r.rows[0]?.pid as number | undefined) ?? null;
      return pid ? { kind: 'T2_BLOCKED_BY_T1' as const, pid } : null;
    }, 'T2 either completed while T1 parked, or blocked by T1');

    const stillParked = await coord.raw(
      `SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${K} AND objsubid=1 AND pid=${t1Pid} AND NOT granted`);

    await coord.raw(`SELECT pg_advisory_unlock(${K})`);
    const [t1, t2] = await Promise.all([t1Promise, t2Promise]);

    const interleaving: Interleaving = {
      t1Pid,
      t2Relation: relation.kind,
      t2BlockedPid: relation.pid,
      t1StillParkedWhenT2Observed: stillParked.rows.length === 1,
      t1,
      t2,
    };
    return interleaving;
  } finally {
    try { await coord.raw(`SELECT pg_advisory_unlock_all()`); } catch { /* reported below */ }
    if (t1Promise) await t1Promise.catch(() => undefined);
    if (t2Promise) await t2Promise.catch(() => undefined);
    try { await coord.raw(`DROP TRIGGER IF EXISTS ${trgName} ON inventory_movements`); } catch { /* reported below */ }
    try { await coord.raw(`DROP FUNCTION IF EXISTS ${fnName}()`); } catch { /* reported below */ }
    const residual = await coord.raw(`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'r2_pause_alloc_release%'`);
    await coord.destroy();
    if (residual.rows.length > 0) throw new Error(`R2 test-only trigger leaked: ${JSON.stringify(residual.rows)}`);
  }
}

// ── shared scenario ─────────────────────────────────────────────────────────

const QTY_A1 = 2;
const QTY_A2 = 1;
const QTY_B1 = 3;

async function arrangeTwoBatches(label: string) {
  const { shopId, token } = await provisionFt2Shop(label);
  const { variantId, productId, locationCode } = await pickRootVariant(shopId, QTY_A1 + QTY_A2 + QTY_B1);
  const before = await truthAt(shopId, variantId, locationCode);
  expect(before.reserved).toBe(0);
  expect(before.available).toBe(before.onHand);
  const othersBefore = await otherTruth(shopId, variantId, locationCode);

  const a1 = await seedHealthyOrder(shopId, { quantity: QTY_A1, variantId, productId });
  const a2 = await seedHealthyOrder(shopId, { quantity: QTY_A2, variantId, productId });
  const b1 = await seedHealthyOrder(shopId, { quantity: QTY_B1, variantId, productId });

  const relA = await postRelease(token, { priority_order_ids: [a1.orderId, a2.orderId], exclusive: true });
  expect(relA.status).toBe(201);
  expect(relA.body.order_count).toBe(2);
  const batchA: string = relA.body.pick_batch_id;
  const relB = await postRelease(token, { priority_order_ids: [b1.orderId], exclusive: true });
  expect(relB.status).toBe(201);
  expect(relB.body.order_count).toBe(1);
  const batchB: string = relB.body.pick_batch_id;

  const total = QTY_A1 + QTY_A2 + QTY_B1;
  expect(await truthAt(shopId, variantId, locationCode)).toEqual({
    onHand: before.onHand, reserved: total, available: before.onHand - total,
  });
  const allocations = await allocationsAt(shopId, variantId, locationCode);
  expect(allocations.map(({ allocation_id, ...r }) => r)).toEqual(
    [
      { pick_batch_id: batchA, lasyncro_order_id: a1.orderId, quantity: QTY_A1 },
      { pick_batch_id: batchA, lasyncro_order_id: a2.orderId, quantity: QTY_A2 },
      { pick_batch_id: batchB, lasyncro_order_id: b1.orderId, quantity: QTY_B1 },
    ].sort((x, y) => `${x.pick_batch_id}|${x.lasyncro_order_id}`.localeCompare(`${y.pick_batch_id}|${y.lasyncro_order_id}`))
  );
  const holdsBefore = (await ledgerAt(shopId, variantId, locationCode));
  expect(holdsBefore).toEqual(
    [
      { movement_type: 'reservation_hold', reference_type: 'pick_batch', reference_id: batchA, quantity_delta: QTY_A1 + QTY_A2 },
      { movement_type: 'reservation_hold', reference_type: 'pick_batch', reference_id: batchB, quantity_delta: QTY_B1 },
    ].sort((a, b) => `${a.movement_type}|${a.reference_type}|${a.reference_id}`.localeCompare(`${b.movement_type}|${b.reference_type}|${b.reference_id}`))
  );
  expect(await batchStatus(shopId, batchA)).toBe('pending');
  expect(await batchStatus(shopId, batchB)).toBe('pending');

  return {
    shopId, token, variantId, locationCode, before, othersBefore, a1, a2, b1, batchA, batchB,
    batchAAllocationIds: allocations.filter((a) => a.pick_batch_id === batchA).map((a) => a.allocation_id),
    batchBAllocationIds: allocations.filter((a) => a.pick_batch_id === batchB).map((a) => a.allocation_id),
    a1AllocationId: allocations.find((a) => a.lasyncro_order_id === a1.orderId)!.allocation_id,
  };
}

async function collectPostState(ctx: Awaited<ReturnType<typeof arrangeTwoBatches>>) {
  const { shopId, variantId, locationCode } = ctx;
  const ledger = await ledgerAt(shopId, variantId, locationCode);
  const truth = await truthAt(shopId, variantId, locationCode);
  const allocations = await allocationsAt(shopId, variantId, locationCode);
  const batchAStatus = await batchStatus(shopId, ctx.batchA);
  const batchAMembers = await batchMembers(shopId, ctx.batchA);
  const batchAAllocations = allocations.filter((a) => a.pick_batch_id === ctx.batchA);
  const batchBAllocations = allocations.filter((a) => a.pick_batch_id === ctx.batchB);
  const fulfillmentRemovalRows = ledger.filter((r) => r.movement_type === 'fulfillment_removal');
  return {
    ledger,
    truth,
    allocations,
    batchAStatus,
    batchAMembers,
    batchBStatus: await batchStatus(shopId, ctx.batchB),
    batchBMembers: await batchMembers(shopId, ctx.batchB),
    batchAAllocations,
    batchBAllocations,
    fulfillmentRemovalRows,
    a1PerAllocationReleaseRows: ledger.filter(
      (r) => r.movement_type === 'reservation_release' &&
        r.reference_type === 'pick_reservation_allocation' && r.reference_id === ctx.a1AllocationId),
    batchAPickBatchReleaseRows: ledger.filter(
      (r) => r.movement_type === 'reservation_release' &&
        r.reference_type === 'pick_batch' && r.reference_id === ctx.batchA),
    othersAfter: await otherTruth(shopId, variantId, locationCode),
  };
}

/** Invariant view, independent of which transaction won. */
function invariantView(ctx: Awaited<ReturnType<typeof arrangeTwoBatches>>, post: Awaited<ReturnType<typeof collectPostState>>) {
  const survivingTotal = post.allocations.reduce((s, a) => s + a.quantity, 0);
  const batchASurviving = post.batchAAllocations.reduce((s, a) => s + a.quantity, 0);
  const batchBSurviving = post.batchBAllocations.reduce((s, a) => s + a.quantity, 0);
  const removedUnits = -post.fulfillmentRemovalRows.reduce((s, r) => s + r.quantity_delta, 0);
  return {
    truthReservedMinusSurvivingAllocations: post.truth.reserved - survivingTotal,
    availableMinusOnHandPlusReserved: post.truth.available - (post.truth.onHand - post.truth.reserved),
    onHandEqualsBeforeMinusPhysicallyRemoved: post.truth.onHand === ctx.before.onHand - removedUnits,
    batchALedgerNetMinusSurviving:
      batchReservationLedgerNet(post.ledger, ctx.batchA, ctx.batchAAllocationIds) - batchASurviving,
    batchBLedgerNetMinusSurviving:
      batchReservationLedgerNet(post.ledger, ctx.batchB, ctx.batchBAllocationIds) - batchBSurviving,
    batchBIntact: {
      status: post.batchBStatus,
      members: post.batchBMembers,
      allocationQuantity: batchBSurviving,
    },
    batchAStateConsistent:
      (post.batchAStatus === 'cancelled' && post.batchAMembers.length === 0 && post.batchAAllocations.length === 0) ||
      (post.batchAStatus === 'pending' &&
        post.batchAAllocations.every((a) => post.batchAMembers.includes(a.lasyncro_order_id))),
    unrelatedTruthUnchanged: post.othersAfter === ctx.othersBefore,
  };
}

/** Evidence line on stdout (console.* may be mocked); printed on PASS and FAIL. */
function emitEvidence(label: string, evidence: unknown): void {
  process.stdout.write(`\n[${label}] ${JSON.stringify(evidence)}\n`);
}

function expectedInvariantView(ctx: Awaited<ReturnType<typeof arrangeTwoBatches>>) {
  return {
    truthReservedMinusSurvivingAllocations: 0,
    availableMinusOnHandPlusReserved: 0,
    onHandEqualsBeforeMinusPhysicallyRemoved: true,
    batchALedgerNetMinusSurviving: 0,
    batchBLedgerNetMinusSurviving: 0,
    batchBIntact: { status: 'pending', members: [ctx.b1.orderId], allocationQuantity: QTY_B1 },
    batchAStateConsistent: true,
    unrelatedTruthUnchanged: true,
  };
}

describe('GH-1145 R0-1 / R2 — concurrent unwind vs pending-batch cancellation releases each reservation at most once', () => {
  it('R2-A — order-cancellation unwind parked after selecting its allocation, concurrent batch cancellation', async () => {
    const ctx = await arrangeTwoBatches('a');

    const interleaving = await runInterleaving(
      () => cancelOrderThroughProjectionHandler(ctx.shopId, ctx.a1.externalOrderId),
      () => postCancelBatch(ctx.token, ctx.batchA).then((r) => ({ status: r.status, body: r.body }))
    );
    const post = await collectPostState(ctx);
    const evidence = {
      ids: { batchA: ctx.batchA, batchB: ctx.batchB, a1Order: ctx.a1.orderId, a2Order: ctx.a2.orderId,
        b1Order: ctx.b1.orderId, a1AllocationId: ctx.a1AllocationId },
      before: ctx.before,
      interleaving,
      ledger: post.ledger,
      truth: post.truth,
      allocations: post.allocations,
      batchAStatus: post.batchAStatus,
      batchAMembers: post.batchAMembers,
      batchBStatus: post.batchBStatus,
      batchBMembers: post.batchBMembers,
      invariants: invariantView(ctx, post),
    };
    emitEvidence('R2A_EVIDENCE', evidence);

    expect({
      interleaving,
      ledger: post.ledger,
      truth: post.truth,
      allocations: post.allocations.map(({ allocation_id, ...r }) => r),
      batchAStatus: post.batchAStatus,
      batchAMembers: post.batchAMembers,
      a1PerAllocationReleaseRows: post.a1PerAllocationReleaseRows.length,
      batchAPickBatchReleaseRows: post.batchAPickBatchReleaseRows,
      invariants: invariantView(ctx, post),
    }).toEqual({
      interleaving: expect.anything(),
      ledger: expect.anything(),
      truth: expect.anything(),
      allocations: expect.anything(),
      batchAStatus: expect.anything(),
      batchAMembers: expect.anything(),
      a1PerAllocationReleaseRows: expect.anything(),
      batchAPickBatchReleaseRows: expect.anything(),
      invariants: expectedInvariantView(ctx),
    });
  }, 240_000);

  it('R2-B — Shopify fulfillment physical removal parked after selecting its allocation, concurrent batch cancellation', async () => {
    const ctx = await arrangeTwoBatches('b');

    const interleaving = await runInterleaving(
      () => fulfillOrderPhysically(ctx.shopId, ctx.a1.orderId),
      () => postCancelBatch(ctx.token, ctx.batchA).then((r) => ({ status: r.status, body: r.body }))
    );
    const post = await collectPostState(ctx);
    const evidence = {
      ids: { batchA: ctx.batchA, batchB: ctx.batchB, a1Order: ctx.a1.orderId, a2Order: ctx.a2.orderId,
        b1Order: ctx.b1.orderId, a1AllocationId: ctx.a1AllocationId },
      before: ctx.before,
      interleaving,
      ledger: post.ledger,
      truth: post.truth,
      allocations: post.allocations,
      batchAStatus: post.batchAStatus,
      batchAMembers: post.batchAMembers,
      batchBStatus: post.batchBStatus,
      batchBMembers: post.batchBMembers,
      invariants: invariantView(ctx, post),
    };
    emitEvidence('R2B_EVIDENCE', evidence);

    // R0-1 contract: the two transactions must SERIALIZE. A deadlock (40P01)
    // or HTTP 500 is not an acceptable resolution of the race — both allowed
    // serial orders commit the fulfillment and cancel the batch.
    expect({
      t1: interleaving.t1,
      t2Status: interleaving.t2.status,
    }).toEqual({
      t1: { committed: true },
      t2Status: 200,
    });

    expect({
      interleaving,
      ledger: post.ledger,
      truth: post.truth,
      allocations: post.allocations.map(({ allocation_id, ...r }) => r),
      batchAStatus: post.batchAStatus,
      batchAMembers: post.batchAMembers,
      a1PerAllocationReleaseRows: post.a1PerAllocationReleaseRows.length,
      batchAPickBatchReleaseRows: post.batchAPickBatchReleaseRows,
      invariants: invariantView(ctx, post),
    }).toEqual({
      interleaving: expect.anything(),
      ledger: expect.anything(),
      truth: expect.anything(),
      allocations: expect.anything(),
      batchAStatus: expect.anything(),
      batchAMembers: expect.anything(),
      a1PerAllocationReleaseRows: expect.anything(),
      batchAPickBatchReleaseRows: expect.anything(),
      invariants: expectedInvariantView(ctx),
    });
  }, 240_000);
});
