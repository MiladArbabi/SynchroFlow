/**
 * SF-PICK-UX-ADAPTIVE-01-ACTIONABLE-ID-001 — real routes, disposable DB only.
 * /line-items projects scan_unit_id: one real eligible LSU for the exact task
 * (tenant, variant, location), from the same predicate as unit_scan_required,
 * deterministic by inventory_units.id. Display only: it is never verification,
 * and every other eligible LSU stays scannable. Helpers copied from
 * pick-quantity-custody-001.test.ts.
 */
import crypto from 'crypto';
import request from 'supertest';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { app, claim, evidence, fixture, seedOrder, type Fx } from './pick-assign-sf-01.fixture';

jest.setTimeout(180_000);

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const rootOf = (fx: Fx) => `WH-${fx.shop.shopId}-ROOT`;
const lineItems = (token: string, batchId: string) =>
  request(app).get(`/api/v1/wms/batch/${batchId}/line-items`).set(bearer(token));
const scanUnits = (token: string, batchId: string, a: any, generation: string, unitIds: string[], quantity = Number(a.quantity)) =>
  request(app).post('/api/v1/wms/pick/scan').set(bearer(token)).send({
    pick_batch_id: batchId, lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    reservation_allocation_id: a.allocation_id, location_code: a.location_code, quantity_confirmed: quantity,
    lasyncro_unit_ids: unitIds, pick_claim_generation: generation,
  });
const shortPickUnits = (token: string, batchId: string, a: any, generation: string, found: number, unitIds: string[]) =>
  request(app).post(`/api/v1/wms/batch/${batchId}/exception`).set(bearer(token)).send({
    lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    reservation_allocation_id: a.allocation_id, location_code: a.location_code, exception_type: 'short_pick',
    stage: 'pick', quantity_required: Number(a.quantity), quantity_found: found, device_event_id: crypto.randomUUID(),
    lasyncro_unit_ids: unitIds, pick_claim_generation: generation,
  });

async function releaseOne(fx: Fx, variant: Fx['variants'][number], qty: number, expectedLocation = rootOf(fx)) {
  const orderId = await seedOrder(fx.shop.shopId, variant, qty);
  const res = await request(app).post('/api/v1/wms/batch/release').set(bearer(fx.shop.ownerToken))
    .send({ priority_order_ids: [orderId], exclusive: true });
  expect({ status: res.status, body: res.body }).toMatchObject({ status: 201 });
  const batchId = res.body.pick_batch_id as string;
  const allocations = await withTenant(fx.shop.shopId, (trx) =>
    trx('pick_reservation_allocations').where({ shop_id: fx.shop.shopId, pick_batch_id: batchId }).select('*'));
  expect(allocations).toHaveLength(1);
  expect(allocations[0].location_code).toBe(expectedLocation);
  return { orderId, batchId, alloc: allocations[0] };
}

/** Test-only: `count` LSUs from one Receive line; a closed receive credits the root. */
async function seedReceivedUnits(fx: Fx, variantId: string, count: number, closed = true) {
  const shopId = fx.shop.shopId;
  return withTenant(shopId, async (trx) => {
    const [supplier] = await trx('suppliers').insert({ shop_id: shopId, name: `QC supplier ${crypto.randomUUID()}` }).returning('id');
    const [po] = await trx('purchase_orders').insert({ shop_id: shopId, supplier_id: supplier.id }).returning('id');
    const [job] = await trx('receive_jobs')
      .insert({ shop_id: shopId, po_id: po.id, ...(closed ? { status: 'closed', closed_at: new Date() } : {}) })
      .returning('receive_job_id');
    const [line] = await trx('receive_job_lines')
      .insert({ shop_id: shopId, receive_job_id: job.receive_job_id, lasyncro_variant_id: variantId, quantity_expected: count })
      .returning('receive_job_line_id');
    const ids: string[] = [];
    for (let i = 1; i <= count; i++) {
      const unitId = `LSU-${crypto.randomBytes(4).toString('hex')}`;
      await trx('inventory_units').insert({
        shop_id: shopId, lasyncro_unit_id: unitId, lasyncro_variant_id: variantId,
        receive_job_line_id: line.receive_job_line_id, receive_sequence: i, status: 'received', current_location_code: null,
      });
      ids.push(unitId);
    }
    if (closed) {
      expect(await trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: `WH-${shopId}-ROOT` })
        .update({
          on_hand_quantity: trx.raw('on_hand_quantity + ?', [count]),
          available_quantity: trx.raw('available_quantity + ?', [count]),
        })).toBe(1);
    }
    return { ids, receiveJobLineId: line.receive_job_line_id as string };
  });
}

