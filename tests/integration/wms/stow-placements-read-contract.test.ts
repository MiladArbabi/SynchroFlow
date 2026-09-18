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
