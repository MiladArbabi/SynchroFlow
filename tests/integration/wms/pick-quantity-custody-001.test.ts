/**
 * SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — real routes, disposable DB only.
 *
 * Owner decision (Option B, approved revision):
 * - One scanned LSU verifies the product at the server-directed location.
 * - The confirmed quantity settles further eligible unit records by count;
 *   those are recorded in pick_scan_unit_settlement and NEVER in the verified
 *   pick_scan_unit_lineage.
 * - Siblings left at that location become identity_unverified.
 * - A later scan of a settled-but-present LSU at its origin exchanges records
 *   with an unverified sibling (Pick or inbound Stow); with no unverified
 *   sibling left it is refused (no duplicate Pick).
 * - inventory_truth and inventory_units stay consistent; Stow obligations,
 *   Short Pick (GH-1049), replay and recovery semantics are unchanged.
 */
import crypto from 'crypto';
import request from 'supertest';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { app, claim, complete, evidence, fixture, seedOrder, type Fx } from './pick-assign-sf-01.fixture';

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

test('QC-01 one LSU scan + quantity 1 at a bin: verified lineage only, no settlement, no uncertainty', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 2);
  const shelf = await shelfUnits(fx, v.lasyncro_variant_id, 2, bin);
  const { batchId, alloc } = await releaseOne(fx, v, 1, bin);
  expect((await lineItems(fx.A.token, batchId)).body.line_items[0]).toMatchObject({ unit_scan_required: 1 });
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;

  const before = await truthAt(fx, v.lasyncro_variant_id, bin);
  expect((await scanUnits(fx.A.token, batchId, alloc, gen, [shelf[1]])).status).toBe(201);
  expect(await truthAt(fx, v.lasyncro_variant_id, bin)).toEqual({ on_hand: before!.on_hand - 1, reserved: before!.reserved - 1 });
  expect(await custody(fx, shelf)).toEqual({
    [shelf[0]]: { status: 'stowed', at: bin, unverified: false },
    [shelf[1]]: { status: 'picked', at: null, unverified: false },
  });
  const scan = await scanOf(fx, batchId);
  expect(await lineageOf(fx, shelf)).toEqual([{ scan_id: scan.scan_id, lasyncro_unit_id: shelf[1] }]);
  expect(await settlementsOf(fx, shelf)).toEqual([]);
});