/** Test-only: an active pick bin holding `qty` of the variant (moved from the root). */
async function stockBin(fx: Fx, variantId: string, qty: number, bin = `PICK-QC-${crypto.randomBytes(3).toString('hex')}`) {
  const shopId = fx.shop.shopId;
  await withTenant(shopId, async (trx) => {
    const exists = await trx('warehouse_locations').where({ shop_id: shopId, location_code: bin }).first('location_code');
    if (!exists) {
      const rootRow = await trx('warehouse_locations').where({ shop_id: shopId, location_code: rootOf(fx) }).first('warehouse_id');
      await trx('warehouse_locations').insert({
        shop_id: shopId, warehouse_id: rootRow.warehouse_id, location_code: bin,
        type: 'bin', zone_type: 'pick', active: true, parent_location_code: rootOf(fx),
      });
    }
    if (qty > 0) {
      expect(await trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: rootOf(fx) })
        .where('available_quantity', '>=', qty)
        .update({
          on_hand_quantity: trx.raw('on_hand_quantity - ?', [qty]),
          available_quantity: trx.raw('available_quantity - ?', [qty]),
        })).toBe(1);
      await trx('inventory_truth')
        .insert({
          shop_id: shopId, lasyncro_variant_id: variantId, location_code: bin, on_hand_quantity: qty,
          reserved_quantity: 0, committed_quantity: 0, available_quantity: qty, last_evaluated_at: new Date(),
        })
        .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
        .merge({
          on_hand_quantity: trx.raw('inventory_truth.on_hand_quantity + ?', [qty]),
          available_quantity: trx.raw('inventory_truth.available_quantity + ?', [qty]),
        });
    }
  });
  return bin;
}

/** Test-only: `count` LSUs stowed at `bin` whose stock is already in the bin's truth. */
async function shelfUnits(fx: Fx, variantId: string, count: number, bin: string) {
  const seeded = await seedReceivedUnits(fx, variantId, count, false);
  await withTenant(fx.shop.shopId, (trx) => trx('inventory_units').where({ shop_id: fx.shop.shopId })
    .whereIn('lasyncro_unit_id', seeded.ids).update({ status: 'stowed', current_location_code: bin }));
  // Deterministic settlement order is by inventory_units.id; read it back.
  const ordered = await withTenant(fx.shop.shopId, (trx) => trx('inventory_units').where({ shop_id: fx.shop.shopId })
    .whereIn('lasyncro_unit_id', seeded.ids).orderBy('id').pluck('lasyncro_unit_id'));
  return ordered as string[];
}

const truthAt = async (fx: Fx, variantId: string, location: string) => {
  const row = await withTenant(fx.shop.shopId, (trx) => trx('inventory_truth')
    .where({ shop_id: fx.shop.shopId, lasyncro_variant_id: variantId, location_code: location }).first());
  return row ? { on_hand: Number(row.on_hand_quantity), reserved: Number(row.reserved_quantity) } : null;
};
/** Unit custody state, keyed by LSU. */
async function custody(fx: Fx, ids: string[]) {
  const rows = await withTenant(fx.shop.shopId, (trx) => trx('inventory_units').where({ shop_id: fx.shop.shopId })
    .whereIn('lasyncro_unit_id', ids).select('lasyncro_unit_id', 'status', 'current_location_code', 'identity_unverified'));
  return Object.fromEntries(rows.map((r: any) => [r.lasyncro_unit_id,
    { status: r.status, at: r.current_location_code, unverified: r.identity_unverified }]));
}
const lineageOf = (fx: Fx, ids: string[]) => withTenant(fx.shop.shopId, (trx) => trx('pick_scan_unit_lineage')
  .where({ shop_id: fx.shop.shopId }).whereIn('lasyncro_unit_id', ids).orderBy('lasyncro_unit_id').select('scan_id', 'lasyncro_unit_id'));
