// SF-PROBLEM-BIN Phase B S2 — barcode-verified Problem Bin resolution and
// per-member problem-solver authority (migration 0232).
//
// R  release: conservation, rebuild fixed point, exact custody, replay, scans
// W  damaged write-off: ledger + unit + incident, rebuild fixed point
// A  authority: management vs designated operator, routine-only, JWT role forgery
// D  designation grant / revoke / history
// G  DB guards (sf_app): no bare custody exit, no bare incident closure, no
//    forged problem-solver evidence, append-only, designations never deleted
// C  concurrency: one winner per incident
// T  tenant isolation and RLS
// M  migration 0232 head objects, DOWN round-trip, DOWN refusal with evidence

import crypto from 'crypto';
import knexLib, { Knex } from 'knex';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { issueTestToken } from '../../unit/helpers/auth';
import db, { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { quarantineUnitToProblemBin } from 'api-src/services/inventory/problemBinQuarantine.service';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { pickableLocationCondition } from 'api-src/services/inventory/pickableLocation';
import * as migration0232 from '../../../apps/backend/migrations/20261110150000_0232_problem_bin_resolution';

jest.setTimeout(180000);
const app = createApp();
const FLAG = 'PROBLEM_BIN_QUARANTINE_ENABLED';
const PB = 'PB-1';
const PB_BARCODE = 'PB-BARCODE-1';
const A1 = 'A-1';
const A2 = 'A-2';
type Role = 'owner' | 'admin' | 'operator';

async function addUser(shopId: number, role: Role, tag: string) {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users').insert({ shop_id: shopId, email: `pbs2-${tag}-${crypto.randomBytes(4).toString('hex')}@test.example`,
      password_hash: 'x', first_name: tag, role }).returning('id');
    const id = Number((row as any).id ?? row);
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: id, role });
    return id;
  });
}