test('QC-02 one LSU scan + quantity 2 from a bin holding 3: one verified, one settled unverified, the remaining sibling untrusted; refusals write nothing', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const w = fx.variants[1];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 3);
  const shelf = await shelfUnits(fx, v.lasyncro_variant_id, 3, bin);
  const otherBin = await stockBin(fx, v.lasyncro_variant_id, 0);
  const elsewhere = await shelfUnits(fx, v.lasyncro_variant_id, 1, otherBin);
  const otherVariantBin = await stockBin(fx, w.lasyncro_variant_id, 1, bin);
  const otherVariant = await shelfUnits(fx, w.lasyncro_variant_id, 1, otherVariantBin);

  const { batchId, alloc } = await releaseOne(fx, v, 2, bin);
  expect((await lineItems(fx.A.token, batchId)).body.line_items[0]).toMatchObject({ unit_scan_required: 1 });
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;

  const before = await evidence(fx.shop.shopId, batchId);
  const refusals: [string[], string, number][] = [
    [[], 'PICK_UNIT_IDENTITY_REQUIRED', 1],
    [[elsewhere[0]], 'PICK_UNIT_IDENTITY_MISMATCH', 1],     // different bin
    [[otherVariant[0]], 'PICK_UNIT_IDENTITY_MISMATCH', 1],  // different variant, same bin
    [[shelf[0], shelf[0]], 'PICK_UNIT_IDENTITY_MISMATCH', 1],
    [[shelf[0], shelf[1], shelf[2]], 'PICK_UNIT_IDENTITY_MISMATCH', 1], // more labels than quantity
  ];
  for (const [ids, code, n] of refusals) {
    const r = await scanUnits(fx.A.token, batchId, alloc, gen, ids);
    expect({ ids, status: r.status, code: r.body.code, n: r.body.units_required }).toEqual({ ids, status: 409, code, n });
  }
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);

  // Scan the LAST unit by id: settlement takes the first non-scanned record deterministically.
  const truthBefore = await truthAt(fx, v.lasyncro_variant_id, bin);
  expect((await scanUnits(fx.A.token, batchId, alloc, gen, [shelf[2]])).status).toBe(201);
  expect(await truthAt(fx, v.lasyncro_variant_id, bin)).toEqual({ on_hand: truthBefore!.on_hand - 2, reserved: truthBefore!.reserved - 2 });
  expect(await custody(fx, [...shelf, ...elsewhere, ...otherVariant])).toEqual({
    [shelf[0]]: { status: 'picked', at: null, unverified: false },
    [shelf[1]]: { status: 'stowed', at: bin, unverified: true },
    [shelf[2]]: { status: 'picked', at: null, unverified: false },
    [elsewhere[0]]: { status: 'stowed', at: otherBin, unverified: false },
    [otherVariant[0]]: { status: 'stowed', at: bin, unverified: false },
  });
  const scan = await scanOf(fx, batchId);
  expect(scan).toMatchObject({ quantity_confirmed: 2, lasyncro_unit_id: shelf[2] });
  // Only the scanned LSU is verified evidence.
  expect(await lineageOf(fx, shelf)).toEqual([{ scan_id: scan.scan_id, lasyncro_unit_id: shelf[2] }]);
  expect(await settlementsOf(fx, shelf)).toEqual([{
    scan_id: scan.scan_id, lasyncro_unit_id: shelf[0], origin_status: 'stowed', origin_location_code: bin,
    released_at: null, released_reason: null, replaced_by_unit_id: null,
  }]);
  const audit = await withTenant(fx.shop.shopId, (trx) => trx('operator_audit_log')
    .where({ shop_id: fx.shop.shopId, entity_id: batchId, action_type: 'pick_scan' }).select('metadata'));
  expect(audit.map((r: any) => r.metadata)).toEqual([expect.objectContaining({
    lasyncro_unit_ids: [shelf[2]], quantity_settled_unit_ids: [shelf[0]], quantity_confirmed: 2,
  })]);

  // Replay of the committed request: recognised, nothing new written.
  const after = await evidence(fx.shop.shopId, batchId);
  const replay = await scanUnits(fx.A.token, batchId, alloc, gen, [shelf[2]]);
  expect({ status: replay.status, code: replay.body.code }).toEqual({ status: 409, code: 'PICK_SCAN_ALREADY_RECORDED' });
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(after);
  expect(await settlementsOf(fx, shelf)).toHaveLength(1);
});

test('QC-03 uncertain response: the committed-outcome read reports only the scanned LSU as unit evidence', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 2);
  const shelf = await shelfUnits(fx, v.lasyncro_variant_id, 2, bin);
  const { batchId, alloc } = await releaseOne(fx, v, 2, bin);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  expect((await scanUnits(fx.A.token, batchId, alloc, gen, [shelf[1]])).status).toBe(201);
  const read = await request(app).get(`/api/v1/wms/batch/${batchId}/pick-session`).set(bearer(fx.A.token))
    .set('X-Pick-Claim-Generation', gen).query({ operation_type: 'pick', reservation_allocation_id: alloc.allocation_id,
      lasyncro_line_item_id: alloc.lasyncro_line_item_id });
  expect(read.status).toBe(200);
  expect(read.body.outcome).toMatchObject({ status: 'recorded', operation_type: 'pick', quantity_confirmed: 2, lasyncro_unit_ids: [shelf[1]] });
  // Both records left the shelf; neither can be picked as present stock now.
  expect(await custody(fx, shelf)).toEqual({
    [shelf[0]]: { status: 'picked', at: null, unverified: false },
    [shelf[1]]: { status: 'picked', at: null, unverified: false },
  });
});

