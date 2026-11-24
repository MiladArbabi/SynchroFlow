import { assertStowDestinationEligible } from 'api-src/services/wms/stowDestinationEligibility.service';
import type { Knex } from 'knex';
import { createRecountTask, commitRecount, reviewLine } from 'api-src/services/wms/inventoryRecount.service';
import { releaseBatch } from 'api-src/services/wms/pickBatch.service';
import { fixture as pickFixture, seedOrder } from './pick-assign-sf-01.fixture';
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { lockLocationHierarchy } from 'api-src/services/inventory/locationHierarchy.service';
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
      name: 'Main', root_location_code: 'ROOT', is_default: true });
    for (const code of ['ROOT', 'A', 'B', 'C']) await trx('warehouse_locations').insert({
      shop_id: shopId, warehouse_id: warehouseId, location_code: code,
      type: code === 'ROOT' ? 'warehouse' : 'bin', parent_location_code: code === 'ROOT' ? null : 'ROOT',
      active: true, zone_type: 'pick' });
    await trx('products').insert({ shop_id: shopId, lasyncro_product_id: productId,
      title: 'S4A stock', status: 'active', product_type: 'physical' });
    await trx('variants').insert({ shop_id: shopId, lasyncro_product_id: productId,
      lasyncro_variant_id: variantId, title: 'S4A variant', sku: suffix, unit_cost: '1.00', status: 'active' });
    return Number(user.id);
  });
  return { shopId, warehouseId, variantId, productId, userId,
    token: issueTestToken({ shopId, userId, tier: 'growth' }) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const patch = (f: Fixture, code: string, body: object) => request(app)
  .patch('/api/v1/floor-planning/zones/' + code).set('Authorization', `Bearer ${f.token}`).send(body);
async function truth(f: Fixture, code: string, quantity = 0, reserved = 0) {
  await withTenant(f.shopId, async trx => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({ shop_id: f.shopId, lasyncro_variant_id: f.variantId,
      location_code: code, on_hand_quantity: quantity, reserved_quantity: reserved,
      committed_quantity: 0, available_quantity: Math.max(0, quantity - reserved), last_evaluated_at: new Date() });
  });
}
async function snapshot(f: Fixture) {
  return withTenant(f.shopId, async trx => {
    const state: Record<string, unknown> = {};
    for (const table of ['warehouse_locations', 'inventory_truth', 'inventory_units', 'inventory_movements',
      'inventory_recount_tasks', 'inventory_recount_lines', 'pick_reservation_allocations', 'pick_scan_unit_lineage',
      'pick_scan_unit_settlement', 'stow_tasks']) {
      state[table] = await trx(table).where({ shop_id: f.shopId }).select('*').orderByRaw('to_jsonb(??)::text', [table]);
    }
    return state;
  });
}

function barrier() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Do not release the first transaction until pg_locks proves that the exact
 * second backend is blocked. Every tested action runs in its real transaction.
 */
