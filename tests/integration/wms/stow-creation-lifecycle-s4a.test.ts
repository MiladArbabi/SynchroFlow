import type { Knex } from 'knex';
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { createStowTask } from 'api-src/services/wms/stow.service';
import { closeReceiveJob } from 'api-src/services/wms/receiveJob.service';
import { lockLocationHierarchy, validateLocationHierarchy } from 'api-src/services/inventory/locationHierarchy.service';
import { assertLocationLifecycleEligible, assertProspectiveParentStowEligible } from 'api-src/services/inventory/locationLifecycleEligibility.service';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(60000);
const app = createApp();
beforeAll(() => { process.env.JWT_SECRET ||= 'test_jwt_secret'; });

async function fixture() {
  const suffix = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async trx => {
    const id = await createTenantShop(trx, `s4a-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });
  const rootCode = `WH-${shopId}-ROOT`;
  const warehouseId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const userId = await withTenant(shopId, async trx => {
    const [user] = await trx('users').insert({ shop_id: shopId, email: `${suffix}@test.example`,
      password_hash: 'not_a_real_hash', first_name: 'Owner', role: 'owner' }).returning('id');
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: user.id, role: 'owner' });
    await trx('user_lifecycle_snapshot').insert({ shop_id: shopId, user_id: user.id,
      phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID() });
    await trx('shop_subscriptions').insert({ shop_id: shopId, tier: 'growth', allow_overage: true,
      billing_provider: 'stripe', stripe_customer_id: null });
    await trx('shop_wms_settings').insert({ shop_id: shopId, bootstrap_model: 'legacy_opening_balance_v1' });
    await trx('warehouses').insert({ shop_id: shopId, warehouse_id: warehouseId,
      name: 'Main', root_location_code: rootCode, is_default: true });
    for (const code of [rootCode, 'A', 'B', 'C']) await trx('warehouse_locations').insert({
      shop_id: shopId, warehouse_id: warehouseId, location_code: code,
      type: code === rootCode ? 'warehouse' : 'bin', parent_location_code: code === rootCode ? null : rootCode,
      active: true, zone_type: 'pick' });
    await trx('products').insert({ shop_id: shopId, lasyncro_product_id: productId,
      title: 'S4A stock', status: 'active', product_type: 'physical' });
    await trx('variants').insert({ shop_id: shopId, lasyncro_product_id: productId,
      lasyncro_variant_id: variantId, title: 'S4A variant', sku: suffix, barcode: '5012345678900', unit_cost: '1.00', status: 'active' });
    return Number(user.id);
  });
  return { shopId, rootCode, warehouseId, variantId, productId, userId,
    token: issueTestToken({ shopId, userId, tier: 'growth' }) };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function receipt(f: Fixture) {
  return withTenant(f.shopId, async trx => {
    const [supplier] = await trx('suppliers').insert({ shop_id: f.shopId, name: 'Creation race supplier', active: true }).returning('id');
    const [po] = await trx('purchase_orders').insert({ shop_id: f.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
    const [poLine] = await trx('purchase_order_line_items').insert({ shop_id: f.shopId, po_id: po.id,
      lasyncro_variant_id: f.variantId, description: 'Creation race receipt', quantity_ordered: 1,
      quantity_received: 0 }).returning('id');
    const [job] = await trx('receive_jobs').insert({ shop_id: f.shopId, po_id: po.id, status: 'stow_ready',
      total_variants: 1, total_units: 1 }).returning('receive_job_id');
    const [line] = await trx('receive_job_lines').insert({ shop_id: f.shopId, receive_job_id: job.receive_job_id,
      po_line_item_id: poLine.id, lasyncro_variant_id: f.variantId, quantity_expected: 1, quantity_accepted: 1,
      inspection_complete: true, suggested_location_code: 'A' }).returning('receive_job_line_id');
    await trx('inventory_units').insert({ shop_id: f.shopId, lasyncro_variant_id: f.variantId,
      receive_job_line_id: line.receive_job_line_id, receive_sequence: 1, status: 'received',
      current_location_code: null, lasyncro_unit_id: 'LSU-' + crypto.randomUUID().slice(0, 12) });
    return { poId: po.id as string, poLineId: poLine.id as string, jobId: job.receive_job_id as string,
      lineId: line.receive_job_line_id as string };
  });
}
type Receipt = Awaited<ReturnType<typeof receipt>>;
const input = (f: Fixture, r: Receipt) => ({ shopId: f.shopId, lasyncroVariantId: f.variantId,
  quantity: 1, locationCode: 'A', trigger: 'inbound_stock' as const, poId: r.poId, receiveJobLineId: r.lineId });
async function state(f: Fixture) {
  return withTenant(f.shopId, async trx => {
    const result: Record<string, any[]> = {};
    for (const table of ['warehouse_locations', 'inventory_truth', 'inventory_units', 'inventory_movements',
      'stow_tasks', 'purchase_orders', 'purchase_order_line_items', 'receive_jobs', 'receive_job_lines',
      'suppliers', 'barcode_print_jobs', 'pick_reservation_allocations', 'pick_scan_unit_lineage', 'pick_scan_unit_settlement']) {
      result[table] = await trx(table).where({ shop_id: f.shopId }).orderByRaw('to_jsonb(??)::text', [table]);
    }
    return result;
  });
}
async function attach(f: Fixture, trx: Knex.Transaction, operation: 'create' | 'reparent') {
  await lockLocationHierarchy(trx, f.shopId);
  const code = operation === 'create' ? 'NEW-CHILD' : 'C';
  if (operation === 'reparent') await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: code }).forUpdate().first();
  await assertLocationLifecycleEligible(trx, f.shopId, [code], operation !== 'create');
  await validateLocationHierarchy(trx, { shopId: f.shopId, warehouseId: f.warehouseId, locationCode: code, parentCode: 'A', barcode: null });
  await assertProspectiveParentStowEligible(trx, f.shopId, 'A');
  if (operation === 'create') return trx('warehouse_locations').insert({ shop_id: f.shopId, warehouse_id: f.warehouseId,
    location_code: code, type: 'bin', parent_location_code: 'A', active: true });
  return trx('warehouse_locations').where({ shop_id: f.shopId, location_code: code }).update({ parent_location_code: 'A' });
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
/** Keep the first writer uncommitted until the exact second backend either
 * waits on hierarchy coordination or commits through it (the reported RED).
 * No mock locks, speculative delays or forced transaction termination.
 */
async function overlap<A, B>(f: Fixture, firstAction: (trx: Knex.Transaction) => Promise<A>,
  secondAction: (trx: Knex.Transaction) => Promise<B>, rollbackFirst = false,
  inspectWait?: (pid: number) => Promise<void>) {
  const held = barrier(), release = barrier(), started = barrier();
  const first = withTenant(f.shopId, async trx => {
    try {
      const value = await firstAction(trx); held.resolve(); await release.promise;
      if (rollbackFirst) throw Error('CREATION_TEST_ROLLBACK');
      return value;
    } catch (e) { held.resolve(); throw e; }
  }).then(value => ({ value, error: null }), error => ({ value: null, error }));
  await held.promise;
  let pid!: number, settled = false;
  const second = withTenant(f.shopId, async trx => {
    pid = (await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    started.resolve(); return secondAction(trx);
  }).then(value => ({ value, error: null }), error => ({ value: null, error })).then(r => { settled = true; return r; });
  let waiting = false;
  try {
    await started.promise;
    const deadline = Date.now() + 5000;
    while (!waiting && !settled && Date.now() < deadline) {
      waiting = await withTenant(f.shopId, async trx => (await trx.raw(`SELECT EXISTS (
        SELECT 1 FROM pg_locks WHERE pid = ? AND locktype = 'advisory' AND NOT granted
      ) AS waiting`, [pid])).rows[0].waiting);
    }
    if (waiting && inspectWait) await inspectWait(pid);
  } finally { release.resolve(); }
  const outcomes = { first: await first, second: await second, waiting, settledBeforeRelease: settled && !waiting };
  console.info('STOW_CREATION_OVERLAP', { pid, waiting, rollbackFirst, settledBeforeRelease: outcomes.settledBeforeRelease });
  return outcomes;
}
const close = async (f: Fixture, r: Receipt, trx: Knex.Transaction) => {
  await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
  return closeReceiveJob(trx, { shopId: f.shopId, receiveJobId: r.jobId, actualDeliveryDate: '2026-11-20', closedBy: f.userId });
};
const cases = (['create', 'reparent'] as const).flatMap(operation => [true, false].map(stowFirst => ({ operation, stowFirst })));

describe('S4A Stow creation lifecycle', () => {
  it.each(cases)('creation race: $operation, stowFirst=$stowFirst', async ({ operation, stowFirst }) => {
    const f = await fixture(), r = await receipt(f), before = await state(f);
    const stow = (trx: Knex.Transaction) => createStowTask(trx, input(f, r));
    const hierarchy = (trx: Knex.Transaction) => attach(f, trx, operation);
    const result = await overlap(f, async trx => { if (stowFirst) await stow(trx); else await hierarchy(trx); },
      async trx => { if (stowFirst) await hierarchy(trx); else await stow(trx); });
    const after = await state(f);
    console.info('STOW_CREATION_RACE_RESULT', { operation, stowFirst, waiting: result.waiting,
      firstError: result.first.error?.message ?? null, secondError: result.second.error?.message ?? null,
      childrenOfA: after.warehouse_locations.filter(l => l.parent_location_code === 'A').length,
      tasksAtA: after.stow_tasks.filter(t => t.location_code === 'A').length });
    expect(result.waiting).toBe(true);
    expect(result.first.error).toBeNull();
    expect(result.second.error?.message).toBe(stowFirst ? 'LOCATION_LIFECYCLE_BLOCKED: stow' : 'STOW_DESTINATION_STRUCTURAL');
    if (stowFirst) { expect(after.warehouse_locations).toEqual(before.warehouse_locations); expect(after.stow_tasks).toHaveLength(1); }
    else { expect(after.stow_tasks).toEqual(before.stow_tasks); expect(after.warehouse_locations.filter(l => l.parent_location_code === 'A')).toHaveLength(1); }
    for (const table of Object.keys(before).filter(t => !['warehouse_locations', 'stow_tasks'].includes(t))) expect(after[table]).toEqual(before[table]);
  });

  it.each(cases)('caller rollback releases creation/hierarchy coordination: $operation, stowFirst=$stowFirst', async ({ operation, stowFirst }) => {
    const f = await fixture(), r = await receipt(f), before = await state(f);
    const result = await overlap(f, async trx => { if (stowFirst) await createStowTask(trx, input(f, r)); else await attach(f, trx, operation); },
      async trx => { if (stowFirst) await attach(f, trx, operation); else await createStowTask(trx, input(f, r)); }, true);
    expect(result.waiting).toBe(true); expect(result.first.error?.message).toBe('CREATION_TEST_ROLLBACK'); expect(result.second.error).toBeNull();
    const after = await state(f);
    if (stowFirst) expect(after.stow_tasks).toEqual(before.stow_tasks);
    else expect(after.warehouse_locations).toEqual(before.warehouse_locations);
    for (const table of Object.keys(before).filter(t => !['warehouse_locations', 'stow_tasks'].includes(t))) expect(after[table]).toEqual(before[table]);
  });

  it.each(cases)('Receive close versus hierarchy: $operation, stowFirst=$stowFirst', async ({ operation, stowFirst }) => {
    const f = await fixture(), r = await receipt(f), before = await state(f);
    const result = await overlap(f, async trx => { if (stowFirst) await close(f, r, trx); else await attach(f, trx, operation); },
      async trx => { if (stowFirst) await attach(f, trx, operation); else await close(f, r, trx); });
    expect(result.waiting).toBe(true); expect(result.first.error).toBeNull();
    expect(result.second.error?.message).toBe(stowFirst ? 'LOCATION_LIFECYCLE_BLOCKED: stow' : 'STOW_DESTINATION_STRUCTURAL');
    const after = await state(f);
    if (stowFirst) {
      expect(after.warehouse_locations).toEqual(before.warehouse_locations);
      expect(after.receive_jobs[0].status).toBe('closed'); expect(after.stow_tasks).toHaveLength(1);
      expect(after.stow_tasks[0].receive_job_line_id).toBe(r.lineId);
      expect(after.inventory_movements).toHaveLength(1); expect(Number(after.inventory_truth[0].on_hand_quantity)).toBe(1);
      expect(Number(after.purchase_order_line_items[0].quantity_received)).toBe(1);
    } else {
      for (const table of Object.keys(before).filter(t => t !== 'warehouse_locations')) expect(after[table]).toEqual(before[table]);
    }
    for (const table of ['inventory_units', 'pick_reservation_allocations', 'pick_scan_unit_lineage', 'pick_scan_unit_settlement']) expect(after[table]).toEqual(before[table]);
  });

  it('Receive close waits for hierarchy before taking PO, job or line row locks', async () => {
    const f = await fixture(), r = await receipt(f);
    const result = await overlap(f, trx => lockLocationHierarchy(trx, f.shopId), trx => close(f, r, trx), false, async pid => {
      await withTenant(f.shopId, async trx => {
        await trx('purchase_orders').where({ shop_id: f.shopId, id: r.poId }).forUpdate().noWait().first();
        await trx('receive_jobs').where({ shop_id: f.shopId, receive_job_id: r.jobId }).forUpdate().noWait().first();
        await trx('receive_job_lines').where({ shop_id: f.shopId, receive_job_line_id: r.lineId }).forUpdate().noWait().first();
      });
      console.info('RECEIVE_HIERARCHY_BEFORE_ROWS_PROVEN', { pid, po: 'unlocked', job: 'unlocked', line: 'unlocked' });
    });
    expect(result.waiting).toBe(true); expect(result.first.error).toBeNull(); expect(result.second.error).toBeNull();
    expect((await state(f)).receive_jobs[0].status).toBe('closed');
  });

  it('Receive close rollback restores its complete economic state and frees hierarchy coordination', async () => {
    const f = await fixture(), r = await receipt(f), before = await state(f);
    const result = await overlap(f, trx => close(f, r, trx), trx => attach(f, trx, 'create'), true);
    expect(result.waiting).toBe(true); expect(result.first.error?.message).toBe('CREATION_TEST_ROLLBACK'); expect(result.second.error).toBeNull();
    const after = await state(f);
    for (const table of Object.keys(before).filter(t => t !== 'warehouse_locations')) expect(after[table]).toEqual(before[table]);
  });

  it.each(['missing', 'inactive', 'structural'] as const)('rejects a %s destination with zero writes', async kind => {
    const f = await fixture(), r = await receipt(f);
    if (kind === 'inactive') await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).update({ active: false }));
    if (kind === 'structural') await withTenant(f.shopId, trx => attach(f, trx, 'create'));
    const before = await state(f);
    await expect(withTenant(f.shopId, trx => createStowTask(trx, { ...input(f, r), locationCode: kind === 'missing' ? 'MISSING' : 'A' })))
      .rejects.toThrow(kind === 'missing' ? 'STOW_DESTINATION_NOT_FOUND' : kind === 'inactive' ? 'STOW_DESTINATION_INACTIVE' : 'STOW_DESTINATION_STRUCTURAL');
    expect(await state(f)).toEqual(before);
  });

  it('allows a valid destination and preserves exact Receive identity', async () => {
    const f = await fixture(), r = await receipt(f), before = await state(f);
    const id = await withTenant(f.shopId, trx => createStowTask(trx, input(f, r)));
    const after = await state(f); expect(after.stow_tasks).toHaveLength(1);
    expect(after.stow_tasks[0]).toMatchObject({ stow_task_id: id, location_code: 'A', receive_job_line_id: r.lineId, status: 'pending', quantity: 1 });
    for (const table of Object.keys(before).filter(t => t !== 'stow_tasks')) expect(after[table]).toEqual(before[table]);
  });

  it('destination-less return-restock creation keeps its existing lock path', async () => {
    const f = await fixture();
    const result = await overlap(f, trx => lockLocationHierarchy(trx, f.shopId), trx => createStowTask(trx,
      { shopId: f.shopId, lasyncroVariantId: f.variantId, quantity: 1, trigger: 'return_restock' }));
    expect(result.waiting).toBe(false); expect(result.settledBeforeRelease).toBe(true);
    expect(result.first.error).toBeNull(); expect(result.second.error).toBeNull();
    expect((await state(f)).stow_tasks[0]).toMatchObject({ location_code: null, trigger: 'return_restock' });
  });

  it('rejects foreign destinations and mismatched tenant context without touching either shop', async () => {
    const f = await fixture(), other = await fixture(), r = await receipt(f);
    await withTenant(other.shopId, trx => trx('warehouse_locations').insert({ shop_id: other.shopId, warehouse_id: other.warehouseId,
      location_code: 'FOREIGN-ONLY', parent_location_code: other.rootCode, type: 'bin', active: true }));
    const before = await state(f), foreignBefore = await state(other);
    await expect(withTenant(f.shopId, trx => createStowTask(trx, { ...input(f, r), locationCode: 'FOREIGN-ONLY' }))).rejects.toThrow('STOW_DESTINATION_NOT_FOUND');
    await expect(withTenant(f.shopId, trx => createStowTask(trx, { ...input(f, r), shopId: other.shopId }))).rejects.toThrow('LOCATION_TENANT_CONTEXT_INVALID');
    expect(await state(f)).toEqual(before); expect(await state(other)).toEqual(foreignBefore);
  });

  it('preserves the unmounted direct POST and missing-inbound-lineage refusal', async () => {
    const f = await fixture(), before = await state(f);
    const response = await request(app).post('/api/v1/wms/stow-tasks').set('Authorization', `Bearer ${f.token}`)
      .send({ lasyncro_variant_id: f.variantId, quantity: 1, location_code: 'A' });
    // The collection POST is unmounted; preserve the observed baseline 404.
    expect(response.status).toBe(404);
    expect(await state(f)).toEqual(before);
    await expect(withTenant(f.shopId, trx => createStowTask(trx, {
      shopId: f.shopId, lasyncroVariantId: f.variantId, quantity: 1, locationCode: 'A', trigger: 'inbound_stock',
    }))).rejects.toThrow('[STOW_CREATE] INBOUND_RECEIVE_LINE_REQUIRED');
    expect(await state(f)).toEqual(before);
  });
});