async function createFixture(units = 4) {
  const unique = crypto.randomBytes(5).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `pbs2-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
  const ownerId = await addUser(shopId, 'owner', 'owner');
  const adminId = await addUser(shopId, 'admin', 'admin');
  const solverId = await addUser(shopId, 'operator', 'solver');
  const operatorId = await addUser(shopId, 'operator', 'plain');
  const rootCode = `WH-${shopId}-ROOT`;
  const variantId = crypto.randomUUID();
  const lsus: string[] = [];
  await withTenant(shopId, async (trx) => {
    await trx('user_lifecycle_snapshot').insert({ shop_id: shopId, user_id: ownerId, phase: 'FT2', since: new Date(),
      last_event_id: crypto.randomUUID() });
    await trx('shop_subscriptions').insert({ shop_id: shopId, tier: 'core', allow_overage: true, billing_provider: 'stripe', stripe_customer_id: null });
    await trx('shop_wms_settings').insert({ shop_id: shopId, bootstrap_model: 'reconcile_opening_expectation_v2' }).onConflict('shop_id').ignore();
    const warehouseId = crypto.randomUUID();
    await trx('warehouses').insert({ warehouse_id: warehouseId, shop_id: shopId, name: 'Main', root_location_code: rootCode, is_default: true, active: true });
    const loc = (location_code: string, zone_type: string | null, type = 'bin', extra: Record<string, unknown> = {}) => ({
      shop_id: shopId, warehouse_id: warehouseId, location_code, type, active: true, zone_type,
      parent_location_code: type === 'warehouse' ? null : rootCode, ...extra });
    await trx('warehouse_locations').insert([loc(rootCode, null, 'warehouse'), loc(A1, 'pick'), loc(A2, 'pick'),
      loc('S-1', 'storage', 'bin', { barcode: 'S-1-BARCODE' }), loc(PB, 'problem', 'bin', { barcode: PB_BARCODE }),
      // D-3 refusal fixtures: staging zone, unzoned legacy, inactive storage, structural storage parent.
      loc('R-1', 'receive'), loc('U-1', null), loc('S-OFF', 'storage', 'bin', { active: false }), loc('S-RACK', 'storage')]);
    await trx('warehouse_locations').insert(loc('S-RACK-1', 'storage', 'bin', { parent_location_code: 'S-RACK' }));
    const productId = crypto.randomUUID();
    await trx('products').insert({ lasyncro_product_id: productId, shop_id: shopId, title: 'S2', status: 'active', product_type: 'physical' });
    await trx('variants').insert({ lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shopId,
      sku: `PBS2-${unique}`, title: 'S2 variant', unit_cost: '5.00', status: 'active' });
    // Closed Receive lineage (inventory_units_source_anchor_xor), as in the Phase A fixture.
    const [supplier] = await trx('suppliers').insert({ shop_id: shopId, name: `S2 supplier ${unique}`, active: true }).returning('id');
    const [po] = await trx('purchase_orders').insert({ shop_id: shopId, supplier_id: (supplier as any).id ?? supplier, status: 'received' }).returning('id');
    const poId = String((po as any).id ?? po);
    const [poLine] = await trx('purchase_order_line_items').insert({ po_id: poId, shop_id: shopId, lasyncro_variant_id: variantId,
      description: 'S2 PO line', quantity_ordered: units, quantity_received: units }).returning('id');
    const [job] = await trx('receive_jobs').insert({ shop_id: shopId, po_id: poId, status: 'closed', total_variants: 1, total_units: units }).returning('receive_job_id');
    const [line] = await trx('receive_job_lines').insert({ shop_id: shopId, receive_job_id: String((job as any).receive_job_id ?? job),
      po_line_item_id: (poLine as any).id ?? poLine, lasyncro_variant_id: variantId, quantity_expected: units,
      quantity_accepted: units, inspection_complete: true }).returning('receive_job_line_id');
    const receiveJobLineId = String((line as any).receive_job_line_id ?? line);
    for (let i = 0; i < units; i++) {
      const id = `LSU-${crypto.randomUUID().slice(0, 12)}`;
      await trx('inventory_units').insert({ shop_id: shopId, lasyncro_variant_id: variantId, status: 'stowed', receive_sequence: i + 1,
        receive_job_line_id: receiveJobLineId, current_location_code: A1, lasyncro_unit_id: id });
      lsus.push(id);
    }
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: A1,
      on_hand_quantity: units, reserved_quantity: 0, committed_quantity: 0, available_quantity: units, last_evaluated_at: new Date() });
    await trx('inventory_movements').insert({ lasyncro_inventory_movement_id: crypto.randomUUID(), device_event_id: crypto.randomUUID(),
      shop_id: shopId, lasyncro_variant_id: variantId, movement_type: 'inbound_purchase', quantity_delta: units,
      location_code: A1, reference_type: 'test_seed', reference_id: crypto.randomUUID(), platform: 'wms',
      triggered_by: 'test_seed', occurred_at: new Date() });
  });
  const token = (userId: number, roles: Role[]) => issueTestToken({ userId, shopId, tier: 'core', roles });
  return { shopId, ownerId, adminId, solverId, operatorId, variantId, lsus, rootCode,
    owner: token(ownerId, ['owner']), admin: token(adminId, ['admin']), solver: token(solverId, ['operator']),
    operator: token(operatorId, ['operator']), token };
}
type Fixture = Awaited<ReturnType<typeof createFixture>>;

const inTx = <T>(shopId: number, fn: (trx: Knex.Transaction) => Promise<T>) =>
  withTenant(shopId, async (trx) => { await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`); return fn(trx); });

async function quarantine(f: Fixture, index: number, reason: 'routine' | 'damaged' | 'defective' = 'routine') {
  const r: any = await inTx(f.shopId, (trx) => quarantineUnitToProblemBin(trx, { shopId: f.shopId, actorId: f.operatorId,
    lasyncroUnitId: f.lsus[index], problemBinScan: PB, deviceEventId: crypto.randomUUID(), quarantineReason: reason }));
  return r.problem_task_id as string;
}

const release = (f: Fixture, tok: string, taskId: string, index: number, extra: Record<string, unknown> = {}) =>
  request(app).post(`/api/v1/wms/problem-bin/incidents/${taskId}/release`).set('Authorization', `Bearer ${tok}`)
    .send({ problem_bin_scan: PB_BARCODE, lasyncro_unit_id: f.lsus[index], destination_scan: A2, device_event_id: crypto.randomUUID(), ...extra });
const writeOff = (f: Fixture, tok: string, taskId: string, index: number, extra: Record<string, unknown> = {}) =>
  request(app).post(`/api/v1/wms/problem-bin/incidents/${taskId}/write-off`).set('Authorization', `Bearer ${tok}`)
    .send({ problem_bin_scan: PB, lasyncro_unit_id: f.lsus[index], write_off_reason: 'damaged', device_event_id: crypto.randomUUID(), ...extra });
const grant = (tok: string, userId: number) => request(app).post('/api/v1/wms/problem-solvers').set('Authorization', `Bearer ${tok}`).send({ user_id: userId });
const revoke = (tok: string, userId: number) => request(app).delete(`/api/v1/wms/problem-solvers/${userId}`).set('Authorization', `Bearer ${tok}`);