async function overlap<A, B>(shopId: number,
  firstAction: (trx: Knex.Transaction) => Promise<A>,
  secondAction: (trx: Knex.Transaction) => Promise<B>,
  rollbackFirst = false,
) {
  const held = barrier(); const release = barrier(); const started = barrier();
  const first = withTenant(shopId, async trx => {
    try {
      const value = await firstAction(trx);
      held.resolve(); await release.promise;
      if (rollbackFirst) throw new Error('S4A_TEST_ROLLBACK');
      return value;
    } catch (e) { held.reject(e); throw e; }
  }).then(value => ({ value, error: null }), error => ({ value: null, error }));
  await held.promise;
  let pid!: number;
  const second = withTenant(shopId, async trx => {
    pid = (await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    started.resolve();
    return secondAction(trx);
  }).then(value => ({ value, error: null }), error => ({ value: null, error }));
  let waiting = false;
  try {
    await started.promise;
    const deadline = Date.now() + 5000;
    while (!waiting && Date.now() < deadline) {
      waiting = await withTenant(shopId, async trx => (await trx.raw(`SELECT EXISTS (
        SELECT 1 FROM pg_locks WHERE pid = ? AND locktype = 'advisory' AND NOT granted
      ) AS waiting`, [pid])).rows[0].waiting);
    }
    expect(waiting).toBe(true);
    console.info('S4A_OVERLAP_PROVEN', { shopId, pid, advisoryWait: waiting, rollbackFirst });
  } finally { release.resolve(); }
  return { first: await first, second: await second };
}
const create = (f: Fixture, trx: Knex.Transaction) => createRecountTask(trx, {
  shopId: f.shopId, warehouseId: f.warehouseId, scope: 'location', locationCode: 'A', createdBy: f.userId,
});
async function reviewed(f: Fixture) {
  await truth(f, 'A');
  return withTenant(f.shopId, async trx => {
    const task = await create(f, trx);
    await trx('inventory_recount_tasks').where({ shop_id: f.shopId, recount_task_id: task.recount_task_id })
      .update({ status: 'manual_review' });
    const [line] = await trx('inventory_recount_lines').where({ shop_id: f.shopId, recount_task_id: task.recount_task_id })
      .update({ counted_quantity: 2, variance: 2, variance_reason: 'count_error' }).returning('recount_line_id');
    return { taskId: task.recount_task_id, lineId: line.recount_line_id as string };
  });
}
const change = async (trx: Knex.Transaction, f: Fixture, updates: object) => {
  await lockLocationHierarchy(trx, f.shopId);
  await assertLocationLifecycleEligible(trx, f.shopId, ['A']);
  return trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).update(updates);
};

