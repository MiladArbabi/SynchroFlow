/**
 * GH-1145 R0-1 RED CONTRACT — PICK OUTCOME vs ORDER-CANCELLATION UNWIND.
 *
 * Current suspected cycle:
 *   cancellationUnwind: pick_batches -> membership -> line status -> allocation -> truth
 *   pick outcome:       line/status or allocation -> truth -> pick_batches
 *
 * Deterministic barrier:
 *   A disposable-DB trigger parks the Pick transaction immediately after its
 *   inventory_truth update. At that point Pick still owns its line/allocation/
 *   truth locks and has not yet reached its later pick_batches update.
 *   The cancellation unwind is then started and must not create a PostgreSQL
 *   deadlock or partial physical/reservation state.
 */
import crypto from 'crypto';
import request from 'supertest';
import { knex as knexFactory, Knex } from 'knex';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemQuery, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { handleOrdersCancelled } from 'api-src/projection/handlers/orders.cancelled';
import { confirmPickScan } from 'api-src/services/wms/pickScan.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).andWhere('id', '>', afterId)
      .orderBy('id', 'asc').select('id'));
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

async function provisionFt2Shop(label: string): Promise<{ shopId: number; userId: number; token: string }> {
  const shopDomain = `r01-red-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
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
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);
  return { shopId, userId, token };
}

function postRelease(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/wms/batch/release')
    .set('Authorization', `Bearer ${token}`).send(body);
}

function postClaim(token: string, batchId: string) {
  return request(app).post(`/api/v1/wms/batch/${batchId}/claim`)
    .set('Authorization', `Bearer ${token}`).send({});
}

function postPickException(token: string, batchId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/v1/wms/batch/${batchId}/exception`)
    .set('Authorization', `Bearer ${token}`).send(body);
}

async function pickRootVariant(shopId: number, minAvailable: number) {
  const locationCode = `WH-${shopId}-ROOT`;
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth as it')
      .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
      .where('it.shop_id', shopId)
      .where('it.location_code', locationCode)
      .orderBy('it.available_quantity', 'desc')
      .first('it.lasyncro_variant_id', 'v.lasyncro_product_id', 'it.available_quantity', 'it.reserved_quantity'));
  expect(row).toBeTruthy();
  expect(Number(row.available_quantity)).toBeGreaterThanOrEqual(minAvailable);
  expect(Number(row.reserved_quantity)).toBe(0);
  return {
    variantId: row.lasyncro_variant_id as string,
    productId: row.lasyncro_product_id as string,
    locationCode,
  };
}

async function seedHealthyOrder(
  shopId: number,
  opts: { quantity: number; variantId: string; productId: string; label: string }
) {
  const orderId = crypto.randomUUID();
  const lineItemId = crypto.randomUUID();
  const externalOrderId =
    String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  const now = new Date();
  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
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
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineItemId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: opts.productId,
      lasyncro_variant_id: opts.variantId,
      sku: null,
      title: `R0-1 Pick Concurrency ${opts.label}`,
      quantity: opts.quantity,
      unit_price: '10.00',
      line_total: (10 * opts.quantity).toFixed(2),
      created_at: now,
      updated_at: now,
    });
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: now,
    });
  });
  return { orderId, externalOrderId, lineItemId };
}

function cancelOrderThroughProjectionHandler(shopId: number, externalOrderId: string) {
  const cancelledAt = new Date();
  return runWithTenantContext(shopId, () =>
    db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await trx.raw(`SET LOCAL "app.current_tenant" = '${Number(shopId)}'`);
      await handleOrdersCancelled({
        domainEvent: {
          shop_id: shopId,
          event_type: 'orders/cancelled',
          event_payload: { id: externalOrderId, cancelled_at: cancelledAt.toISOString() },
        },
        domain_event_id: 0,
        canonicalEventTime: cancelledAt,
        trx,
      });
    })
  );
}

async function truthAt(shopId: number, variantId: string, locationCode: string) {
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode })
      .first('on_hand_quantity', 'reserved_quantity', 'available_quantity'));
  return {
    onHand: Number(row.on_hand_quantity),
    reserved: Number(row.reserved_quantity),
    available: Number(row.available_quantity),
  };
}

async function allocationsAt(shopId: number, batchId: string) {
  const rows = await withTenant(shopId, (trx) =>
    trx('pick_reservation_allocations')
      .where({ shop_id: shopId, pick_batch_id: batchId })
      .orderBy('allocation_id')
      .select('allocation_id', 'lasyncro_order_id', 'lasyncro_line_item_id',
        'lasyncro_variant_id', 'location_code', 'quantity'));
  return rows.map((r: any) => ({ ...r, quantity: Number(r.quantity) }));
}