test('QC-04 more requested than labelled, and insufficient stock: labelled records settled up to their count; insufficient on-hand refused with no writes', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const received = await seedReceivedUnits(fx, v.lasyncro_variant_id, 2);
  const { batchId, alloc } = await releaseOne(fx, v, 3);
  expect((await lineItems(fx.A.token, batchId)).body.line_items[0]).toMatchObject({ unit_scan_required: 1 });
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;

  // Insufficient physical stock at confirm time (test-only drain after Release).
  const truth0 = await truthAt(fx, v.lasyncro_variant_id, rootOf(fx));
  await withTenant(fx.shop.shopId, (trx) => trx('inventory_truth')
    .where({ shop_id: fx.shop.shopId, lasyncro_variant_id: v.lasyncro_variant_id, location_code: rootOf(fx) })
    .update({ on_hand_quantity: 2 }));
  const before = await evidence(fx.shop.shopId, batchId);
  const short = await scanUnits(fx.A.token, batchId, alloc, gen, [received.ids[0]]);
  // The route maps INSUFFICIENT_ON_HAND to this 409 operator message.
  expect({ status: short.status, error: short.body.error }).toEqual({
    status: 409, error: 'Not enough stock remains at this location for the requested pick. Refresh the pick task before continuing.',
  });
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);
  await withTenant(fx.shop.shopId, (trx) => trx('inventory_truth')
    .where({ shop_id: fx.shop.shopId, lasyncro_variant_id: v.lasyncro_variant_id, location_code: rootOf(fx) })
    .update({ on_hand_quantity: truth0!.on_hand }));

  // 2 labelled + 1 unlabelled: one scan, one settled record, one unit by quantity only.
  expect((await scanUnits(fx.A.token, batchId, alloc, gen, [received.ids[1]])).status).toBe(201);
  expect(await truthAt(fx, v.lasyncro_variant_id, rootOf(fx))).toEqual({ on_hand: truth0!.on_hand - 3, reserved: truth0!.reserved - 3 });
  expect(await custody(fx, received.ids)).toEqual({
    [received.ids[0]]: { status: 'picked', at: null, unverified: false },
    [received.ids[1]]: { status: 'picked', at: null, unverified: false },
  });
  expect((await settlementsOf(fx, received.ids)).map((s: any) => s.lasyncro_unit_id)).toEqual([received.ids[0]]);
  expect((await lineageOf(fx, received.ids)).map((s: any) => s.lasyncro_unit_id)).toEqual([received.ids[1]]);
});

test('QC-05 Short Pick: one scan + found 2 of 3 settles one record; the shortfall stays reserved (GH-1049)', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 3);
  const shelf = await shelfUnits(fx, v.lasyncro_variant_id, 3, bin);
  const { batchId, alloc } = await releaseOne(fx, v, 3, bin);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;

  const before = await evidence(fx.shop.shopId, batchId);
  const unlabelled = await shortPickUnits(fx.A.token, batchId, alloc, gen, 2, []);
  expect({ status: unlabelled.status, code: unlabelled.body.code, n: unlabelled.body.units_required })
    .toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_REQUIRED', n: 1 });
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);

  const truthBefore = await truthAt(fx, v.lasyncro_variant_id, bin);
  const ok = await shortPickUnits(fx.A.token, batchId, alloc, gen, 2, [shelf[1]]);
  expect(ok.status).toBe(201);
  expect(await truthAt(fx, v.lasyncro_variant_id, bin)).toEqual({ on_hand: truthBefore!.on_hand - 2, reserved: truthBefore!.reserved - 2 });
  expect(await custody(fx, shelf)).toEqual({
    [shelf[0]]: { status: 'picked', at: null, unverified: false },
    [shelf[1]]: { status: 'picked', at: null, unverified: false },
    [shelf[2]]: { status: 'stowed', at: bin, unverified: true },
  });
  expect((await settlementsOf(fx, shelf)).map((s: any) => s.lasyncro_unit_id)).toEqual([shelf[0]]);
  expect((await lineageOf(fx, shelf)).map((s: any) => s.lasyncro_unit_id)).toEqual([shelf[1]]);
  const tasks = await withTenant(fx.shop.shopId, (trx) => trx('problem_center_tasks')
    .where({ shop_id: fx.shop.shopId, source_pick_exception_id: ok.body.pick_exception_id }).select('quantity'));
  expect(tasks.map((t: any) => Number(t.quantity))).toEqual([1]);
});