describe('GH-1305 S4A genuine overlapping transactions', () => {
  it('Recount creation wins: lifecycle waiter rechecks the newly active work', async () => {
    const f = await fixture(); await truth(f, 'A');
    const r = await overlap(f.shopId, trx => create(f, trx), trx => change(trx, f, { active: false }));
    expect(r.first.error).toBeNull(); expect(r.second.error?.message).toContain('LOCATION_LIFECYCLE_BLOCKED: recount');
    await withTenant(f.shopId, async trx => {
      expect(await trx('inventory_recount_tasks').where({ shop_id: f.shopId })).toHaveLength(1);
      expect(await trx('inventory_recount_lines').where({ shop_id: f.shopId })).toHaveLength(1);
      expect((await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).first()).active).toBe(true);
    });
  });

  it('lifecycle wins: Recount creation sees the inactive location and rolls back label/task writes', async () => {
    const f = await fixture(); await truth(f, 'A');
    const before = await snapshot(f);
    const r = await overlap(f.shopId, trx => change(trx, f, { active: false }), trx => create(f, trx));
    expect(r.first.error).toBeNull(); expect(r.second.error?.message).toBe('RECOUNT_LOCATION_INELIGIBLE');
    const after = await snapshot(f);
    expect(after.inventory_recount_tasks).toEqual(before.inventory_recount_tasks);
    expect(after.inventory_recount_lines).toEqual(before.inventory_recount_lines);
    await withTenant(f.shopId, async trx => {
      expect(Number((await trx('shop_wms_settings').where({ shop_id: f.shopId }).first()).recount_label_sequence)).toBe(0);
    });
  });

  it('Recount commit wins: lifecycle waiter sees the correction and cannot invalidate stock', async () => {
    const f = await fixture(); const t = await reviewed(f);
    const r = await overlap(f.shopId, trx => commitRecount(trx, f.shopId, t.taskId, f.userId), trx => change(trx, f, { active: false }));
    expect(r.first.error).toBeNull(); expect(r.first.value).toEqual({ corrections: 1, units: 2 });
    expect(r.second.error?.message).toContain('LOCATION_LIFECYCLE_BLOCKED: inventory');
    await withTenant(f.shopId, async trx => {
      expect(await trx('inventory_movements').where({ shop_id: f.shopId, reference_id: t.lineId })).toHaveLength(1);
      expect(Number((await trx('inventory_truth').where({ shop_id: f.shopId, location_code: 'A' }).first()).on_hand_quantity)).toBe(2);
    });
  });

  it('geometry commits first and Recount commits after the hierarchy lock is released', async () => {
    const f = await fixture(); const t = await reviewed(f);
    const r = await overlap(f.shopId, async trx => {
      await lockLocationHierarchy(trx, f.shopId);
      return trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).update({ orientation: 90 });
    }, trx => commitRecount(trx, f.shopId, t.taskId, f.userId));
    expect(r.first.error).toBeNull(); expect(r.second.error).toBeNull();
    expect(r.second.value).toEqual({ corrections: 1, units: 2 });
  });

  it.each([false, true])('review and commit serialize on the owning task (commitFirst=%s)', async commitFirst => {
    const f = await fixture(); const t = await reviewed(f);
    const review = (trx: Knex.Transaction) => reviewLine(trx, { shopId: f.shopId, recountTaskId: t.taskId,
      recountLineId: t.lineId, decision: 'accept', varianceReason: 'damage', reviewedBy: f.userId });
    const commit = (trx: Knex.Transaction) => commitRecount(trx, f.shopId, t.taskId, f.userId);
    const firstAction = async (trx: Knex.Transaction) => { if (commitFirst) await commit(trx); else await review(trx); };
    const secondAction = async (trx: Knex.Transaction) => { if (commitFirst) await review(trx); else await commit(trx); };
    const r = await overlap(f.shopId, firstAction, secondAction);
    expect(r.first.error).toBeNull();
    if (commitFirst) expect(r.second.error?.message).toContain('Task not in review');
    else expect(r.second.error).toBeNull();
    await withTenant(f.shopId, async trx => {
      const line = await trx('inventory_recount_lines').where({ shop_id: f.shopId, recount_line_id: t.lineId }).first();
      expect(line.variance_reason).toBe(commitFirst ? 'count_error' : 'damage');
      expect(await trx('inventory_movements').where({ shop_id: f.shopId, reference_id: t.lineId })).toHaveLength(1);
    });
  });

  it('serializes concurrent lifecycle changes without losing fields', async () => {
    const f = await fixture();
    const r = await overlap(f.shopId, trx => change(trx, f, { barcode: 'ONE' }), trx => change(trx, f, { active: false }));
    expect(r.first.error).toBeNull(); expect(r.second.error).toBeNull();
    await withTenant(f.shopId, async trx => {
      const row = await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).first();
      expect(row).toMatchObject({ barcode: 'ONE', active: false });
    });
  });

  it('rollback restores lifecycle state and releases the advisory lock to Recount', async () => {
    const f = await fixture(); await truth(f, 'A');
    const r = await overlap(f.shopId, trx => change(trx, f, { active: false }), trx => create(f, trx), true);
    expect(r.first.error?.message).toBe('S4A_TEST_ROLLBACK'); expect(r.second.error).toBeNull();
    await withTenant(f.shopId, async trx => {
      expect((await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A' }).first()).active).toBe(true);
      expect(await trx('inventory_recount_tasks').where({ shop_id: f.shopId })).toHaveLength(1);
    });
  });

  it.each(['manual', 'auto'] as const)('Pick %s release holds coordination before reservation; lifecycle sees its committed dependency', async trigger => {
    const fx = await pickFixture(); const shopId = fx.shop.shopId;
    const order = await seedOrder(shopId, fx.variants[0], 1);
    const root = `WH-${shopId}-ROOT`;
    const r = await overlap(shopId,
      trx => releaseBatch(trx, shopId, trigger, trigger === 'auto' ? null : fx.shop.ownerId, undefined, undefined, [order], true),
      async trx => { await lockLocationHierarchy(trx, shopId); await assertLocationLifecycleEligible(trx, shopId, [root]); });
    expect(r.first.error).toBeNull(); expect(r.first.value).not.toBeNull();
    expect(r.second.error?.message).toContain('LOCATION_LIFECYCLE_BLOCKED');
    await withTenant(shopId, async trx => {
      const allocations = await trx('pick_reservation_allocations').where({ shop_id: shopId, pick_batch_id: r.first.value!.pick_batch_id });
      expect(allocations.reduce((n: number, a: any) => n + Number(a.quantity), 0)).toBe(1);
      expect(allocations).toHaveLength(1);
    });
  });

  it('lifecycle geometry commits first; waiting Pick release preserves the order and exact reservation', async () => {
    const fx = await pickFixture(); const shopId = fx.shop.shopId;
    const order = await seedOrder(shopId, fx.variants[0], 1);
    const r = await overlap(shopId, async trx => {
      await lockLocationHierarchy(trx, shopId);
      return trx('warehouse_locations').where({ shop_id: shopId, location_code: `WH-${shopId}-ROOT` }).update({ orientation: 90 });
    }, trx => releaseBatch(trx, shopId, 'manual', fx.shop.ownerId, undefined, undefined, [order], true));
    expect(r.first.error).toBeNull(); expect(r.second.error).toBeNull(); expect(r.second.value).not.toBeNull();
    await withTenant(shopId, async trx => {
      const rows = await trx('pick_reservation_allocations').where({ shop_id: shopId, pick_batch_id: r.second.value!.pick_batch_id });
      expect(rows).toHaveLength(1); expect(Number(rows[0].quantity)).toBe(1);
    });
  });
});