async function ledgerAt(shopId: number, variantId: string, locationCode: string) {
  const rows = await withTenant(shopId, (trx) =>
    trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode })
      .whereIn('movement_type', ['reservation_hold', 'reservation_release', 'pick_removal'])
      .orderBy(['movement_type', 'reference_type', 'reference_id'])
      .select('movement_type', 'reference_type', 'reference_id', 'quantity_delta'));
  return rows.map((r: any) => ({ ...r, reference_id: String(r.reference_id), quantity_delta: Number(r.quantity_delta) }));
}

async function batchStatus(shopId: number, batchId: string) {
  const row = await withTenant(shopId, (trx) =>
    trx('pick_batches').where({ shop_id: shopId, pick_batch_id: batchId }).first('status'));
  return row?.status ?? null;
}

async function scanLogAt(shopId: number, batchId: string) {
  const rows = await withTenant(shopId, (trx) =>
    trx('pick_scan_log').where({ shop_id: shopId, pick_batch_id: batchId })
      .orderBy('scan_id')
      .select('reservation_allocation_id', 'status', 'quantity_confirmed'));
  return rows.map((r: any) => ({
    reservation_allocation_id: r.reservation_allocation_id,
    status: r.status,
    quantity_confirmed: Number(r.quantity_confirmed),
  }));
}

type Fixture = Awaited<ReturnType<typeof arrangePickingBatch>>;

async function arrangePickingBatch(label: string, targetQuantity = 1) {
  const { shopId, userId, token } = await provisionFt2Shop(label);
  const { variantId, productId, locationCode } = await pickRootVariant(shopId, targetQuantity + 1);
  await withTenant(shopId, (trx) =>
    trx('shop_wms_settings')
      .where({ shop_id: shopId })
      .update({ problem_bin_location: `WH-${shopId}-PROBLEM` })
  );
  const before = await truthAt(shopId, variantId, locationCode);
  const target = await seedHealthyOrder(shopId, { quantity: targetQuantity, variantId, productId, label: 'target' });
  const bystander = await seedHealthyOrder(shopId, { quantity: 1, variantId, productId, label: 'bystander' });
  const release = await postRelease(token, { priority_order_ids: [target.orderId, bystander.orderId], exclusive: true });
  expect(release.status).toBe(201);
  const batchId: string = release.body.pick_batch_id;
  const claim = await postClaim(token, batchId);
  expect(claim.status).toBe(200);
  const allocations = await allocationsAt(shopId, batchId);
  const targetAllocation = allocations.find((a) => a.lasyncro_order_id === target.orderId);
  expect(targetAllocation).toBeTruthy();
  return { shopId, userId, token, variantId, locationCode, before, target, bystander, batchId, targetAllocation };
}

function assertDisposableTestDb(): string {
  const pgdb = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(pgdb)) {
    throw new Error(`R0-1 RED: refusing test DDL in non-disposable PGDATABASE "${pgdb}"`);
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

function timeoutAfter(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`BLOCKED_BY_TEST_INFRA: ${label}`)), ms);
  });
}

type TxOutcome<T> =
  | { committed: true; value: T }
  | { committed: false; code: string | null; message: string };

