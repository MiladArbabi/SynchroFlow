/**
 * SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-CERT-01 — Stage 1 targeted proofs (disposable DB only).
 *
 * CERT-D2: a Receive closes (its line's inbound Stow task appears) after a root
 * Pick has locked the Stow tasks it knew about and before it locks the eligible
 * unit set. Barrier: a held FOR UPDATE on the one Stow task the Pick knows,
 * so the Pick's stow-task lock statement (snapshot taken before the close)
 * blocks; the close commits; the barrier is released.
 *
 * The close is a test-only stand-in for closeReceiveJob's inventory effects
 * (job status closed, root credited, inbound Stow task created) in one
 * committed transaction.
 *
 * CERT-X: reverification never crosses tenant or origin.
 */
import crypto from 'crypto';
import request from 'supertest';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { app, claim, evidence, fixture, seedOrder, type Fx } from './pick-assign-sf-01.fixture';

jest.setTimeout(180_000);

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const rootOf = (fx: Fx) => `WH-${fx.shop.shopId}-ROOT`;
const scanUnits = (token: string, batchId: string, a: any, generation: string, unitIds: string[]) =>
  request(app).post('/api/v1/wms/pick/scan').set(bearer(token)).send({
    pick_batch_id: batchId, lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    reservation_allocation_id: a.allocation_id, location_code: a.location_code, quantity_confirmed: Number(a.quantity),
    lasyncro_unit_ids: unitIds, pick_claim_generation: generation,
  });

async function releaseOne(fx: Fx, variant: Fx['variants'][number], qty: number, expectedLocation = rootOf(fx)) {
  const orderId = await seedOrder(fx.shop.shopId, variant, qty);
  const res = await request(app).post('/api/v1/wms/batch/release').set(bearer(fx.shop.ownerToken))
    .send({ priority_order_ids: [orderId], exclusive: true });
  expect(res.status).toBe(201);
  const batchId = res.body.pick_batch_id as string;
  const [alloc] = await withTenant(fx.shop.shopId, (trx) =>
    trx('pick_reservation_allocations').where({ shop_id: fx.shop.shopId, pick_batch_id: batchId }).select('*'));
  expect(alloc.location_code).toBe(expectedLocation);
  return { batchId, alloc };
}

/** `count` received LSUs on one Receive line; `closed` credits the root (closeReceiveJob's effect). */
async function seedReceive(fx: Fx, variantId: string, count: number, closed: boolean) {
  const shopId = fx.shop.shopId;
  return withTenant(shopId, async (trx) => {
    const [supplier] = await trx('suppliers').insert({ shop_id: shopId, name: `CERT ${crypto.randomUUID()}` }).returning('id');
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
    if (closed) await creditRoot(trx, shopId, variantId, count);
    return { ids, jobId: job.receive_job_id as string, lineId: line.receive_job_line_id as string };
  });
}
async function creditRoot(trx: any, shopId: number, variantId: string, n: number) {
  expect(await trx('inventory_truth')
    .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: `WH-${shopId}-ROOT` })
    .update({
      on_hand_quantity: trx.raw('on_hand_quantity + ?', [n]),
      available_quantity: trx.raw('available_quantity + ?', [n]),
    })).toBe(1);
}
const insertInboundTask = (trx: any, shopId: number, variantId: string, lineId: string, quantity: number) =>
  trx('stow_tasks').insert({
    shop_id: shopId, lasyncro_variant_id: variantId, quantity, location_code: `WH-${shopId}-ROOT`,
    status: 'pending', trigger: 'inbound_stock', receive_job_line_id: lineId,
  }).returning('stow_task_id').then((r: any[]) => r[0].stow_task_id as string);