it.each([false, true])('Pick release and Recount preserve inventory in both commit orders (pickFirst=%s)', async pickFirst => {
  const fx = await pickFixture(); const shopId = fx.shop.shopId;
  const variantId = fx.variants[0].lasyncro_variant_id;
  const root = `WH-${shopId}-ROOT`;
  const order = await seedOrder(shopId, fx.variants[0], 1);
  const t = await withTenant(shopId, async trx => {
    const location = await trx('warehouse_locations').where({ shop_id: shopId, location_code: root }).first();
    const task = await createRecountTask(trx, { shopId, warehouseId: location.warehouse_id,
      scope: 'location', locationCode: root, createdBy: fx.shop.ownerId });
    await trx('inventory_recount_tasks').where({ shop_id: shopId, recount_task_id: task.recount_task_id }).update({ status: 'manual_review' });
    const [line] = await trx('inventory_recount_lines').where({ shop_id: shopId,
      recount_task_id: task.recount_task_id, lasyncro_variant_id: variantId })
      .update({ counted_quantity: trx.raw('expected_quantity + 2'), variance: 2, variance_reason: 'count_error' }).returning('recount_line_id');
    return { taskId: task.recount_task_id, lineId: line.recount_line_id };
  });
  const state = () => withTenant(shopId, async trx => {
    const rows = await trx('inventory_truth').where({ shop_id: shopId, lasyncro_variant_id: variantId });
    return { onHand: rows.reduce((n: number, row: any) => n + Number(row.on_hand_quantity), 0),
      reserved: rows.reduce((n: number, row: any) => n + Number(row.reserved_quantity), 0),
      units: await trx('inventory_units').where({ shop_id: shopId }).orderBy('lasyncro_unit_id'),
      lineage: await trx('pick_scan_unit_lineage').where({ shop_id: shopId }),
      settlements: await trx('pick_scan_unit_settlement').where({ shop_id: shopId }) };
  });
  const before = await state();
  const pick = (trx: Knex.Transaction) => releaseBatch(trx, shopId, 'manual', fx.shop.ownerId, undefined, undefined, [order], true);
  const recount = (trx: Knex.Transaction) => commitRecount(trx, shopId, t.taskId, fx.shop.ownerId);
  const r = await overlap(shopId,
    async trx => { if (pickFirst) expect(await pick(trx)).not.toBeNull(); else expect(await recount(trx)).toEqual({ corrections: 1, units: 2 }); },
    async trx => { if (pickFirst) expect(await recount(trx)).toEqual({ corrections: 1, units: 2 }); else expect(await pick(trx)).not.toBeNull(); });
  expect(r.first.error).toBeNull(); expect(r.second.error).toBeNull();
  const after = await state();
  expect(after).toEqual({ ...before, onHand: before.onHand + 2, reserved: before.reserved + 1 });
  await withTenant(shopId, async trx => {
    expect(await trx('inventory_movements').where({ shop_id: shopId, reference_id: t.lineId, movement_type: 'reconciliation_correction' })).toHaveLength(1);
    const allocations = await trx('pick_reservation_allocations').where({ shop_id: shopId, lasyncro_order_id: order });
    expect(allocations).toHaveLength(1); expect(Number(allocations[0].quantity)).toBe(1);
  });
});

