/**
 * SF-PICK-LOCATION-TRUTH-01 — real routes, disposable DB only.
 *
 * Owner decision (Option B):
 * - Root-only Release → Pick works without Floor Planning or Stow (A18). The
 *   warehouse root is a product-scan stop: no location scan, no map position.
 * - When eligible LSU records exist for the variant at the root, at least one
 *   scanned LSU is required (SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001: one
 *   label verifies, the rest of the quantity is settled by count and recorded
 *   as unverified — see pick-quantity-custody-001.test.ts).
 * - Product-only root picking is allowed when no eligible LSU exists.
 * - Picked LSUs leave the eligible set atomically with the physical removal:
 *   they can be neither Stowed nor Picked again.
 * - GH-1049 Short Pick reservation semantics are unchanged.
 * - Real pick bins keep server-verified location scans, and the same unit
 *   identity rule applies to stowed units at a bin.
 * - A received root LSU picked before Stow releases exactly its unit of the
 *   Receive line's inbound Stow obligation (partial / complete / cancelled).
 */
import crypto from 'crypto';
import request from 'supertest';
import { withTenant } from '@lasyncro/backend-core/db.js';
import {
  app, claim, complete, evidence, fixture, release, scan, seedOrder, type Fx,
} from './pick-assign-sf-01.fixture';

jest.setTimeout(180_000);

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const rootOf = (fx: Fx) => `WH-${fx.shop.shopId}-ROOT`;
const lineItems = (token: string, batchId: string) =>
  request(app).get(`/api/v1/wms/batch/${batchId}/line-items`).set(bearer(token));
const verify = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/wms/pick/location/verify').set(bearer(token)).send(body);
const scanUnits = (token: string, batchId: string, a: any, generation: string, unitIds: string[], quantity = Number(a.quantity)) =>
  request(app).post('/api/v1/wms/pick/scan').set(bearer(token)).send({
    pick_batch_id: batchId, lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    reservation_allocation_id: a.allocation_id, location_code: a.location_code, quantity_confirmed: quantity,
    lasyncro_unit_ids: unitIds, pick_claim_generation: generation,
  });
const shortPickUnits = (token: string, batchId: string, a: any, generation: string, found: number, unitIds: string[], eventId = crypto.randomUUID()) =>
  request(app).post(`/api/v1/wms/batch/${batchId}/exception`).set(bearer(token)).send({
    lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    reservation_allocation_id: a.allocation_id, location_code: a.location_code, exception_type: 'short_pick',
    stage: 'pick', quantity_required: Number(a.quantity), quantity_found: found, device_event_id: eventId,
    lasyncro_unit_ids: unitIds, pick_claim_generation: generation,
  });

/** Release exactly one order of `qty` units of `variant`; returns its single allocation (root unless stated). */
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

/**
 * Test-only: `count` LSUs from one Receive line. A closed receive also credits
 * its quantity to the root (as closeReceiveJob does); an open receive does not
 * and its units are not root stock.
 */
async function seedReceivedUnits(fx: Fx, variantId: string, count: number, closed = true) {
  const shopId = fx.shop.shopId;
  return withTenant(shopId, async (trx) => {
    const [supplier] = await trx('suppliers').insert({ shop_id: shopId, name: `LT supplier ${crypto.randomUUID()}` }).returning('id');
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
      const n = await trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: `WH-${shopId}-ROOT` })
        .update({
          on_hand_quantity: trx.raw('on_hand_quantity + ?', [count]),
          available_quantity: trx.raw('available_quantity + ?', [count]),
        });
      expect(n).toBe(1);
    }
    return { ids, receiveJobLineId: line.receive_job_line_id as string, poId: po.id as number };
  });
}

const units = (fx: Fx, ids: string[]) =>
  withTenant(fx.shop.shopId, (trx) => trx('inventory_units').where({ shop_id: fx.shop.shopId })
    .whereIn('lasyncro_unit_id', ids).orderBy('lasyncro_unit_id').select('lasyncro_unit_id', 'status', 'current_location_code'));
const rootTruth = async (fx: Fx, variantId: string) => {
  const row = await withTenant(fx.shop.shopId, (trx) => trx('inventory_truth')
    .where({ shop_id: fx.shop.shopId, lasyncro_variant_id: variantId, location_code: rootOf(fx) }).first());
  return { on_hand: Number(row.on_hand_quantity), reserved: Number(row.reserved_quantity) };
};
const pickRemovals = (fx: Fx, variantId: string) =>
  withTenant(fx.shop.shopId, (trx) => trx('inventory_movements')
    .where({ shop_id: fx.shop.shopId, lasyncro_variant_id: variantId, movement_type: 'pick_removal' })
    .select('quantity_delta', 'location_code'));
