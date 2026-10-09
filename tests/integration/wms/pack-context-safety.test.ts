/**
 * PACK-CTX-01 — active order is a server-enforced constraint on free-scan.
 * Real FT2 provisioning, release, exact-unit Pick and Pack routes; no mocks.
 * Run only through the repository disposable-Postgres integration harness.
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
  const shopDomain = `packctx01-${label}-${Date.now()}.myshopify.com`;
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
        title: `PACK-CTX-01 fixture line ${i + 1}`,
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
      .insert({ shop_id: shopId, name: `PACK-CTX-01 fixture supplier ${crypto.randomUUID()}` })
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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function fixture() {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const tenant = await provisionFt2Shop(crypto.randomUUID());
  const variants = await withTenant(tenant.shopId, (trx) =>
    trx('variants').where({ shop_id: tenant.shopId }).orderBy('sku').limit(2)
      .select('lasyncro_variant_id', 'lasyncro_product_id'));
  expect(variants).toHaveLength(2);
  const a = await seedOrder(tenant.shopId, [{
    variantId: variants[0].lasyncro_variant_id,
    productId: variants[0].lasyncro_product_id, quantity: 1,
  }]);
  const b = await seedOrder(tenant.shopId, [{
    variantId: variants[1].lasyncro_variant_id,
    productId: variants[1].lasyncro_product_id, quantity: 1,
  }]);
  const release = await request(app).post('/api/v1/wms/batch/release').set(auth(tenant.token))
    .send({ priority_order_ids: [a.orderId, b.orderId], exclusive: true });
  expect({ status: release.status, body: release.body })
    .toMatchObject({ status: 201, body: { order_count: 2 } });
  const batchId = release.body.pick_batch_id as string;
  const claim = await request(app).post(`/api/v1/wms/batch/${batchId}/claim`)
    .set(auth(tenant.token)).send({});
  expect(claim.status).toBe(200);
  const allocations = await withTenant(tenant.shopId, (trx) =>
    trx('pick_reservation_allocations').where({ shop_id: tenant.shopId, pick_batch_id: batchId })
      .select('*'));
  expect(allocations).toHaveLength(2);
  const receiveJobId = await seedReceiveJob(tenant.shopId);
  const orders = [];
  for (const order of [a, b]) {
    const allocation = allocations.find((row: any) => row.lasyncro_line_item_id === order.lineItemIds[0]);
    expect(allocation).toBeTruthy();
    const unitId = await seedStowedUnit(tenant.shopId, {
      variantId: allocation.lasyncro_variant_id, locationCode: allocation.location_code,
      receiveJobId, sequence: 1,
    });
    const pick = await request(app).post('/api/v1/wms/pick/scan').set(auth(tenant.token)).send({
      pick_batch_id: batchId, lasyncro_line_item_id: order.lineItemIds[0],
      lasyncro_variant_id: allocation.lasyncro_variant_id,
      reservation_allocation_id: allocation.allocation_id,
      location_code: allocation.location_code, quantity_confirmed: 1, lasyncro_unit_id: unitId,
    });
    expect({ status: pick.status, body: pick.body }).toMatchObject({ status: 201 });
    const row = await withTenant(tenant.shopId, (trx) =>
      trx('orders').where({ shop_id: tenant.shopId, lasyncro_order_id: order.orderId })
        .first('wms_barcode'));
    expect(row.wms_barcode).toMatch(/^LSO-/);
    orders.push({ orderId: order.orderId, lineItemId: order.lineItemIds[0], unitId, barcode: row.wms_barcode as string });
  }
  const complete = await request(app).post(`/api/v1/wms/batch/${batchId}/pick-complete`)
    .set(auth(tenant.token)).send({});
  expect({ status: complete.status, body: complete.body }).toMatchObject({ status: 200 });
  const f = { ...tenant, batchId, a: orders[0], b: orders[1] };
  const ready = await request(app).get('/api/v1/wms/batches/ready-to-pack').set(auth(f.token));
  expect(ready.status).toBe(200);
  expect(ready.body.orders.map((row: any) => row.lasyncro_order_id))
    .toEqual(expect.arrayContaining([f.a.orderId, f.b.orderId]));
  const initial = await state(f);
  expect(initial.batch.status).toBe('pick_complete');
  expect(initial.packScans).toEqual([]);
  expect(initial.units.map((row: any) => row.status)).toEqual(['picked', 'picked']);
  expect(initial.ows.map((row: any) => row.status)).toEqual(['picked', 'picked']);
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

function freeScan(f: Fixture, scannedValue: string, expectedOrderId?: string) {
  return request(app).post('/api/v1/wms/pack/free-scan').set(auth(f.token)).send({
    scanned_value: scannedValue,
    ...(expectedOrderId === undefined ? {} : { expected_lasyncro_order_id: expectedOrderId }),
  });
}

// Full persisted rows include ownership/activity, packed_at, shipped_at and
// acknowledgement fields. Ordering makes equality independent of SQL row order.
async function state(f: Fixture) {
  const orderIds = [f.a.orderId, f.b.orderId];
  return withTenant(f.shopId, async (trx) => ({
    batch: await trx('pick_batches').where({ shop_id: f.shopId, pick_batch_id: f.batchId }).first(),
    members: await trx('pick_batch_orders').where({ shop_id: f.shopId, pick_batch_id: f.batchId })
      .orderBy('lasyncro_order_id').select('*'),
    packScans: await trx('pack_scan_log').where({ shop_id: f.shopId, pick_batch_id: f.batchId })
      .orderBy('scan_id').select('*'),
    ows: await trx('order_warehouse_status').whereIn('lasyncro_order_id', orderIds)
      .orderBy('lasyncro_order_id').select('*'),
    olws: await trx('order_line_item_warehouse_status').where({ shop_id: f.shopId })
      .whereIn('lasyncro_order_id', orderIds).orderBy('lasyncro_line_item_id').select('*'),
    units: await trx('inventory_units').where({ shop_id: f.shopId })
      .whereIn('lasyncro_unit_id', [f.a.unitId, f.b.unitId]).orderBy('lasyncro_unit_id').select('*'),
    orders: await trx('orders').where({ shop_id: f.shopId }).whereIn('lasyncro_order_id', orderIds)
      .orderBy('lasyncro_order_id').select('*'),
    fulfillment: await trx('order_fulfillment_status').whereIn('lasyncro_order_id', orderIds)
      .orderBy('lasyncro_order_id').select('*'),
    fulfillmentHistory: await trx('order_fulfillment_history').whereIn('lasyncro_order_id', orderIds)
      .orderBy('lasyncro_fulfillment_event_id').select('*'),
    shipments: await trx('order_shipment_tracking').where({ shop_id: f.shopId })
      .whereIn('lasyncro_order_id', orderIds).orderBy('id').select('*'),
    executions: await trx('fulfillment_executions').where({ shop_id: f.shopId })
      .whereIn('lasyncro_order_id', orderIds).orderBy('id').select('*'),
    alerts: await trx('alerts').where({ shop_id: f.shopId }).orderBy('id').select('*'),
    usage: await trx('shop_usage_metrics').where({ shop_id: f.shopId }).orderBy('id').select('*'),
    events: await trx('domain_events').where({ shop_id: f.shopId }).orderBy('id').select('*'),
    printJobs: await trx('barcode_print_jobs').where({ shop_id: f.shopId })
      .whereIn('lasyncro_order_id', orderIds).orderBy('lasyncro_order_id').select('*'),
  }));
}

async function acquireA(f: Fixture) {
  const acquired = await freeScan(f, f.a.unitId);
  expect({ status: acquired.status, body: acquired.body }).toMatchObject({
    status: 200, body: { type: 'unit_resolved', lasyncro_order_id: f.a.orderId, auto_claimed: true },
  });
  const acquiredState = await state(f);
  expect(acquiredState.batch).toMatchObject({ status: 'packing', units_packed: 1, packed_by: f.userId });
  expect(acquiredState.packScans).toHaveLength(1);
  expect(acquiredState.packScans[0]).toMatchObject({ lasyncro_order_id: f.a.orderId, lasyncro_unit_id: f.a.unitId });
  expect(acquiredState.units.find((row: any) => row.lasyncro_unit_id === f.b.unitId)?.status).toBe('picked');
  return acquiredState;
}

async function expectRefusedWithoutMutation(f: Fixture, barcode: string, before: Awaited<ReturnType<typeof state>>) {
  const response = await freeScan(f, barcode, f.a.orderId);
  const after = await state(f);
  console.info('[PACK_CTX_01_OBSERVED]', {
    barcodeKind: barcode.startsWith('LSU-') ? 'LSU' : 'LSO', status: response.status,
    responseType: response.body.type, resolvedOrder: response.body.lasyncro_order_id,
    bOrderId: f.b.orderId,
    bWarehouseStatus: after.ows.find((row: any) => row.lasyncro_order_id === f.b.orderId)?.status,
    bUnitStatus: after.units.find((row: any) => row.lasyncro_unit_id === f.b.unitId)?.status,
    unitsPackedBefore: before.batch.units_packed, unitsPackedAfter: after.batch.units_packed,
  });
  // One compound assertion exposes BOTH an incorrect response and all durable
  // mutations in the RED output instead of stopping at the first status check.
  expect({ deliberate4xx: response.status >= 400 && response.status < 500, state: after })
    .toEqual({ deliberate4xx: true, state: before });
}

it('wrong LSU with active A refuses B before any Pack mutation', async () => {
  const f = await fixture();
  const before = await acquireA(f);
  expect(before.ows.find((row: any) => row.lasyncro_order_id === f.b.orderId))
    .toMatchObject({ status: 'packing', packed_at: null });
  await expectRefusedWithoutMutation(f, f.b.unitId, before);
});

it('wrong LSO with active A refuses closure of independently verified B', async () => {
  const f = await fixture();
  await acquireA(f);
  // Independent acquisition establishes real contents evidence for B; it does
  // not close B or change the active-A context supplied by the refused request.
  const verifyB = await freeScan(f, f.b.unitId);
  expect({ status: verifyB.status, body: verifyB.body }).toMatchObject({
    status: 200, body: { type: 'unit_resolved', lasyncro_order_id: f.b.orderId },
  });
  const before = await state(f);
  expect(before.batch).toMatchObject({ status: 'packing', units_packed: 2, pack_completed_at: null });
  expect(before.ows.find((row: any) => row.lasyncro_order_id === f.b.orderId))
    .toMatchObject({ status: 'packing', packed_at: null });
  expect(before.packScans).toHaveLength(2);
  await expectRefusedWithoutMutation(f, f.b.barcode, before);
});

it('matching A context permits its LSO after context-free initial acquisition', async () => {
  const f = await fixture();
  const before = await acquireA(f);
  const response = await freeScan(f, f.a.barcode, f.a.orderId);
  expect({ status: response.status, body: response.body }).toMatchObject({
    status: 200, body: { type: 'packed', lasyncro_order_id: f.a.orderId, batch_complete: false },
  });
  const after = await state(f);
  expect(after.ows.find((row: any) => row.lasyncro_order_id === f.a.orderId)?.status).toBe('packed');
  expect(after.ows.find((row: any) => row.lasyncro_order_id === f.b.orderId))
    .toEqual(before.ows.find((row: any) => row.lasyncro_order_id === f.b.orderId));
  expect(after.packScans).toEqual(before.packScans);
  expect(after.units).toEqual(before.units);
  expect(after.batch).toEqual(before.batch);
});