test('QC-06 identity uncertainty: a settled-but-present LSU is reverified by exchange; with no unverified sibling left it is refused; settlement rows are release-only', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 3);
  const shelf = await shelfUnits(fx, v.lasyncro_variant_id, 3, bin);
  const first = await releaseOne(fx, v, 2, bin);
  const gen1 = (await claim(fx.A.token, first.batchId)).body.pick_claim_generation;
  expect((await scanUnits(fx.A.token, first.batchId, first.alloc, gen1, [shelf[2]])).status).toBe(201);
  const scan1 = await scanOf(fx, first.batchId);
  // Records: shelf[0] settled (unverified), shelf[1] still stowed but untrusted.
  // Physically, the picker actually took shelf[1]; shelf[0] is still on the shelf.
  expect((await complete(fx.A.token, first.batchId, gen1)).status).toBe(200);

  const second = await releaseOne(fx, v, 1, bin);
  const gen2 = (await claim(fx.B.token, second.batchId)).body.pick_claim_generation;
  const truthBefore = await truthAt(fx, v.lasyncro_variant_id, bin);
  const picked0 = await pickedRecords(fx, v.lasyncro_variant_id);
  expect((await scanUnits(fx.B.token, second.batchId, second.alloc, gen2, [shelf[0]])).status).toBe(201);
  const scan2 = await scanOf(fx, second.batchId);

  expect(await truthAt(fx, v.lasyncro_variant_id, bin)).toEqual({ on_hand: truthBefore!.on_hand - 1, reserved: truthBefore!.reserved - 1 });
  expect(await pickedRecords(fx, v.lasyncro_variant_id)).toBe(picked0 + 1);
  expect(await custody(fx, shelf)).toEqual({
    [shelf[0]]: { status: 'picked', at: null, unverified: false },
    [shelf[1]]: { status: 'picked', at: null, unverified: false },
    [shelf[2]]: { status: 'picked', at: null, unverified: false },
  });
  // shelf[0] is now verified by the second scan; the first scan's settlement moved to shelf[1].
  expect(await lineageOf(fx, shelf)).toEqual(
    [{ scan_id: scan2.scan_id, lasyncro_unit_id: shelf[0] }, { scan_id: scan1.scan_id, lasyncro_unit_id: shelf[2] }]
      .sort((a, b) => a.lasyncro_unit_id.localeCompare(b.lasyncro_unit_id)));
  const settlements = await settlementsOf(fx, shelf);
  expect(settlements).toEqual(expect.arrayContaining([
    expect.objectContaining({ scan_id: scan1.scan_id, lasyncro_unit_id: shelf[0], released_reason: 'reverified_present', replaced_by_unit_id: shelf[1] }),
    expect.objectContaining({ scan_id: scan1.scan_id, lasyncro_unit_id: shelf[1], released_at: null, origin_location_code: bin }),
  ]));
  expect(settlements).toHaveLength(2);
  const reverified = await withTenant(fx.shop.shopId, (trx) => trx('operator_audit_log')
    .where({ shop_id: fx.shop.shopId, action_type: 'pick_unit_reverified', entity_id: shelf[0] }).select('metadata'));
  expect(reverified.map((r: any) => r.metadata)).toEqual([expect.objectContaining({
    via: 'pick_scan', settlement_scan_id: scan1.scan_id, reverified_present_unit_id: shelf[0], quantity_settled_unit_id: shelf[1],
  })]);

  // Duplicate Pick of a consumed LSU with no unverified sibling to exchange: refused, nothing written.
  await stockBin(fx, v.lasyncro_variant_id, 1, bin);
  const extra = await shelfUnits(fx, v.lasyncro_variant_id, 1, bin); // trusted, never part of a settlement
  const third = await releaseOne(fx, v, 1, bin);
  const gen3 = (await claim(fx.A.token, third.batchId)).body.pick_claim_generation;
  const before3 = await evidence(fx.shop.shopId, third.batchId);
  for (const id of [shelf[1], shelf[2]]) {
    const dup = await scanUnits(fx.A.token, third.batchId, third.alloc, gen3, [id]);
    expect({ id, status: dup.status, code: dup.body.code }).toEqual({ id, status: 409, code: 'PICK_UNIT_IDENTITY_MISMATCH' });
  }
  expect(await evidence(fx.shop.shopId, third.batchId)).toEqual(before3);
  expect((await scanUnits(fx.A.token, third.batchId, third.alloc, gen3, [extra[0]])).status).toBe(201);

  // Release-only: as the application role, a released row cannot change and no row can be deleted.
  await expect(withTenant(fx.shop.shopId, (trx) => trx('pick_scan_unit_settlement')
    .where({ shop_id: fx.shop.shopId, lasyncro_unit_id: shelf[0] }).update({ released_reason: null, released_at: null, replaced_by_unit_id: null })))
    .rejects.toThrow();
  await expect(withTenant(fx.shop.shopId, (trx) => trx('pick_scan_unit_settlement')
    .where({ shop_id: fx.shop.shopId, lasyncro_unit_id: shelf[1] }).del())).rejects.toThrow();
});