const sortedUnits = (rows: { lasyncro_unit_id: string; status: string; current_location_code: string | null }[]) =>
  [...rows].sort((x, y) => x.lasyncro_unit_id.localeCompare(y.lasyncro_unit_id));

test('LT-01 root-only opening inventory: Release → product-only Pick → Pack, with no location scan', async () => {
  const fx = await fixture();
  const root = rootOf(fx);
  const { batchId, allocations } = await release(fx, fx.A.userId);
  expect(allocations.every((a: any) => a.location_code === root)).toBe(true);

  const items = await lineItems(fx.A.token, batchId);
  expect(items.status).toBe(200);
  for (const li of items.body.line_items) {
    expect(li).toMatchObject({ location_code: root, location_pickable: true, location_scan_required: false, unit_scan_required: 0 });
  }

  // The root is never a location-scan target.
  const a0 = allocations[0];
  const v = await verify(fx.A.token, {
    pick_batch_id: batchId, lasyncro_line_item_id: a0.lasyncro_line_item_id,
    reservation_allocation_id: a0.allocation_id, scanned_value: root,
  });
  expect(v.status).toBe(409);
  expect(v.body).toMatchObject({ code: 'PICK_LOCATION_NOT_PICKABLE', location_code: root, problem: 'structural_location' });

  const claimed = await claim(fx.A.token, batchId);
  expect(claimed.status).toBe(200);
  const gen = claimed.body.pick_claim_generation;
  for (const a of allocations) {
    const before = await rootTruth(fx, a.lasyncro_variant_id);
    const s = await scan(fx.A.token, batchId, a, gen);
    expect(s.status).toBe(201);
    expect(await rootTruth(fx, a.lasyncro_variant_id))
      .toEqual({ on_hand: before.on_hand - Number(a.quantity), reserved: before.reserved - Number(a.quantity) });
  }

  expect((await complete(fx.A.token, batchId, gen)).status).toBe(200);
  const rtp = await request(app).get('/api/v1/wms/batches/ready-to-pack').set(bearer(fx.shop.ownerToken));
  expect(rtp.status).toBe(200);
  const packOrders = new Set((rtp.body.orders ?? []).map((o: any) => o.lasyncro_order_id));
  for (const a of allocations) expect(packOrders.has(a.lasyncro_order_id)).toBe(true);
});

test('LT-02 a real pick bin keeps a server-verified location scan: the bin is accepted, any other label rejected', async () => {
  const fx = await fixture();
  const { batchId, allocations } = await release(fx, fx.A.userId);
  const a = allocations[0];
  const bin = `PICK-LT-${Date.now()}`;
  // Test-only: point one disposable allocation at a real active pick bin. The
  // location names its warehouse (migration 0229): inherit the root's.
  await withTenant(fx.shop.shopId, async (trx) => {
    const rootRow = await trx('warehouse_locations')
      .where({ shop_id: fx.shop.shopId, location_code: rootOf(fx) }).first('warehouse_id');
    await trx('warehouse_locations').insert({
      shop_id: fx.shop.shopId, warehouse_id: rootRow.warehouse_id, location_code: bin,
      type: 'bin', zone_type: 'pick', active: true, parent_location_code: rootOf(fx),
    });
    await trx('pick_reservation_allocations').where({ allocation_id: a.allocation_id }).update({ location_code: bin });
  });

  const body = { pick_batch_id: batchId, lasyncro_line_item_id: a.lasyncro_line_item_id, reservation_allocation_id: a.allocation_id };
  const ok = await verify(fx.A.token, { ...body, scanned_value: bin });
  expect(ok.status).toBe(200);
  expect(ok.body).toEqual({ verified: true, location_code: bin });

  const wrong = await verify(fx.A.token, { ...body, scanned_value: rootOf(fx) });
  expect(wrong.status).toBe(422);
  expect(wrong.body).toMatchObject({ code: 'PICK_LOCATION_MISMATCH', location_code: bin });

  const items = await lineItems(fx.A.token, batchId);
  const row = items.body.line_items.find((li: any) => li.reservation_allocation_id === a.allocation_id);
  expect(row).toMatchObject({ location_code: bin, location_pickable: true, location_scan_required: true, unit_scan_required: 0 });
});