async function runPickVsCancelInterleaving<T1Value>(
  startPick: () => Promise<T1Value>,
  startCancel: () => Promise<void>,
  barrier: 'pick-truth-update' | 'short-pick-exception-insert' = 'pick-truth-update'
) {
  const pgdb = assertDisposableTestDb();
  const uniq = crypto.randomUUID().replace(/-/g, '');
  const K = 1 + Math.floor(Math.random() * 2_000_000_000);
  const fnName = `r01_pause_pick_${uniq}`;
  const trgName = `r01_pause_pick_trg_${uniq}`;
  const triggerTable = barrier === 'short-pick-exception-insert'
    ? 'pick_exceptions'
    : 'inventory_truth';
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
  let pickPromise: Promise<TxOutcome<T1Value>> | null = null;
  let cancelPromise: Promise<TxOutcome<void>> | null = null;
  let pickSettled: TxOutcome<T1Value> | null = null;

  try {
    await coord.raw(
      `CREATE FUNCTION ${fnName}() RETURNS trigger LANGUAGE plpgsql AS $$ ` +
      `BEGIN PERFORM pg_advisory_xact_lock(${K}); RETURN NEW; END; $$;`
    );
    if (barrier === 'short-pick-exception-insert') {
      await coord.raw(
        `CREATE TRIGGER ${trgName} AFTER INSERT ON pick_exceptions FOR EACH ROW ` +
        `WHEN (NEW.exception_type = 'short_pick' AND NEW.stage = 'pick') EXECUTE FUNCTION ${fnName}();`
      );
    } else {
      await coord.raw(
        `CREATE TRIGGER ${trgName} AFTER UPDATE ON inventory_truth FOR EACH ROW ` +
        `WHEN (NEW.reserved_quantity < OLD.reserved_quantity) EXECUTE FUNCTION ${fnName}();`
      );
    }
    await coord.raw(`SELECT pg_advisory_lock(${K})`);

    pickPromise = startPick().then(
      (value) => ({ committed: true, value } as TxOutcome<T1Value>),
      (e: any) => ({ committed: false, code: e?.code ?? null, message: String(e?.message ?? e) } as TxOutcome<T1Value>)
    ).then((outcome) => {
      pickSettled = outcome;
      return outcome;
    });

    const pickPid = await waitFor(async () => {
      if (pickSettled) {
        throw new Error(
          `BLOCKED_BY_TEST_INFRA: pick path completed before ${barrier}: ${JSON.stringify(pickSettled)}`
        );
      }
      const r = await coord.raw(
        `SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${K} AND objsubid=1 AND NOT granted`);
      return (r.rows[0]?.pid as number | undefined) ?? null;
    }, barrier === 'short-pick-exception-insert'
      ? 'Pick transaction parked after pick_exceptions insert'
      : 'Pick transaction parked after inventory_truth update');

    cancelPromise = startCancel().then(
      () => ({ committed: true, value: undefined } as TxOutcome<void>),
      (e: any) => ({ committed: false, code: e?.code ?? null, message: String(e?.message ?? e) } as TxOutcome<void>)
    );

    const blocker = await waitFor(async () => {
      const r = await coord.raw(
        `SELECT a.pid, pg_blocking_pids(a.pid) AS blockers
           FROM pg_stat_activity a
          WHERE a.backend_type = 'client backend'
            AND a.pid <> ${pickPid}
            AND ${pickPid} = ANY(pg_blocking_pids(a.pid))
          LIMIT 1`);
      return r.rows[0] ?? null;
    }, 'cancellation unwind blocked by parked Pick transaction');

    await coord.raw(`SELECT pg_advisory_unlock(${K})`);
    const [pick, cancel] = await Promise.race([
      Promise.all([pickPromise, cancelPromise]),
      timeoutAfter(20_000, 'pick/cancel transactions did not settle after barrier release'),
    ]);
    return { pickPid, cancelBlockedPid: Number(blocker.pid), blockers: blocker.blockers, pick, cancel };
  } finally {
    try { await coord.raw(`SELECT pg_advisory_unlock_all()`); } catch { /* best-effort cleanup */ }
    try { await coord.raw(`DROP TRIGGER IF EXISTS ${trgName} ON ${triggerTable}`); } catch { /* best-effort cleanup */ }
    try { await coord.raw(`DROP FUNCTION IF EXISTS ${fnName}()`); } catch { /* best-effort cleanup */ }
    const residual = await coord.raw(`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'r01_pause_pick%'`);
    await coord.destroy();
    if (residual.rows.length > 0) {
      throw new Error(`R0-1 RED test-only trigger leaked: ${JSON.stringify(residual.rows)}`);
    }
  }
}

async function collectState(ctx: Fixture) {
  return {
    orderState: await withTenant(ctx.shopId, trx => trx('order_warehouse_status')
      .where({ lasyncro_order_id: ctx.target.orderId }).first('status', 'pick_batch_id')),
    membership: await withTenant(ctx.shopId, trx => trx('pick_batch_orders')
      .where({ shop_id: ctx.shopId, lasyncro_order_id: ctx.target.orderId }).first()),
    lineState: await withTenant(ctx.shopId, trx => trx('order_line_item_warehouse_status')
      .where({ shop_id: ctx.shopId, lasyncro_line_item_id: ctx.target.lineItemId }).first('status')),
    batchStatus: await batchStatus(ctx.shopId, ctx.batchId),
    allocations: await allocationsAt(ctx.shopId, ctx.batchId),
    scanLog: await scanLogAt(ctx.shopId, ctx.batchId),
    ledger: await ledgerAt(ctx.shopId, ctx.variantId, ctx.locationCode),
    truth: await truthAt(ctx.shopId, ctx.variantId, ctx.locationCode),
  };
}