async function snapshot(f: Fixture) {
  return withTenant(f.shopId, async (trx) => ({
    truth: (await trx('inventory_truth').where({ shop_id: f.shopId }).orderBy('location_code'))
      .map((r: any) => ({ loc: r.location_code, on_hand: Number(r.on_hand_quantity), reserved: Number(r.reserved_quantity), available: Number(r.available_quantity) })),
    movements: await trx('inventory_movements').where({ shop_id: f.shopId }).whereIn('reference_type', ['problem_bin_release', 'problem_bin_write_off'])
      .orderBy(['reference_id', 'location_code']).select('movement_type', 'quantity_delta', 'location_code', 'reference_type', 'reference_id'),
    units: await trx('inventory_units').where({ shop_id: f.shopId }).orderBy('lasyncro_unit_id')
      .select('lasyncro_unit_id', 'status', 'current_location_code', 'quarantined_from_location', 'quarantined_from_status'),
    incidents: await trx('problem_center_tasks').where({ shop_id: f.shopId }).orderBy('problem_task_id')
      .select('problem_task_id', 'status', 'resolution_action', 'resolved_by'),
    events: await trx('problem_bin_resolution_events').where({ shop_id: f.shopId }).orderBy('device_event_id'),
  }));
}
const onHand = (s: Awaited<ReturnType<typeof snapshot>>) => s.truth.reduce((n, r) => n + r.on_hand, 0);
const at = (s: Awaited<ReturnType<typeof snapshot>>, loc: string) => s.truth.find((r) => r.loc === loc);
const unitOf = (s: Awaited<ReturnType<typeof snapshot>>, lsu: string) => s.units.find((u: any) => u.lasyncro_unit_id === lsu);

/** Rebuild from the ledger must reproduce the projection exactly. */
async function expectRebuildFixedPoint(f: Fixture) {
  const before = (await snapshot(f)).truth;
  await inTx(f.shopId, (trx) => rebuildInventoryProjectionForVariants(f.shopId, [f.variantId], trx, new Date()));
  const after = (await snapshot(f)).truth.filter((r) => r.on_hand !== 0 || before.some((b) => b.loc === r.loc));
  expect(after).toEqual(before.filter((r) => r.on_hand !== 0 || after.some((a) => a.loc === r.loc)));
}