test('LT-03 root received LSUs: identity required, wrong labels refused with no writes, picked units settled and never Stowed or Picked again', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const received = await seedReceivedUnits(fx, v.lasyncro_variant_id, 2);
  const openReceive = await seedReceivedUnits(fx, v.lasyncro_variant_id, 1, false); // not root stock
  const otherVariant = await seedReceivedUnits(fx, fx.variants[1].lasyncro_variant_id, 1);

  const { batchId, alloc } = await releaseOne(fx, v, 2);
  const items = await lineItems(fx.A.token, batchId);
  expect(items.body.line_items[0]).toMatchObject({ location_scan_required: false, unit_scan_required: 1 });

  const claimed = await claim(fx.A.token, batchId);
  expect(claimed.status).toBe(200);
  const gen = claimed.body.pick_claim_generation;

  // Every refusal is answered before any write.
  const before = await evidence(fx.shop.shopId, batchId);
  const refusals: [string[], string][] = [
    [[], 'PICK_UNIT_IDENTITY_REQUIRED'],
    [[received.ids[0], otherVariant.ids[0]], 'PICK_UNIT_IDENTITY_MISMATCH'],
    [[received.ids[0], openReceive.ids[0]], 'PICK_UNIT_IDENTITY_MISMATCH'],
    [[received.ids[0], received.ids[0]], 'PICK_UNIT_IDENTITY_MISMATCH'],
    [[received.ids[0], 'LSU-ffffffff'], 'PICK_UNIT_IDENTITY_MISMATCH'],
  ];
  for (const [ids, code] of refusals) {
    const r = await scanUnits(fx.A.token, batchId, alloc, gen, ids);
    expect({ ids, status: r.status, code: r.body.code }).toEqual({ ids, status: 409, code });
  }
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);

  const truthBefore = await rootTruth(fx, v.lasyncro_variant_id);
  const ok = await scanUnits(fx.A.token, batchId, alloc, gen, received.ids);
  expect(ok.status).toBe(201);
  expect(await rootTruth(fx, v.lasyncro_variant_id))
    .toEqual({ on_hand: truthBefore.on_hand - 2, reserved: truthBefore.reserved - 2 });
  expect(await units(fx, received.ids)).toEqual(sortedUnits(
    received.ids.map((id) => ({ lasyncro_unit_id: id, status: 'picked', current_location_code: null }))));
  expect(await units(fx, openReceive.ids)).toEqual([{ lasyncro_unit_id: openReceive.ids[0], status: 'received', current_location_code: null }]);
  const lineage = await withTenant(fx.shop.shopId, (trx) => trx('pick_scan_unit_lineage')
    .where({ shop_id: fx.shop.shopId }).whereIn('lasyncro_unit_id', received.ids).pluck('lasyncro_unit_id'));
  expect([...lineage].sort()).toEqual([...received.ids].sort());

  // A picked unit is not Stowable: the inbound Stow of its Receive line refuses it with no side effects.
  const binCode = `PICK-LT3-${Date.now()}`;
  const stowTaskId = await withTenant(fx.shop.shopId, async (trx) => {
    const rootRow = await trx('warehouse_locations').where({ shop_id: fx.shop.shopId, location_code: rootOf(fx) }).first('warehouse_id');
    await trx('warehouse_locations').insert({
      shop_id: fx.shop.shopId, warehouse_id: rootRow.warehouse_id, location_code: binCode,
      type: 'bin', zone_type: 'pick', active: true, parent_location_code: rootOf(fx),
    });
    const [row] = await trx('stow_tasks').insert({
      shop_id: fx.shop.shopId, lasyncro_variant_id: v.lasyncro_variant_id, quantity: 2, location_code: binCode,
      po_id: received.poId, status: 'pending', trigger: 'inbound_stock', receive_job_line_id: received.receiveJobLineId,
    }).returning('stow_task_id');
    return row.stow_task_id as string;
  });
  expect((await request(app).post(`/api/v1/wms/stow-tasks/${stowTaskId}/claim`).set(bearer(fx.shop.ownerToken)).send({})).status).toBe(200);
  const beforeStow = await evidence(fx.shop.shopId, batchId);
  const stow = await request(app).post(`/api/v1/wms/stow-tasks/${stowTaskId}/confirm`).set(bearer(fx.shop.ownerToken))
    .send({ lasyncro_unit_id: received.ids[0], quantity_placed: 1 });
  expect(stow.status).toBeGreaterThanOrEqual(400);
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(beforeStow);

  // A picked unit is not Pickable again; with no eligible LSU left, product-only applies.
  expect((await complete(fx.A.token, batchId, gen)).status).toBe(200);
  const second = await releaseOne(fx, v, 1);
  const items2 = await lineItems(fx.B.token, second.batchId);
  expect(items2.body.line_items[0]).toMatchObject({ unit_scan_required: 0 });
  const claimed2 = await claim(fx.B.token, second.batchId);
  expect(claimed2.status).toBe(200);
  const before2 = await evidence(fx.shop.shopId, second.batchId);
  const again = await scanUnits(fx.B.token, second.batchId, second.alloc, claimed2.body.pick_claim_generation, [received.ids[1]]);
  expect({ status: again.status, code: again.body.code }).toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_MISMATCH' });
  expect(await evidence(fx.shop.shopId, second.batchId)).toEqual(before2);
  expect((await scanUnits(fx.B.token, second.batchId, second.alloc, claimed2.body.pick_claim_generation, [])).status).toBe(201);
});

