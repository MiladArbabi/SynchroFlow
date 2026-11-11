import crypto from 'crypto';
import knexLib from 'knex';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { issueTestToken } from '../../unit/helpers/auth';
import db, { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { claimStowTask, confirmStow } from 'api-src/services/wms/stow.service';
import { quarantineStowUnit } from 'api-src/services/wms/stowQuarantine.service';
import { quarantineUnitToProblemBin, isProblemBinQuarantineEnabled } from 'api-src/services/inventory/problemBinQuarantine.service';
import { evaluateProblemResolutionEligibility } from 'api-src/services/wms/problemCenterResolutionPolicy';
import { pickableLocationCondition } from 'api-src/services/inventory/pickableLocation';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { readReleaseCapacity } from 'api-src/services/inventory/releaseCapacity.service';
import { createRecountTask, claimRecountTask, recordCount, closeCount, reviewLine, commitRecount } from 'api-src/services/wms/inventoryRecount.service';
import * as migration from '../../../apps/backend/migrations/20261109150000_0231_problem_bin_quarantine_custody';
jest.setTimeout(180000);

/**
 * SF-PROBLEM-BIN Phase A — shared Problem Bin quarantine (Free Scan core +
 * Stow adapter). Adapted from the S2 suite (SF-STOW-SAD-PATH-01 attempt 3);
 * S2 invariants are kept, task-independent and non-ROOT cases are added.
 */
const BIN = 'CAP-1';
const PROBLEM = 'PROBLEM-S2';
const FLAG = 'PROBLEM_BIN_QUARANTINE_ENABLED';

async function createShopWithUser(prefix: string, role: 'operator' | 'owner' = 'operator') {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    await trx('shop_wms_settings')
      .insert({ shop_id: id, bootstrap_model: 'reconcile_opening_expectation_v2' })
      .onConflict('shop_id').ignore();
    return id;
  });
  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({ shop_id: shopId, email: `${prefix}-${role}-${unique}@test.example`, password_hash: 'not_a_real_hash',
        first_name: 'Problem', last_name: 'Bin', role })
      .returning('id');
    const id = Number((row as any).id ?? row);
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: id, role });
    return id;
  });
  return { shopId, operatorId: userId };
}