const savedFlag = process.env[FLAG];
beforeAll(() => { process.env[FLAG] = 'true'; });
afterAll(() => { if (savedFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = savedFlag; });

describe('S2 R — release to stock', () => {
  it('R1: owner release moves exactly one unit PB → A-2, conserves on-hand, closes the incident, rebuild fixed point', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0);
    const before = await snapshot(f);
    const res = await release(f, f.owner, taskId, 0);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'released', authority: 'management', destination_location: A2, replayed: false });
    const after = await snapshot(f);
    expect(onHand(after)).toBe(onHand(before));
    expect(at(after, PB)?.on_hand).toBe(0);
    expect(at(after, A2)).toMatchObject({ on_hand: 1, available: 1 });
    expect(at(after, A1)).toEqual(at(before, A1));
    expect(after.movements.map((m: any) => [m.movement_type, m.quantity_delta, m.location_code]).sort())
      .toEqual([['location_transfer', -1, PB], ['location_transfer', 1, A2]]);
    expect(unitOf(after, f.lsus[0])).toMatchObject({ status: 'stowed', current_location_code: A2, quarantined_from_location: null, quarantined_from_status: null });
    expect(after.incidents.find((i: any) => i.problem_task_id === taskId)).toMatchObject({ status: 'resolved', resolution_action: 'release_to_stock', resolved_by: f.ownerId });
    expect(after.events).toHaveLength(1);
    await expectRebuildFixedPoint(f);
  });

  it('R2: same-event retry replays without new writes; changed payload conflicts; a new event on a closed incident is refused', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0);
    const deviceEventId = crypto.randomUUID();
    const first = await release(f, f.owner, taskId, 0, { device_event_id: deviceEventId });
    const mid = await snapshot(f);
    const again = await release(f, f.owner, taskId, 0, { device_event_id: deviceEventId });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ...first.body, replayed: true });
    expect(await snapshot(f)).toEqual(mid);
    const conflict = await release(f, f.owner, taskId, 0, { device_event_id: deviceEventId, destination_scan: 'S-1' });
    expect([conflict.status, conflict.body.code]).toEqual([409, 'PROBLEM_BIN_REPLAY_CONFLICT']);
    const fresh = await release(f, f.owner, taskId, 0);
    expect([fresh.status, fresh.body.code]).toEqual([409, 'PROBLEM_BIN_INCIDENT_NOT_OPEN']);
    expect(await snapshot(f)).toEqual(mid);
  });

  it.each([
    ['wrong Problem Bin scan', { problem_bin_scan: A1 }, 'PROBLEM_BIN_SCAN_MISMATCH'],
    ['another unit\'s LSU', { lasyncro_unit_id: 'LSU-notthisunit' }, 'PROBLEM_BIN_UNIT_SCAN_MISMATCH'],
    ['destination is the Problem Bin', { destination_scan: PB }, 'PROBLEM_BIN_DESTINATION_INELIGIBLE'],
    ['destination is the warehouse root', { destination_scan: 'ROOT' }, 'PROBLEM_BIN_DESTINATION_INELIGIBLE'],
    ['destination unknown', { destination_scan: 'NOPE-9' }, 'PROBLEM_BIN_DESTINATION_INELIGIBLE'],
    ['destination is a staging (receive) zone bin', { destination_scan: 'R-1' }, 'PROBLEM_BIN_DESTINATION_INELIGIBLE'],
    ['destination is an unzoned legacy bin', { destination_scan: 'U-1' }, 'PROBLEM_BIN_DESTINATION_INELIGIBLE'],
    ['destination is an inactive storage bin', { destination_scan: 'S-OFF' }, 'PROBLEM_BIN_DESTINATION_INELIGIBLE'],
    ['destination is a structural storage parent', { destination_scan: 'S-RACK' }, 'PROBLEM_BIN_DESTINATION_INELIGIBLE'],
  ])('R3: %s → 409 %s, nothing written', async (_n, override, code) => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0);
    const body = { ...override } as Record<string, unknown>;
    if (body.destination_scan === 'ROOT') body.destination_scan = f.rootCode;
    const before = await snapshot(f);
    const res = await release(f, f.owner, taskId, 0, body);
    expect([res.status, res.body.code]).toEqual([409, code]);
    expect(await snapshot(f)).toEqual(before);
  });

  it('R4: destination capacity is enforced when the shop enforces it', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0);
    await withTenant(f.shopId, async (trx) => {
      await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: A1 }).update({ max_capacity: 1 });
      await trx('shop_wms_settings').where({ shop_id: f.shopId }).update({ enforce_location_capacity: true });
    });
    const before = await snapshot(f);
    const res = await release(f, f.owner, taskId, 0, { destination_scan: A1 });
    expect([res.status, res.body.code]).toEqual([409, 'LOCATION_CAPACITY_EXCEEDED']);
    expect(await snapshot(f)).toEqual(before);
  });
});

/** Pickable on-hand by the canonical WMS predicate (what availability readers see). */
async function pickableOnHand(f: Fixture) {
  return withTenant(f.shopId, async (trx) => {
    const [row] = await trx('inventory_truth as it')
      .join('warehouse_locations as wl', function () {
        this.on('wl.shop_id', '=', 'it.shop_id').andOn('wl.location_code', '=', 'it.location_code');
      })
      .where('it.shop_id', f.shopId).where('wl.active', true).whereRaw(pickableLocationCondition(trx))
      .select(trx.raw('COALESCE(SUM(it.on_hand_quantity), 0)::int AS n'));
    return Number((row as any).n);
  });
}