test('LT-04 root Short Pick: found units need their labels; only they are removed; the shortfall stays reserved (GH-1049)', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const received = await seedReceivedUnits(fx, v.lasyncro_variant_id, 2);
  const { batchId, alloc } = await releaseOne(fx, v, 2);
  const claimed = await claim(fx.A.token, batchId);
  expect(claimed.status).toBe(200);
  const gen = claimed.body.pick_claim_generation;

  const before = await evidence(fx.shop.shopId, batchId);
  const unlabelled = await shortPickUnits(fx.A.token, batchId, alloc, gen, 1, []);
  expect({ status: unlabelled.status, code: unlabelled.body.code, n: unlabelled.body.units_required })
    .toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_REQUIRED', n: 1 });
  const surplus = await shortPickUnits(fx.A.token, batchId, alloc, gen, 1, received.ids);
  expect({ status: surplus.status, code: surplus.body.code }).toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_MISMATCH' });
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);

  const truthBefore = await rootTruth(fx, v.lasyncro_variant_id);
  const ok = await shortPickUnits(fx.A.token, batchId, alloc, gen, 1, [received.ids[0]]);
  expect(ok.status).toBe(201);
  // GH-1049: only the found unit is removed and released; the missing one stays reserved for Problem Center.
  expect(await rootTruth(fx, v.lasyncro_variant_id))
    .toEqual({ on_hand: truthBefore.on_hand - 1, reserved: truthBefore.reserved - 1 });
  expect(await units(fx, received.ids)).toEqual(sortedUnits([
    { lasyncro_unit_id: received.ids[0], status: 'picked', current_location_code: null },
    { lasyncro_unit_id: received.ids[1], status: 'received', current_location_code: null },
  ]));
  const tasks = await withTenant(fx.shop.shopId, (trx) => trx('problem_center_tasks')
    .where({ shop_id: fx.shop.shopId, source_pick_exception_id: ok.body.pick_exception_id }).select('quantity'));
  expect(tasks.map((t: any) => Number(t.quantity))).toEqual([1]);
});

test('LT-05 mixed root stock: labelled units identified, unlabelled remainder product-only, one removal, no replay duplicate', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const received = await seedReceivedUnits(fx, v.lasyncro_variant_id, 1);
  const { batchId, alloc } = await releaseOne(fx, v, 3);
  expect((await lineItems(fx.A.token, batchId)).body.line_items[0]).toMatchObject({ unit_scan_required: 1 });
  const claimed = await claim(fx.A.token, batchId);
  expect(claimed.status).toBe(200);
  const gen = claimed.body.pick_claim_generation;

  const before = await evidence(fx.shop.shopId, batchId);
  const missing = await scanUnits(fx.A.token, batchId, alloc, gen, []);
  expect({ status: missing.status, code: missing.body.code, n: missing.body.units_required })
    .toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_REQUIRED', n: 1 });
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);

  const truthBefore = await rootTruth(fx, v.lasyncro_variant_id);
  const removalsBefore = (await pickRemovals(fx, v.lasyncro_variant_id)).length;
  expect((await scanUnits(fx.A.token, batchId, alloc, gen, received.ids)).status).toBe(201);
  const replay = await scanUnits(fx.A.token, batchId, alloc, gen, received.ids);
  expect({ status: replay.status, code: replay.body.code }).toEqual({ status: 409, code: 'PICK_SCAN_ALREADY_RECORDED' });

  expect(await rootTruth(fx, v.lasyncro_variant_id))
    .toEqual({ on_hand: truthBefore.on_hand - 3, reserved: truthBefore.reserved - 3 });
  const removals = await pickRemovals(fx, v.lasyncro_variant_id);
  expect(removals.length).toBe(removalsBefore + 1);
  expect(removals.filter((m: any) => Number(m.quantity_delta) === -3)).toHaveLength(1);
  expect(await units(fx, received.ids)).toEqual([{ lasyncro_unit_id: received.ids[0], status: 'picked', current_location_code: null }]);
});

// ── Bins (P0) and Stow reconciliation (P1) ───────────────────────────────────