const settlementsOf = (fx: Fx, ids: string[]) => withTenant(fx.shop.shopId, (trx) => trx('pick_scan_unit_settlement')
  .where({ shop_id: fx.shop.shopId }).whereIn('lasyncro_unit_id', ids).orderBy(['settled_at', 'lasyncro_unit_id'])
  .select('scan_id', 'lasyncro_unit_id', 'origin_status', 'origin_location_code', 'released_at', 'released_reason', 'replaced_by_unit_id'));
const scanOf = (fx: Fx, batchId: string) => withTenant(fx.shop.shopId, (trx) => trx('pick_scan_log')
  .where({ shop_id: fx.shop.shopId, pick_batch_id: batchId, status: 'confirmed' }).first('scan_id', 'quantity_confirmed', 'lasyncro_unit_id'));
const pickedRecords = (fx: Fx, variantId: string) => withTenant(fx.shop.shopId, async (trx) => Number((await trx('inventory_units')
  .where({ shop_id: fx.shop.shopId, lasyncro_variant_id: variantId, status: 'picked' }).count({ n: '*' }).first())!.n));
const stowTask = (fx: Fx, id: string) => withTenant(fx.shop.shopId, (trx) => trx('stow_tasks')
  .where({ shop_id: fx.shop.shopId, stow_task_id: id }).first('quantity', 'quantity_placed', 'quantity_excepted', 'status'));

async function waitForLockWaiters(shopId: number, n: number) {
  for (let i = 0; i < 150; i++) {
    const r = await withTenant(shopId, (trx) => trx.raw('SELECT count(DISTINCT pid)::int AS n FROM pg_locks WHERE NOT granted'));
    if (r.rows[0].n >= n) return r.rows[0].n as number;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`lock waiters never reached ${n}`);
}


const line = async (token: string, batchId: string, location?: string) => {
  const r = await lineItems(token, batchId);
  expect(r.status).toBe(200);
  return (r.body.line_items as any[]).filter((li) => !location || li.location_code === location);
};

test('ACT-R1 product-only root stock: no LSU is projected; the accepted barcode is served', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const { batchId } = await releaseOne(fx, v, 2);
  const [li] = await line(fx.A.token, batchId);
  expect(li).toMatchObject({ unit_scan_required: 0, scan_unit_id: null, location_code: rootOf(fx) });
  expect(li.barcode).toEqual(expect.any(String));
  expect(li.barcode).not.toMatch(/^LSU-/);
});

test('ACT-R2 root received labelled stock ×2: a complete eligible LSU is projected (never the open-receive one); display is not verification; another eligible LSU is accepted with quantity 2', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const received = await seedReceivedUnits(fx, v.lasyncro_variant_id, 3);
  const notRoot = await seedReceivedUnits(fx, v.lasyncro_variant_id, 1, false);
  const ordered = await withTenant(fx.shop.shopId, (trx) => trx('inventory_units').where({ shop_id: fx.shop.shopId })
    .whereIn('lasyncro_unit_id', received.ids).orderBy('id').pluck('lasyncro_unit_id')) as string[];
  const { batchId, alloc } = await releaseOne(fx, v, 2);
  const [li] = await line(fx.A.token, batchId);
  expect(li).toMatchObject({ unit_scan_required: 1, location_code: rootOf(fx), quantity: 2 });
  expect(li.scan_unit_id).toBe(ordered[0]);
  expect(li.scan_unit_id).toMatch(/^LSU-[0-9a-f]{8}$/);
  expect(li.scan_unit_id).not.toBe(notRoot.ids[0]);

  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  // Displaying the LSU is not verification: no scanned label → refused, nothing written.
  const before = await evidence(fx.shop.shopId, batchId);
  const unscanned = await scanUnits(fx.A.token, batchId, alloc, gen, []);
  expect({ status: unscanned.status, code: unscanned.body.code }).toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_REQUIRED' });
  const openReceive = await scanUnits(fx.A.token, batchId, alloc, gen, [notRoot.ids[0]]);
  expect({ status: openReceive.status, code: openReceive.body.code }).toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_MISMATCH' });
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);
  // A different eligible LSU than the displayed one is accepted; quantity 2 confirms.
  const truthBefore = await truthAt(fx, v.lasyncro_variant_id, rootOf(fx));
  expect((await scanUnits(fx.A.token, batchId, alloc, gen, [ordered[2]])).status).toBe(201);
  expect(await truthAt(fx, v.lasyncro_variant_id, rootOf(fx))).toEqual({ on_hand: truthBefore!.on_hand - 2, reserved: truthBefore!.reserved - 2 });
  expect((await lineageOf(fx, received.ids)).map((l: any) => l.lasyncro_unit_id)).toEqual([ordered[2]]);
});