describe('S2 D3 — storage-zone release (owner decision D-3)', () => {
  it('D3-1: owner release into a storage bin by barcode: physical on-hand conserved, pickable −1, rebuild fixed point', async () => {
    const f = await createFixture();
    const pickableStart = await pickableOnHand(f);
    const taskId = await quarantine(f, 0);
    const before = await snapshot(f);
    const pickableBefore = await pickableOnHand(f);
    expect(pickableBefore).toBe(pickableStart - 1); // quarantine already removed it from pickable
    const res = await release(f, f.owner, taskId, 0, { destination_scan: 'S-1-BARCODE' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'released', destination_location: 'S-1', unit_status: 'stowed' });
    const after = await snapshot(f);
    expect(onHand(after)).toBe(onHand(before));
    expect(at(after, PB)?.on_hand).toBe(0);
    expect(at(after, 'S-1')).toMatchObject({ on_hand: 1, available: 1, reserved: 0 });
    // Physical, not pickable: storage stock is outside the pickable predicate.
    expect(await pickableOnHand(f)).toBe(pickableBefore);
    expect(after.movements.map((m: any) => [m.movement_type, m.quantity_delta, m.location_code]).sort())
      .toEqual([['location_transfer', -1, PB], ['location_transfer', 1, 'S-1']]);
    expect(unitOf(after, f.lsus[0])).toMatchObject({ status: 'stowed', current_location_code: 'S-1', quarantined_from_location: null });
    expect(after.incidents.find((i: any) => i.problem_task_id === taskId)).toMatchObject({ status: 'resolved', resolution_action: 'release_to_stock' });
    expect(after.events).toEqual([expect.objectContaining({ destination_location: 'S-1', destination_scan: 'S-1-BARCODE' })]);
    await expectRebuildFixedPoint(f);
  });

  it('D3-2: a designated operator may release a routine unit into storage; replay is idempotent', async () => {
    const f = await createFixture();
    expect((await grant(f.owner, f.solverId)).status).toBe(200);
    const taskId = await quarantine(f, 0, 'routine');
    const deviceEventId = crypto.randomUUID();
    const first = await release(f, f.solver, taskId, 0, { destination_scan: 'S-1', device_event_id: deviceEventId });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ authority: 'problem_solver', destination_location: 'S-1' });
    const mid = await snapshot(f);
    const again = await release(f, f.solver, taskId, 0, { destination_scan: 'S-1', device_event_id: deviceEventId });
    expect(again.body).toMatchObject({ ...first.body, replayed: true });
    expect(await snapshot(f)).toEqual(mid);
  });

  it('D3-3: a storage bin that is the shop\'s configured Problem Bin is refused', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0);
    await withTenant(f.shopId, (trx) => trx('shop_wms_settings').where({ shop_id: f.shopId }).update({ problem_bin_location: 'S-1' }));
    const before = await snapshot(f);
    const res = await release(f, f.owner, taskId, 0, { destination_scan: 'S-1' });
    expect([res.status, res.body.code]).toEqual([409, 'PROBLEM_BIN_DESTINATION_INELIGIBLE']);
    expect(await snapshot(f)).toEqual(before);
  });

  it('D3-4: another tenant\'s storage bin code does not resolve here', async () => {
    const f = await createFixture();
    const g = await createFixture();
    await withTenant(g.shopId, (trx) => trx('warehouse_locations').where({ shop_id: g.shopId, location_code: 'S-1' })
      .update({ barcode: 'S-FOREIGN-ONLY' }));
    const taskId = await quarantine(f, 0);
    const before = await snapshot(f);
    const res = await release(f, f.owner, taskId, 0, { destination_scan: 'S-FOREIGN-ONLY' });
    expect([res.status, res.body.code]).toEqual([409, 'PROBLEM_BIN_DESTINATION_INELIGIBLE']);
    expect(await snapshot(f)).toEqual(before);
  });
});

describe('S2 W — damaged write-off', () => {
  it('W1: admin write-off debits the Problem Bin once (damage), unit written_off, incident resolved, rebuild fixed point', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 1, 'damaged');
    const before = await snapshot(f);
    const res = await writeOff(f, f.admin, taskId, 1, { write_off_reason: 'defective' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'written_off', write_off_reason: 'defective', authority: 'management' });
    const after = await snapshot(f);
    expect(onHand(after)).toBe(onHand(before) - 1);
    expect(at(after, PB)?.on_hand).toBe(0);
    expect(after.movements.map((m: any) => [m.movement_type, m.quantity_delta, m.location_code])).toEqual([['damage', -1, PB]]);
    expect(unitOf(after, f.lsus[1])).toMatchObject({ status: 'written_off', current_location_code: null, quarantined_from_location: null });
    expect(after.incidents.find((i: any) => i.problem_task_id === taskId)).toMatchObject({ status: 'resolved', resolution_action: 'write_off' });
    await expectRebuildFixedPoint(f);
  });

  it('W2: write-off requires a damaged/defective reason (400, nothing written)', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0);
    const before = await snapshot(f);
    expect((await writeOff(f, f.owner, taskId, 0, { write_off_reason: 'missing' })).status).toBe(400);
    expect(await snapshot(f)).toEqual(before);
  });
});