/** Test-only: an active pick bin holding `qty` of the variant (moved from the root). */
async function stockBin(fx: Fx, variantId: string, qty: number, bin = `PICK-LT-${crypto.randomBytes(3).toString('hex')}`) {
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

/** Test-only: mark seeded units as stowed at `bin` (their stock is already in that bin's truth). */
const placeUnits = (fx: Fx, ids: string[], bin: string) =>
  withTenant(fx.shop.shopId, (trx) => trx('inventory_units').where({ shop_id: fx.shop.shopId })
    .whereIn('lasyncro_unit_id', ids).update({ status: 'stowed', current_location_code: bin }));

const binTruth = async (fx: Fx, variantId: string, bin: string) => {
  const row = await withTenant(fx.shop.shopId, (trx) => trx('inventory_truth')
    .where({ shop_id: fx.shop.shopId, lasyncro_variant_id: variantId, location_code: bin }).first());
  return row ? { on_hand: Number(row.on_hand_quantity), reserved: Number(row.reserved_quantity) } : null;
};

async function inboundStowTask(fx: Fx, variantId: string, receiveJobLineId: string, quantity: number, bin: string) {
  return withTenant(fx.shop.shopId, async (trx) => {
    const [row] = await trx('stow_tasks').insert({
      shop_id: fx.shop.shopId, lasyncro_variant_id: variantId, quantity, location_code: bin,
      status: 'pending', trigger: 'inbound_stock', receive_job_line_id: receiveJobLineId,
    }).returning('stow_task_id');
    return row.stow_task_id as string;
  });
}
const stowTask = (fx: Fx, id: string) => withTenant(fx.shop.shopId, (trx) => trx('stow_tasks')
  .where({ shop_id: fx.shop.shopId, stow_task_id: id })
  .first('quantity', 'quantity_placed', 'quantity_excepted', 'status', 'completed_at'));
const stowClaim = (fx: Fx, id: string) =>
  request(app).post(`/api/v1/wms/stow-tasks/${id}/claim`).set(bearer(fx.shop.ownerToken)).send({});
const stowConfirm = (fx: Fx, id: string, unitId: string) =>
  request(app).post(`/api/v1/wms/stow-tasks/${id}/confirm`).set(bearer(fx.shop.ownerToken))
    .send({ lasyncro_unit_id: unitId, quantity_placed: 1 });
const reconcileAudit = (fx: Fx, id: string) => withTenant(fx.shop.shopId, (trx) => trx('operator_audit_log')
  .where({ shop_id: fx.shop.shopId, entity_id: id, action_type: 'stow_reconcile' }).select('metadata'));

test('LT-06 bin Full Pick: scanned stowed units are named; wrong, duplicate or missing labels are refused; no re-pick', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 3);
  const shelf = await seedReceivedUnits(fx, v.lasyncro_variant_id, 3, false);
  await placeUnits(fx, shelf.ids, bin);
  const elsewhereBin = await stockBin(fx, v.lasyncro_variant_id, 0); // a unit record elsewhere, no stock: allocation stays on `bin`
  const elsewhere = await seedReceivedUnits(fx, v.lasyncro_variant_id, 1, false);
  await placeUnits(fx, elsewhere.ids, elsewhereBin);

  const { batchId, alloc } = await releaseOne(fx, v, 2, bin);
  expect((await lineItems(fx.A.token, batchId)).body.line_items[0])
    .toMatchObject({ location_code: bin, location_scan_required: true, unit_scan_required: 1 });
  const claimed = await claim(fx.A.token, batchId);
  expect(claimed.status).toBe(200);
  const gen = claimed.body.pick_claim_generation;

  const before = await evidence(fx.shop.shopId, batchId);
  const refusals: [string[], string][] = [
    [[], 'PICK_UNIT_IDENTITY_REQUIRED'],
    [[shelf.ids[0], elsewhere.ids[0]], 'PICK_UNIT_IDENTITY_MISMATCH'],
    [[shelf.ids[0], shelf.ids[0]], 'PICK_UNIT_IDENTITY_MISMATCH'],
  ];
  for (const [ids, code] of refusals) {
    const r = await scanUnits(fx.A.token, batchId, alloc, gen, ids);
    expect({ ids, status: r.status, code: r.body.code }).toEqual({ ids, status: 409, code });
  }
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);

  const truthBefore = await binTruth(fx, v.lasyncro_variant_id, bin);
  expect((await scanUnits(fx.A.token, batchId, alloc, gen, [shelf.ids[2], shelf.ids[0]])).status).toBe(201);
  const replay = await scanUnits(fx.A.token, batchId, alloc, gen, [shelf.ids[2], shelf.ids[0]]);
  expect({ status: replay.status, code: replay.body.code }).toEqual({ status: 409, code: 'PICK_SCAN_ALREADY_RECORDED' });
  expect(await binTruth(fx, v.lasyncro_variant_id, bin))
    .toEqual({ on_hand: truthBefore!.on_hand - 2, reserved: truthBefore!.reserved - 2 });
  expect(await units(fx, shelf.ids)).toEqual(sortedUnits([
    { lasyncro_unit_id: shelf.ids[0], status: 'picked', current_location_code: null },
    { lasyncro_unit_id: shelf.ids[1], status: 'stowed', current_location_code: bin },
    { lasyncro_unit_id: shelf.ids[2], status: 'picked', current_location_code: null },
  ]));

  // A consumed LSU cannot be picked again; the remaining shelf unit can.
  expect((await complete(fx.A.token, batchId, gen)).status).toBe(200);
  const second = await releaseOne(fx, v, 1, bin);
  expect((await lineItems(fx.B.token, second.batchId)).body.line_items[0]).toMatchObject({ unit_scan_required: 1 });
  const claimed2 = await claim(fx.B.token, second.batchId);
  const gen2 = claimed2.body.pick_claim_generation;
  const before2 = await evidence(fx.shop.shopId, second.batchId);
  const again = await scanUnits(fx.B.token, second.batchId, second.alloc, gen2, [shelf.ids[0]]);
  expect({ status: again.status, code: again.body.code }).toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_MISMATCH' });
  expect(await evidence(fx.shop.shopId, second.batchId)).toEqual(before2);
  expect((await scanUnits(fx.B.token, second.batchId, second.alloc, gen2, [shelf.ids[1]])).status).toBe(201);
});

