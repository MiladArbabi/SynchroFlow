/**
 * B2 — PICK-UNIT-LINEAGE-01: real allocation-backed bulk Pick child lineage.
 * Reuses B1 provisioning/schema-valid fixture patterns without changing B1.
 * One shared action supplies independent A/B/C assertions; capture all evidence
 * for the canonical action and its exact physical-unit child evidence. No provider calls.
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
  const shopDomain = `picklineage01-${label}-${Date.now()}.myshopify.com`;
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
        title: `PICK-UNIT-LINEAGE-01 fixture line ${i + 1}`,
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
      .insert({ shop_id: shopId, name: `PICK-UNIT-LINEAGE-01 fixture supplier ${crypto.randomUUID()}` })
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
  const locationCode = `PICK-LINEAGE-${tenant.shopId}-A`;
  const unrelatedLocation = `PICK-LINEAGE-${tenant.shopId}-D`;
  await withTenant(tenant.shopId, async trx => {
    const warehouse = await trx('warehouses').where({ shop_id: tenant.shopId, is_default: true })
      .first('warehouse_id', 'root_location_code');
    expect(warehouse).toBeTruthy();
    await trx('warehouse_locations').insert([locationCode, unrelatedLocation].map(location_code => ({
      shop_id: tenant.shopId, warehouse_id: warehouse.warehouse_id, location_code,
      type: 'bin', parent_location_code: warehouse.root_location_code,
      active: true, zone_type: 'pick',
    })));
    // Exactly three allocatable units in the preferred Pick bin. D is outside
    // the allocation, with a different receive lineage and location.
    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(), device_event_id: crypto.randomUUID(),
      shop_id: tenant.shopId, lasyncro_variant_id: variantId,
      movement_type: 'manual_adjustment', quantity_delta: 3, location_code: locationCode,
      reference_type: 'fixture_physical_stock', reference_id: crypto.randomUUID(),
      platform: 'wms', occurred_at: new Date(), triggered_by: 'pick_unit_lineage_01_fixture',
    });
    await rebuildInventoryProjectionForVariants(tenant.shopId, [variantId], trx, new Date());
  });
  const order = await seedOrder(tenant.shopId, [{
    variantId, productId: variant.lasyncro_product_id, quantity: 3,
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
    .select('*'));
  expect(allocations).toHaveLength(1);
  const allocation = allocations[0];
  expect({ location: allocation.location_code, quantity: Number(allocation.quantity) })
    .toEqual({ location: locationCode, quantity: 3 });
  const receiveJobId = await seedReceiveJob(tenant.shopId);
  const unitIds: string[] = [];
  for (let sequence = 1; sequence <= 3; sequence++) {
    unitIds.push(await seedStowedUnit(tenant.shopId, {
      variantId, locationCode, receiveJobId, sequence,
    }));
  }
  const unitD = await seedStowedUnit(tenant.shopId, {
    variantId, locationCode: unrelatedLocation,
    receiveJobId: await seedReceiveJob(tenant.shopId), sequence: 1,
  });
  // Same discriminator as B1: unrelated already-picked stock must not gain
  // attribution merely because its variant/status matches the bulk-picked units.
  await withTenant(tenant.shopId, trx => trx('inventory_units')
    .where({ shop_id: tenant.shopId, lasyncro_unit_id: unitD })
    .update({ status: 'picked', current_location_code: null }));
  const f = { ...tenant, batchId, orderId: order.orderId, lineItemId, variantId,
    unitA: unitIds[0], unitB: unitIds[1], unitC: unitIds[2], unitD };
  const beforePick = await state(f);
  for (const unitId of unitIds) {
    expect(beforePick.units.find(r => r.lasyncro_unit_id === unitId)?.status).toBe('stowed');
  }
  expect(beforePick.units.find(r => r.lasyncro_unit_id === unitD)?.status).toBe('picked');
  const pick = await request(app).post('/api/v1/wms/pick/scan').set(auth(f.token)).send({
    pick_batch_id: batchId, lasyncro_line_item_id: lineItemId,
    lasyncro_variant_id: variantId, reservation_allocation_id: allocation.allocation_id,
    location_code: locationCode, quantity_confirmed: 3, lasyncro_unit_id: f.unitA,
  });
  const afterPick = await state(f);
  capture('bulk_pick', f, afterPick, pick);
  expect({ status: pick.status, body: pick.body }).toMatchObject({ status: 201 });
  for (const unitId of unitIds) {
    expect(afterPick.units.find(r => r.lasyncro_unit_id === unitId)?.status).toBe('picked');
  }
  expect(afterPick.units.find(r => r.lasyncro_unit_id === f.unitD))
    .toEqual(beforePick.units.find(r => r.lasyncro_unit_id === f.unitD));
  const complete = await request(app).post(`/api/v1/wms/batch/${batchId}/pick-complete`)
    .set(auth(f.token)).send({});
  expect({ status: complete.status, body: complete.body }).toMatchObject({ status: 200 });
  const packClaim = await request(app).post(`/api/v1/wms/batch/${batchId}/pack/claim`)
    .set(auth(f.token)).send({});
  expect({ status: packClaim.status, body: packClaim.body }).toMatchObject({ status: 200 });
  const beforePack = await state(f);
  expect(beforePack.batch.status).toBe('packing');
  const packB = await freeScan(f, f.unitB);
  const afterPackB = await state(f);
  capture('exact_pack_B', f, afterPackB, packB);
  const packD = await freeScan(f, f.unitD);
  const afterPackD = await state(f);
  capture('unrelated_same_variant_D', f, afterPackD, packD);
  return { f, beforePick, afterPick, beforePack, packB, afterPackB, packD, afterPackD };
}

type Fixture = {
  shopId: number; token: string; batchId: string; orderId: string;
  lineItemId: string; variantId: string;
  unitA: string; unitB: string; unitC: string; unitD: string;
};
function freeScan(f: Fixture, unitId: string) {
  return request(app).post('/api/v1/wms/pack/free-scan').set(auth(f.token)).send({
    scanned_value: unitId, expected_lasyncro_order_id: f.orderId,
  });
}
async function state(f: Fixture) {
  return withTenant(f.shopId, async trx => ({
    batch: await trx('pick_batches').where({ shop_id: f.shopId, pick_batch_id: f.batchId })
      .first('status', 'units_picked', 'units_packed'),
    units: await trx('inventory_units').where({ shop_id: f.shopId })
      .whereIn('lasyncro_unit_id', [f.unitA, f.unitB, f.unitC, f.unitD])
      .orderBy('lasyncro_unit_id').select('shop_id', 'lasyncro_unit_id', 'lasyncro_variant_id',
        'receive_job_line_id', 'status', 'current_location_code'),
    pickScans: await trx('pick_scan_log').where({ shop_id: f.shopId, pick_batch_id: f.batchId })
      .orderBy('lasyncro_unit_id').select('shop_id', 'pick_batch_id', 'lasyncro_line_item_id',
        'lasyncro_variant_id', 'lasyncro_unit_id', 'reservation_allocation_id',
        'location_code', 'quantity_confirmed', 'status'),
    unitLineage: await trx('pick_scan_unit_lineage as pul')
      .join('pick_scan_log as psl', function () {
        this.on('psl.scan_id', '=', 'pul.scan_id').andOn('psl.shop_id', '=', 'pul.shop_id');
      })
      .where({ 'pul.shop_id': f.shopId, 'psl.pick_batch_id': f.batchId })
      .orderBy('pul.lasyncro_unit_id')
      .select('pul.shop_id', 'pul.lasyncro_unit_id', 'psl.pick_batch_id',
        'psl.lasyncro_line_item_id', 'psl.lasyncro_variant_id', 'psl.reservation_allocation_id'),
    allocations: await trx('pick_reservation_allocations')
      .where({ shop_id: f.shopId, pick_batch_id: f.batchId }).select('*'),
    line: await trx('order_line_items').where({ lasyncro_line_item_id: f.lineItemId })
      .first('lasyncro_order_id', 'lasyncro_line_item_id', 'lasyncro_variant_id', 'quantity'),
    packScans: await trx('pack_scan_log').where({ shop_id: f.shopId, pick_batch_id: f.batchId })
      .orderBy('lasyncro_unit_id').select('lasyncro_unit_id', 'lasyncro_line_item_id', 'quantity_confirmed', 'status'),
  }));
}
type State = Awaited<ReturnType<typeof state>>;
function capture(stage: string, f: Fixture, s: State, response: any) {
  console.info('[PICK_UNIT_LINEAGE_01]', JSON.stringify({ stage,
    shopId: f.shopId, batchId: f.batchId, orderId: f.orderId, lineItemId: f.lineItemId,
    unitA: f.unitA, unitB: f.unitB, unitC: f.unitC, unitD: f.unitD,
    ...s, response: { status: response.status, body: response.body },
  }));
}

let evidence: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { evidence = await fixture(); });

it('A — bulk Pick durably attributes every transitioned physical LSU to shop/batch/line/variant', () => {
  const { f, afterPick } = evidence;
  expect(afterPick.pickScans).toHaveLength(1);
  expect(afterPick.pickScans[0]).toMatchObject({
    shop_id: f.shopId, pick_batch_id: f.batchId,
    lasyncro_line_item_id: f.lineItemId, lasyncro_variant_id: f.variantId,
    reservation_allocation_id: afterPick.allocations[0].allocation_id,
    lasyncro_unit_id: f.unitA, quantity_confirmed: 3, status: 'confirmed',
  });
  expect(afterPick.unitLineage.map(row => row.lasyncro_unit_id).sort())
    .toEqual([f.unitA, f.unitB, f.unitC].sort());
  for (const row of afterPick.unitLineage) {
    expect(row).toMatchObject({
      shop_id: f.shopId, pick_batch_id: f.batchId,
      lasyncro_line_item_id: f.lineItemId, lasyncro_variant_id: f.variantId,
      reservation_allocation_id: afterPick.allocations[0].allocation_id,
    });
  }
  expect(afterPick.unitLineage.filter(row => row.lasyncro_unit_id === f.unitD)).toEqual([]);
});

it('B — exact Pack scan recognizes bulk-picked LSU-B as this batch/order/line', () => {
  const { f, packB } = evidence;
  expect({ status: packB.status, body: packB.body }).toMatchObject({
    status: 200, body: { type: 'unit_resolved', pick_batch_id: f.batchId,
      lasyncro_order_id: f.orderId, lasyncro_unit_id: f.unitB },
  });
});

it('C — unrelated same-variant LSU-D has no order attribution and cannot enter Pack', () => {
  const { f, beforePick, afterPick, afterPackB, packD, afterPackD } = evidence;
  expect(afterPick.units.find(r => r.lasyncro_unit_id === f.unitD))
    .toEqual(beforePick.units.find(r => r.lasyncro_unit_id === f.unitD));
  expect(afterPick.pickScans.filter(r => r.lasyncro_unit_id === f.unitD)).toEqual([]);
  expect(afterPackD.pickScans.filter(r => r.lasyncro_unit_id === f.unitD)).toEqual([]);
  expect(afterPick.unitLineage.filter(r => r.lasyncro_unit_id === f.unitD)).toEqual([]);
  expect(afterPackD.unitLineage.filter(r => r.lasyncro_unit_id === f.unitD)).toEqual([]);
  expect(afterPackD.packScans.filter(r => r.lasyncro_unit_id === f.unitD)).toEqual([]);
  expect(packD.status >= 400 && packD.status < 500).toBe(true);
  expect(afterPackD).toEqual(afterPackB);
});