async function waitForLockWaiters(shopId: number, n: number) {
  for (let i = 0; i < 150; i++) {
    const r = await withTenant(shopId, (trx) => trx.raw('SELECT count(DISTINCT pid)::int AS n FROM pg_locks WHERE NOT granted'));
    if (r.rows[0].n >= n) return r.rows[0].n as number;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`lock waiters never reached ${n}`);
}
const custody = (fx: Fx, ids: string[]) => withTenant(fx.shop.shopId, async (trx) => Object.fromEntries(
  (await trx('inventory_units').where({ shop_id: fx.shop.shopId }).whereIn('lasyncro_unit_id', ids)
    .select('lasyncro_unit_id', 'status', 'current_location_code', 'identity_unverified'))
    .map((r: any) => [r.lasyncro_unit_id, { status: r.status, at: r.current_location_code, unverified: r.identity_unverified }])));
const task = (fx: Fx, id: string) => withTenant(fx.shop.shopId, (trx) => trx('stow_tasks')
  .where({ shop_id: fx.shop.shopId, stow_task_id: id }).first('quantity', 'quantity_placed', 'status'));
const rootTruth = async (fx: Fx, variantId: string) => {
  const row = await withTenant(fx.shop.shopId, (trx) => trx('inventory_truth')
    .where({ shop_id: fx.shop.shopId, lasyncro_variant_id: variantId, location_code: rootOf(fx) }).first());
  return { on_hand: Number(row.on_hand_quantity), reserved: Number(row.reserved_quantity) };
};
const removalsFor = (fx: Fx, batchId: string) => withTenant(fx.shop.shopId, (trx) => trx('pick_scan_log')
  .where({ shop_id: fx.shop.shopId, pick_batch_id: batchId }).select('scan_id'));

test('CERT-D2 a Receive closing between the Stow-task lock and the eligible-set lock: the Pick refuses with nothing written; the retry reconciles the new obligation exactly once', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const v = fx.variants[0];
  // Line A: closed, one unit, open inbound task (the task the Pick knows about).
  const a = await seedReceive(fx, v.lasyncro_variant_id, 1, true);
  const taskA = await withTenant(shopId, (trx) => insertInboundTask(trx, shopId, v.lasyncro_variant_id, a.lineId, 1));
  // Line B: received, receive still OPEN (not root stock, no task yet). Seeded after A, so its id sorts after A's.
  const b = await seedReceive(fx, v.lasyncro_variant_id, 1, false);

  const { batchId, alloc } = await releaseOne(fx, v, 2);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  const truth0 = await rootTruth(fx, v.lasyncro_variant_id);
  const before = await evidence(shopId, batchId);

  // Barrier: hold task A. The Pick reads lines {A, B}, then blocks locking open tasks (only A exists).
  let locked!: () => void; let releaseGate!: () => void;
  const held = new Promise<void>((r) => { locked = r; });
  const gate = new Promise<void>((r) => { releaseGate = r; });
  const holder = withTenant(shopId, async (trx) => {
    await trx('stow_tasks').where({ shop_id: shopId, stow_task_id: taskA }).forUpdate().first('stow_task_id');
    locked();
    await gate;
  });
  await held;
  const pickP = scanUnits(fx.A.token, batchId, alloc, gen, [a.ids[0]]).then((r) => r);
  expect(await waitForLockWaiters(shopId, 1)).toBeGreaterThanOrEqual(1);

  // Receive B closes and commits while the Pick waits: root credited, B's inbound task created.
  const taskB = await withTenant(shopId, async (trx) => {
    await trx('receive_jobs').where({ shop_id: shopId, receive_job_id: b.jobId }).update({ status: 'closed', closed_at: new Date() });
    await creditRoot(trx, shopId, v.lasyncro_variant_id, 1);
    return insertInboundTask(trx, shopId, v.lasyncro_variant_id, b.lineId, 1);
  });
  releaseGate();
  await holder;
  const first = await pickP;

  // Definitive refusal, nothing written (no scan, movement, truth or unit change, no obligation consumed).
  expect({ status: first.status, error: first.body.error }).toEqual({ status: 500, error: 'Pick scan failed: [PICK_SCAN] UNIT_SET_CHANGED' });
  const afterRefusal = await evidence(shopId, batchId);
  expect(afterRefusal.scans).toEqual(before.scans);
  expect(afterRefusal.movements).toEqual(before.movements); // the stand-in close writes no movement
  expect(afterRefusal.unitsPicked).toBe(before.unitsPicked);
  expect(await rootTruth(fx, v.lasyncro_variant_id)).toEqual({ on_hand: truth0.on_hand + 1, reserved: truth0.reserved });
  expect(await custody(fx, [...a.ids, ...b.ids])).toEqual({
    [a.ids[0]]: { status: 'received', at: null, unverified: false },
    [b.ids[0]]: { status: 'received', at: null, unverified: false },
  });
  expect(await task(fx, taskA)).toMatchObject({ quantity: 1, status: 'pending' });
  expect(await task(fx, taskB)).toMatchObject({ quantity: 1, status: 'pending' });

  // Safe retry of the identical request: both obligations reconciled exactly once.
  const retry = await scanUnits(fx.A.token, batchId, alloc, gen, [a.ids[0]]);
  expect(retry.status).toBe(201);
  expect(await removalsFor(fx, batchId)).toHaveLength(1);
  expect(await rootTruth(fx, v.lasyncro_variant_id)).toEqual({ on_hand: truth0.on_hand + 1 - 2, reserved: truth0.reserved - 2 });
  expect(await custody(fx, [...a.ids, ...b.ids])).toEqual({
    [a.ids[0]]: { status: 'picked', at: null, unverified: false },
    [b.ids[0]]: { status: 'picked', at: null, unverified: false },
  });
  expect(await task(fx, taskA)).toMatchObject({ quantity: 0, status: 'cancelled' });
  expect(await task(fx, taskB)).toMatchObject({ quantity: 0, status: 'cancelled' });
  const settled = await withTenant(shopId, (trx) => trx('pick_scan_unit_settlement').where({ shop_id: shopId }).select('lasyncro_unit_id', 'released_at'));
  expect(settled).toEqual([{ lasyncro_unit_id: b.ids[0], released_at: null }]);
  const lineage = await withTenant(shopId, (trx) => trx('pick_scan_unit_lineage').where({ shop_id: shopId }).pluck('lasyncro_unit_id'));
  expect(lineage).toEqual([a.ids[0]]);
});