test('LT-07 bin Short Pick: the found unit is named and settled; the shelf sibling stays; the shortfall stays reserved (GH-1049)', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 2);
  const shelf = await seedReceivedUnits(fx, v.lasyncro_variant_id, 2, false);
  await placeUnits(fx, shelf.ids, bin);
  const { batchId, alloc } = await releaseOne(fx, v, 2, bin);
  const claimed = await claim(fx.A.token, batchId);
  const gen = claimed.body.pick_claim_generation;

  const before = await evidence(fx.shop.shopId, batchId);
  const unlabelled = await shortPickUnits(fx.A.token, batchId, alloc, gen, 1, []);
  expect({ status: unlabelled.status, code: unlabelled.body.code, n: unlabelled.body.units_required })
    .toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_REQUIRED', n: 1 });
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);

  const truthBefore = await binTruth(fx, v.lasyncro_variant_id, bin);
  const ok = await shortPickUnits(fx.A.token, batchId, alloc, gen, 1, [shelf.ids[1]]);
  expect(ok.status).toBe(201);
  expect(await binTruth(fx, v.lasyncro_variant_id, bin))
    .toEqual({ on_hand: truthBefore!.on_hand - 1, reserved: truthBefore!.reserved - 1 });
  expect(await units(fx, shelf.ids)).toEqual(sortedUnits([
    { lasyncro_unit_id: shelf.ids[0], status: 'stowed', current_location_code: bin },
    { lasyncro_unit_id: shelf.ids[1], status: 'picked', current_location_code: null },
  ]));
});

test('LT-08 Stow partially reconciled: a root-picked received LSU leaves the task; the remaining units stow normally to completion', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 0);
  const received = await seedReceivedUnits(fx, v.lasyncro_variant_id, 3);
  const taskId = await inboundStowTask(fx, v.lasyncro_variant_id, received.receiveJobLineId, 3, bin);

  const { batchId, alloc } = await releaseOne(fx, v, 1);
  // Three eligible root LSUs, one unit ordered: one label.
  expect((await lineItems(fx.A.token, batchId)).body.line_items[0]).toMatchObject({ unit_scan_required: 1 });
  const claimed = await claim(fx.A.token, batchId);
  expect((await scanUnits(fx.A.token, batchId, alloc, claimed.body.pick_claim_generation, [received.ids[1]])).status).toBe(201);

  expect(await stowTask(fx, taskId)).toMatchObject({ quantity: 2, quantity_placed: 0, quantity_excepted: 0, status: 'pending', completed_at: null });
  expect((await reconcileAudit(fx, taskId)).map((r: any) => r.metadata)).toEqual([expect.objectContaining({
    reason: 'units_picked_from_root', lasyncro_unit_ids: [received.ids[1]], quantity_before: 3, quantity_after: 2,
    status_before: 'pending', status_after: 'pending', pick_batch_id: batchId,
  })]);
  const listed = await request(app).get('/api/v1/wms/stow-tasks').set(bearer(fx.shop.ownerToken));
  const row = (listed.body.stow_tasks ?? []).find((t: any) => t.stow_task_id === taskId);
  expect([...(row?.unit_ids ?? [])].sort()).toEqual([received.ids[0], received.ids[2]].sort());

  // The picked unit is refused by Stow; the remaining work completes with no exception.
  expect((await stowClaim(fx, taskId)).status).toBe(200);
  const beforeStow = await evidence(fx.shop.shopId, batchId);
  const refused = await stowConfirm(fx, taskId, received.ids[1]);
  expect(refused.status).toBeGreaterThanOrEqual(400);
  expect(String(refused.body.error)).toContain('INBOUND_LSU_MISMATCH');
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(beforeStow);
  for (const id of [received.ids[0], received.ids[2]]) {
    const r = await stowConfirm(fx, taskId, id);
    expect({ id, status: r.status }).toEqual({ id, status: 200 });
  }
  expect(await stowTask(fx, taskId)).toMatchObject({ quantity: 2, quantity_placed: 2, quantity_excepted: 0, status: 'completed' });
  expect(await binTruth(fx, v.lasyncro_variant_id, bin)).toMatchObject({ on_hand: 2 });
});

