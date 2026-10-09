/**
 * GH-1086 — PACK-GATE-01 regression suite.
 *
 * Real release / pick / exception / pack surfaces against the disposable
 * integration database. No mocks of the code under test.
 *
 * LOCKED DOMAIN CONTRACT PROTECTED HERE
 * -------------------------------------
 *  1. A Pick problem is a Problem Center concern. It never returns an order
 *     that is already in warehouse execution to Order Pool, and never
 *     populates Blocked Orders.
 *  2. Batch membership (pick_batch_orders) is authoritative once released.
 *  3. Problem Center operational resolution (and pick_exceptions.resolved)
 *     resolves physical custody. It does NOT authorize shipment.
 *  4. Commercial Pack authorization is owned by pack_decision_requests.
 *  5. Partial Pack may never exceed physically picked quantity.
 *  6. Healthy orders in the same batch continue independently.
 *
 * Fail-closed is asserted as a deliberate 4xx refusal plus zero Pack
 * mutation. A 500 is a server fault, not a gate, and does not satisfy the
 * contract.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemQuery, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(180000);

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as pick-exception-allocation-1049.test.ts) ────

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

async function provisionFt2Shop(label: string): Promise<{ shopId: number; userId: number; token: string }> {
  const shopDomain = `pg1086-${label}-${Date.now()}.myshopify.com`;
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
  return { shopId, userId, token };
}

interface SeedLine { variantId: string; productId: string; quantity: number }

/** Minimum valid paid/pending order with the requested WMS-usable lines. */
async function seedOrder(shopId: number, lines: SeedLine[]): Promise<{
  orderId: string;
  lineItemIds: string[];
}> {
  const lasyncroOrderId = crypto.randomUUID();
  const lineItemIds = lines.map(() => crypto.randomUUID());
  const now = new Date();

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
    for (const [i, line] of lines.entries()) {
      await trx('order_line_items').insert({
        lasyncro_line_item_id: lineItemIds[i],
        lasyncro_order_id: lasyncroOrderId,
        lasyncro_product_id: line.productId,
        lasyncro_variant_id: line.variantId,
        sku: null,
        title: `GH1086 fixture line ${i + 1}`,
        quantity: line.quantity,
        unit_price: '10.00',
        line_total: (10 * line.quantity).toFixed(2),
        created_at: now,
        updated_at: now,
      });
    }
    // order_fulfillment_status is projection-single-writer guarded
    // (migration 0076). Transaction-local guard, identical to the pattern
    // release-readiness.test.ts / pick-exception-allocation-1049.test.ts use
    // to seed this table for an authorised fixture.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      status: 'pending',
      status_updated_at: now,
    });
  });

  return { orderId: lasyncroOrderId, lineItemIds };
}

/**
 * Per-unit identity (LSU-) is created by the receive workflow in production.
 * inventory_units.receive_job_line_id is NOT NULL, so the minimum valid
 * fixture is supplier → purchase_order → receive_job → receive_job_line.
 * Synthetic identifiers only; no provider identifiers, no network.
 */
async function seedStowedUnit(
  shopId: number,
  opts: { variantId: string; locationCode: string; receiveJobId: string; sequence: number }
): Promise<string> {
  const unitId = `LSU-${crypto.randomBytes(4).toString('hex')}`;
  await withTenant(shopId, async (trx) => {
    const existing = await trx('receive_job_lines')
      .where({
        shop_id: shopId,
        receive_job_id: opts.receiveJobId,
        lasyncro_variant_id: opts.variantId,
      })
      .first('receive_job_line_id');

    const lineId =
      existing?.receive_job_line_id ??
      (
        await trx('receive_job_lines')
          .insert({
            shop_id: shopId,
            receive_job_id: opts.receiveJobId,
            lasyncro_variant_id: opts.variantId,
            quantity_expected: 10,
          })
          .returning('receive_job_line_id')
      )[0].receive_job_line_id;

    await trx('inventory_units').insert({
      shop_id: shopId,
      lasyncro_unit_id: unitId,
      lasyncro_variant_id: opts.variantId,
      receive_job_line_id: lineId,
      receive_sequence: opts.sequence,
      status: 'stowed',
      current_location_code: opts.locationCode,
    });
  });
  return unitId;
}

