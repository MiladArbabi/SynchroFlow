// tests/integration/wms/stow-location-capacity-s1.test.ts
//
// SF-STOW-SAD-PATH-01 S1 — opt-in hard Stow capacity.
//
// Fixture: the real inbound Stow fixture from stow-placements-read-contract
// (GH-1305 S3A), no alternate stock writer. Runtime scenarios run as sf_app via
// withTenant. Migration 0230 up/down runs as the migration role inside an
// admin transaction that is ALWAYS rolled back (0228 safety-test precedent).

import crypto from 'crypto';
import knexLib, { Knex } from 'knex';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { issueTestToken } from '../../unit/helpers/auth';
import { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { claimStowTask, confirmStow } from 'api-src/services/wms/stow.service';
import { LocationCapacityExceededError } from 'api-src/services/wms/stowLocationCapacity.service';
import * as migration0230 from '../../../apps/backend/migrations/20261109120000_0230_add_enforce_location_capacity';

jest.setTimeout(180000);

const BIN = 'CAP-1';

async function createShopWithUser(prefix: string, role: 'operator' | 'owner' = 'operator') {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    // Provision WMS settings as shop bootstrap does; enforce_location_capacity
    // is left to its database default (false).
    await trx('shop_wms_settings')
      .insert({ shop_id: id, bootstrap_model: 'reconcile_opening_expectation_v2' })
      .onConflict('shop_id').ignore();
    return id;
  });
  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `${prefix}-${role}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Capacity',
        last_name: 'User',
        role,
      })
      .returning('id');
    const id = Number((row as any).id ?? row);
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: id, role });
    return id;
  });
  return { shopId, operatorId: userId };
}

/** Same shape as the GH-1305 S3A inbound fixture; the bin is created once per
 * shop so several tasks can compete for the same destination. */
async function seedTask(shopId: number, unitCount: number, binCode = BIN) {
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
    if (!(await trx('warehouse_locations').where({ shop_id: shopId, location_code: binCode }).first())) {
      await trx('warehouse_locations').insert({ shop_id: shopId, warehouse_id: wh.warehouse_id, location_code: binCode,
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
    const [task] = await trx('stow_tasks').insert({ shop_id: shopId, lasyncro_variant_id: variantId, receive_job_line_id: receiveJobLineId,
      quantity: unitCount, location_code: binCode, status: 'pending', trigger: 'inbound_stock', po_id: poId }).returning('stow_task_id');
    return { taskId: String((task as any).stow_task_id ?? task), variantId, lasyncroUnitIds };
  });
}

async function fixture(prefix: string, unitCount = 2) {
  const shop = await createShopWithUser(prefix);
  const work = await seedTask(shop.shopId, unitCount);
  await withTenant(shop.shopId, (trx) => claimStowTask(trx, work.taskId, shop.shopId, shop.operatorId));
  return { ...shop, ...work };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function configure(shopId: number, opts: { enforce?: boolean; max?: number | null; binCode?: string }) {
  await withTenant(shopId, async (trx) => {
    if (opts.enforce !== undefined) {
      const updated = await trx('shop_wms_settings').where({ shop_id: shopId }).update({ enforce_location_capacity: opts.enforce });
      expect(updated).toBe(1);
    }
    if (opts.max !== undefined) {
      await trx('warehouse_locations').where({ shop_id: shopId, location_code: opts.binCode ?? BIN }).update({ max_capacity: opts.max });
    }
  });
}

/** Physical stock already at the bin that carries no LSU (another variant). */
async function seedUnlabelledAtBin(shopId: number, onHand: number, reserved: number) {
  await withTenant(shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    await trx('products').insert({ lasyncro_product_id: productId, shop_id: shopId, title: 'Legacy', status: 'active', product_type: 'physical' });
    await trx('variants').insert({ lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shopId,
      sku: `LEG-${variantId.slice(0, 8)}`, title: 'Legacy variant', unit_cost: '1.00', status: 'active' });
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: BIN,
      on_hand_quantity: onHand, reserved_quantity: reserved, committed_quantity: 0,
      available_quantity: onHand - reserved, last_evaluated_at: new Date() });
  });
}

async function confirm(trx: Knex.Transaction, f: Fixture, index = 0, quantityPlaced = 1) {
  await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
  return confirmStow(trx, { stowTaskId: f.taskId, shopId: f.shopId, claimedBy: f.operatorId,
    quantityPlaced, lasyncroUnitId: f.lasyncroUnitIds[index] });
}

async function snapshot(shopId: number) {
  return withTenant(shopId, async (trx) => ({
    truth: await trx('inventory_truth').where({ shop_id: shopId }).orderBy(['location_code', 'lasyncro_variant_id']),
    units: await trx('inventory_units').where({ shop_id: shopId }).orderBy('lasyncro_unit_id'),
    movements: await trx('inventory_movements').where({ shop_id: shopId }).orderBy('lasyncro_inventory_movement_id'),
    tasks: await trx('stow_tasks').where({ shop_id: shopId }).orderBy('stow_task_id'),
    problems: await trx('problem_center_tasks').where({ shop_id: shopId }).orderBy('problem_task_id'),
  }));
}

const binOnHand = (s: Awaited<ReturnType<typeof snapshot>>) =>
  s.truth.filter((r) => r.location_code === BIN).reduce((n, r) => n + Number(r.on_hand_quantity), 0);

async function expectCapacityRejection(f: Fixture, index = 0, quantityPlaced = 1) {
  const before = await snapshot(f.shopId);
  const err = await withTenant(f.shopId, (trx) => confirm(trx, f, index, quantityPlaced)).then(() => null, (e) => e);
  expect(err).toBeInstanceOf(LocationCapacityExceededError);
  expect(err.code).toBe('LOCATION_CAPACITY_EXCEEDED');
  expect(err.locationCode).toBe(BIN);
  // Zero inventory, ledger, unit, task-progress or Problem Center mutation.
  expect(await snapshot(f.shopId)).toEqual(before);
}

describe('SF-STOW-SAD-PATH-01 S1 — opt-in hard Stow capacity', () => {
  it('1. default OFF preserves advisory behaviour, including the soft over-capacity Problem Center warning', async () => {
    const f = await fixture('cap-off');
    const setting = await withTenant(f.shopId, (trx) => trx('shop_wms_settings').where({ shop_id: f.shopId }).first('enforce_location_capacity'));
    expect(setting.enforce_location_capacity).toBe(false);
    await configure(f.shopId, { max: 1 });
    await withTenant(f.shopId, (trx) => confirm(trx, f, 0));
    await withTenant(f.shopId, (trx) => confirm(trx, f, 1));
    const after = await snapshot(f.shopId);
    expect(binOnHand(after)).toBe(2);
    expect(after.problems.filter((p) => p.exception_type === 'bin_over_capacity')).toHaveLength(1);
  });

  it('2. ON allows placement below and exactly at capacity', async () => {
    const f = await fixture('cap-at');
    await configure(f.shopId, { enforce: true, max: 2 });
    await withTenant(f.shopId, (trx) => confirm(trx, f, 0));
    await withTenant(f.shopId, (trx) => confirm(trx, f, 1));
    const after = await snapshot(f.shopId);
    expect(binOnHand(after)).toBe(2);
    expect(after.tasks[0].status).toBe('completed');
    expect(after.problems).toHaveLength(0);
  });

  it('1b. ON: SUM(on_hand) is the sole authority — no legacy unit-count over-capacity warning on an accepted placement', async () => {
    const f = await fixture('cap-on-no-legacy');
    await configure(f.shopId, { max: 1 });
    await withTenant(f.shopId, (trx) => confirm(trx, f, 0));
    // Diverge the two measures: one stowed unit remains, truth at the bin reads 0.
    await withTenant(f.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await trx('inventory_truth').where({ shop_id: f.shopId, location_code: BIN }).update({ on_hand_quantity: 0, available_quantity: 0 });
    });
    await configure(f.shopId, { enforce: true });
    // SUM 0 + 1 <= 1 → accepted; 2 stowed units > 1 would have raised the legacy warning.
    await withTenant(f.shopId, (trx) => confirm(trx, f, 1));
    const after = await snapshot(f.shopId);
    expect(after.units.filter((u) => u.status === 'stowed' && u.current_location_code === BIN)).toHaveLength(2);
    expect(after.problems.filter((p) => p.exception_type === 'bin_over_capacity')).toHaveLength(0);
  });

  it('3/11. ON rejects a placement exceeding capacity with zero mutations and no soft warning', async () => {
    const f = await fixture('cap-over');
    await configure(f.shopId, { enforce: true, max: 1 });
    await withTenant(f.shopId, (trx) => confirm(trx, f, 0));
    await expectCapacityRejection(f, 1);
    const after = await snapshot(f.shopId);
    expect(after.problems).toHaveLength(0);
    expect(after.tasks[0]).toMatchObject({ status: 'in_progress', quantity_placed: 1, location_code: BIN });
  });

  it('4. unlabelled and reserved physical stock counts toward occupancy', async () => {
    const f = await fixture('cap-unlabelled');
    await seedUnlabelledAtBin(f.shopId, 2, 2); // fully reserved, no LSUs
    await configure(f.shopId, { enforce: true, max: 2 });
    await expectCapacityRejection(f, 0);
  });

  it('5. NULL capacity is unlimited when enforcement is ON', async () => {
    const f = await fixture('cap-null');
    await seedUnlabelledAtBin(f.shopId, 50, 0);
    await configure(f.shopId, { enforce: true, max: null });
    await withTenant(f.shopId, (trx) => confirm(trx, f, 0));
    await withTenant(f.shopId, (trx) => confirm(trx, f, 1));
    expect(binOnHand(await snapshot(f.shopId))).toBe(52);
  });

  it('6. an already-over-capacity location rejects any additional placement', async () => {
    const f = await fixture('cap-already-over');
    await seedUnlabelledAtBin(f.shopId, 3, 0);
    await configure(f.shopId, { enforce: true, max: 1 });
    await expectCapacityRejection(f, 0);
  });

  it('7. partial placements are checked by the quantity actually placed, not the task total', async () => {
    const f = await fixture('cap-partial', 3);
    // Task total (3) exceeds capacity (2): a total-based check would refuse the first unit.
    await configure(f.shopId, { enforce: true, max: 2 });
    await withTenant(f.shopId, (trx) => confirm(trx, f, 0));
    await withTenant(f.shopId, (trx) => confirm(trx, f, 1));
    await expectCapacityRejection(f, 2);
    const after = await snapshot(f.shopId);
    expect(after.tasks[0]).toMatchObject({ status: 'in_progress', quantity_placed: 2 });
    expect(binOnHand(after)).toBe(2);
  });

  it('8. concurrent confirmations competing for the final slot cannot both succeed', async () => {
    const shop = await createShopWithUser('cap-race');
    const a = await seedTask(shop.shopId, 1);
    const b = await seedTask(shop.shopId, 1);
    for (const t of [a, b]) await withTenant(shop.shopId, (trx) => claimStowTask(trx, t.taskId, shop.shopId, shop.operatorId));
    await configure(shop.shopId, { enforce: true, max: 1 });
    const fa = { ...shop, ...a };
    const fb = { ...shop, ...b };
    const outcomes = await Promise.allSettled([
      withTenant(shop.shopId, (trx) => confirm(trx, fa, 0)),
      withTenant(shop.shopId, (trx) => confirm(trx, fb, 0)),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(LocationCapacityExceededError);
    const after = await snapshot(shop.shopId);
    expect(binOnHand(after)).toBe(1);
    expect(after.units.filter((u) => u.status === 'stowed')).toHaveLength(1);
    // Conservation: the loser's unit and root stock are untouched.
    expect(after.truth.reduce((n, r) => n + Number(r.on_hand_quantity), 0)).toBe(2);
  });

  // 9. receive_recovery: proven with a real held unit in
  // receive-held-recovery-stow-s4-5-i3.test.ts — CAP1 (OFF, advisory warning
  // kept) and CAP2 (ON: success within the limit; 409 with zero custody,
  // truth, ledger, Stow or task mutation). A recovery Stow's trigger is
  // immutable (RECEIVE_RECOVERY_STOW_IMMUTABLE), so it is not simulated here.

  it('10. a same-source/destination re-stow keeps its own error, not a capacity error', async () => {
    const f = await fixture('cap-same');
    await seedUnlabelledAtBin(f.shopId, 5, 0);
    await configure(f.shopId, { enforce: true, max: 1 });
    await withTenant(f.shopId, async (trx) => {
      const [problem] = await trx('problem_center_tasks').insert({ shop_id: f.shopId, status: 'open', source: 'stow',
        lasyncro_variant_id: f.variantId, quantity: 1, exception_type: 'bin_over_capacity', problem_bin_location: BIN,
        notes: 'S1 same-location fixture' }).returning('problem_task_id');
      await trx('stow_tasks').where({ shop_id: f.shopId, stow_task_id: f.taskId })
        .update({ trigger: 'problem_center', source_task_id: (problem as any).problem_task_id ?? problem });
    });
    const before = await snapshot(f.shopId);
    await expect(withTenant(f.shopId, (trx) => confirm(trx, f, 0))).rejects.toThrow('Re-stow source and destination must differ');
    expect(await snapshot(f.shopId)).toEqual(before);
  });

  it('13. GH-1305 eligibility still precedes capacity: a structural destination reports STOW_DESTINATION_STRUCTURAL', async () => {
    const f = await fixture('cap-structural');
    await configure(f.shopId, { enforce: true, max: 0 });
    await withTenant(f.shopId, async (trx) => {
      const parent = await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: BIN }).first();
      await trx('warehouse_locations').insert({ shop_id: f.shopId, warehouse_id: parent.warehouse_id,
        location_code: `${BIN}-P1`, parent_location_code: BIN, type: 'bin', zone_type: 'pick', active: true });
    });
    await expect(withTenant(f.shopId, (trx) => confirm(trx, f, 0))).rejects.toThrow('STOW_DESTINATION_STRUCTURAL');
  });
});

describe('SF-STOW-SAD-PATH-01 S1 — API: 409 mapping and settings', () => {
  async function tokenFor(shopId: number, userId: number, roles: string[]) {
    await withTenant(shopId, async (trx) => {
      await trx('user_lifecycle_snapshot').insert({ shop_id: shopId, user_id: userId, phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID() })
        .onConflict().ignore();
      if (!(await trx('shop_subscriptions').where({ shop_id: shopId }).first())) {
        await trx('shop_subscriptions').insert({ shop_id: shopId, tier: 'growth', allow_overage: true, billing_provider: 'stripe', stripe_customer_id: null });
      }
    });
    process.env.JWT_SECRET ||= 'test_jwt_secret';
    return issueTestToken({ shopId, userId, tier: 'growth', roles });
  }

  it('confirm maps capacity rejection to 409 LOCATION_CAPACITY_EXCEEDED with the operator message', async () => {
    const f = await fixture('cap-api');
    await configure(f.shopId, { enforce: true, max: 0 });
    const token = await tokenFor(f.shopId, f.operatorId, ['operator']);
    const before = await snapshot(f.shopId);
    const res = await request(createApp()).post(`/api/v1/wms/stow-tasks/${f.taskId}/confirm`)
      .set('Authorization', `Bearer ${token}`).send({ quantity_placed: 1, lasyncro_unit_id: f.lasyncroUnitIds[0] });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'LOCATION_CAPACITY_EXCEEDED', code: 'LOCATION_CAPACITY_EXCEEDED',
      location_code: BIN, message: `Location ${BIN} is full. Scan another storage location.` });
    expect(await snapshot(f.shopId)).toEqual(before);
  });

  it('12. settings: owner reads and updates; non-boolean rejected; operator forbidden; tenant-scoped', async () => {
    const owner = await createShopWithUser('cap-settings', 'owner');
    const other = await createShopWithUser('cap-settings-other', 'owner');
    const app = createApp();
    const ownerToken = await tokenFor(owner.shopId, owner.operatorId, ['owner']);

    const initial = await request(app).get('/api/v1/wms/settings').set('Authorization', `Bearer ${ownerToken}`);
    expect(initial.status).toBe(200);
    expect(initial.body.settings.enforce_location_capacity).toBe(false);

    for (const bad of ['true', 1, null, 'yes']) {
      const res = await request(app).patch('/api/v1/wms/settings').set('Authorization', `Bearer ${ownerToken}`).send({ enforce_location_capacity: bad });
      expect(res.status).toBe(400);
    }

    const on = await request(app).patch('/api/v1/wms/settings').set('Authorization', `Bearer ${ownerToken}`).send({ enforce_location_capacity: true });
    expect(on.status).toBe(200);
    expect(on.body.settings.enforce_location_capacity).toBe(true);

    // Roles are resolved from shop_memberships, not the token, so the
    // forbidden check needs a distinct user with a real operator membership.
    const operatorUserId = await withTenant(owner.shopId, async (trx) => {
      const [row] = await trx('users').insert({ shop_id: owner.shopId,
        email: `cap-settings-operator-${crypto.randomBytes(6).toString('hex')}@test.example`,
        password_hash: 'not_a_real_hash', first_name: 'Capacity', last_name: 'Operator', role: 'operator' }).returning('id');
      const id = Number((row as any).id ?? row);
      await trx('shop_memberships').insert({ shop_id: owner.shopId, user_id: id, role: 'operator' });
      return id;
    });
    const operatorToken = await tokenFor(owner.shopId, operatorUserId, ['operator']);
    const forbidden = await request(app).patch('/api/v1/wms/settings').set('Authorization', `Bearer ${operatorToken}`).send({ enforce_location_capacity: false });
    expect(forbidden.status).toBe(403);

    // The other tenant is unaffected by this shop's change.
    const otherSetting = await withTenant(other.shopId, (trx) => trx('shop_wms_settings').where({ shop_id: other.shopId }).first('enforce_location_capacity'));
    expect(otherSetting.enforce_location_capacity).toBe(false);
    const own = await withTenant(owner.shopId, (trx) => trx('shop_wms_settings').where({ shop_id: owner.shopId }).first('enforce_location_capacity'));
    expect(own.enforce_location_capacity).toBe(true);
  });
});

describe('SF-STOW-SAD-PATH-01 S1 — migration 0230 (rolled back, disposable DB only)', () => {
  let admin: Knex;
  const SENTINEL = new Error('__rollback__');

  beforeAll(() => {
    if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(process.env.PGDATABASE ?? '')) {
      throw new Error('0230 migration test refuses a non-disposable PGDATABASE');
    }
    admin = knexLib({ client: 'pg', connection: { host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGMIGRATION_USER, password: process.env.PGMIGRATION_PASSWORD, database: process.env.PGDATABASE }, pool: { min: 0, max: 1 } });
  });
  afterAll(async () => { if (admin) await admin.destroy(); });

  const column = (trx: Knex.Transaction) => trx.raw(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'shop_wms_settings' AND column_name = 'enforce_location_capacity'`);

  it('head has NOT NULL DEFAULT false; DOWN removes it; UP restores it and existing rows read false', async () => {
    await createShopWithUser('cap-mig');
    let ran = false;
    await admin.transaction(async (trx) => {
      expect((await column(trx)).rows).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
      await migration0230.down(trx);
      expect((await column(trx)).rows).toEqual([]);
      await migration0230.up(trx);
      expect((await column(trx)).rows).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
      const { rows } = await trx.raw(`SELECT count(*)::int AS n FROM public.shop_wms_settings WHERE enforce_location_capacity IS DISTINCT FROM false`);
      expect(rows[0].n).toBe(0);
      ran = true;
      throw SENTINEL;
    }).catch((err) => { if (err !== SENTINEL) throw err; });
    expect(ran).toBe(true);
  });
});