test('LT-09 Stow fully reconciled: completed when the rest was placed; cancelled when nothing was; no stuck task', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 0);

  // (a) 2 received: one stowed, then the other picked from the root → completed.
  // Released while the bin is still empty, so the allocation is at the root.
  const a = await seedReceivedUnits(fx, v.lasyncro_variant_id, 2);
  const taskA = await inboundStowTask(fx, v.lasyncro_variant_id, a.receiveJobLineId, 2, bin);
  const r1 = await releaseOne(fx, v, 1);
  const c1 = await claim(fx.A.token, r1.batchId);
  expect((await stowClaim(fx, taskA)).status).toBe(200);
  expect((await stowConfirm(fx, taskA, a.ids[0])).status).toBe(200);
  expect(await stowTask(fx, taskA)).toMatchObject({ quantity: 2, quantity_placed: 1, status: 'in_progress' });
  expect((await scanUnits(fx.A.token, r1.batchId, r1.alloc, c1.body.pick_claim_generation, [a.ids[1]])).status).toBe(201);
  const doneA = await stowTask(fx, taskA);
  expect(doneA).toMatchObject({ quantity: 1, quantity_placed: 1, quantity_excepted: 0, status: 'completed' });
  expect(doneA.completed_at).not.toBeNull();
  expect((await complete(fx.A.token, r1.batchId, c1.body.pick_claim_generation)).status).toBe(200);

  // (b) 1 received, picked from the root before any Stow → cancelled, nothing placed.
  // Second variant: the first now has bin stock, which release would prefer.
  const w = fx.variants[1];
  const b = await seedReceivedUnits(fx, w.lasyncro_variant_id, 1);
  const taskB = await inboundStowTask(fx, w.lasyncro_variant_id, b.receiveJobLineId, 1, bin);
  const r2 = await releaseOne(fx, w, 1);
  const c2 = await claim(fx.B.token, r2.batchId);
  expect((await scanUnits(fx.B.token, r2.batchId, r2.alloc, c2.body.pick_claim_generation, [b.ids[0]])).status).toBe(201);
  const doneB = await stowTask(fx, taskB);
  expect(doneB).toMatchObject({ quantity: 0, quantity_placed: 0, quantity_excepted: 0, status: 'cancelled' });
  expect(doneB.completed_at).not.toBeNull();
  const listed = await request(app).get('/api/v1/wms/stow-tasks').set(bearer(fx.shop.ownerToken));
  const open = (listed.body.stow_tasks ?? []).map((t: any) => t.stow_task_id);
  expect(open).not.toContain(taskA);
  expect(open).not.toContain(taskB);
});

/** Polls until at least `n` lock requests are waiting (proves genuine overlap). */
async function waitForLockWaiters(shopId: number, n: number) {
  for (let i = 0; i < 150; i++) {
    const r = await withTenant(shopId, (trx) => trx.raw('SELECT count(DISTINCT pid)::int AS n FROM pg_locks WHERE NOT granted'));
    if (r.rows[0].n >= n) return r.rows[0].n as number;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`lock waiters never reached ${n}`);
}