describe('S2 A/D — authority and per-member designation', () => {
  it('A1: an undesignated operator cannot release (403) and cannot reach write-off (route)', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0);
    const before = await snapshot(f);
    const r = await release(f, f.operator, taskId, 0);
    expect([r.status, r.body.code]).toEqual([403, 'PROBLEM_BIN_RESOLUTION_FORBIDDEN']);
    expect((await writeOff(f, f.operator, taskId, 0)).status).toBe(403);
    expect(await snapshot(f)).toEqual(before);
  });

  it('A2: a designated operator releases a routine unit, not a damaged one; never writes off; designation is per member', async () => {
    const f = await createFixture();
    expect((await grant(f.owner, f.solverId)).status).toBe(200);
    const routine = await quarantine(f, 0, 'routine');
    const damaged = await quarantine(f, 1, 'damaged');
    const ok = await release(f, f.solver, routine, 0);
    expect(ok.status).toBe(200);
    expect(ok.body.authority).toBe('problem_solver');
    const refused = await release(f, f.solver, damaged, 1);
    expect([refused.status, refused.body.code]).toEqual([403, 'PROBLEM_BIN_RESOLUTION_REQUIRES_MANAGEMENT']);
    expect((await writeOff(f, f.solver, damaged, 1)).status).toBe(403);
    // Another operator of the same shop is not designated by someone else's grant.
    const other = await release(f, f.operator, damaged, 1);
    expect(other.body.code).toBe('PROBLEM_BIN_RESOLUTION_FORBIDDEN');
    // Owner may still release the damaged unit after inspection.
    expect((await release(f, f.owner, damaged, 1)).status).toBe(200);
  });

  it('A3: a forged owner role in the JWT does not grant authority — the member\'s DB role decides', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0, 'damaged');
    const forged = f.token(f.operatorId, ['owner']);
    const before = await snapshot(f);
    const w = await writeOff(f, forged, taskId, 0);
    // Refused at whichever layer sees it first (auth middleware re-derives the
    // role from the membership; the service re-reads it in-transaction).
    expect(w.status).toBe(403);
    const r = await release(f, forged, taskId, 0);
    expect(r.status).toBe(403);
    expect(await snapshot(f)).toEqual(before);
  });

  it('D1: only management grants/revokes; targets must be active operators; revocation is immediate and keeps history', async () => {
    const f = await createFixture();
    expect((await grant(f.operator, f.solverId)).status).toBe(403);
    expect((await grant(f.owner, f.adminId)).body.code).toBe('PROBLEM_SOLVER_TARGET_NOT_OPERATOR');
    expect((await grant(f.owner, 999999)).status).toBe(404);
    const g1 = await grant(f.admin, f.solverId);
    expect(g1.body).toMatchObject({ user_id: f.solverId, created: true });
    expect((await grant(f.owner, f.solverId)).body.created).toBe(false);
    const list = await request(app).get('/api/v1/wms/problem-solvers').set('Authorization', `Bearer ${f.owner}`);
    expect(list.body.problem_solvers.map((p: any) => p.user_id)).toEqual([f.solverId]);
    expect((await revoke(f.owner, f.solverId)).body).toEqual({ user_id: f.solverId, revoked: true });
    expect((await revoke(f.owner, f.solverId)).body.revoked).toBe(false);
    const taskId = await quarantine(f, 0);
    expect((await release(f, f.solver, taskId, 0)).body.code).toBe('PROBLEM_BIN_RESOLUTION_FORBIDDEN');
    const rows = await withTenant(f.shopId, (trx) => trx('problem_solver_designations').where({ shop_id: f.shopId, user_id: f.solverId }));
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_by).toBe(f.ownerId);
    expect((await grant(f.owner, f.solverId)).body.created).toBe(true);
  });

  it('D2: a designated operator whose membership is revoked loses authority', async () => {
    const f = await createFixture();
    await grant(f.owner, f.solverId);
    await withTenant(f.shopId, (trx) => trx('shop_memberships').where({ shop_id: f.shopId, user_id: f.solverId }).update({ revoked_at: new Date() }));
    const taskId = await quarantine(f, 0);
    const before = await snapshot(f);
    expect((await release(f, f.solver, taskId, 0)).status).toBe(403);
    expect(await snapshot(f)).toEqual(before);
  });
});