it('rolling back Pick release frees its reservation and hierarchy lock for a single successful retry', async () => {
  const fx = await pickFixture(); const shopId = fx.shop.shopId;
  const order = await seedOrder(shopId, fx.variants[0], 1);
  const pick = (trx: Knex.Transaction) => releaseBatch(trx, shopId, 'manual', fx.shop.ownerId, undefined, undefined, [order], true);
  const r = await overlap(shopId, pick, pick, true);
  expect(r.first.error?.message).toBe('S4A_TEST_ROLLBACK'); expect(r.second.error).toBeNull();
  expect(r.second.value).not.toBeNull();
  await withTenant(shopId, async trx => {
    const allocations = await trx('pick_reservation_allocations').where({ shop_id: shopId, lasyncro_order_id: order });
    expect(allocations).toHaveLength(1); expect(Number(allocations[0].quantity)).toBe(1);
    expect(await trx('pick_batches').where({ shop_id: shopId })).toHaveLength(1);
    expect(await trx('inventory_movements').where({ shop_id: shopId, reference_id: r.second.value!.pick_batch_id, movement_type: 'reservation_hold' })).toHaveLength(1);
  });
});


// F1: each order overlaps on the exact second backend's hierarchy lock.
describe('F1 Stow assignment versus prospective-parent changes', () => {
  async function seedTask(f: Fixture) {
    await withTenant(f.shopId, async trx => {
      const [supplier] = await trx('suppliers').insert({ shop_id: f.shopId, name: 'F1 supplier', active: true }).returning('id');
      const [po] = await trx('purchase_orders').insert({ shop_id: f.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
      const [poLine] = await trx('purchase_order_line_items').insert({ shop_id: f.shopId, po_id: po.id,
        lasyncro_variant_id: f.variantId, description: 'F1 receipt', quantity_ordered: 1, quantity_received: 1 }).returning('id');
      const [job] = await trx('receive_jobs').insert({ shop_id: f.shopId, po_id: po.id, status: 'closed',
        total_variants: 1, total_units: 1 }).returning('receive_job_id');
      const [line] = await trx('receive_job_lines').insert({ shop_id: f.shopId, receive_job_id: job.receive_job_id,
        po_line_item_id: poLine.id, lasyncro_variant_id: f.variantId, quantity_expected: 1,
        quantity_accepted: 1, inspection_complete: true }).returning('receive_job_line_id');
      await trx('inventory_units').insert({ shop_id: f.shopId, lasyncro_variant_id: f.variantId,
        receive_job_line_id: line.receive_job_line_id, receive_sequence: 1, status: 'received',
        current_location_code: null, lasyncro_unit_id: 'LSU-' + crypto.randomUUID().slice(0, 12) });
      await trx('stow_tasks').insert({ shop_id: f.shopId, lasyncro_variant_id: f.variantId,
        receive_job_line_id: line.receive_job_line_id, po_id: po.id, quantity: 1, location_code: 'B',
        status: 'in_progress', trigger: 'inbound_stock', claimed_by: f.userId, claimed_at: trx.fn.now() });
    });
    await truth(f, 'ROOT', 1);

  }
  const attach = async (f: Fixture, trx: Knex.Transaction, operation: 'create' | 'reparent') => {
    await lockLocationHierarchy(trx, f.shopId);
    await assertLocationLifecycleEligible(trx, f.shopId, [operation === 'create' ? 'NEW-CHILD' : 'C'], operation !== 'create');
    await assertProspectiveParentStowEligible(trx, f.shopId, 'A');
    if (operation === 'create') return trx('warehouse_locations').insert({ shop_id: f.shopId,
      warehouse_id: f.warehouseId, location_code: 'NEW-CHILD', type: 'bin', parent_location_code: 'A', active: true });
    return trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'C' }).update({ parent_location_code: 'A' });
  };
  const assign = async (f: Fixture, trx: Knex.Transaction) => {
    await lockLocationHierarchy(trx, f.shopId);
    const task = await trx('stow_tasks').where({ shop_id: f.shopId }).forUpdate().first();
    await assertStowDestinationEligible(trx, f.shopId, 'A');
    return trx('stow_tasks').where({ shop_id: f.shopId, stow_task_id: task.stow_task_id }).update({ location_code: 'A' });
  };
  it.each(['create', 'reparent'] as const)('Stow assignment wins: %s rechecks the parent after waiting', async operation => {
    const f = await fixture();
    await seedTask(f);
    const before = await snapshot(f);
    const r = await overlap(f.shopId, trx => assign(f, trx), trx => attach(f, trx, operation));
    expect(r.first.error).toBeNull();
    expect(r.second.error?.message).toBe('LOCATION_LIFECYCLE_BLOCKED: stow');
    const after = await snapshot(f);
    expect(after.warehouse_locations).toEqual(before.warehouse_locations);
    expect(after.stow_tasks).toEqual((before.stow_tasks as any[]).map(t => ({ ...t, location_code: 'A' })));
    for (const table of ['inventory_truth', 'inventory_units', 'inventory_movements', 'pick_reservation_allocations',
      'pick_scan_unit_lineage', 'pick_scan_unit_settlement']) expect(after[table]).toEqual(before[table]);
  });
  it.each(['create', 'reparent'] as const)('Hierarchy %s wins: Stow assignment sees structural parent and rolls back', async operation => {
    const f = await fixture();
    await seedTask(f);
    const before = await snapshot(f);
    const r = await overlap(f.shopId, trx => attach(f, trx, operation), trx => assign(f, trx));
    expect(r.first.error).toBeNull();
    expect(r.second.error?.message).toBe('STOW_DESTINATION_STRUCTURAL');
    const after = await snapshot(f);
    expect((after.warehouse_locations as any[]).filter(l => l.parent_location_code === 'A').map(l => l.location_code))
      .toEqual([operation === 'create' ? 'NEW-CHILD' : 'C']);
    for (const table of ['stow_tasks', 'inventory_truth', 'inventory_units', 'inventory_movements',
      'pick_reservation_allocations', 'pick_scan_unit_lineage', 'pick_scan_unit_settlement']) expect(after[table]).toEqual(before[table]);
  });
  it.each(['create', 'reparent'] as const)('caller rollback of %s restores parent eligibility for waiting Stow', async operation => {
    const f = await fixture();
    await seedTask(f);
    const before = await snapshot(f);
    const r = await overlap(f.shopId, trx => attach(f, trx, operation), trx => assign(f, trx), true);
    expect(r.first.error?.message).toBe('S4A_TEST_ROLLBACK'); expect(r.second.error).toBeNull();
    const after = await snapshot(f);
    expect(after.warehouse_locations).toEqual(before.warehouse_locations);
    expect(after.stow_tasks).toEqual((before.stow_tasks as any[]).map(t => ({ ...t, location_code: 'A' })));
    for (const table of ['inventory_truth', 'inventory_units', 'inventory_movements', 'pick_reservation_allocations',
      'pick_scan_unit_lineage', 'pick_scan_unit_settlement']) expect(after[table]).toEqual(before[table]);
  });
});