test('LT-10 Pick and Stow racing for one received root LSU: exactly one consumes it, the other writes nothing', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const shopId = fx.shop.shopId;
  const bin = await stockBin(fx, v.lasyncro_variant_id, 0);
  const received = await seedReceivedUnits(fx, v.lasyncro_variant_id, 1);
  const taskId = await inboundStowTask(fx, v.lasyncro_variant_id, received.receiveJobLineId, 1, bin);
  expect((await stowClaim(fx, taskId)).status).toBe(200);
  const { batchId, alloc } = await releaseOne(fx, v, 1);
  const claimed = await claim(fx.A.token, batchId);
  const gen = claimed.body.pick_claim_generation;
  const rootBefore = await rootTruth(fx, v.lasyncro_variant_id);

  // Hold the Stow task row: both writers queue on it (Pick and Stow lock it first), then race.
  let locked!: () => void; let release!: () => void;
  const held = new Promise<void>((r) => { locked = r; });
  const gate = new Promise<void>((r) => { release = r; });
  const holder = withTenant(shopId, async (trx) => {
    await trx('stow_tasks').where({ shop_id: shopId, stow_task_id: taskId }).forUpdate().first('stow_task_id');
    locked();
    await gate;
  });
  await held;
  const pickP = scanUnits(fx.A.token, batchId, alloc, gen, received.ids).then((r) => r);
  const stowP = stowConfirm(fx, taskId, received.ids[0]).then((r) => r);
  expect(await waitForLockWaiters(shopId, 2)).toBeGreaterThanOrEqual(2);
  release();
  await holder;
  const [pick, stow] = await Promise.all([pickP, stowP]);

  const pickWon = pick.status === 201;
  const stowWon = stow.status === 200;
  expect({ pickWon, stowWon, pick: pick.status, stow: stow.status }).toEqual(
    pickWon ? { pickWon: true, stowWon: false, pick: 201, stow: stow.status } : { pickWon: false, stowWon: true, pick: 409, stow: 200 });

  // Exactly one physical removal from the root, whichever side won.
  const rootAfter = await rootTruth(fx, v.lasyncro_variant_id);
  expect(rootAfter.on_hand).toBe(rootBefore.on_hand - 1);
  const [unit] = await units(fx, received.ids);
  const task = await stowTask(fx, taskId);
  if (pickWon) {
    expect(unit).toMatchObject({ status: 'picked', current_location_code: null });
    expect(task).toMatchObject({ quantity: 0, quantity_placed: 0, status: 'cancelled' });
    expect((await binTruth(fx, v.lasyncro_variant_id, bin))?.on_hand ?? 0).toBe(0);
    expect(rootAfter.reserved).toBe(rootBefore.reserved - 1);
  } else {
    expect(pick.body.code).toBe('PICK_UNIT_IDENTITY_MISMATCH');
    expect(unit).toMatchObject({ status: 'stowed', current_location_code: bin });
    expect(task).toMatchObject({ quantity: 1, quantity_placed: 1, status: 'completed' });
    expect(await binTruth(fx, v.lasyncro_variant_id, bin)).toMatchObject({ on_hand: 1 });
    expect(rootAfter.reserved).toBe(rootBefore.reserved);
    const scans = await withTenant(shopId, (trx) => trx('pick_scan_log').where({ shop_id: shopId, pick_batch_id: batchId }).select('scan_id'));
    expect(scans).toHaveLength(0);
  }
  const lineage = await withTenant(shopId, (trx) => trx('pick_scan_unit_lineage').where({ shop_id: shopId, lasyncro_unit_id: received.ids[0] }).select('scan_id'));
  expect(lineage).toHaveLength(pickWon ? 1 : 0);
});

test('LT-11 Short Pick at a stop that is no longer an active pick bin: found units are refused with no writes; item_missing is still reported', async () => {
  const fx = await fixture();
  const v = fx.variants[0];
  const bin = await stockBin(fx, v.lasyncro_variant_id, 2);
  const { batchId, alloc } = await releaseOne(fx, v, 2, bin);
  const claimed = await claim(fx.A.token, batchId);
  const gen = claimed.body.pick_claim_generation;
  // The allocated bin is deactivated after Release (a non-pickable destination).
  await withTenant(fx.shop.shopId, (trx) =>
    trx('warehouse_locations').where({ shop_id: fx.shop.shopId, location_code: bin }).update({ active: false }));

  const before = await evidence(fx.shop.shopId, batchId);
  const refused = await shortPickUnits(fx.A.token, batchId, alloc, gen, 1, []);
  expect({ status: refused.status, code: refused.body.code, location: refused.body.location_code, problem: refused.body.problem })
    .toEqual({ status: 409, code: 'PICK_LOCATION_NOT_PICKABLE', location: bin, problem: 'inactive_location' });
  expect(await evidence(fx.shop.shopId, batchId)).toEqual(before);

  // No physical write → the blocked stop can still be reported (Problem Center path).
  const missing = await request(app).post(`/api/v1/wms/batch/${batchId}/exception`).set(bearer(fx.A.token)).send({
    lasyncro_line_item_id: alloc.lasyncro_line_item_id, lasyncro_variant_id: alloc.lasyncro_variant_id,
    reservation_allocation_id: alloc.allocation_id, location_code: alloc.location_code, exception_type: 'item_missing',
    stage: 'pick', quantity_required: Number(alloc.quantity), quantity_found: 0, device_event_id: crypto.randomUUID(),
    pick_claim_generation: gen,
  });
  expect(missing.status).toBe(201);
  const after = await evidence(fx.shop.shopId, batchId);
  expect(after.movements).toEqual(before.movements);
  expect(after.truth).toEqual(before.truth);
  expect(after.scans).toEqual(before.scans);
  expect(after.exceptions).toEqual([expect.objectContaining({ exception_type: 'item_missing', quantity_found: 0 })]);
});
