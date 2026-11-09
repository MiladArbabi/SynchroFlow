import type { Knex } from 'knex';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { issueTestToken } from '../../unit/helpers/auth';
import { assertStowDestinationEligible } from 'api-src/services/wms/stowDestinationEligibility.service';
import { suggestStowLocation } from 'api-src/services/wms/locationSuggestion.service';
// tests/integration/wms/stow-placements-read-contract.test.ts
//
// STOW-UX-SCAN-RAIL-01 — canonical placement read projection.
//
// getStowTaskPlacements (stow.service.ts) derives ONE logical placement
// event per successfully committed physical unit from existing canonical
// evidence (inventory_movements + inventory_units + users + variants +
// products) — no new activity table, no migration. This suite proves the
// projection is exact: correct count, no debit/credit duplication, no
// cross-task/cross-tenant leakage, and server-authoritative operator/LSU/
// timestamp.

import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  claimStowTask,
  confirmStow,
  getStowTaskPlacements,
} from 'api-src/services/wms/stow.service';

jest.setTimeout(180000);

async function createShopWithOperator(prefix: string) {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const operatorId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `${prefix}-op-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Placement',
        last_name: 'Operator',
        role: 'operator',
      })
      .returning('id');
    const id = Number((row as any).id ?? row);
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: id, role: 'operator' });
    return id;
  });

  return { shopId, operatorId, unique };
}

/** Seeds one warehouse/bin and one receive line with `unitCount` physical
 * units, all destined for a single stow task at `binCode`. */
async function seedReceiveLineAndTask(
  shopId: number,
  binCode: string,
  unitCount: number
) {
  return withTenant(shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Placement product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `PLC-${variantId.slice(0, 8)}`,
      title: 'Placement variant',
      unit_cost: '5.00',
      status: 'active',
    });
    // STOW-UX-SCAN-RAIL-01 fixture note: this helper may be called more than
    // once for the SAME shop (e.g. two tasks on two different bins) to prove
    // no cross-task leakage. warehouses_shop_root_unique and
    // warehouse_locations' location_code PK mean the shared warehouse root
    // must only be created once per shop — .onConflict().ignore() makes a
    // second call idempotent on that shared row while still inserting this
    // call's own new bin location.
    await trx('warehouses')
      .insert({
        warehouse_id: warehouseId,
        shop_id: shopId,
        name: `Placement warehouse ${crypto.randomUUID().slice(0, 8)}`,
        root_location_code: rootCode,
        is_default: true,
        active: true,
      })
      .onConflict(['shop_id', 'root_location_code'])
      .ignore();

    const existingWarehouse = await trx('warehouses')
      .where({ shop_id: shopId, root_location_code: rootCode })
      .first('warehouse_id');
    const resolvedWarehouseId = existingWarehouse?.warehouse_id ?? warehouseId;

    const existingRoot = await trx('warehouse_locations')
      .where({ shop_id: shopId, location_code: rootCode })
      .first('location_code');
    if (!existingRoot) {
      await trx('warehouse_locations').insert({
        shop_id: shopId,
        warehouse_id: resolvedWarehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      });
    }
    await trx('warehouse_locations').insert({
      shop_id: shopId,
      warehouse_id: resolvedWarehouseId,
      location_code: binCode,
      type: 'bin',
      parent_location_code: rootCode,
      active: true,
      zone_type: 'pick',
    });

    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shopId, name: `Placement supplier ${crypto.randomUUID().slice(0, 8)}`, active: true })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: (supplier as any).id ?? supplier, status: 'shipped' })
      .returning('id');
    const poId = String((po as any).id ?? po);
    const [poLine] = await trx('purchase_order_line_items')
      .insert({
        po_id: poId,
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        description: 'Placement PO line',
        quantity_ordered: unitCount,
        quantity_received: unitCount,
      })
      .returning('id');

    const [job] = await trx('receive_jobs')
      .insert({
        shop_id: shopId,
        po_id: poId,
        status: 'closed',
        total_variants: 1,
        total_units: unitCount,
      })
      .returning('receive_job_id');
    const receiveJobId = String((job as any).receive_job_id ?? job);
    const [line] = await trx('receive_job_lines')
      .insert({
        shop_id: shopId,
        receive_job_id: receiveJobId,
        po_line_item_id: (poLine as any).id ?? poLine,
        lasyncro_variant_id: variantId,
        quantity_expected: unitCount,
        quantity_accepted: unitCount,
        inspection_complete: true,
      })
      .returning('receive_job_line_id');
    const receiveJobLineId = String((line as any).receive_job_line_id ?? line);

    const lasyncroUnitIds: string[] = [];
    for (let i = 1; i <= unitCount; i++) {
      const lasyncroUnitId = `LSU-${crypto.randomUUID().slice(0, 12)}`;
      await trx('inventory_units').insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: receiveJobLineId,
        receive_sequence: i,
        status: 'received',
        current_location_code: null,
        lasyncro_unit_id: lasyncroUnitId,
      });
      lasyncroUnitIds.push(lasyncroUnitId);
    }

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        location_code: rootCode,
        on_hand_quantity: unitCount,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: unitCount,
        last_evaluated_at: new Date(),
      })
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
      .merge({ on_hand_quantity: unitCount, available_quantity: unitCount });

    const [task] = await trx('stow_tasks')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: receiveJobLineId,
        quantity: unitCount,
        location_code: binCode,
        status: 'pending',
        trigger: 'inbound_stock',
        po_id: poId,
      })
      .returning('stow_task_id');

    return {
      taskId: String((task as any).stow_task_id ?? task),
      variantId,
      receiveJobLineId,
      lasyncroUnitIds,
    };
  });
}

async function confirmUnit(
  shopId: number,
  taskId: string,
  operatorId: number,
  lasyncroUnitId: string
) {
  return withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    return confirmStow(trx, {
      stowTaskId: taskId,
      shopId,
      claimedBy: operatorId,
      quantityPlaced: 1,
      lasyncroUnitId,
    });
  });
}

describe('STOW-UX-SCAN-RAIL-01 — GET stow-tasks/:taskId/placements canonical projection', () => {
  it('one committed unit -> exactly one placement row with exact LSU, location, server operator, and timestamp', async () => {
    const { shopId, operatorId } = await createShopWithOperator('placements-single');
    const work = await seedReceiveLineAndTask(shopId, 'A-1', 1);

    await withTenant(shopId, (trx) => claimStowTask(trx, work.taskId, shopId, operatorId));
    const before = new Date();
    await confirmUnit(shopId, work.taskId, operatorId, work.lasyncroUnitIds[0]);
    const after = new Date();

    const placements = await withTenant(shopId, (trx) =>
      getStowTaskPlacements(trx, { shopId, stowTaskId: work.taskId })
    );

    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({
      lasyncro_unit_id: work.lasyncroUnitIds[0],
      lasyncro_variant_id: work.variantId,
      location_code: 'A-1',
      operator_id: operatorId,
      operator_name: 'Placement Operator',
    });
    const occurredAt = new Date(placements[0].occurred_at).getTime();
    expect(occurredAt).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(occurredAt).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('two committed units -> exactly two rows, oldest first, no debit/credit duplication', async () => {
    const { shopId, operatorId } = await createShopWithOperator('placements-two');
    const work = await seedReceiveLineAndTask(shopId, 'A-1', 2);

    await withTenant(shopId, (trx) => claimStowTask(trx, work.taskId, shopId, operatorId));
    await confirmUnit(shopId, work.taskId, operatorId, work.lasyncroUnitIds[0]);
    await confirmUnit(shopId, work.taskId, operatorId, work.lasyncroUnitIds[1]);

    const placements = await withTenant(shopId, (trx) =>
      getStowTaskPlacements(trx, { shopId, stowTaskId: work.taskId })
    );

    // Exactly one row per physical unit — the debit (ROOT, quantity_delta=-1)
    // leg of each transfer must never surface as a second UI event.
    expect(placements).toHaveLength(2);
    expect(placements.map((p) => p.lasyncro_unit_id)).toEqual([
      work.lasyncroUnitIds[0],
      work.lasyncroUnitIds[1],
    ]);
    expect(placements.every((p) => p.location_code === 'A-1')).toBe(true);
  });

  it('a different task on a different receive line does not leak into this task\'s placements', async () => {
    const { shopId, operatorId } = await createShopWithOperator('placements-leak');
    const taskA = await seedReceiveLineAndTask(shopId, 'A-1', 1);
    const taskB = await seedReceiveLineAndTask(shopId, 'B-1', 1);

    await withTenant(shopId, (trx) => claimStowTask(trx, taskA.taskId, shopId, operatorId));
    await confirmUnit(shopId, taskA.taskId, operatorId, taskA.lasyncroUnitIds[0]);

    await withTenant(shopId, (trx) => claimStowTask(trx, taskB.taskId, shopId, operatorId));
    await confirmUnit(shopId, taskB.taskId, operatorId, taskB.lasyncroUnitIds[0]);

    const placementsA = await withTenant(shopId, (trx) =>
      getStowTaskPlacements(trx, { shopId, stowTaskId: taskA.taskId })
    );

    expect(placementsA).toHaveLength(1);
    expect(placementsA[0].lasyncro_unit_id).toBe(taskA.lasyncroUnitIds[0]);
  });

  it('tenant isolation: a task from another shop is not visible', async () => {
    const shopA = await createShopWithOperator('placements-tenant-a');
    const shopB = await createShopWithOperator('placements-tenant-b');
    const workA = await seedReceiveLineAndTask(shopA.shopId, 'A-1', 1);

    await withTenant(shopA.shopId, (trx) =>
      claimStowTask(trx, workA.taskId, shopA.shopId, shopA.operatorId)
    );
    await confirmUnit(shopA.shopId, workA.taskId, shopA.operatorId, workA.lasyncroUnitIds[0]);

    await expect(
      withTenant(shopB.shopId, (trx) =>
        getStowTaskPlacements(trx, { shopId: shopB.shopId, stowTaskId: workA.taskId })
      )
    ).rejects.toThrow('[STOW_PLACEMENTS] TASK_NOT_FOUND');
  });
});


// GH-1305 S3A: reuse the real inbound fixture above; no alternate stock writer.
describe('GH1305 structural-parent Stow safety', () => {
  async function fixture() {
    const shop = await createShopWithOperator('structural-stow');
    const work = await seedReceiveLineAndTask(shop.shopId, 'RACK', 2);
    await withTenant(shop.shopId, trx => claimStowTask(trx, work.taskId, shop.shopId, shop.operatorId));
    return { ...shop, ...work };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function child(trx: Knex.Transaction, f: Fixture, active = true) {
    const parent = await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'RACK' }).first();
    // Direct SQL proves the database-owned hierarchy guard shares Stow's lock.
    await trx('warehouse_locations').insert({ shop_id: f.shopId, warehouse_id: parent.warehouse_id,
      location_code: 'POSITION', parent_location_code: 'RACK', type: 'bin', zone_type: 'pick', active });
  }
  async function snapshot(f: Fixture) {
    return withTenant(f.shopId, async trx => ({
      truth: await trx('inventory_truth').where({ shop_id: f.shopId }).orderBy('location_code'),
      units: await trx('inventory_units').where({ shop_id: f.shopId }).orderBy('lasyncro_unit_id'),
      movements: await trx('inventory_movements').where({ shop_id: f.shopId }).orderBy('lasyncro_inventory_movement_id'),
      tasks: await trx('stow_tasks').where({ shop_id: f.shopId }).orderBy('stow_task_id'),
      reservations: await trx('pick_reservation_allocations').where({ shop_id: f.shopId }).orderBy('allocation_id'),
    }));
  }
  async function confirm(trx: Knex.Transaction, f: Fixture, index = 0) {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    return confirmStow(trx, { stowTaskId: f.taskId, shopId: f.shopId, claimedBy: f.operatorId,
      quantityPlaced: 1, lasyncroUnitId: f.lasyncroUnitIds[index] });
  }
  async function api(f: Fixture) {
    await withTenant(f.shopId, async trx => {
      await trx('user_lifecycle_snapshot').insert({ shop_id: f.shopId, user_id: f.operatorId,
        phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID() });
      await trx('shop_subscriptions').insert({ shop_id: f.shopId, tier: 'growth', allow_overage: true,
        billing_provider: 'stripe', stripe_customer_id: null });
    });
    process.env.JWT_SECRET ||= 'test_jwt_secret';
    return issueTestToken({ shopId: f.shopId, userId: f.operatorId, tier: 'growth' });
  }

  it('uses restricted sf_app and keeps visual rack levels non-material for simple-rack placement', async () => {
    const f = await fixture();
    await withTenant(f.shopId, async trx => {
      const role = (await trx.raw('SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
      expect(role).toEqual({ role: 'sf_app', rolsuper: false, rolbypassrls: false });
      await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'RACK' }).update({ rack_levels: 9 });
      expect((await assertStowDestinationEligible(trx, f.shopId, 'RACK')).location_code).toBe('RACK');
    });
    await withTenant(f.shopId, trx => confirm(trx, f));
    expect((await snapshot(f)).units.find(u => u.lasyncro_unit_id === f.lasyncroUnitIds[0]))
      .toMatchObject({ status: 'stowed', current_location_code: 'RACK' });
  });

  it.each([true, false])('first configured child (active=%s) preserves stocked-parent truth and blocks the remaining sticky placement', async active => {
    const f = await fixture();
    await withTenant(f.shopId, trx => confirm(trx, f));
    await withTenant(f.shopId, trx => trx('inventory_truth').where({ shop_id: f.shopId, location_code: 'RACK' })
      .update({ reserved_quantity: 1, available_quantity: 0 }));
    const before = await snapshot(f);
    await withTenant(f.shopId, trx => child(trx, f, active));
    expect(await snapshot(f)).toEqual(before);
    await expect(withTenant(f.shopId, trx => confirm(trx, f, 1))).rejects.toThrow('STOW_DESTINATION_STRUCTURAL');
    expect(await snapshot(f)).toEqual(before);
  });

  it.each(['inbound_stock', 'return_restock', 'problem_center', 'order_cancelled_mid_pick'])
    ('rejects a preassigned structural destination before any %s branch mutates inventory', async trigger => {
      const f = await fixture();
      await withTenant(f.shopId, async trx => {
        await child(trx, f, false);
        await trx('stow_tasks').where({ shop_id: f.shopId, stow_task_id: f.taskId }).update({ trigger });
      });
      const before = await snapshot(f);
      await expect(withTenant(f.shopId, trx => confirm(trx, f))).rejects.toThrow('STOW_DESTINATION_STRUCTURAL');
      expect(await snapshot(f)).toEqual(before);
    });

  it.each(['inactive', 'structural'])('rejects %s assignment, including same-location idempotent requests, and confirmation with stable API errors', async state => {
    const f = await fixture();
    const token = await api(f);
    await withTenant(f.shopId, async trx => {
      if (state === 'structural') await child(trx, f);
      else await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'RACK' }).update({ active: false });
    });
    const before = await snapshot(f);
    const app = createApp();
    const code = state === 'structural' ? 'STOW_DESTINATION_STRUCTURAL' : 'STOW_DESTINATION_INACTIVE';
    const assigned = await request(app).patch(`/api/v1/wms/stow-tasks/${f.taskId}/location`)
      .set('Authorization', `Bearer ${token}`).send({ location_code: 'RACK' });
    expect(assigned.status).toBe(409);
    expect(assigned.body.code).toBe(code);
    const confirmed = await request(app).post(`/api/v1/wms/stow-tasks/${f.taskId}/confirm`)
      .set('Authorization', `Bearer ${token}`).send({ quantity_placed: 1, lasyncro_unit_id: f.lasyncroUnitIds[0] });
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.code).toBe(code);
    expect(await snapshot(f)).toEqual(before);
  });

  it('does not suggest stocked parents with inactive children, and refuses a saved suggestion at confirmation', async () => {
    const f = await fixture();
    await withTenant(f.shopId, trx => confirm(trx, f));
    await withTenant(f.shopId, trx => child(trx, f, false));
    const suggested = await withTenant(f.shopId, trx => suggestStowLocation(trx, { shopId: f.shopId, lasyncroVariantId: f.variantId }));
    expect(suggested).toBeNull();
    await expect(withTenant(f.shopId, trx => confirm(trx, f, 1))).rejects.toThrow('STOW_DESTINATION_STRUCTURAL');
  });

  it('does not resolve another tenant destination and rolls back a valid placement when its transaction fails', async () => {
    const f = await fixture();
    const foreign = await fixture();
    await withTenant(foreign.shopId, trx => child(trx, foreign));
    await expect(withTenant(f.shopId, trx => assertStowDestinationEligible(trx, f.shopId, 'POSITION')))
      .rejects.toThrow('STOW_DESTINATION_NOT_FOUND');
    const before = await snapshot(f);
    await expect(withTenant(f.shopId, async trx => { await confirm(trx, f); throw new Error('ROLLBACK_PROOF'); }))
      .rejects.toThrow('ROLLBACK_PROOF');
    expect(await snapshot(f)).toEqual(before);
  });

  it('refuses repeatable-read snapshots before placement instead of relying on stale hierarchy reads', async () => {
    const f = await fixture();
    const before = await snapshot(f);
    await expect(withTenant(f.shopId, trx => confirm(trx, f), { isolationLevel: 'repeatable read' }))
      .rejects.toThrow('STOW_DESTINATION_ISOLATION_UNSUPPORTED');
    expect(await snapshot(f)).toEqual(before);
  });

  it.each(['child-first', 'stow-first'])('serializes real overlapping transactions: %s', async order => {
    const f = await fixture();
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>(r => { release = r; });
    const started = new Promise<void>(r => { ready = r; });
    const before = await snapshot(f);
    const sourceCode = `WH-${f.shopId}-ROOT`;
    const quantities = (state: Awaited<ReturnType<typeof snapshot>>) => state.truth.map(row => ({
      location_code: row.location_code,
      on_hand_quantity: Number(row.on_hand_quantity),
      available_quantity: Number(row.available_quantity),
      reserved_quantity: Number(row.reserved_quantity),
      committed_quantity: Number(row.committed_quantity),
    }));
    const totalInventory = (state: Awaited<ReturnType<typeof snapshot>>) =>
      state.truth.reduce((sum, row) => sum + Number(row.on_hand_quantity), 0);
    // The destination has no truth row yet; both physical units start at root.
    expect(quantities(before)).toEqual([{
      location_code: sourceCode, on_hand_quantity: 2, available_quantity: 2,
      reserved_quantity: 0, committed_quantity: 0,
    }]);
    expect(totalInventory(before)).toBe(2);
    const first = withTenant(f.shopId, async trx => {
      if (order === 'child-first') await child(trx, f);
      else await confirm(trx, f);
      ready();
      await held;
    });
    // Attach rejection handling immediately, also unblocking setup failures.
    const firstOutcome = first.then(() => null, error => { ready(); return error; });
    await started;
    let pid!: number;
    let entering!: () => void;
    const entered = new Promise<void>(r => { entering = r; });
    const second = withTenant(f.shopId, async trx => {
      pid = (await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      entering();
      if (order === 'child-first') return confirm(trx, f);
      return child(trx, f);
    }).then(() => null, error => error);
    try {
      await entered;
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (!waiting && Date.now() < deadline) {
        waiting = await withTenant(f.shopId, async trx => (await trx.raw(
          "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = ? AND locktype = 'advisory' AND NOT granted) AS waiting", [pid])).rows[0].waiting);
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      expect(await firstOutcome).toBeNull();
    }
    const secondError = await second;
    if (order === 'child-first') {
      expect(secondError?.message).toContain('STOW_DESTINATION_STRUCTURAL');
      expect(await snapshot(f)).toEqual(before);
    } else {
      expect(secondError).toBeNull();
      const after = await snapshot(f);
      expect(after.units.find(u => u.lasyncro_unit_id === f.lasyncroUnitIds[0]))
        .toMatchObject({ status: 'stowed', current_location_code: 'RACK' });
      expect(after.movements.length - before.movements.length).toBe(2);
      expect(quantities(after)).toEqual([
        { location_code: 'RACK', on_hand_quantity: 1, available_quantity: 1,
          reserved_quantity: 0, committed_quantity: 0 },
        { location_code: sourceCode, on_hand_quantity: 1, available_quantity: 1,
          reserved_quantity: 0, committed_quantity: 0 },
      ]);
      expect(totalInventory(after)).toBe(totalInventory(before));
      const previousMovementIds = new Set(before.movements.map(row => row.lasyncro_inventory_movement_id));
      expect(after.movements.filter(row => previousMovementIds.has(row.lasyncro_inventory_movement_id)))
        .toEqual(before.movements);
      const unit = before.units.find(row => row.lasyncro_unit_id === f.lasyncroUnitIds[0]);
      const newLegs = after.movements
        .filter(row => !previousMovementIds.has(row.lasyncro_inventory_movement_id))
        .map(row => ({ location_code: row.location_code, quantity_delta: Number(row.quantity_delta),
          shop_id: row.shop_id, lasyncro_variant_id: row.lasyncro_variant_id,
          movement_type: row.movement_type, reference_type: row.reference_type,
          reference_id: row.reference_id, triggered_by: row.triggered_by }))
        .sort((a, b) => a.quantity_delta - b.quantity_delta);
      const identity = { shop_id: f.shopId, lasyncro_variant_id: f.variantId,
        movement_type: 'location_transfer', reference_type: 'inventory_unit',
        reference_id: unit.id, triggered_by: 'stow' };
      expect(newLegs).toEqual([
        { ...identity, location_code: sourceCode, quantity_delta: -1 },
        { ...identity, location_code: 'RACK', quantity_delta: 1 },
      ]);
      expect(newLegs.reduce((sum, row) => sum + row.quantity_delta, 0)).toBe(0);
      expect(after.units.find(row => row.lasyncro_unit_id === f.lasyncroUnitIds[1]))
        .toEqual(before.units.find(row => row.lasyncro_unit_id === f.lasyncroUnitIds[1]));
      expect(after.reservations).toEqual(before.reservations);
    }
    // Parent stock committed before child configuration remains exactly where
    // it was. Refusing the remaining unit must not alter truth, units or ledger.
    const beforeRefusal = await snapshot(f);
    await expect(withTenant(f.shopId, trx => confirm(trx, f, 1))).rejects.toThrow('STOW_DESTINATION_STRUCTURAL');
    const afterRefusal = await snapshot(f);
    expect(afterRefusal).toEqual(beforeRefusal);
    expect(totalInventory(afterRefusal)).toBe(totalInventory(before));
  });
});
