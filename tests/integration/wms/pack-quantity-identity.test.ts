/**
 * PACK-QTY-01 — exact-unit cumulative Pack, RED contract only.
 * Real FT2 install, release, allocation-backed Pick, free-scan and read routes.
 * Each of two quantity-one allocations has independent exact-LSU Pick evidence.
 * Case C alone inserts a second Pack row as fixture-only read-model evidence.
 * No production changes, provider calls, weakened constraints or UI redesign.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemQuery, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { issueTestToken } from '../../unit/helpers/auth';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';

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
  const shopDomain = `packqty01-${label}-${Date.now()}.myshopify.com`;
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
        title: `PACK-QTY-01 fixture line ${i + 1}`,
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
      .insert({ shop_id: shopId, name: `PACK-QTY-01 fixture supplier ${crypto.randomUUID()}` })
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
  const variant = await withTenant(tenant.shopId, trx => trx('variants')
    .where({ shop_id: tenant.shopId }).orderBy('sku')
    .first('lasyncro_variant_id', 'lasyncro_product_id'));
  expect(variant).toBeTruthy();
  const variantId = variant.lasyncro_variant_id as string;
  const locations = [`PACK-QTY-${tenant.shopId}-A`, `PACK-QTY-${tenant.shopId}-B`];
  await withTenant(tenant.shopId, async trx => {
    const warehouse = await trx('warehouses').where({ shop_id: tenant.shopId, is_default: true })
      .first('warehouse_id', 'root_location_code');
    expect(warehouse).toBeTruthy();
    await trx('warehouse_locations').insert(locations.map(location_code => ({
      shop_id: tenant.shopId, warehouse_id: warehouse.warehouse_id, location_code,
      type: 'bin', parent_location_code: warehouse.root_location_code,
      active: true, zone_type: 'pick',
    })));
    // Canonical ledger/projection fixture: one physical unit in each valid Pick bin.
    // Release prefers bins to seedFreshInstall's root stock, yielding 1 + 1.
    for (const location_code of locations) {
      await trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: crypto.randomUUID(), device_event_id: crypto.randomUUID(),
        shop_id: tenant.shopId, lasyncro_variant_id: variantId,
        movement_type: 'manual_adjustment', quantity_delta: 1, location_code,
        reference_type: 'fixture_physical_stock', reference_id: crypto.randomUUID(),
        platform: 'wms', occurred_at: new Date(), triggered_by: 'pack_qty_01_fixture',
      });
    }
    await rebuildInventoryProjectionForVariants(tenant.shopId, [variantId], trx, new Date());
  });
  const order = await seedOrder(tenant.shopId, [{
    variantId, productId: variant.lasyncro_product_id, quantity: 2,
  }]);
  const lineItemId = order.lineItemIds[0];
  const release = await request(app).post('/api/v1/wms/batch/release').set(auth(tenant.token))
    .send({ priority_order_ids: [order.orderId], exclusive: true });
  expect({ status: release.status, body: release.body })
    .toMatchObject({ status: 201, body: { order_count: 1 } });
  const batchId = release.body.pick_batch_id as string;
  const claim = await request(app).post(`/api/v1/wms/batch/${batchId}/claim`)
    .set(auth(tenant.token)).send({});
  expect({ status: claim.status, body: claim.body }).toMatchObject({ status: 200 });
  const allocations = await withTenant(tenant.shopId, trx => trx('pick_reservation_allocations')
    .where({ shop_id: tenant.shopId, pick_batch_id: batchId, lasyncro_line_item_id: lineItemId })
    .orderBy('location_code').select('*'));
  expect(allocations.map(a => ({ location: a.location_code, quantity: Number(a.quantity) })))
    .toEqual(locations.map(location => ({ location, quantity: 1 })));
  expect(new Set(allocations.map(a => a.allocation_id)).size).toBe(2);
  const receiveJobId = await seedReceiveJob(tenant.shopId);
  const unitIds: string[] = [];
  for (const [i, allocation] of allocations.entries()) {
    const unitId = await seedStowedUnit(tenant.shopId, {
      variantId, locationCode: allocation.location_code, receiveJobId, sequence: i + 1,
    });
    unitIds.push(unitId);
    const pick = await request(app).post('/api/v1/wms/pick/scan').set(auth(tenant.token)).send({
      pick_batch_id: batchId, lasyncro_line_item_id: lineItemId,
      lasyncro_variant_id: variantId, reservation_allocation_id: allocation.allocation_id,
      location_code: allocation.location_code, quantity_confirmed: 1, lasyncro_unit_id: unitId,
    });
    expect({ status: pick.status, body: pick.body }).toMatchObject({ status: 201 });
  }
  // Unrelated same-variant picked unit has no Pick attribution for this order.
  // Fixture-only state makes broad same-variant Pack mutation observable.
  const unrelatedId = await seedStowedUnit(tenant.shopId, {
    variantId, locationCode: locations[0], receiveJobId, sequence: 3,
  });
  await withTenant(tenant.shopId, trx => trx('inventory_units')
    .where({ shop_id: tenant.shopId, lasyncro_unit_id: unrelatedId }).update({ status: 'picked' }));
  const complete = await request(app).post(`/api/v1/wms/batch/${batchId}/pick-complete`)
    .set(auth(tenant.token)).send({});
  expect({ status: complete.status, body: complete.body }).toMatchObject({ status: 200 });
  const row = await withTenant(tenant.shopId, trx => trx('orders')
    .where({ shop_id: tenant.shopId, lasyncro_order_id: order.orderId }).first('wms_barcode'));
  expect(row.wms_barcode).toMatch(/^LSO-/);
  const f = { ...tenant, batchId, orderId: order.orderId, lineItemId, variantId,
    unitA: unitIds[0], unitB: unitIds[1], unrelatedId, barcode: row.wms_barcode as string };
  const initial = await state(f);
  expect(initial.batch.status).toBe('pick_complete');
  expect(initial.batch.units_packed).toBe(0);
  expect(initial.packScans).toEqual([]);
  expect(initial.pickScans).toHaveLength(2);
  for (const [i, unitId] of unitIds.entries()) {
    expect(initial.pickScans.find(r => r.lasyncro_unit_id === unitId)).toMatchObject({
      lasyncro_line_item_id: lineItemId, lasyncro_variant_id: variantId,
      reservation_allocation_id: allocations[i].allocation_id,
      location_code: locations[i], quantity_confirmed: 1, status: 'confirmed',
    });
    expect(initial.units.find(r => r.lasyncro_unit_id === unitId)?.status).toBe('picked');
  }
  expect(initial.lineStatus.status).toBe('picked');
  expect(initial.orderStatus.status).toBe('picked');
  const read = await readOrder(f);
  capture('canonical_pick_complete', f, initial, read);
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

function freeScan(f: Fixture, scannedValue: string, active = true) {
  return request(app).post('/api/v1/wms/pack/free-scan').set(auth(f.token)).send({
    scanned_value: scannedValue,
    ...(active ? { expected_lasyncro_order_id: f.orderId } : {}),
  });
}
async function readOrder(f: Fixture) {
  const response = await request(app).get(`/api/v1/wms/batch/${f.batchId}/orders`).set(auth(f.token));
  expect(response.status).toBe(200);
  expect(response.body.orders).toHaveLength(1);
  return response;
}
async function state(f: Fixture) {
  return withTenant(f.shopId, async trx => ({
    batch: await trx('pick_batches').where({ shop_id: f.shopId, pick_batch_id: f.batchId }).first(),
    packScans: await trx('pack_scan_log').where({ shop_id: f.shopId, pick_batch_id: f.batchId })
      .orderBy('lasyncro_unit_id').select('*'),
    pickScans: await trx('pick_scan_log').where({ shop_id: f.shopId, pick_batch_id: f.batchId })
      .orderBy('lasyncro_unit_id').select('*'),
    lineStatus: await trx('order_line_item_warehouse_status')
      .where({ shop_id: f.shopId, lasyncro_line_item_id: f.lineItemId }).first(),
    orderStatus: await trx('order_warehouse_status').where({ lasyncro_order_id: f.orderId }).first(),
    units: await trx('inventory_units').where({ shop_id: f.shopId })
      .whereIn('lasyncro_unit_id', [f.unitA, f.unitB, f.unrelatedId]).orderBy('lasyncro_unit_id').select('*'),
    printJobs: await trx('barcode_print_jobs').where({ shop_id: f.shopId, lasyncro_order_id: f.orderId })
      .orderBy('print_job_id').select('*'),
  }));
}
type State = Awaited<ReturnType<typeof state>>;
const packedQuantity = (s: State) => s.packScans.filter(r => r.status === 'confirmed')
  .reduce((n, r) => n + Number(r.quantity_confirmed), 0);
const pickedQuantity = (s: State) => s.pickScans.filter(r => r.status === 'confirmed')
  .reduce((n, r) => n + Number(r.quantity_confirmed), 0);

function capture(stage: string, f: Fixture, s: State, response: any) {
  console.info('[PACK_QTY_01_SNAPSHOT]', JSON.stringify({ stage, shopId: f.shopId,
    unitA: f.unitA, unitB: f.unitB, unrelatedId: f.unrelatedId,
    packedQuantity: packedQuantity(s), pickedQuantity: pickedQuantity(s),
    packScans: s.packScans.map(r => ({ line: r.lasyncro_line_item_id,
      unit: r.lasyncro_unit_id, quantity: r.quantity_confirmed, status: r.status })),
    pickScans: s.pickScans.map(r => ({ line: r.lasyncro_line_item_id,
      allocation: r.reservation_allocation_id, location: r.location_code,
      unit: r.lasyncro_unit_id, quantity: r.quantity_confirmed, status: r.status })),
    lineStatus: s.lineStatus, orderStatus: s.orderStatus,
    batch: { status: s.batch.status, units_packed: s.batch.units_packed },
    units: s.units.map(r => ({ unit: r.lasyncro_unit_id, variant: r.lasyncro_variant_id,
      status: r.status, location: r.current_location_code })),
    response: { status: response.status, body: response.body },
  }));
}

async function firstScan(f: Fixture) {
  const before = await state(f);
  const response = await freeScan(f, f.unitA, false);
  const after = await state(f);
  capture('first_exact_lsu', f, after, response);
  expect({ status: response.status, body: response.body }).toMatchObject({
    status: 200, body: { type: 'unit_resolved', lasyncro_order_id: f.orderId, auto_claimed: true },
  });
  expect(packedQuantity(after)).toBe(1);
  expect(packedQuantity(after)).toBeLessThanOrEqual(pickedQuantity(after));
  expect(after.packScans).toHaveLength(1);
  expect(after.packScans[0]).toMatchObject({ lasyncro_unit_id: f.unitA, quantity_confirmed: 1 });
  expect(after.batch).toMatchObject({ status: 'packing', units_packed: 1 });
  expect(after.units.find(r => r.lasyncro_unit_id === f.unitA)?.status).toBe('packed');
  expect(after.units.find(r => r.lasyncro_unit_id === f.unitB))
    .toEqual(before.units.find(r => r.lasyncro_unit_id === f.unitB));
  expect(after.units.find(r => r.lasyncro_unit_id === f.unrelatedId))
    .toEqual(before.units.find(r => r.lasyncro_unit_id === f.unrelatedId));
  expect(after.pickScans).toEqual(before.pickScans);
  return { response, after };
}

it('A — second independent exact LSU accumulates two confirmed Pack units', async () => {
  const f = await fixture();
  const first = await firstScan(f);
  const response = await freeScan(f, f.unitB);
  const after = await state(f);
  capture('second_exact_lsu', f, after, response);
  expect(after.units.find(r => r.lasyncro_unit_id === f.unitA))
    .toEqual(first.after.units.find(r => r.lasyncro_unit_id === f.unitA));
  expect(after.units.find(r => r.lasyncro_unit_id === f.unrelatedId))
    .toEqual(first.after.units.find(r => r.lasyncro_unit_id === f.unrelatedId));
  expect(after.pickScans).toEqual(first.after.pickScans);
  expect(packedQuantity(after)).toBeLessThanOrEqual(pickedQuantity(after));
  // One assertion exposes the desired HTTP and persisted cumulative outcome.
  expect({ status: response.status, type: response.body.type,
    orderComplete: response.body.order_complete, packedQuantity: packedQuantity(after),
    rows: after.packScans.length, unitsPacked: after.batch.units_packed,
    unitBStatus: after.units.find(r => r.lasyncro_unit_id === f.unitB)?.status,
    lineStatus: after.lineStatus.status,
  }).toEqual({ status: 200, type: 'unit_resolved', orderComplete: true,
    packedQuantity: 2, rows: 2, unitsPacked: 2, unitBStatus: 'packed', lineStatus: 'packed' });
});

it('B — one of two units keeps line and order contents incomplete', async () => {
  const f = await fixture();
  const first = await firstScan(f);
  const read = await readOrder(f);
  capture('partial_quantity_read', f, first.after, read);
  // The LSO gate is independent evidence: it must refuse closure at 1 of 2.
  const closure = await freeScan(f, f.barcode);
  const after = await state(f);
  capture('partial_quantity_lso_refusal', f, after, closure);
  expect({ status: closure.status, body: closure.body, state: after })
    .toEqual({ status: 409, body: expect.objectContaining({
      error: 'siblings_incomplete', confirmed: 1, total: 2,
    }), state: first.after });
  expect({ linePacked: after.lineStatus.status === 'packed',
    orderComplete: first.response.body.order_complete,
    orderWarehouseStatus: after.orderStatus.status,
    freeScanLines: first.response.body.line_items.map((line: any) => ({
      id: line.lasyncro_line_item_id, quantity: line.quantity,
      pack_scanned: line.pack_scanned, packed_quantity: line.packed_quantity,
    })),
  }).toEqual({ linePacked: false, orderComplete: false, orderWarehouseStatus: 'packing',
    freeScanLines: [{ id: f.lineItemId, quantity: 2, pack_scanned: false, packed_quantity: 1 }] });
});

it('C — fixture-only two Pack rows return one logical line with cumulative progress', async () => {
  const f = await fixture();
  const first = await firstScan(f);
  // FIXTURE-ONLY READ DISCRIMINATOR. Confirmed Pick independently attributes B.
  // Insert only the missing quantity-one Pack log row to isolate the read query;
  // no constraints/triggers/RLS are disabled, no unit or batch status is forged.
  await withTenant(f.shopId, trx => trx('pack_scan_log').insert({
    scan_id: crypto.randomUUID(), shop_id: f.shopId, pick_batch_id: f.batchId,
    lasyncro_order_id: f.orderId, lasyncro_line_item_id: f.lineItemId,
    lasyncro_variant_id: f.variantId, lasyncro_unit_id: f.unitB,
    quantity_confirmed: 1, status: 'confirmed', scanned_by: f.userId, scanned_at: new Date(),
  }));
  const after = await state(f);
  expect(after.packScans).toHaveLength(2);
  expect(packedQuantity(after)).toBe(2);
  expect(packedQuantity(after)).toBeLessThanOrEqual(pickedQuantity(after));
  expect(after.batch).toEqual(first.after.batch);
  expect(after.units).toEqual(first.after.units);
  const read = await readOrder(f);
  capture('fixture_only_two_pack_rows_read', f, after, read);
  const lines = read.body.orders[0].line_items;
  expect({ logicalLines: lines.length, lines: lines.map((line: any) => ({
    id: line.lasyncro_line_item_id, required: line.quantity,
    packed_quantity: line.packed_quantity, pack_scanned: line.pack_scanned,
  })) }).toEqual({ logicalLines: 1, lines: [{ id: f.lineItemId, required: 2,
    packed_quantity: 2, pack_scanned: true }] });
});

it('D — duplicate exact LSU and unattributed same-variant LSU refuse without mutation', async () => {
  const f = await fixture();
  const first = await firstScan(f);
  const duplicate = await freeScan(f, f.unitA);
  const afterDuplicate = await state(f);
  capture('duplicate_exact_lsu', f, afterDuplicate, duplicate);
  expect({ deliberate4xx: duplicate.status >= 400 && duplicate.status < 500,
    state: afterDuplicate, quantity: packedQuantity(afterDuplicate), rows: afterDuplicate.packScans.length,
  }).toEqual({ deliberate4xx: true, state: first.after, quantity: 1, rows: 1 });
  const unrelated = await freeScan(f, f.unrelatedId);
  const afterUnrelated = await state(f);
  capture('unit_without_pick_evidence', f, afterUnrelated, unrelated);
  expect({ deliberate4xx: unrelated.status >= 400 && unrelated.status < 500, state: afterUnrelated })
    .toEqual({ deliberate4xx: true, state: first.after });
  expect(packedQuantity(afterUnrelated)).toBeLessThanOrEqual(pickedQuantity(afterUnrelated));
  const read = await readOrder(f);
  capture('duplicate_and_unattributed_read', f, afterUnrelated, read);
});