describe('S2 G — database custody guards (sf_app)', () => {
  const failure = (fn: () => Promise<unknown>) => fn().then(() => null, (e: any) => `${e.code} ${String(e.message).match(/PROBLEM_[A-Z_]+|append-only/)?.[0]}`);

  it('G1: a quarantined unit cannot leave custody, and its incident cannot close, without a resolution event', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0);
    expect(await failure(() => inTx(f.shopId, (trx) => trx('inventory_units').where({ shop_id: f.shopId, lasyncro_unit_id: f.lsus[0] })
      .update({ status: 'stowed', current_location_code: A2, quarantined_from_location: null, quarantined_from_status: null }))))
      .toBe('P0001 PROBLEM_BIN_CUSTODY_IMMUTABLE');
    expect(await failure(() => inTx(f.shopId, (trx) => trx('problem_center_tasks').where({ shop_id: f.shopId, problem_task_id: taskId })
      .update({ status: 'resolved', resolution_action: 'release_to_stock' })))).toBe('P0001 PROBLEM_BIN_RESOLUTION_REQUIRED');
  });

  it('G2: a forged problem-solver event is refused; events are append-only; a closed incident is final; designations are never deleted', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0);
    const forged = { shop_id: f.shopId, device_event_id: crypto.randomUUID(), resolution_id: crypto.randomUUID(), problem_task_id: taskId,
      lasyncro_unit_id: f.lsus[0], outcome: 'released', problem_bin_location: PB, problem_bin_scan: PB, unit_scan: f.lsus[0],
      destination_location: A2, destination_scan: A2, authority: 'problem_solver', operator_id: f.operatorId, result: {} };
    expect(await failure(() => inTx(f.shopId, (trx) => trx('problem_bin_resolution_events').insert(forged))))
      .toBe('P0001 PROBLEM_BIN_RESOLUTION_UNAUTHORIZED');
    expect((await release(f, f.owner, taskId, 0)).status).toBe(200);
    expect(await failure(() => inTx(f.shopId, (trx) => trx('problem_bin_resolution_events').where({ shop_id: f.shopId }).update({ notes: 'x' }))))
      .toMatch(/append-only|42501/);
    expect(await failure(() => inTx(f.shopId, (trx) => trx('problem_center_tasks').where({ shop_id: f.shopId, problem_task_id: taskId })
      .update({ status: 'open' })))).toBe('P0001 PROBLEM_BIN_INCIDENT_FINAL');
    await grant(f.owner, f.solverId);
    expect(await failure(() => inTx(f.shopId, (trx) => trx('problem_solver_designations').where({ shop_id: f.shopId }).del())))
      .toMatch(/42501|PROBLEM_SOLVER_DESIGNATION_IMMUTABLE/);
  });

  it('G3: quarantine requires a classification (400) and stores it on the custody event', async () => {
    const f = await createFixture();
    const missing = await request(app).post('/api/v1/wms/problem-bin/quarantine').set('Authorization', `Bearer ${f.operator}`)
      .send({ lasyncro_unit_id: f.lsus[2], problem_bin_location: PB, device_event_id: crypto.randomUUID() });
    expect(missing.status).toBe(400);
    await quarantine(f, 2, 'defective');
    const ev = await withTenant(f.shopId, (trx) => trx('problem_bin_custody_events').where({ shop_id: f.shopId, lasyncro_unit_id: f.lsus[2] }).first());
    expect(ev.quarantine_reason).toBe('defective');
  });
});

describe('S2 C/T — concurrency and tenant isolation', () => {
  it('C1: concurrent release and write-off of one incident → exactly one winner, one ledger effect', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0, 'damaged');
    const before = await snapshot(f);
    const results = await Promise.all([release(f, f.owner, taskId, 0), writeOff(f, f.admin, taskId, 0), release(f, f.admin, taskId, 0)]);
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'PROBLEM_BIN_INCIDENT_NOT_OPEN')).toBe(true);
    const after = await snapshot(f);
    expect(after.events).toHaveLength(1);
    expect(onHand(after)).toBe(onHand(before) - (ok[0].body.outcome === 'written_off' ? 1 : 0));
    await expectRebuildFixedPoint(f);
  });

  it('T1: another shop cannot resolve, see or designate across tenants', async () => {
    const a = await createFixture();
    const b = await createFixture();
    const taskId = await quarantine(a, 0);
    const res = await request(app).post(`/api/v1/wms/problem-bin/incidents/${taskId}/release`).set('Authorization', `Bearer ${b.owner}`)
      .send({ problem_bin_scan: PB, lasyncro_unit_id: a.lsus[0], destination_scan: A2, device_event_id: crypto.randomUUID() });
    expect([res.status, res.body.code]).toEqual([404, 'PROBLEM_BIN_INCIDENT_NOT_FOUND']);
    expect((await grant(b.owner, a.solverId)).status).toBe(404);
    expect((await release(a, a.owner, taskId, 0)).status).toBe(200);
    const seenByB = await withTenant(b.shopId, (trx) => trx('problem_bin_resolution_events').count<{ count: string }[]>('* as count'));
    expect(Number(seenByB[0].count)).toBe(0);
  });
});