test('QC-07 Receive/Stow consistency: root quantity Pick reconciles the Stow obligation; Stow of a settled-but-present LSU exchanges and completes', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 0);
  const received = await seedReceivedUnits(fx, v.lasyncro_variant_id, 3);
  const ordered = await withTenant(fx.shop.shopId, (trx) => trx('inventory_units').where({ shop_id: fx.shop.shopId })
    .whereIn('lasyncro_unit_id', received.ids).orderBy('id').pluck('lasyncro_unit_id')) as string[];
  const taskId = await withTenant(fx.shop.shopId, async (trx) => {
    const [row] = await trx('stow_tasks').insert({
      shop_id: fx.shop.shopId, lasyncro_variant_id: v.lasyncro_variant_id, quantity: 3, location_code: bin,
      status: 'pending', trigger: 'inbound_stock', receive_job_line_id: received.receiveJobLineId,
    }).returning('stow_task_id');
    return row.stow_task_id as string;
  });

  const { batchId, alloc } = await releaseOne(fx, v, 2);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  const rootBefore = await truthAt(fx, v.lasyncro_variant_id, rootOf(fx));
  expect((await scanUnits(fx.A.token, batchId, alloc, gen, [ordered[2]])).status).toBe(201);
  expect(await truthAt(fx, v.lasyncro_variant_id, rootOf(fx))).toEqual({ on_hand: rootBefore!.on_hand - 2, reserved: rootBefore!.reserved - 2 });
  expect(await stowTask(fx, taskId)).toMatchObject({ quantity: 1, quantity_placed: 0, status: 'pending' });
  expect(await custody(fx, ordered)).toEqual({
    [ordered[0]]: { status: 'picked', at: null, unverified: false },
    [ordered[1]]: { status: 'received', at: null, unverified: true },
    [ordered[2]]: { status: 'picked', at: null, unverified: false },
  });
  const reconcile = await withTenant(fx.shop.shopId, (trx) => trx('operator_audit_log')
    .where({ shop_id: fx.shop.shopId, entity_id: taskId, action_type: 'stow_reconcile' }).select('metadata'));
  expect(reconcile.map((r: any) => r.metadata)).toEqual([expect.objectContaining({
    lasyncro_unit_ids: [ordered[2]], quantity_settled_unit_ids: [ordered[0]], quantity_before: 3, quantity_after: 1,
  })]);

  // Physically the picker took ordered[1]; Stow now scans ordered[0], which is on the floor.
  expect((await request(app).post(`/api/v1/wms/stow-tasks/${taskId}/claim`).set(bearer(fx.shop.ownerToken)).send({})).status).toBe(200);
  const stow = await request(app).post(`/api/v1/wms/stow-tasks/${taskId}/confirm`).set(bearer(fx.shop.ownerToken))
    .send({ lasyncro_unit_id: ordered[0], quantity_placed: 1 });
  expect(stow.status).toBe(200);
  expect(await stowTask(fx, taskId)).toMatchObject({ quantity: 1, quantity_placed: 1, status: 'completed' });
  expect(await custody(fx, ordered)).toEqual({
    [ordered[0]]: { status: 'stowed', at: bin, unverified: false },
    [ordered[1]]: { status: 'picked', at: null, unverified: false },
    [ordered[2]]: { status: 'picked', at: null, unverified: false },
  });
  expect(await truthAt(fx, v.lasyncro_variant_id, bin)).toMatchObject({ on_hand: 1 });
  expect(await truthAt(fx, v.lasyncro_variant_id, rootOf(fx))).toMatchObject({ on_hand: rootBefore!.on_hand - 3 });
  const settlements = await settlementsOf(fx, ordered);
  expect(settlements.filter((s: any) => s.released_at === null).map((s: any) => s.lasyncro_unit_id)).toEqual([ordered[1]]);
  expect(await lineageOf(fx, ordered)).toEqual([expect.objectContaining({ lasyncro_unit_id: ordered[2] })]);
});