async function seedReceiveJob(shopId: number): Promise<string> {
  return withTenant(shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shopId, name: `GH1086 fixture supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: supplier.id })
      .returning('id');
    const [job] = await trx('receive_jobs')
      .insert({ shop_id: shopId, po_id: po.id })
      .returning('receive_job_id');
    return job.receive_job_id as string;
  });
}

// ── request helpers ─────────────────────────────────────────────────────────

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function readyToPack(f: Fixture) {
  return request(app).get('/api/v1/wms/batches/ready-to-pack').set(auth(f.token));
}

function orderPool(f: Fixture) {
  return request(app).get('/api/v1/wms/order-pool').set(auth(f.token));
}

function blockedOrders(f: Fixture) {
  return request(app).get('/api/v1/orders/constrained').set(auth(f.token));
}

/**
 * Canonical Starter-accessible Problem Center surface.
 * GET /problem-center is requireCapability('warehouse.operations'); the
 * /problem-center/pick-exceptions variant is Core-only and is therefore not
 * the surface a Starter warehouse tenant actually works from.
 */
function problemCenterTasks(f: Fixture) {
  return request(app)
    .get('/api/v1/wms/problem-center')
    .set(auth(f.token));
}

function claimPack(f: Fixture) {
  return request(app).post(`/api/v1/wms/batch/${f.batchId}/pack/claim`).set(auth(f.token)).send({});
}

function packScan(f: Fixture, orderId: string, lineItemId: string, variantId: string, quantity: number) {
  return request(app).post('/api/v1/wms/pack/scan').set(auth(f.token)).send({
    pick_batch_id: f.batchId,
    lasyncro_order_id: orderId,
    lasyncro_line_item_id: lineItemId,
    lasyncro_variant_id: variantId,
    quantity_confirmed: quantity,
  });
}

function freeScan(f: Fixture, scannedValue: string) {
  return request(app).post('/api/v1/wms/pack/free-scan').set(auth(f.token)).send({
    scanned_value: scannedValue,
  });
}

function completePack(f: Fixture) {
  return request(app).post(`/api/v1/wms/batch/${f.batchId}/pack-complete`).set(auth(f.token)).send({});
}

function raiseDecision(
  f: Fixture,
  orderId: string,
  lineItemId: string,
  question: 'ship_partial' | 'hold_and_requeue',
  exceptionType: 'item_missing' | 'short_pick' = 'short_pick'
) {
  return request(app).post('/api/v1/wms/pack/decision-request').set(auth(f.token)).send({
    pick_batch_id: f.batchId,
    lasyncro_order_id: orderId,
    lasyncro_line_item_id: lineItemId,
    exception_type: exceptionType,
    question,
  });
}

function resolveDecision(
  f: Fixture,
  requestId: string,
  body: { status: 'approved' | 'rejected'; partial_shipment?: boolean; note?: string }
) {
  return request(app)
    .post(`/api/v1/wms/pack/decision-request/${requestId}/resolve`)
    .set(auth(f.token))
    .send(body);
}

/**
 * The real operational resolution workflow available to a Starter tenant.
 * Resolving the Problem Center task cascades to the linked pick_exceptions
 * row in production (BL-08), which is exactly what test C needs in order to
 * prove that a resolved exception is still not Pack authorization.
 */
function resolveProblemTask(
  f: Fixture,
  taskId: string,
  resolutionAction: 're_stow' | 'discard' | 'write_off' | 'quarantine' | 'find_replacement'
) {
  return request(app)
    .post(`/api/v1/wms/problem-center/${taskId}/resolve`)
    .set(auth(f.token))
    .send({
      resolution_action: resolutionAction,
      resolution_notes: 'GH1086 physical custody resolved on the floor',
    });
}

// ── fixture ─────────────────────────────────────────────────────────────────

/**
 * One released batch containing:
 *   healthy  — single line, fully picked, no deficit
 *   affected — two lines; one fully picked, one short_pick (3 required,
 *              1 physically picked, 2 missing) → unresolved fulfillment deficit
 * Batch is driven to pick_complete through the real routes.
 */
async function fixture() {
  // Fail closed: this suite must only ever run against a disposable DB.
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const f = await provisionFt2Shop(crypto.randomUUID());

  const variants = await withTenant(f.shopId, (trx) =>
    trx('variants').where({ shop_id: f.shopId })
      .orderBy('sku').limit(3).select('lasyncro_variant_id', 'lasyncro_product_id')
  );
  expect(variants).toHaveLength(3);

  const healthy = await seedOrder(f.shopId, [
    { variantId: variants[0].lasyncro_variant_id, productId: variants[0].lasyncro_product_id, quantity: 1 },
  ]);
  const affected = await seedOrder(f.shopId, [
    { variantId: variants[1].lasyncro_variant_id, productId: variants[1].lasyncro_product_id, quantity: 1 },
    { variantId: variants[2].lasyncro_variant_id, productId: variants[2].lasyncro_product_id, quantity: 3 },
  ]);

  const release = await request(app).post('/api/v1/wms/batch/release').set(auth(f.token))
    .send({ priority_order_ids: [healthy.orderId, affected.orderId], exclusive: true });
  expect({ status: release.status, body: release.body })
    .toMatchObject({ status: 201, body: { order_count: 2 } });
  const batchId = release.body.pick_batch_id as string;

  const claim = await request(app).post(`/api/v1/wms/batch/${batchId}/claim`)
    .set(auth(f.token)).send({});
  expect(claim.status).toBe(200);

  const allocations = await withTenant(f.shopId, (trx) =>
    trx('pick_reservation_allocations')
      .where({ shop_id: f.shopId, pick_batch_id: batchId })
      .select('*')
  );
  expect(allocations).toHaveLength(3);

  const allocFor = (lineItemId: string) => {
    const row = allocations.find((a: any) => a.lasyncro_line_item_id === lineItemId);
    expect(row).toBeTruthy();
    return row;
  };

  const healthyAlloc = allocFor(healthy.lineItemIds[0]);
  const affectedFullAlloc = allocFor(affected.lineItemIds[0]);
  const affectedShortAlloc = allocFor(affected.lineItemIds[1]);

  // Per-unit identity for the two lines that are physically picked in full.
  const receiveJobId = await seedReceiveJob(f.shopId);
  const healthyUnit = await seedStowedUnit(f.shopId, {
    variantId: healthyAlloc.lasyncro_variant_id,
    locationCode: healthyAlloc.location_code,
    receiveJobId, sequence: 1,
  });
  const affectedUnit = await seedStowedUnit(f.shopId, {
    variantId: affectedFullAlloc.lasyncro_variant_id,
    locationCode: affectedFullAlloc.location_code,
    receiveJobId, sequence: 1,
  });

  expect((await pickScanRaw(f.token, batchId, healthyAlloc, 1, healthyUnit)).status).toBe(201);
  expect((await pickScanRaw(f.token, batchId, affectedFullAlloc, 1, affectedUnit)).status).toBe(201);

  // Fulfillment deficit: 3 required, 1 physically picked, 2 missing.
  const exception = await request(app)
    .post(`/api/v1/wms/batch/${batchId}/exception`)
    .set(auth(f.token))
    .send({
      lasyncro_line_item_id: affectedShortAlloc.lasyncro_line_item_id,
      lasyncro_variant_id: affectedShortAlloc.lasyncro_variant_id,
      reservation_allocation_id: affectedShortAlloc.allocation_id,
      location_code: affectedShortAlloc.location_code,
      exception_type: 'short_pick',
      stage: 'pick',
      quantity_required: 3,
      quantity_found: 1,
      device_event_id: crypto.randomUUID(),
      notes: 'GH1086 two units missing at allocation location',
    });
  expect({ status: exception.status, body: exception.body })
    .toMatchObject({ status: 201, body: { pick_exception_id: expect.any(String) } });

  const completePick = await request(app)
    .post(`/api/v1/wms/batch/${batchId}/pick-complete`)
    .set(auth(f.token)).send({});
  expect(completePick.status).toBe(200);

  /**
   * The server-owned Problem Center incident raised alongside the Pick
   * exception (createProblemCenterTask, same transaction). Read here only to
   * ADDRESS the task through the HTTP surface below — every Problem Center
   * contract in this suite is still asserted through the route, never here.
   */
  const problemTask = await withTenant(f.shopId, (trx) =>
    trx('problem_center_tasks')
      .where({
        shop_id: f.shopId,
        source: 'pick',
        source_exception_id: exception.body.pick_exception_id as string,
      })
      .first('problem_task_id')
  );
  expect(problemTask?.problem_task_id).toBeTruthy();

  const orders = await withTenant(f.shopId, (trx) =>
    trx('orders').where({ shop_id: f.shopId })
      .whereIn('lasyncro_order_id', [healthy.orderId, affected.orderId])
      .select('lasyncro_order_id', 'wms_barcode')
  );
  const barcodeFor = (orderId: string) => {
    const row = orders.find((o: any) => o.lasyncro_order_id === orderId);
    expect(row?.wms_barcode).toBeTruthy();
    return row.wms_barcode as string;
  };

  return {
    ...f,
    batchId,
    healthy: {
      orderId: healthy.orderId,
      lineItemId: healthy.lineItemIds[0],
      variantId: healthyAlloc.lasyncro_variant_id,
      unitId: healthyUnit,
      barcode: barcodeFor(healthy.orderId),
    },
    affected: {
      orderId: affected.orderId,
      fullLineItemId: affected.lineItemIds[0],
      fullVariantId: affectedFullAlloc.lasyncro_variant_id,
      shortLineItemId: affected.lineItemIds[1],
      shortVariantId: affectedShortAlloc.lasyncro_variant_id,
      unitId: affectedUnit,
      barcode: barcodeFor(affected.orderId),
      pickExceptionId: exception.body.pick_exception_id as string,
      problemTaskId: problemTask.problem_task_id as string,
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** pickScan needs the batch id before the Fixture object exists. */
function pickScanRaw(
  token: string,
  batchId: string,
  alloc: any,
  quantity: number,
  unitId?: string
) {
  return request(app).post('/api/v1/wms/pick/scan').set(auth(token)).send({
    pick_batch_id: batchId,
    lasyncro_line_item_id: alloc.lasyncro_line_item_id,
    lasyncro_variant_id: alloc.lasyncro_variant_id,
    reservation_allocation_id: alloc.allocation_id,
    location_code: alloc.location_code,
    quantity_confirmed: quantity,
    ...(unitId ? { lasyncro_unit_id: unitId } : {}),
  });
}

// ── shop-scoped state readers ───────────────────────────────────────────────

async function state(f: Fixture) {
  return withTenant(f.shopId, async (trx) => ({
    members: await trx('pick_batch_orders')
      .where({ shop_id: f.shopId }).orderBy('lasyncro_order_id')
      .select('lasyncro_order_id', 'pick_batch_id'),
    packScans: await trx('pack_scan_log')
      .where({ shop_id: f.shopId }).orderBy('scan_id')
      .select('scan_id', 'lasyncro_order_id', 'lasyncro_line_item_id', 'quantity_confirmed', 'status'),
    batch: await trx('pick_batches')
      .where({ shop_id: f.shopId, pick_batch_id: f.batchId })
      .first('status', 'units_packed', 'packed_by'),
    ows: await trx('order_warehouse_status')
      .whereIn('lasyncro_order_id', [f.healthy.orderId, f.affected.orderId])
      .orderBy('lasyncro_order_id')
      .select('lasyncro_order_id', 'status'),
    olws: await trx('order_line_item_warehouse_status')
      .where({ shop_id: f.shopId }).orderBy('lasyncro_line_item_id')
      .select('lasyncro_line_item_id', 'status'),
    exceptions: await trx('pick_exceptions')
      .where({ shop_id: f.shopId }).orderBy('pick_exception_id')
      .select('pick_exception_id', 'exception_type', 'quantity_required', 'quantity_found', 'resolved'),
    decisions: await trx('pack_decision_requests')
      .where({ shop_id: f.shopId }).orderBy('id')
      .select('id', 'lasyncro_order_id', 'status', 'partial_shipment'),
    constraints: await trx('order_constraints')
      .whereIn('lasyncro_order_id', [f.healthy.orderId, f.affected.orderId])
      .where('is_active', true)
      .select('lasyncro_order_id', 'constraint_type'),
  }));
}

const orderIdsIn = (rows: any[]) => rows.map((r) => r.lasyncro_order_id);
const scansForOrder = (s: any, orderId: string) =>
  s.packScans.filter((r: any) => r.lasyncro_order_id === orderId);
const owsFor = (s: any, orderId: string) =>
  s.ows.find((r: any) => r.lasyncro_order_id === orderId)?.status;

/** A gate refuses deliberately. A 500 is a server fault, not a gate. */
function expectFailClosed(res: { status: number; body: unknown }) {
  expect({ status: res.status, body: res.body })
    .toEqual({ status: expect.any(Number), body: expect.anything() });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
}

// ─────────────────────────────────────────────────────────────────────────────
// A. MIXED BATCH DISCOVERY
// ─────────────────────────────────────────────────────────────────────────────

it('A — a pick-deficient order is withheld from ready-to-pack, stays in its batch, and surfaces only through Problem Center', async () => {
  const f = await fixture();

  const ready = await readyToPack(f);
  expect(ready.status).toBe(200);
  const readyOrderIds = orderIdsIn(ready.body.orders ?? []);

  // Healthy work continues independently.
  expect(readyOrderIds).toContain(f.healthy.orderId);

  // The order carrying an unresolved fulfillment deficit is not ordinary
  // ready-to-pack work.
  expect(readyOrderIds).not.toContain(f.affected.orderId);

  const after = await state(f);

  // Batch/history association remains authoritative.
  expect(orderIdsIn(after.members).sort())
    .toEqual([f.healthy.orderId, f.affected.orderId].sort());
  expect(
    after.members.find((m: any) => m.lasyncro_order_id === f.affected.orderId).pick_batch_id
  ).toBe(f.batchId);

  // The affected order is represented as a Problem Center concern, through
  // the linked problem_center_tasks record on the Starter operational surface.
  const pc = await problemCenterTasks(f);
  expect(pc.status).toBe(200);
  expect(
    (pc.body.problem_tasks ?? []).filter(
      (t: any) => t.problem_task_id === f.affected.problemTaskId
    )
  ).toEqual([
    expect.objectContaining({
      problem_task_id: f.affected.problemTaskId,
      source: 'pick',
      exception_type: 'short_pick',
      // Problem work owns only the missing remainder: 3 required - 1 found.
      quantity: 2,
      status: 'open',
    }),
  ]);

  // A Pick problem is never an Order Flow concern.
  const pool = await orderPool(f);
  expect(pool.status).toBe(200);
  expect(orderIdsIn(pool.body.orders ?? [])).not.toContain(f.affected.orderId);

  const blocked = await blockedOrders(f);
  expect(blocked.status).toBe(200);
  expect(orderIdsIn(blocked.body.data ?? [])).not.toContain(f.affected.orderId);
  expect(after.constraints).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// B. HOLD DECISION
// ─────────────────────────────────────────────────────────────────────────────

it('B — an owner hold/reject decision holds the order in its batch and never requeues it to Order Pool or Blocked Orders', async () => {
  const f = await fixture();

  const raised = await raiseDecision(
    f, f.affected.orderId, f.affected.shortLineItemId, 'hold_and_requeue'
  );
  expect(raised.status).toBe(201);
  const requestId = raised.body.request.id as string;

  const resolved = await resolveDecision(f, requestId, {
    status: 'rejected',
    note: 'GH1086 hold — do not ship',
  });
  expect(resolved.status).toBe(200);
  expect(resolved.body.request).toMatchObject({ id: requestId, status: 'rejected' });

  const after = await state(f);

  // Held, not requeued: batch membership survives the hold.
  expect(orderIdsIn(after.members)).toContain(f.affected.orderId);
  expect(
    after.members.find((m: any) => m.lasyncro_order_id === f.affected.orderId).pick_batch_id
  ).toBe(f.batchId);

  // Never back to Order Pool.
  const pool = await orderPool(f);
  expect(pool.status).toBe(200);
  expect(orderIdsIn(pool.body.orders ?? [])).not.toContain(f.affected.orderId);

  // Never into Blocked Orders.
  const blocked = await blockedOrders(f);
  expect(blocked.status).toBe(200);
  expect(orderIdsIn(blocked.body.data ?? [])).not.toContain(f.affected.orderId);
  expect(after.constraints).toEqual([]);

  // A hold is not an authorization — the order stays non-packable.
  const ready = await readyToPack(f);
  expect(ready.status).toBe(200);
  expect(orderIdsIn(ready.body.orders ?? [])).not.toContain(f.affected.orderId);
});

// ─────────────────────────────────────────────────────────────────────────────
// C. OPERATIONAL RESOLUTION IS NOT PACK AUTHORIZATION
// ─────────────────────────────────────────────────────────────────────────────

it('C — resolving the Pick exception settles custody only; resolved=true is not Pack authorization', async () => {
  const f = await fixture();

  /**
   * re_stow is the operational resolution chosen here: it is a genuine
   * physical-custody outcome for missing units, it resolves the task outright
   * (unlike find_replacement, which parks it in 'investigating' and
   * deliberately does not cascade), and its only side effect is a pending
   * stow task — no inventory_truth preconditions, unlike discard / write_off /
   * quarantine. That keeps this test about Pack authorization.
   */
  const resolve = await resolveProblemTask(f, f.affected.problemTaskId, 're_stow');
  expect({ status: resolve.status, body: resolve.body }).toMatchObject({
    status: 200,
    body: {
      problem_task_id: f.affected.problemTaskId,
      resolved: true,
      resolution_action: 're_stow',
      status: 'resolved',
    },
  });

  const resolvedState = await state(f);
  // Production cascade (BL-08): resolving the task closes the pick exception.
  expect(
    resolvedState.exceptions.find(
      (e: any) => e.pick_exception_id === f.affected.pickExceptionId
    ).resolved
  ).toBe(true);

  // No commercial Pack authorization was created by the operational action.
  expect(resolvedState.decisions).toEqual([]);

  // Still not ordinary ready-to-pack work.
  const ready = await readyToPack(f);
  expect(ready.status).toBe(200);
  expect(orderIdsIn(ready.body.orders ?? [])).not.toContain(f.affected.orderId);

  // Still not packable at the execution surface.
  expect((await claimPack(f)).status).toBe(200);
  const before = await state(f);

  const scan = await packScan(
    f, f.affected.orderId, f.affected.shortLineItemId, f.affected.shortVariantId, 3
  );
  expectFailClosed(scan);

  const after = await state(f);
  expect(scansForOrder(after, f.affected.orderId)).toEqual([]);
  expect(Number(after.batch.units_packed)).toBe(Number(before.batch.units_packed));
});

// ─────────────────────────────────────────────────────────────────────────────
// D. DIRECT PACK SCAN BYPASS
// ─────────────────────────────────────────────────────────────────────────────

it('D — a direct pack scan on an unauthorized deficient order fails closed with zero Pack side effects', async () => {
  const f = await fixture();

  const beforeClaim = await state(f);
  expect((await claimPack(f)).status).toBe(200);
  const afterClaim = await state(f);

  // Claiming Pack is not an authorization event for a deficient order:
  // it must not drive that order into Pack execution.
  expect(owsFor(afterClaim, f.affected.orderId))
    .toBe(owsFor(beforeClaim, f.affected.orderId));

  const scan = await packScan(
    f, f.affected.orderId, f.affected.shortLineItemId, f.affected.shortVariantId, 3
  );
  expectFailClosed(scan);

  const after = await state(f);

  // No pack evidence written.
  expect(scansForOrder(after, f.affected.orderId)).toEqual([]);
  // units_packed unchanged.
  expect(Number(after.batch.units_packed)).toBe(Number(afterClaim.batch.units_packed));
  // Order and line warehouse status unchanged across the refused scan.
  expect(after.ows).toEqual(afterClaim.ows);
  expect(after.olws).toEqual(afterClaim.olws);
});

// ─────────────────────────────────────────────────────────────────────────────
// E. LSU FREE-SCAN BYPASS
// ─────────────────────────────────────────────────────────────────────────────

it('E — a unit free-scan on a deficient order fails closed without auto-claiming the batch, and the healthy order still packs', async () => {
  const f = await fixture();

  const before = await state(f);
  expect(before.batch.status).toBe('pick_complete');

  const blockedScan = await freeScan(f, f.affected.unitId);
  expectFailClosed(blockedScan);

  const afterBlocked = await state(f);

  // A blocked-order scan must not mutate the whole batch.
  expect(afterBlocked.batch.status).toBe('pick_complete');
  expect(afterBlocked.batch.packed_by).toBeNull();
  expect(afterBlocked.ows).toEqual(before.ows);
  expect(scansForOrder(afterBlocked, f.affected.orderId)).toEqual([]);
  expect(Number(afterBlocked.batch.units_packed)).toBe(Number(before.batch.units_packed));

  // The healthy order in the same batch remains independently executable.
  const healthyScan = await freeScan(f, f.healthy.unitId);
  expect(healthyScan.status).toBe(200);

  const afterHealthy = await state(f);
  expect(scansForOrder(afterHealthy, f.healthy.orderId)).toEqual([
    expect.objectContaining({
      lasyncro_line_item_id: f.healthy.lineItemId,
      quantity_confirmed: 1,
      status: 'confirmed',
    }),
  ]);
  expect(scansForOrder(afterHealthy, f.affected.orderId)).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// F. LSO / PARCEL CLOSE BYPASS
// ─────────────────────────────────────────────────────────────────────────────

it('F — an invoice scan cannot close the parcel for an unauthorized deficient order', async () => {
  const f = await fixture();

  expect((await claimPack(f)).status).toBe(200);

  // Drive the contents surface as an operator would. Whether these are
  // refused (correct) or accepted (current bypass), the invoice scan below
  // must still refuse to mark an unauthorized deficient order packed.
  await packScan(f, f.affected.orderId, f.affected.fullLineItemId, f.affected.fullVariantId, 1);
  await packScan(f, f.affected.orderId, f.affected.shortLineItemId, f.affected.shortVariantId, 3);

  const before = await state(f);

  const close = await freeScan(f, f.affected.barcode);
  expectFailClosed(close);

  const after = await state(f);
  expect(owsFor(after, f.affected.orderId)).not.toBe('packed');
  expect(owsFor(after, f.affected.orderId)).toBe(owsFor(before, f.affected.orderId));
  expect(after.batch.status).not.toBe('pack_complete');
});

// ─────────────────────────────────────────────────────────────────────────────
// G. PARTIAL SHIPMENT APPROVAL
// ─────────────────────────────────────────────────────────────────────────────

it('G — approved partial shipment authorizes exactly the physically picked quantity and never fabricates the missing units', async () => {
  const f = await fixture();

  const raised = await raiseDecision(
    f, f.affected.orderId, f.affected.shortLineItemId, 'ship_partial'
  );
  expect(raised.status).toBe(201);

  const resolved = await resolveDecision(f, raised.body.request.id as string, {
    status: 'approved',
    partial_shipment: true,
    note: 'GH1086 ship what was physically picked',
  });
  expect(resolved.status).toBe(200);
  expect(resolved.body.request).toMatchObject({ status: 'approved', partial_shipment: true });

  expect((await claimPack(f)).status).toBe(200);

  // Authorization never exceeds physical Pick evidence: 1 unit was picked,
  // 3 were ordered.
  const overScan = await packScan(
    f, f.affected.orderId, f.affected.shortLineItemId, f.affected.shortVariantId, 3
  );
  expectFailClosed(overScan);
  expect(scansForOrder(await state(f), f.affected.orderId)).toEqual([]);

  // The authorized partial quantity packs normally.
  expect(
    (await packScan(f, f.affected.orderId, f.affected.fullLineItemId, f.affected.fullVariantId, 1)).status
  ).toBe(201);
  expect(
    (await packScan(f, f.affected.orderId, f.affected.shortLineItemId, f.affected.shortVariantId, 1)).status
  ).toBe(201);

  const afterScans = await state(f);
  const shortScans = afterScans.packScans.filter(
    (r: any) => r.lasyncro_line_item_id === f.affected.shortLineItemId
  );
  // Missing quantity is never fabricated into pack evidence.
  expect(shortScans).toEqual([
    expect.objectContaining({ quantity_confirmed: 1, status: 'confirmed' }),
  ]);

  // Closure must not demand an impossible scan for the missing units.
  const close = await freeScan(f, f.affected.barcode);
  expect(close.status).toBe(200);
  expect(owsFor(await state(f), f.affected.orderId)).toBe('packed');
});

// ─────────────────────────────────────────────────────────────────────────────
// H. PACK COMPLETE
// ─────────────────────────────────────────────────────────────────────────────

it('H — the batch cannot reach pack_complete while a member order still carries an unresolved fulfillment deficit', async () => {
  const f = await fixture();

  expect((await claimPack(f)).status).toBe(200);

  // Healthy work completes normally.
  expect(
    (await packScan(f, f.healthy.orderId, f.healthy.lineItemId, f.healthy.variantId, 1)).status
  ).toBe(201);
  expect((await freeScan(f, f.healthy.barcode)).status).toBe(200);

  // The deficient order is never authorized — no pack_decision_requests row.
  await packScan(f, f.affected.orderId, f.affected.fullLineItemId, f.affected.fullVariantId, 1);
  await packScan(f, f.affected.orderId, f.affected.shortLineItemId, f.affected.shortVariantId, 3);
  await freeScan(f, f.affected.barcode);

  const afterScans = await state(f);
  expect(afterScans.decisions).toEqual([]);
  expect(
    afterScans.exceptions.find(
      (e: any) => e.pick_exception_id === f.affected.pickExceptionId
    ).resolved
  ).toBe(false);

  // No path — implicit or explicit — may complete the batch.
  expect(afterScans.batch.status).not.toBe('pack_complete');
  expectFailClosed(await completePack(f));

  const final = await state(f);
  expect(final.batch.status).not.toBe('pack_complete');

  // Healthy work still completed and is unaffected by the held order.
  expect(owsFor(final, f.healthy.orderId)).toBe('packed');
  expect(scansForOrder(final, f.healthy.orderId)).toEqual([
    expect.objectContaining({ lasyncro_line_item_id: f.healthy.lineItemId, status: 'confirmed' }),
  ]);
});