describe('S2 M — migration 0232 safety', () => {
  let admin: Knex;
  const SENTINEL = new Error('__rollback__');
  beforeAll(() => {
    if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(process.env.PGDATABASE ?? '')) throw new Error('not a disposable DB');
    admin = knexLib({ client: 'pg', pool: { min: 0, max: 2 }, connection: { host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGMIGRATION_USER, password: process.env.PGMIGRATION_PASSWORD, database: process.env.PGDATABASE } });
  });
  afterAll(async () => { if (admin) await admin.destroy(); });
  const rolledBack = (body: (trx: Knex.Transaction) => Promise<void>) =>
    admin.transaction(async (trx) => { await body(trx); throw SENTINEL; }).catch((e) => { if (e !== SENTINEL) throw e; });
  const objects = async (trx: Knex.Transaction) => (await trx.raw(`SELECT
      to_regclass('public.problem_bin_resolution_events') IS NOT NULL AS events,
      to_regclass('public.problem_solver_designations') IS NOT NULL AS designations,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'problem_bin_custody_events' AND column_name = 'quarantine_reason') AS reason,
      (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('problem_bin_resolution_events_validate',
        'problem_bin_resolution_events_immutable', 'problem_solver_designations_guard', 'problem_center_tasks_guard_problem_bin_closure')) AS triggers,
      (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN
        (to_regclass('public.problem_bin_resolution_events'), to_regclass('public.problem_solver_designations'))) AS forced_rls,
      (SELECT array_agg(DISTINCT privilege_type::text ORDER BY privilege_type::text) FROM information_schema.role_table_grants
        WHERE grantee = 'sf_app' AND table_name = 'problem_bin_resolution_events') AS event_grants,
      (SELECT prosrc LIKE '%resolution_events%' FROM pg_proc WHERE proname = 'guard_problem_bin_unit_custody') AS guard_replaced,
      (SELECT prosrc LIKE '%OLD.source::text = ''receive'' AND NEW.status%' FROM pg_proc WHERE proname = 'guard_receive_task_custody') AS receive_rule_scoped`)).rows[0];
  const HEAD = { events: true, designations: true, reason: true, triggers: 4, forced_rls: true, event_grants: ['INSERT', 'SELECT'], guard_replaced: true, receive_rule_scoped: true };

  it('M0: head carries every 0232 object; sf_app holds only SELECT + INSERT on resolution events', async () => {
    await rolledBack(async (trx) => { expect(await objects(trx)).toEqual(HEAD); });
  });

  it('M1: DOWN → UP round-trips when no 0232 evidence exists (in a rolled-back transaction)', async () => {
    await rolledBack(async (trx) => {
      await trx.raw('SET LOCAL row_security = off');
      // Remove every committed 0232 evidence row inside this rolled-back
      // migration-role transaction, so DOWN's precondition is genuinely met.
      await trx.raw(`ALTER TABLE problem_bin_resolution_events DISABLE TRIGGER problem_bin_resolution_events_immutable`);
      await trx.raw(`ALTER TABLE problem_solver_designations DISABLE TRIGGER problem_solver_designations_guard`);
      await trx.raw(`ALTER TABLE problem_bin_custody_events DISABLE TRIGGER problem_bin_custody_events_immutable`);
      await trx.raw(`DELETE FROM problem_bin_resolution_events`);
      await trx.raw(`DELETE FROM problem_solver_designations`);
      await trx.raw(`UPDATE problem_bin_custody_events SET quarantine_reason = NULL`);
      await trx.raw(`UPDATE inventory_units SET status = 'lost' WHERE status::text = 'written_off'`);
      await trx.raw(`ALTER TABLE problem_bin_resolution_events ENABLE TRIGGER problem_bin_resolution_events_immutable`);
      await trx.raw(`ALTER TABLE problem_solver_designations ENABLE TRIGGER problem_solver_designations_guard`);
      await trx.raw(`ALTER TABLE problem_bin_custody_events ENABLE TRIGGER problem_bin_custody_events_immutable`);
      await migration0232.down(trx);
      expect(await objects(trx)).toMatchObject({ events: false, designations: false, reason: false, triggers: 0, guard_replaced: false, receive_rule_scoped: false });
      await migration0232.up(trx);
      expect(await objects(trx)).toEqual(HEAD);
    });
  });

  it('M2: DOWN refuses while resolution evidence exists, leaving 0232 in place', async () => {
    const f = await createFixture();
    const taskId = await quarantine(f, 0);
    expect((await release(f, f.owner, taskId, 0)).status).toBe(200);
    await rolledBack(async (trx) => {
      await expect(trx.transaction((sp) => migration0232.down(sp))).rejects.toThrow('PROBLEM_BIN_RESOLUTION_ROLLBACK_BLOCKED');
      expect(await objects(trx)).toEqual(HEAD);
    });
  });
});

afterAll(async () => { await db.destroy(); });