test('QC-08 concurrent Picks at one bin: both commit, every record consumed once, truth and units agree', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const shopId = fx.shop.shopId;
  const bin = await stockBin(fx, v.lasyncro_variant_id, 4);
  const shelf = await shelfUnits(fx, v.lasyncro_variant_id, 4, bin);
  const one = await releaseOne(fx, v, 2, bin);
  const two = await releaseOne(fx, v, 2, bin);
  const genA = (await claim(fx.A.token, one.batchId)).body.pick_claim_generation;
  const genB = (await claim(fx.B.token, two.batchId)).body.pick_claim_generation;
  const truthBefore = await truthAt(fx, v.lasyncro_variant_id, bin);

  // Hold the bin's first unit row: both Picks queue on the eligible-set lock, then race.
  let locked!: () => void; let releaseGate!: () => void;
  const held = new Promise<void>((r) => { locked = r; });
  const gate = new Promise<void>((r) => { releaseGate = r; });
  const holder = withTenant(shopId, async (trx) => {
    await trx('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: shelf[0] }).forUpdate().first('id');
    locked();
    await gate;
  });
  await held;
  // A scans shelf[0]; B scans shelf[1] — the record A would settle by quantity.
  const pA = scanUnits(fx.A.token, one.batchId, one.alloc, genA, [shelf[0]]).then((r) => r);
  const pB = scanUnits(fx.B.token, two.batchId, two.alloc, genB, [shelf[1]]).then((r) => r);
  expect(await waitForLockWaiters(shopId, 2)).toBeGreaterThanOrEqual(2);
  releaseGate();
  await holder;
  const [rA, rB] = await Promise.all([pA, pB]);
  expect({ a: rA.status, b: rB.status }).toEqual({ a: 201, b: 201 });

  expect(await truthAt(fx, v.lasyncro_variant_id, bin)).toEqual({ on_hand: truthBefore!.on_hand - 4, reserved: truthBefore!.reserved - 4 });
  const state = await custody(fx, shelf);
  expect(Object.values(state).every((u: any) => u.status === 'picked' && u.at === null && !u.unverified)).toBe(true);
  // Each scanned LSU is verified exactly once; settlement covers the other two, each active once.
  const lineage = await lineageOf(fx, shelf);
  expect(lineage.map((l: any) => l.lasyncro_unit_id).sort()).toEqual([shelf[0], shelf[1]].sort());
  const active = (await settlementsOf(fx, shelf)).filter((s: any) => s.released_at === null).map((s: any) => s.lasyncro_unit_id);
  expect(active.sort()).toEqual([shelf[2], shelf[3]].sort());
  const verifiedAndSettled = lineage.map((l: any) => l.lasyncro_unit_id).filter((id: string) => active.includes(id));
  expect(verifiedAndSettled).toEqual([]);
});