function assertEffectiveOwnership(ctx: Fixture, post: Awaited<ReturnType<typeof collectState>>) {
  const effective = post.allocations.reduce((total, allocation) => {
    expect(allocation.lasyncro_variant_id).toBe(ctx.variantId);
    expect(allocation.location_code).toBe(ctx.locationCode);
    const picked = post.scanLog.filter(scan => scan.status === 'confirmed' &&
      scan.reservation_allocation_id === allocation.allocation_id)
      .reduce((sum, scan) => sum + scan.quantity_confirmed, 0);
    const outstanding = allocation.quantity - picked;
    expect(outstanding).toBeGreaterThanOrEqual(0);
    return total + outstanding;
  }, 0);
  expect(post.truth.reserved).toBe(effective);
  expect(post.truth.available).toBe(post.truth.onHand - post.truth.reserved);
  expect(post.scanLog.filter(scan => scan.status === 'confirmed')).toEqual([{
    reservation_allocation_id: ctx.targetAllocation.allocation_id,
    status: 'confirmed', quantity_confirmed: 1,
  }]);
  expect(post.allocations.find(a => a.allocation_id === ctx.targetAllocation.allocation_id)?.quantity)
    .toBe(ctx.targetAllocation.quantity);
  expect(post.truth.onHand).toBe(ctx.before.onHand - 1);
  expect(post.membership).toBeUndefined();
  expect(post.orderState).toEqual({ status: 'cancelled', pick_batch_id: null });
  expect(post.lineState?.status).toBe('cancelled');
  expect(post.batchStatus).toBe('picking');
}

function emitEvidence(label: string, evidence: unknown): void {
  process.stdout.write(`\n[${label}] ${JSON.stringify(evidence)}\n`);
}

describe('GH-1145 R0-1 RED — pick outcome vs order-cancellation unwind lock order', () => {
  it('PS1 — confirmPickScan and orders/cancelled unwind serialize without deadlock or partial state', async () => {
    const ctx = await arrangePickingBatch('ps1');
    const interleaving = await runPickVsCancelInterleaving(
      () => runWithTenantContext(ctx.shopId, () =>
        db.transaction(async (trx: Knex.Transaction) => {
          await trx.raw(`SET LOCAL "app.current_tenant" = '${ctx.shopId}'`);
          await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
          return confirmPickScan(trx, {
            pickBatchId: ctx.batchId,
            lasyncroLineItemId: ctx.target.lineItemId,
            lasyncroVariantId: ctx.variantId,
            reservationAllocationId: ctx.targetAllocation.allocation_id,
            locationCode: ctx.locationCode,
            quantityConfirmed: 1,
            scannedBy: ctx.userId,
            shopId: ctx.shopId,
            scanSource: 'manual',
          });
        })
      ),
      () => cancelOrderThroughProjectionHandler(ctx.shopId, ctx.target.externalOrderId)
    );
    const post = await collectState(ctx);
    emitEvidence('PS1_EVIDENCE', { ids: ctx, interleaving, post });

    expect(interleaving.pick).toEqual({ committed: true, value: expect.anything() });
    expect(interleaving.cancel).toEqual({ committed: true, value: undefined });
    expect([interleaving.pick, interleaving.cancel].some((o) => !o.committed && o.code === '40P01')).toBe(false);
    assertEffectiveOwnership(ctx, post);
  }, 240_000);

  it('PS2 — short-pick exception and orders/cancelled unwind serialize without deadlock or HTTP 500', async () => {
    const ctx = await arrangePickingBatch('ps2', 2);
    const interleaving = await runPickVsCancelInterleaving(
      () => postPickException(ctx.token, ctx.batchId, {
        lasyncro_line_item_id: ctx.target.lineItemId,
        lasyncro_variant_id: ctx.variantId,
        reservation_allocation_id: ctx.targetAllocation.allocation_id,
        exception_type: 'short_pick',
        stage: 'pick',
        quantity_required: 2,
        quantity_found: 1,
        device_event_id: crypto.randomUUID(),
      }).then((r) => ({ status: r.status, body: r.body })),
      () => cancelOrderThroughProjectionHandler(ctx.shopId, ctx.target.externalOrderId),
      'short-pick-exception-insert'
    );
    const post = await collectState(ctx);
    emitEvidence('PS2_EVIDENCE', { ids: ctx, interleaving, post });

    expect(interleaving.pick).toEqual({ committed: true, value: { status: 201, body: expect.anything() } });
    expect(interleaving.cancel).toEqual({ committed: true, value: undefined });
    expect(interleaving.pick.committed && interleaving.pick.value.status).not.toBe(500);
    expect([interleaving.pick, interleaving.cancel].some((o) => !o.committed && o.code === '40P01')).toBe(false);
    assertEffectiveOwnership(ctx, post);
    const shortPickMovements = post.ledger.filter(row => row.reference_type === 'pick_exception');
    expect(shortPickMovements.filter(row => row.movement_type === 'pick_removal'))
      .toEqual([expect.objectContaining({ quantity_delta: -1 })]);
    expect(shortPickMovements.filter(row => row.movement_type === 'reservation_release'))
      .toEqual([expect.objectContaining({ quantity_delta: -1 })]);
    expect(new Set(shortPickMovements.map(row => row.reference_id)).size).toBe(1);
  }, 240_000);
});