/** GH-1305 S3A inbound fixture: received LSUs at ROOT plus an inbound Stow task. */
async function seedTask(shopId: number, unitCount: number) {
  return withTenant(shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;
    await trx('products').insert({ lasyncro_product_id: productId, shop_id: shopId, title: 'Cap product', status: 'active', product_type: 'physical' });
    await trx('variants').insert({ lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shopId,
      sku: `CAP-${variantId.slice(0, 8)}`, title: 'Cap variant', unit_cost: '5.00', status: 'active' });
    await trx('warehouses')
      .insert({ warehouse_id: crypto.randomUUID(), shop_id: shopId, name: `Cap wh ${crypto.randomUUID().slice(0, 8)}`,
        root_location_code: rootCode, is_default: true, active: true })
      .onConflict(['shop_id', 'root_location_code']).ignore();
    const wh = await trx('warehouses').where({ shop_id: shopId, root_location_code: rootCode }).first('warehouse_id');
    if (!(await trx('warehouse_locations').where({ shop_id: shopId, location_code: rootCode }).first())) {
      await trx('warehouse_locations').insert({ shop_id: shopId, warehouse_id: wh.warehouse_id, location_code: rootCode,
        type: 'warehouse', parent_location_code: null, active: true, zone_type: null });
    }
    if (!(await trx('warehouse_locations').where({ shop_id: shopId, location_code: BIN }).first())) {
      await trx('warehouse_locations').insert({ shop_id: shopId, warehouse_id: wh.warehouse_id, location_code: BIN,
        type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' });
    }
    const [supplier] = await trx('suppliers').insert({ shop_id: shopId, name: `Cap supplier ${crypto.randomUUID().slice(0, 8)}`, active: true }).returning('id');
    const [po] = await trx('purchase_orders').insert({ shop_id: shopId, supplier_id: (supplier as any).id ?? supplier, status: 'shipped' }).returning('id');
    const poId = String((po as any).id ?? po);
    const [poLine] = await trx('purchase_order_line_items').insert({ po_id: poId, shop_id: shopId, lasyncro_variant_id: variantId,
      description: 'Cap PO line', quantity_ordered: unitCount, quantity_received: unitCount }).returning('id');
    const [job] = await trx('receive_jobs').insert({ shop_id: shopId, po_id: poId, status: 'closed', total_variants: 1, total_units: unitCount }).returning('receive_job_id');
    const [line] = await trx('receive_job_lines').insert({ shop_id: shopId, receive_job_id: String((job as any).receive_job_id ?? job),
      po_line_item_id: (poLine as any).id ?? poLine, lasyncro_variant_id: variantId, quantity_expected: unitCount,
      quantity_accepted: unitCount, inspection_complete: true }).returning('receive_job_line_id');
    const receiveJobLineId = String((line as any).receive_job_line_id ?? line);
    const lasyncroUnitIds: string[] = [];
    for (let i = 1; i <= unitCount; i++) {
      const id = `LSU-${crypto.randomUUID().slice(0, 12)}`;
      await trx('inventory_units').insert({ shop_id: shopId, lasyncro_variant_id: variantId, receive_job_line_id: receiveJobLineId,
        receive_sequence: i, status: 'received', current_location_code: null, lasyncro_unit_id: id });
      lasyncroUnitIds.push(id);
    }
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth')
      .insert({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: rootCode, on_hand_quantity: unitCount,
        reserved_quantity: 0, committed_quantity: 0, available_quantity: unitCount, last_evaluated_at: new Date() });
    // Ledger-consistent seed: every truth write has the movement that reproduces it.
    await trx('inventory_movements').insert({ lasyncro_inventory_movement_id: crypto.randomUUID(), device_event_id: crypto.randomUUID(),
      shop_id: shopId, lasyncro_variant_id: variantId, movement_type: 'inbound_purchase', quantity_delta: unitCount,
      location_code: rootCode, reference_type: 'test_seed', reference_id: crypto.randomUUID(), platform: 'wms',
      triggered_by: 'test_seed', occurred_at: new Date() });
    const [task] = await trx('stow_tasks').insert({ shop_id: shopId, lasyncro_variant_id: variantId, receive_job_line_id: receiveJobLineId,
      quantity: unitCount, location_code: BIN, status: 'pending', trigger: 'inbound_stock', po_id: poId }).returning('stow_task_id');
    return { taskId: String((task as any).stow_task_id ?? task), variantId, lasyncroUnitIds, rootCode };
  });
}

async function setup(count = 2, prefix = 'problem-bin') {
  const shop = await createShopWithUser(prefix);
  const work = await seedTask(shop.shopId, count);
  await withTenant(shop.shopId, (trx) => claimStowTask(trx, work.taskId, shop.shopId, shop.operatorId));
  await withTenant(shop.shopId, async trx => {
    const parent = await trx('warehouse_locations').where({ shop_id: shop.shopId, location_code: BIN }).first();
    await trx('warehouse_locations').insert({ shop_id: shop.shopId, warehouse_id: parent.warehouse_id, location_code: PROBLEM,
      type: 'bin', zone_type: 'problem', active: true, parent_location_code: parent.parent_location_code, max_capacity: 1 });
    await trx('shop_wms_settings').where({ shop_id: shop.shopId }).update({ enforce_location_capacity: true });
  });
  return { ...shop, ...work };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

const confirm = (f: Fixture, index: number) => withTenant(f.shopId, async trx => {
  await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
  return confirmStow(trx, { shopId: f.shopId, stowTaskId: f.taskId, claimedBy: f.operatorId, quantityPlaced: 1, lasyncroUnitId: f.lasyncroUnitIds[index] });
});
/** Every unit stowed into the pick bin: the task is complete, stock sits at BIN (not ROOT). */
async function setupStowed(count = 2) {
  const f = await setup(count, 'problem-bin-stowed');
  await withTenant(f.shopId, trx => trx('shop_wms_settings').where({ shop_id: f.shopId }).update({ enforce_location_capacity: false }));
  for (let i = 0; i < count; i++) await confirm(f, i);
  return f;
}

function stowInput(f: Fixture, index = 0) {
  return { shopId: f.shopId, stowTaskId: f.taskId, claimedBy: f.operatorId,
    lasyncroUnitId: f.lasyncroUnitIds[index], problemBinLocation: PROBLEM, deviceEventId: crypto.randomUUID(), quarantineReason: 'routine' as const };
}
function freeInput(f: Fixture, index = 0) {
  return { shopId: f.shopId, actorId: f.operatorId, lasyncroUnitId: f.lasyncroUnitIds[index],
    problemBinScan: PROBLEM, deviceEventId: crypto.randomUUID(), quarantineReason: 'routine' as const };
}
async function inTx<T>(shopId: number, fn: (trx: any) => Promise<T>) {
  return withTenant(shopId, async trx => { await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`); return fn(trx); });
}
const quarantineStow = (i: ReturnType<typeof stowInput>) => inTx(i.shopId, trx => quarantineStowUnit(trx, i));
const quarantineFree = (i: ReturnType<typeof freeInput>) => inTx(i.shopId, trx => quarantineUnitToProblemBin(trx, i));

async function state(shopId: number) {
  return withTenant(shopId, async trx => ({
    truth: await trx('inventory_truth').where({ shop_id: shopId }).orderBy(['lasyncro_variant_id', 'location_code']),
    units: await trx('inventory_units').where({ shop_id: shopId }).orderBy('lasyncro_unit_id'),
    tasks: await trx('stow_tasks').where({ shop_id: shopId }).orderBy('stow_task_id'),
    movements: await trx('inventory_movements').where({ shop_id: shopId }).orderBy('lasyncro_inventory_movement_id'),
    incidents: await trx('problem_center_tasks').where({ shop_id: shopId }).orderBy('problem_task_id'),
    events: await trx('problem_bin_custody_events').where({ shop_id: shopId }).orderBy('device_event_id'),
  }));
}
type State = Awaited<ReturnType<typeof state>>;
const onHand = (s: State) => s.truth.reduce((n, row) => n + Number(row.on_hand_quantity), 0);
const available = (s: State) => s.truth.reduce((n, row) => n + Number(row.available_quantity), 0);
const truthAt = (s: State, location: string) => s.truth.find(r => r.location_code === location);
const qMovements = (s: State) => s.movements.filter(m => m.reference_type === 'problem_bin_quarantine');
const truthRows = (s: State) => s.truth.map(r => ({ location: r.location_code, on_hand: Number(r.on_hand_quantity),
  reserved: Number(r.reserved_quantity), committed: Number(r.committed_quantity), available: Number(r.available_quantity) }));
/** Sellable capacity: the reservation/eligibility reader (pickable locations only). */
const sellable = (f: { shopId: number; variantId: string }) => withTenant(f.shopId, trx =>
  readReleaseCapacity(trx as any, { shopId: f.shopId, variantIds: [f.variantId], lock: 'none' }));
const sellableUnits = async (f: { shopId: number; variantId: string }) => (await sellable(f)).reduce((n, r) => n + r.availableQuantity, 0);
/** The production projector (recount commit, initial sync, CLI rebuild). */
const rebuild = (f: { shopId: number; variantId: string }) =>
  inTx(f.shopId, trx => rebuildInventoryProjectionForVariants(f.shopId, [f.variantId], trx, new Date()));
/** Rebuild must be a fixed point: returns truth before and after for equality. */
async function rebuildFixedPoint(f: { shopId: number; variantId: string }) {
  const live = truthRows(await state(f.shopId)); await rebuild(f); const rebuilt = truthRows(await state(f.shopId));
  return { live, rebuilt };
}
/** Movements → truth, per location, independently of the projector code. */
const LEDGER_ON_HAND = ['inbound_purchase', 'location_transfer', 'reconciliation_correction', 'manual_adjustment', 'opening_balance'];
function ledgerAgrees(s: State) {
  const byLocation = new Map<string, { on_hand: number; reserved: number }>();
  for (const m of s.movements) {
    const row = byLocation.get(m.location_code) ?? { on_hand: 0, reserved: 0 };
    if (LEDGER_ON_HAND.includes(m.movement_type)) row.on_hand += Number(m.quantity_delta);
    if (m.movement_type === 'reservation_hold' || m.movement_type === 'reservation_release') row.reserved += Number(m.quantity_delta);
    byLocation.set(m.location_code, row);
  }
  for (const [location, l] of byLocation) {
    expect({ location, ...pickRow(truthAt(s, location)) })
      .toEqual({ location, on_hand: l.on_hand, reserved: l.reserved, available: Math.max(0, l.on_hand - l.reserved) });
  }
}
const pickRow = (r: any) => ({ on_hand: Number(r?.on_hand_quantity), reserved: Number(r?.reserved_quantity), available: Number(r?.available_quantity) });

async function tokenFor(f: { shopId: number; operatorId: number }) {
  await withTenant(f.shopId, async trx => {
    await trx('user_lifecycle_snapshot').insert({ shop_id: f.shopId, user_id: f.operatorId, phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID() }).onConflict().ignore();
    await trx('shop_subscriptions').insert({ shop_id: f.shopId, tier: 'growth', allow_overage: true, billing_provider: 'stripe', stripe_customer_id: null }).onConflict('shop_id').ignore();
  });
  process.env.JWT_SECRET ||= 'test_jwt_secret';
  return issueTestToken({ shopId: f.shopId, userId: f.operatorId, tier: 'growth', roles: ['operator'] });
}

const savedFlag = process.env[FLAG];
afterAll(async () => { if (savedFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = savedFlag; await db.destroy(); });
beforeEach(() => { process.env[FLAG] = 'true'; });

describe('Problem Bin gate and authentication', () => {
  it('rejects service, Free Scan, Stow and resolve APIs when OFF, without mutation', async () => {
    const f = await setupStowed(); const before = await state(f.shopId); delete process.env[FLAG];
    expect(isProblemBinQuarantineEnabled()).toBe(false);
    await expect(quarantineFree(freeInput(f))).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_QUARANTINE_DISABLED' });
    const token = await tokenFor(f); const app = createApp();
    const body = { lasyncro_unit_id: f.lasyncroUnitIds[0], problem_bin_location: PROBLEM, quarantine_reason: 'routine', device_event_id: crypto.randomUUID() };
    for (const res of [
      await request(app).post('/api/v1/wms/problem-bin/quarantine').set('Authorization', `Bearer ${token}`).send(body),
      await request(app).post(`/api/v1/wms/stow-tasks/${f.taskId}/quarantine`).set('Authorization', `Bearer ${token}`).send(body),
      await request(app).get('/api/v1/wms/problem-bin/resolve').query({ scan: PROBLEM }).set('Authorization', `Bearer ${token}`),
    ]) { expect(res.status).toBe(409); expect(res.body.code).toBe('PROBLEM_BIN_QUARANTINE_DISABLED'); }
    const status = await request(app).get('/api/v1/wms/problem-bin/status').set('Authorization', `Bearer ${token}`);
    expect(status.status).toBe(200); expect(status.body).toEqual({ enabled: false });
    expect(await state(f.shopId)).toEqual(before);
  });
  it('rejects anonymous calls', async () => {
    const app = createApp();
    expect((await request(app).post('/api/v1/wms/problem-bin/quarantine').send({})).status).toBe(401);
    expect((await request(app).post(`/api/v1/wms/stow-tasks/${crypto.randomUUID()}/quarantine`).send({})).status).toBe(401);
    expect((await request(app).get('/api/v1/wms/problem-bin/status')).status).toBe(401);
  });
});

describe('Free Scan — task-independent quarantine', () => {
  it('transfers a stowed unit from its pick bin (not ROOT): conserved on-hand and canonical available, two legs, one incident', async () => {
    const f = await setupStowed(); const before = await state(f.shopId);
    expect(truthAt(before, BIN)).toMatchObject({ on_hand_quantity: 2, available_quantity: 2 });
    const rootBefore = truthAt(before, f.rootCode);
    const result = await quarantineFree(freeInput(f));
    expect(result).toMatchObject({ source_location: BIN, source_status: 'stowed', problem_bin_location: PROBLEM, context: 'free_scan', replayed: false });
    const after = await state(f.shopId);
    expect(onHand(after)).toBe(onHand(before));
    // Canonical projection form: available = max(0, on_hand − reserved) at every row.
    expect(available(after)).toBe(available(before));
    expect(truthAt(after, BIN)).toMatchObject({ on_hand_quantity: 1, available_quantity: 1 });
    expect(truthAt(after, PROBLEM)).toMatchObject({ on_hand_quantity: 1, available_quantity: 1, reserved_quantity: 0 });
    expect(truthAt(after, f.rootCode)).toEqual(rootBefore);
    const legs = qMovements(after);
    expect(legs.map(m => [m.location_code, Number(m.quantity_delta), m.movement_type]).sort())
      .toEqual([[BIN, -1, 'location_transfer'], [PROBLEM, 1, 'location_transfer']].sort());
    expect(legs.every(m => m.reference_id === result.problem_task_id && m.triggered_by === 'problem_bin')).toBe(true);
    expect(after.incidents).toEqual([expect.objectContaining({ problem_task_id: result.problem_task_id, source: 'warehouse',
      status: 'open', exception_type: 'quarantined_unit', lasyncro_unit_id: f.lasyncroUnitIds[0], quantity: 1,
      problem_bin_location: PROBLEM, source_exception_id: null })]);
    expect(after.units.find(u => u.lasyncro_unit_id === f.lasyncroUnitIds[0])).toMatchObject({ status: 'quarantined',
      current_location_code: PROBLEM, quarantined_from_location: BIN, quarantined_from_status: 'stowed' });
    expect(after.events).toEqual([expect.objectContaining({ lasyncro_unit_id: f.lasyncroUnitIds[0], source_location: BIN,
      source_status: 'stowed', context_kind: 'free_scan', stow_task_id: null, problem_task_id: result.problem_task_id })]);
    expect(after.tasks).toEqual(before.tasks); // no task accounting outside an adapter
    const pickable = await withTenant(f.shopId, trx => trx('warehouse_locations as wl')
      .where({ 'wl.shop_id': f.shopId, 'wl.location_code': PROBLEM }).whereRaw(pickableLocationCondition(trx)));
    expect(pickable).toHaveLength(0);
  });

  it('transfers a received unit with no active Stow task from ROOT', async () => {
    const f = await setup(2, 'problem-bin-root');
    await withTenant(f.shopId, trx => trx('stow_tasks').where({ shop_id: f.shopId, stow_task_id: f.taskId }).update({ status: 'cancelled' }));
    const before = await state(f.shopId);
    expect(await quarantineFree(freeInput(f))).toMatchObject({ source_location: f.rootCode, source_status: 'received' });
    const after = await state(f.shopId);
    expect(onHand(after)).toBe(onHand(before)); expect(available(after)).toBe(available(before));
    expect(truthAt(after, f.rootCode)).toMatchObject({ on_hand_quantity: 1, available_quantity: 1 });
    expect(truthAt(after, PROBLEM)).toMatchObject({ on_hand_quantity: 1, reserved_quantity: 0, available_quantity: 1 });
    expect(qMovements(after).map(m => m.location_code).sort()).toEqual([f.rootCode, PROBLEM].sort());
  });

  it('refuses a unit owned by an active Stow task — only the Stow adapter may quarantine it', async () => {
    const f = await setup(); const before = await state(f.shopId);
    await expect(quarantineFree(freeInput(f))).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_UNIT_ON_ACTIVE_STOW' });
    expect(await state(f.shopId)).toEqual(before);
  });

  it('never consumes reserved stock: refuses when the source has no unreserved unit', async () => {
    const f = await setupStowed();
    await inTx(f.shopId, trx => trx('inventory_truth').where({ shop_id: f.shopId, location_code: BIN })
      .update({ reserved_quantity: 2, available_quantity: 0 }));
    const before = await state(f.shopId);
    await expect(quarantineFree(freeInput(f))).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_SOURCE_STOCK_RESERVED_OR_MISSING' });
    expect(await state(f.shopId)).toEqual(before);
    // One unreserved unit: exactly one quarantine succeeds, reservation untouched.
    await inTx(f.shopId, trx => trx('inventory_truth').where({ shop_id: f.shopId, location_code: BIN })
      .update({ reserved_quantity: 1, available_quantity: 1 }));
    const results = await Promise.allSettled([quarantineFree(freeInput(f, 0)), quarantineFree(freeInput(f, 1))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const after = await state(f.shopId);
    expect(truthAt(after, BIN)).toMatchObject({ on_hand_quantity: 1, reserved_quantity: 1, available_quantity: 0 });
    expect(qMovements(after)).toHaveLength(2);
  });

  it.each(['picked', 'packed', 'shipped', 'held', 'discarded', 'lost', 'returned'])('refuses a %s unit without writes', async (status) => {
    const f = await setupStowed(1);
    await withTenant(f.shopId, trx => trx('inventory_units').where({ shop_id: f.shopId, lasyncro_unit_id: f.lasyncroUnitIds[0] }).update({ status }));
    const before = await state(f.shopId);
    await expect(quarantineFree(freeInput(f))).rejects.toMatchObject({ statusCode: 409 });
    expect(await state(f.shopId)).toEqual(before);
  });

  it('requires an exact, existing LSU and an active Problem Bin; refuses inactive sources', async () => {
    const f = await setupStowed(); const before = await state(f.shopId);
    await expect(quarantineFree({ ...freeInput(f), lasyncroUnitId: 'LSU-doesnotexist' })).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_UNIT_NOT_FOUND' });
    for (const scan of [BIN, f.rootCode, 'UNKNOWN']) {
      await expect(quarantineFree({ ...freeInput(f), problemBinScan: scan })).rejects.toThrow();
    }
    await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId, location_code: BIN }).update({ active: false }));
    await expect(quarantineFree(freeInput(f))).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_SOURCE_INELIGIBLE' });
    await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId, location_code: BIN }).update({ active: true }));
    const token = await tokenFor(f);
    const productBarcode = await request(createApp()).post('/api/v1/wms/problem-bin/quarantine').set('Authorization', `Bearer ${token}`)
      .send({ lasyncro_unit_id: 'CAP-PRODUCT-BARCODE', problem_bin_location: PROBLEM, quarantine_reason: 'routine', device_event_id: crypto.randomUUID() });
    expect(productBarcode.status).toBe(400);
    expect(await state(f.shopId)).toEqual(before);
  });

  it('same-key concurrent retries commit exactly once; a changed payload conflicts', async () => {
    const f = await setupStowed(1); const i = freeInput(f);
    const results = await Promise.all([quarantineFree(i), quarantineFree(i)]);
    expect(results.map(r => r.replayed).sort()).toEqual([false, true]);
    expect(results[0].problem_task_id).toBe(results[1].problem_task_id);
    const after = await state(f.shopId);
    expect(qMovements(after)).toHaveLength(2); expect(after.events).toHaveLength(1); expect(after.incidents).toHaveLength(1);
    await expect(quarantineFree({ ...i, lasyncroUnitId: 'LSU-other' })).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_REPLAY_CONFLICT' });
    await expect(quarantineFree({ ...i, actorId: i.actorId + 100000 })).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_REPLAY_CONFLICT' });
    expect(await state(f.shopId)).toEqual(after);
  });

  it('distinct keys cannot quarantine the same LSU twice', async () => {
    const f = await setupStowed(); const results = await Promise.allSettled([quarantineFree(freeInput(f)), quarantineFree(freeInput(f))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const after = await state(f.shopId);
    expect(qMovements(after)).toHaveLength(2); expect(after.incidents).toHaveLength(1); expect(after.events).toHaveLength(1);
  });

  it('rolls back the complete write set on transaction failure', async () => {
    const f = await setupStowed(); const before = await state(f.shopId);
    await expect(inTx(f.shopId, async trx => { await quarantineUnitToProblemBin(trx, freeInput(f)); throw new Error('synthetic abort'); }))
      .rejects.toThrow('synthetic abort');
    expect(await state(f.shopId)).toEqual(before);
  });

  it('isolates tenants: a foreign actor cannot see or move another shop’s LSU', async () => {
    const f = await setupStowed(); const other = await setupStowed(1); const before = await state(f.shopId);
    await expect(quarantineFree({ ...freeInput(other), lasyncroUnitId: f.lasyncroUnitIds[0] })).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_UNIT_NOT_FOUND' });
    const otherToken = await tokenFor(other);
    const res = await request(createApp()).post('/api/v1/wms/problem-bin/quarantine').set('Authorization', `Bearer ${otherToken}`)
      .send({ lasyncro_unit_id: f.lasyncroUnitIds[0], problem_bin_location: PROBLEM, quarantine_reason: 'routine', device_event_id: crypto.randomUUID() });
    expect(res.status).toBe(404);
    expect(await state(f.shopId)).toEqual(before);
    await quarantineFree(freeInput(f));
    expect((await state(other.shopId)).events).toHaveLength(0); // RLS: no cross-tenant custody rows
  });

  it('authorized operator Free Scan API: resolves the bin, quarantines and returns the incident', async () => {
    const f = await setupStowed(); const token = await tokenFor(f); const app = createApp();
    const status = await request(app).get('/api/v1/wms/problem-bin/status').set('Authorization', `Bearer ${token}`);
    expect(status.body).toEqual({ enabled: true });
    const bin = await request(app).get('/api/v1/wms/problem-bin/resolve').query({ scan: PROBLEM }).set('Authorization', `Bearer ${token}`);
    expect(bin.status).toBe(200); expect(bin.body).toMatchObject({ location_code: PROBLEM });
    const notProblem = await request(app).get('/api/v1/wms/problem-bin/resolve').query({ scan: BIN }).set('Authorization', `Bearer ${token}`);
    expect(notProblem.status).toBe(409);
    const body = { lasyncro_unit_id: f.lasyncroUnitIds[0], problem_bin_location: PROBLEM, quarantine_reason: 'routine', device_event_id: crypto.randomUUID() };
    const res = await request(app).post('/api/v1/wms/problem-bin/quarantine').set('Authorization', `Bearer ${token}`).send(body);
    expect(res.status).toBe(200); expect(res.body).toMatchObject({ source_location: BIN, replayed: false });
    const replay = await request(app).post('/api/v1/wms/problem-bin/quarantine').set('Authorization', `Bearer ${token}`).send(body);
    expect(replay.status).toBe(200); expect(replay.body).toMatchObject({ problem_task_id: res.body.problem_task_id, replayed: true });
  });
});

describe('Stow adapter — task accounting over the shared core', () => {
  it('conserves on-hand from ROOT, records exceptions, exempts capacity, finishes with exceptions', async () => {
    const f = await setup(); const before = await state(f.shopId);
    expect(await quarantineStow(stowInput(f))).toMatchObject({ context: 'stow', source_location: f.rootCode,
      quantity_placed: 0, quantity_excepted: 1, quantity_remaining: 1, status: 'in_progress' });
    let after = await state(f.shopId);
    expect(onHand(after)).toBe(onHand(before)); expect(available(after)).toBe(available(before));
    expect(truthAt(after, PROBLEM)).toMatchObject({ on_hand_quantity: 1, reserved_quantity: 0, available_quantity: 1 });
    expect(after.units.find(u => u.lasyncro_unit_id === f.lasyncroUnitIds[0])).toMatchObject({ status: 'quarantined', current_location_code: PROBLEM });
    expect(after.incidents).toEqual([expect.objectContaining({ source: 'warehouse', exception_type: 'quarantined_unit', source_exception_id: f.taskId })]);
    expect(after.events[0]).toMatchObject({ context_kind: 'stow', stow_task_id: f.taskId });
    expect(qMovements(after).every(m => m.triggered_by === 'stow')).toBe(true);
    await quarantineStow(stowInput(f, 1)); // second unit exceeds max_capacity=1 — capacity-exempt
    after = await state(f.shopId);
    expect(onHand(after)).toBe(onHand(before));
    expect(after.tasks[0]).toMatchObject({ status: 'finished_with_exceptions', quantity_placed: 0, quantity_excepted: 2 });
  });

  it('ordinary placement completes mixed tasks and refuses the quarantined LSU', async () => {
    const f = await setup(); await quarantineStow(stowInput(f));
    const before = await state(f.shopId); await expect(confirm(f, 0)).rejects.toThrow(); expect(await state(f.shopId)).toEqual(before);
    await confirm(f, 1);
    expect((await state(f.shopId)).tasks[0]).toMatchObject({ status: 'finished_with_exceptions', quantity_placed: 1, quantity_excepted: 1 });
  });

  it('same-key replay is exactly one mutation, including after task completion', async () => {
    const f = await setup(1); const i = stowInput(f); const results = await Promise.all([quarantineStow(i), quarantineStow(i)]);
    expect(results.map(x => x.replayed).sort()).toEqual([false, true]);
    const after = await state(f.shopId); expect(qMovements(after)).toHaveLength(2); expect(after.events).toHaveLength(1);
    expect(after.tasks[0].status).toBe('finished_with_exceptions');
    await expect(quarantineStow({ ...i, lasyncroUnitId: 'LSU-wrong' })).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_REPLAY_CONFLICT' });
    // The same key may not be replayed through Free Scan either.
    await expect(quarantineFree({ shopId: f.shopId, actorId: f.operatorId, lasyncroUnitId: i.lasyncroUnitId, problemBinScan: PROBLEM, deviceEventId: i.deviceEventId, quarantineReason: 'routine' }))
      .rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_REPLAY_CONFLICT' });
    expect(await state(f.shopId)).toEqual(after);
  });

  it('refuses wrong owner, foreign LSU, foreign tenant and held units without writes', async () => {
    const f = await setup(); const other = await setup(); const before = await state(f.shopId);
    for (const override of [{ claimedBy: other.operatorId }, { lasyncroUnitId: other.lasyncroUnitIds[0] }, { shopId: other.shopId }]) {
      await expect(quarantineStow({ ...stowInput(f), ...override })).rejects.toThrow();
    }
    expect(await state(f.shopId)).toEqual(before);
    await withTenant(f.shopId, trx => trx('inventory_units').where({ shop_id: f.shopId, lasyncro_unit_id: f.lasyncroUnitIds[0] }).update({ status: 'held' }));
    const held = await state(f.shopId); await expect(quarantineStow(stowInput(f))).rejects.toThrow(); expect(await state(f.shopId)).toEqual(held);
  });

  it('API: the owning operator succeeds; another tenant is refused without writes', async () => {
    const f = await setup(); const i = stowInput(f); const token = await tokenFor(f);
    const res = await request(createApp()).post(`/api/v1/wms/stow-tasks/${f.taskId}/quarantine`).set('Authorization', `Bearer ${token}`)
      .send({ lasyncro_unit_id: i.lasyncroUnitId, problem_bin_location: PROBLEM, quarantine_reason: 'routine', device_event_id: i.deviceEventId });
    expect(res.status).toBe(200); expect(res.body).toMatchObject({ quantity_excepted: 1, quantity_remaining: 1 });
    const other = await createShopWithUser('problem-bin-foreign'); const otherToken = await tokenFor(other);
    const before = await state(f.shopId);
    const foreign = await request(createApp()).post(`/api/v1/wms/stow-tasks/${f.taskId}/quarantine`).set('Authorization', `Bearer ${otherToken}`)
      .send({ lasyncro_unit_id: f.lasyncroUnitIds[1], problem_bin_location: PROBLEM, quarantine_reason: 'routine', device_event_id: crypto.randomUUID() });
    expect(foreign.status).toBeGreaterThanOrEqual(400); expect(foreign.status).toBeLessThan(500);
    expect(await state(f.shopId)).toEqual(before);
  });
});

describe('Projection consistency — live writes equal the ledger projection', () => {
  it('stowed source: rebuild is a fixed point; sellable −1; Problem Bin never allocatable', async () => {
    const f = await setupStowed(); ledgerAgrees(await state(f.shopId));
    const pre = await rebuildFixedPoint(f); expect(pre.rebuilt).toEqual(pre.live); // fixture baseline
    const sellableBefore = await sellableUnits(f);
    await quarantineFree(freeInput(f));
    const after = await state(f.shopId); ledgerAgrees(after);
    expect(await sellableUnits(f)).toBe(sellableBefore - 1);
    expect((await sellable(f)).map(r => r.locationCode)).not.toContain(PROBLEM);
    const { live, rebuilt } = await rebuildFixedPoint(f);
    expect(rebuilt).toEqual(live);
    expect(live.find(r => r.location === PROBLEM)).toMatchObject({ on_hand: 1, reserved: 0, available: 1 });
    expect(await sellableUnits(f)).toBe(sellableBefore - 1);
    expect((await sellable(f)).map(r => r.locationCode)).not.toContain(PROBLEM);
    expect((await state(f.shopId)).units.find(u => u.lasyncro_unit_id === f.lasyncroUnitIds[0]))
      .toMatchObject({ status: 'quarantined', current_location_code: PROBLEM, quarantined_from_location: BIN });
  });

  it('ROOT source and Stow adapter (finished with exceptions): rebuild is a fixed point', async () => {
    const r = await setup(2, 'problem-bin-proj-root');
    await withTenant(r.shopId, trx => trx('stow_tasks').where({ shop_id: r.shopId, stow_task_id: r.taskId }).update({ status: 'cancelled' }));
    const rootSellable = await sellableUnits(r);
    await quarantineFree(freeInput(r));
    ledgerAgrees(await state(r.shopId));
    expect(await sellableUnits(r)).toBe(rootSellable - 1);
    let fp = await rebuildFixedPoint(r); expect(fp.rebuilt).toEqual(fp.live);

    const s = await setup(1, 'problem-bin-proj-stow');
    await quarantineStow(stowInput(s));
    expect((await state(s.shopId)).tasks[0].status).toBe('finished_with_exceptions');
    ledgerAgrees(await state(s.shopId));
    fp = await rebuildFixedPoint(s); expect(fp.rebuilt).toEqual(fp.live);
    expect(await sellableUnits(s)).toBe(0);
  });

  it('reserved stock stays protected across rebuild; quarantine never moves a reservation', async () => {
    const f = await setupStowed();
    // A real (ledgered) reservation of one unit at BIN, projected by the canonical rebuild.
    await inTx(f.shopId, trx => trx('inventory_movements').insert({ lasyncro_inventory_movement_id: crypto.randomUUID(),
      device_event_id: crypto.randomUUID(), shop_id: f.shopId, lasyncro_variant_id: f.variantId, movement_type: 'reservation_hold',
      quantity_delta: 1, location_code: BIN, reference_type: 'test_reservation', reference_id: crypto.randomUUID(),
      platform: 'wms', triggered_by: 'test_seed', occurred_at: new Date() }));
    await rebuild(f);
    expect(truthAt(await state(f.shopId), BIN)).toMatchObject({ on_hand_quantity: 2, reserved_quantity: 1, available_quantity: 1 });
    await quarantineFree(freeInput(f, 0));
    const blocked = await state(f.shopId);
    await expect(quarantineFree(freeInput(f, 1))).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_SOURCE_STOCK_RESERVED_OR_MISSING' });
    expect(await state(f.shopId)).toEqual(blocked);
    expect(truthAt(blocked, BIN)).toMatchObject({ on_hand_quantity: 1, reserved_quantity: 1, available_quantity: 0 });
    expect(truthAt(blocked, PROBLEM)).toMatchObject({ on_hand_quantity: 1, reserved_quantity: 0, available_quantity: 1 });
    ledgerAgrees(blocked);
    const { live, rebuilt } = await rebuildFixedPoint(f);
    expect(rebuilt).toEqual(live);
    expect(await sellableUnits(f)).toBe(0); // the reserved unit is not free capacity; the Problem Bin unit is excluded
  });

  it('a recount committed at another location leaves quarantine accounting unchanged', async () => {
    const f = await setupStowed(); await quarantineFree(freeInput(f));
    const before = await state(f.shopId);
    const incident = before.incidents[0];
    // Real recount lifecycle at ROOT (not the source, not the Problem Bin): one extra unit found.
    const task = await withTenant(f.shopId, trx => createRecountTask(trx as any, { shopId: f.shopId, scope: 'location',
      locationCode: f.rootCode, createdBy: f.operatorId }));
    await withTenant(f.shopId, trx => claimRecountTask(trx as any, f.shopId, task.recount_task_id, f.operatorId));
    const lines = await withTenant(f.shopId, trx => trx('inventory_recount_lines')
      .where({ shop_id: f.shopId, recount_task_id: task.recount_task_id }).select('recount_line_id', 'location_code', 'lasyncro_variant_id'));
    expect(lines).toEqual([expect.objectContaining({ location_code: f.rootCode, lasyncro_variant_id: f.variantId })]);
    await withTenant(f.shopId, trx => recordCount(trx as any, { shopId: f.shopId, recountTaskId: task.recount_task_id,
      recountLineId: lines[0].recount_line_id, countedQuantity: 1, countMethod: 'bin_quantity', countedBy: f.operatorId }));
    await withTenant(f.shopId, trx => closeCount(trx as any, f.shopId, task.recount_task_id, f.operatorId));
    await withTenant(f.shopId, trx => reviewLine(trx as any, { shopId: f.shopId, recountTaskId: task.recount_task_id,
      recountLineId: lines[0].recount_line_id, decision: 'accept', varianceReason: 'unrecorded_external_workflow',
      notes: 'Problem Bin projection regression', reviewedBy: f.operatorId }));
    expect(await withTenant(f.shopId, trx => commitRecount(trx as any, f.shopId, task.recount_task_id, f.operatorId)))
      .toEqual({ corrections: 1, units: 1 });
    const after = await state(f.shopId);
    // Only ROOT changed (+1); source bin and Problem Bin rows are byte-identical after the projector ran.
    expect(truthAt(after, f.rootCode)).toMatchObject({ on_hand_quantity: 1, reserved_quantity: 0, available_quantity: 1 });
    expect(pickRow(truthAt(after, PROBLEM))).toEqual(pickRow(truthAt(before, PROBLEM)));
    expect(pickRow(truthAt(after, BIN))).toEqual(pickRow(truthAt(before, BIN)));
    expect(qMovements(after)).toEqual(qMovements(before));
    expect(after.units).toEqual(before.units);
    expect(after.events).toEqual(before.events);
    expect(after.incidents).toEqual([expect.objectContaining({ problem_task_id: incident.problem_task_id, status: 'open' })]);
    expect((await sellable(f)).map(r => r.locationCode)).not.toContain(PROBLEM);
    ledgerAgrees(after);
  });
});

describe('Custody evidence, incident uniqueness and resolution boundary', () => {
  it('database guards: no bare quarantine, frozen custody, one active incident per LSU', async () => {
    const f = await setupStowed();
    await expect(withTenant(f.shopId, trx => trx('inventory_units').where({ shop_id: f.shopId, lasyncro_unit_id: f.lasyncroUnitIds[1] })
      .update({ status: 'quarantined', current_location_code: PROBLEM, quarantined_from_location: BIN, quarantined_from_status: 'stowed' })))
      .rejects.toThrow(/PROBLEM_BIN_CUSTODY_EVENT_REQUIRED/);
    const result = await quarantineFree(freeInput(f));
    await expect(withTenant(f.shopId, trx => trx('inventory_units').where({ shop_id: f.shopId, lasyncro_unit_id: f.lasyncroUnitIds[0] })
      .update({ status: 'stowed', current_location_code: BIN }))).rejects.toThrow(/PROBLEM_BIN_CUSTODY_IMMUTABLE/);
    await expect(withTenant(f.shopId, trx => trx('problem_bin_custody_events').where({ shop_id: f.shopId }).update({ problem_bin_location: BIN })))
      .rejects.toThrow();
    // DB: one active QUARANTINE incident per LSU (0224 leaves other sources free).
    await expect(withTenant(f.shopId, trx => trx('problem_center_tasks').insert({ shop_id: f.shopId, source: 'warehouse', status: 'open',
      lasyncro_unit_id: f.lasyncroUnitIds[0], lasyncro_variant_id: f.variantId, quantity: 1, exception_type: 'quarantined_unit' })))
      .rejects.toMatchObject({ code: '23505' });
    // Core: an active incident of ANY source blocks quarantine of that LSU.
    await withTenant(f.shopId, trx => trx('problem_center_tasks').insert({ shop_id: f.shopId, source: 'pick', status: 'open',
      lasyncro_unit_id: f.lasyncroUnitIds[1], lasyncro_variant_id: f.variantId, quantity: 1, exception_type: 'other_source' }));
    const blocked = await state(f.shopId);
    await expect(quarantineFree(freeInput(f, 1))).rejects.toMatchObject({ errorCode: 'PROBLEM_BIN_UNIT_HAS_ACTIVE_INCIDENT' });
    expect(await state(f.shopId)).toEqual(blocked);
    const incident = await withTenant(f.shopId, trx => trx('problem_center_tasks').where({ problem_task_id: result.problem_task_id }).first());
    for (const action of ['re_stow', 'discard', 'write_off', 'quarantine', 'find_replacement'] as const) {
      const verdict = await withTenant(f.shopId, trx => evaluateProblemResolutionEligibility(trx as any, f.shopId, incident, action));
      expect(verdict.eligible).toBe(false); // Phase A: no resolution path
    }
  });

  it('0231 has forced RLS, append-only grants, and refuses DOWN once custody exists', async () => {
    const f = await setupStowed(); await quarantineFree(freeInput(f));
    if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(process.env.PGDATABASE ?? '')) throw new Error('0231 migration test refuses non-disposable database');
    const admin = knexLib({ client: 'pg', connection: { host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), user: process.env.PGMIGRATION_USER,
      password: process.env.PGMIGRATION_PASSWORD, database: process.env.PGDATABASE }, pool: { min: 0, max: 1 } });
    try {
      await admin.transaction(async trx => {
        const flags = await trx.raw(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'problem_bin_custody_events'::regclass`);
        expect(flags.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
        const grants = await trx.raw(`SELECT has_table_privilege('sf_app', 'problem_bin_custody_events', 'SELECT') AS read,
          has_table_privilege('sf_app', 'problem_bin_custody_events', 'INSERT') AS insert,
          has_table_privilege('sf_app', 'problem_bin_custody_events', 'UPDATE') AS update,
          has_table_privilege('sf_app', 'problem_bin_custody_events', 'DELETE') AS delete`);
        expect(grants.rows[0]).toEqual({ read: true, insert: true, update: false, delete: false });
        const labels = await trx.raw(`SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'inventory_unit_lifecycle_status' AND e.enumlabel IN ('quarantined', 'stow_quarantined')`);
        expect(labels.rows).toEqual([{ enumlabel: 'quarantined' }]);
        await expect(migration.down(trx)).rejects.toThrow('PROBLEM_BIN_QUARANTINE_ROLLBACK_BLOCKED');
        await trx.rollback();
      });
    } finally { await admin.destroy(); }
    expect((await state(f.shopId)).events).toHaveLength(1);
  });
});