test('QC-09 EAN-only stock: no labelled units → product-only quantity Pick, no unit records touched', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 3);
  const { batchId, alloc } = await releaseOne(fx, v, 2, bin);
  expect((await lineItems(fx.A.token, batchId)).body.line_items[0]).toMatchObject({ unit_scan_required: 0 });
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  const truthBefore = await truthAt(fx, v.lasyncro_variant_id, bin);
  const unitsBefore = (await evidence(fx.shop.shopId, batchId)).units;
  expect((await scanUnits(fx.A.token, batchId, alloc, gen, [])).status).toBe(201);
  expect(await truthAt(fx, v.lasyncro_variant_id, bin)).toEqual({ on_hand: truthBefore!.on_hand - 2, reserved: truthBefore!.reserved - 2 });
  expect((await evidence(fx.shop.shopId, batchId)).units).toEqual(unitsBefore);
  const settled = await withTenant(fx.shop.shopId, (trx) => trx('pick_scan_unit_settlement').where({ shop_id: fx.shop.shopId }).select('scan_id'));
  expect(settled).toEqual([]);
});

test('QC-10 a settled record returned to stock by another route is settled again; the stale settlement is released, never deleted (review D1)', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 2);
  const shelf = await shelfUnits(fx, v.lasyncro_variant_id, 2, bin);
  const first = await releaseOne(fx, v, 2, bin);
  const gen1 = (await claim(fx.A.token, first.batchId)).body.pick_claim_generation;
  expect((await scanUnits(fx.A.token, first.batchId, first.alloc, gen1, [shelf[1]])).status).toBe(201);
  const scan1 = await scanOf(fx, first.batchId);
  expect((await complete(fx.A.token, first.batchId, gen1)).status).toBe(200);

  // Test-only stand-in for a non-exchange return to stock (e.g. cancelled-pick
  // recovery): both records go back on the shelf with their stock.
  await stockBin(fx, v.lasyncro_variant_id, 2, bin);
  await withTenant(fx.shop.shopId, (trx) => trx('inventory_units').where({ shop_id: fx.shop.shopId })
    .whereIn('lasyncro_unit_id', shelf).update({ status: 'stowed', current_location_code: bin }));

  const second = await releaseOne(fx, v, 2, bin);
  const gen2 = (await claim(fx.B.token, second.batchId)).body.pick_claim_generation;
  expect((await scanUnits(fx.B.token, second.batchId, second.alloc, gen2, [shelf[1]])).status).toBe(201);
  const scan2 = await scanOf(fx, second.batchId);
  const rows = await settlementsOf(fx, shelf);
  expect(rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ scan_id: scan1.scan_id, lasyncro_unit_id: shelf[0], released_reason: 'returned_to_stock', replaced_by_unit_id: null }),
    expect.objectContaining({ scan_id: scan2.scan_id, lasyncro_unit_id: shelf[0], released_at: null }),
  ]));
  expect(rows).toHaveLength(2);
});