test('ACT-R3 PICK-A1 labelled ×2 plus root remainder: the bin line projects a bin LSU, the root line none; wrong-location and wrong-variant LSUs are refused', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const w = fx.variants[1];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 2, 'PICK-A1');
  const shelf = await shelfUnits(fx, v.lasyncro_variant_id, 2, bin);
  const otherBin = await stockBin(fx, v.lasyncro_variant_id, 0);
  const elsewhere = await shelfUnits(fx, v.lasyncro_variant_id, 1, otherBin);
  await stockBin(fx, w.lasyncro_variant_id, 1, bin);
  const wrongVariant = await shelfUnits(fx, w.lasyncro_variant_id, 1, bin);
  const orderId = await seedOrder(fx.shop.shopId, v, 3);
  const rel = await request(app).post('/api/v1/wms/batch/release').set(bearer(fx.shop.ownerToken)).send({ priority_order_ids: [orderId], exclusive: true });
  expect(rel.status).toBe(201);
  const batchId = rel.body.pick_batch_id as string;
  const allocs = await withTenant(fx.shop.shopId, (trx) => trx('pick_reservation_allocations').where({ shop_id: fx.shop.shopId, pick_batch_id: batchId }).select('*'));
  const binAlloc = allocs.find((a: any) => a.location_code === bin);
  expect(binAlloc).toMatchObject({ quantity: 2 });

  const [binLine] = await line(fx.A.token, batchId, bin);
  expect(binLine).toMatchObject({ unit_scan_required: 1, location_scan_required: true, scan_unit_id: shelf[0] });
  const rootLines = await line(fx.A.token, batchId, rootOf(fx));
  for (const li of rootLines) expect(li).toMatchObject({ unit_scan_required: 0, scan_unit_id: null });
  expect([elsewhere[0], wrongVariant[0]]).not.toContain(binLine.scan_unit_id);

  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  const before = await evidence(fx.shop.shopId, batchId);
  for (const id of [elsewhere[0], wrongVariant[0]]) {
    const r = await scanUnits(fx.A.token, batchId, binAlloc, gen, [id]);
    expect({ id, status: r.status, code: r.body.code }).toEqual({ id, status: 409, code: 'PICK_UNIT_IDENTITY_MISMATCH' });
  }
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);
  const truthBefore = await truthAt(fx, v.lasyncro_variant_id, bin);
  expect((await scanUnits(fx.A.token, batchId, binAlloc, gen, [shelf[1]])).status).toBe(201);
  expect(await truthAt(fx, v.lasyncro_variant_id, bin)).toEqual({ on_hand: truthBefore!.on_hand - 2, reserved: truthBefore!.reserved - 2 });
});

test('ACT-T tenant isolation: another tenant never receives this tenant\'s projected LSU', async () => {
  const fx = await fixture();
  const other = await fixture();
  const v = fx.variants[0];
  const received = await seedReceivedUnits(fx, v.lasyncro_variant_id, 1);
  const { batchId } = await releaseOne(fx, v, 1);
  const [li] = await line(fx.A.token, batchId);
  expect(li.scan_unit_id).toBe(received.ids[0]);
  const foreign = await lineItems(other.A.token, batchId);
  expect(JSON.stringify(foreign.body)).not.toContain(received.ids[0]);
  expect(foreign.body.line_items ?? []).toEqual([]);
  // The other tenant's own labelled task projects only its own LSU.
  const o = other.variants[0];
  const oRec = await seedReceivedUnits(other, o.lasyncro_variant_id, 1);
  const oRel = await releaseOne(other, o, 1);
  const [oLi] = await line(other.A.token, oRel.batchId);
  expect(oLi.scan_unit_id).toBe(oRec.ids[0]);
});