test('CERT-X reverification never crosses tenant or origin: a foreign or wrong-origin settled LSU is refused with nothing written', async () => {
  const fx = await fixture();
  const other = await fixture();
  const shopId = fx.shop.shopId;
  const v = fx.variants[0];
  // Two bins of the same variant in shop 1.
  const mkBin = async (code: string, qty: number) => withTenant(shopId, async (trx) => {
    const rootRow = await trx('warehouse_locations').where({ shop_id: shopId, location_code: rootOf(fx) }).first('warehouse_id');
    await trx('warehouse_locations').insert({ shop_id: shopId, warehouse_id: rootRow.warehouse_id, location_code: code, type: 'bin', zone_type: 'pick', active: true, parent_location_code: rootOf(fx) });
    expect(await trx('inventory_truth').where({ shop_id: shopId, lasyncro_variant_id: v.lasyncro_variant_id, location_code: rootOf(fx) })
      .update({ on_hand_quantity: trx.raw('on_hand_quantity - ?', [qty]), available_quantity: trx.raw('available_quantity - ?', [qty]) })).toBe(1);
    await trx('inventory_truth').insert({ shop_id: shopId, lasyncro_variant_id: v.lasyncro_variant_id, location_code: code, on_hand_quantity: qty,
      reserved_quantity: 0, committed_quantity: 0, available_quantity: qty, last_evaluated_at: new Date() });
    return code;
  });
  const shelf = async (bin: string, n: number) => {
    const r = await seedReceive(fx, v.lasyncro_variant_id, n, false);
    await withTenant(shopId, (trx) => trx('inventory_units').where({ shop_id: shopId }).whereIn('lasyncro_unit_id', r.ids).update({ status: 'stowed', current_location_code: bin }));
    return withTenant(shopId, (trx) => trx('inventory_units').where({ shop_id: shopId }).whereIn('lasyncro_unit_id', r.ids).orderBy('id').pluck('lasyncro_unit_id')) as Promise<string[]>;
  };
  // Y first (before X exists, so Release allocates there): a trusted unit plus one forced unverified sibling.
  const binY = await mkBin(`PICK-CY-${crypto.randomBytes(3).toString('hex')}`, 2);
  const y = await shelf(binY, 2);
  const p2 = await releaseOne(fx, v, 1, binY);
  const g2 = (await claim(fx.B.token, p2.batchId)).body.pick_claim_generation;
  expect((await scanUnits(fx.B.token, p2.batchId, p2.alloc, g2, [y[0]])).status).toBe(201);
  await withTenant(shopId, (trx) => trx('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: y[1] }).update({ identity_unverified: true }));
  // X: quantity Pick → x[2] scanned, x[0] settled, x[1] unverified.
  const binX = await mkBin(`PICK-CX-${crypto.randomBytes(3).toString('hex')}`, 3);
  const x = await shelf(binX, 3);
  const p1 = await releaseOne(fx, v, 2, binX);
  const g1 = (await claim(fx.A.token, p1.batchId)).body.pick_claim_generation;
  expect((await scanUnits(fx.A.token, p1.batchId, p1.alloc, g1, [x[2]])).status).toBe(201);

  // Wrong origin: x[0] was settled at X; scanning it for a Pick at Y must not exchange with y[1].
  // Test-only: point this refusal-only order's allocation at Y (Release may prefer X's remaining stock).
  const orderId3 = await seedOrder(shopId, v, 1);
  const r3 = await request(app).post('/api/v1/wms/batch/release').set(bearer(fx.shop.ownerToken)).send({ priority_order_ids: [orderId3], exclusive: true });
  expect(r3.status).toBe(201);
  const p3 = { batchId: r3.body.pick_batch_id as string, alloc: (await withTenant(shopId, (trx) => trx('pick_reservation_allocations')
    .where({ shop_id: shopId, pick_batch_id: r3.body.pick_batch_id }).update({ location_code: binY }).returning('*')))[0] };
  const g3 = (await claim(fx.A.token, p3.batchId)).body.pick_claim_generation;
  const before3 = await evidence(shopId, p3.batchId);
  const wrongOrigin = await scanUnits(fx.A.token, p3.batchId, p3.alloc, g3, [x[0]]);
  expect({ status: wrongOrigin.status, code: wrongOrigin.body.code }).toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_MISMATCH' });
  expect(await evidence(shopId, p3.batchId)).toEqual(before3);
  expect(await custody(fx, [x[0], x[1], y[1]])).toEqual({
    [x[0]]: { status: 'picked', at: null, unverified: false },
    [x[1]]: { status: 'stowed', at: binX, unverified: true },
    [y[1]]: { status: 'stowed', at: binY, unverified: true },
  });

  // Cross tenant: shop 2 cannot see or exchange shop 1's settled LSU.
  const o = other.variants[0];
  const oRec = await seedReceive(other, o.lasyncro_variant_id, 2, true);
  const p4 = await releaseOne(other, o, 1);
  const g4 = (await claim(other.A.token, p4.batchId)).body.pick_claim_generation;
  await withTenant(other.shop.shopId, (trx) => trx('inventory_units').where({ shop_id: other.shop.shopId }).whereIn('lasyncro_unit_id', oRec.ids).update({ identity_unverified: true }));
  const before4 = await evidence(other.shop.shopId, p4.batchId);
  const foreign = await scanUnits(other.A.token, p4.batchId, p4.alloc, g4, [x[0]]);
  expect({ status: foreign.status, code: foreign.body.code }).toEqual({ status: 409, code: 'PICK_UNIT_IDENTITY_MISMATCH' });
  expect(await evidence(other.shop.shopId, p4.batchId)).toEqual(before4);
  expect(await custody(fx, [x[0]])).toEqual({ [x[0]]: { status: 'picked', at: null, unverified: false } });
  const s1 = await withTenant(shopId, (trx) => trx('pick_scan_unit_settlement').where({ shop_id: shopId, lasyncro_unit_id: x[0] }).select('released_at'));
  expect(s1).toEqual([{ released_at: null }]);
});
