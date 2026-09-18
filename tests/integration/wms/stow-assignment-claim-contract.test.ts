import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { confirmStow } from 'api-src/services/wms/stow.service';
import {
  assignStowTask,
  claimStowTask,
} from 'api-src/services/wms/stow.service';
import {
  httpAssignStowLocation,
} from 'api-src/api/wms/wms.controller';
import { getStowTaskPlacements } from 'api-src/services/wms/stow.service';
import fs from 'fs';
import path from 'path';

jest.setTimeout(180000);

async function createUser(
  shopId: number,
  unique: string,
  label: string,
  role: 'owner' | 'operator'
): Promise<number> {
  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `stow-assign-${label}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: label,
        role,
      })
      .returning('id');

    return Number((row as any).id ?? row);
  });

  await withTenant(shopId, (trx) =>
    trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role,
      revoked_at: null,
    })
  );

  return userId;
}

async function createFixture() {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `stow-assign-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const ownerId = await createUser(shopId, unique, 'owner', 'owner');
  const operatorAId = await createUser(shopId, unique, 'operator-a', 'operator');
  const operatorBId = await createUser(shopId, unique, 'operator-b', 'operator');

  return {
    shopId,
    ownerId,
    operatorAId,
    operatorBId,
  };
}

async function seedStowWork(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  options: { assignedOperatorId?: number | null; locationCode?: string | null } = {}
) {
  return withTenant(fixture.shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${fixture.shopId}-ROOT`;
    const binCode = 'A-1';
    const alternateBinCode = 'B-1';

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: fixture.shopId,
      title: 'Stow assignment product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: fixture.shopId,
      sku: `SA-${variantId.slice(0, 8)}`,
      title: 'Stow assignment variant',
      unit_cost: '5.00',
      status: 'active',
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: fixture.shopId,
      name: `Stow assignment warehouse ${crypto.randomUUID().slice(0, 8)}`,
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      {
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: binCode,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: alternateBinCode,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    const [supplier] = await trx('suppliers')
      .insert({ shop_id: fixture.shopId, name: 'Stow assignment supplier', active: true })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: fixture.shopId, supplier_id: (supplier as any).id ?? supplier, status: 'shipped' })
      .returning('id');
    const poId = String((po as any).id ?? po);
    const [poLine] = await trx('purchase_order_line_items')
      .insert({
        po_id: poId,
        shop_id: fixture.shopId,
        lasyncro_variant_id: variantId,
        description: 'Stow assignment PO line',
        quantity_ordered: 2,
        quantity_received: 2,
      })
      .returning('id');

    async function receiveLine(sequence: number) {
      const [job] = await trx('receive_jobs')
        .insert({
          shop_id: fixture.shopId,
          po_id: poId,
          status: 'closed',
          total_variants: 1,
          total_units: 1,
        })
        .returning('receive_job_id');
      const receiveJobId = String((job as any).receive_job_id ?? job);
      const [line] = await trx('receive_job_lines')
        .insert({
          shop_id: fixture.shopId,
          receive_job_id: receiveJobId,
          po_line_item_id: (poLine as any).id ?? poLine,
          lasyncro_variant_id: variantId,
          quantity_expected: 1,
          quantity_accepted: 1,
          inspection_complete: true,
        })
        .returning('receive_job_line_id');
      const receiveJobLineId = String((line as any).receive_job_line_id ?? line);
      const lasyncroUnitId = `LSU-${crypto.randomUUID().slice(0, 12)}`;
      await trx('inventory_units').insert({
        shop_id: fixture.shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: receiveJobLineId,
        receive_sequence: sequence,
        status: 'received',
        current_location_code: null,
        lasyncro_unit_id: lasyncroUnitId,
      });
      return { receiveJobLineId, lasyncroUnitId };
    }

    const lineA = await receiveLine(1);
    const lineB = await receiveLine(1);

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({
      shop_id: fixture.shopId,
      lasyncro_variant_id: variantId,
      location_code: rootCode,
      on_hand_quantity: 2,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: 2,
      last_evaluated_at: new Date(),
    });

    const [task] = await trx('stow_tasks')
      .insert({
        shop_id: fixture.shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: lineA.receiveJobLineId,
        quantity: 1,
        location_code: options.locationCode === undefined ? binCode : options.locationCode,
        status: 'pending',
        trigger: 'inbound_stock',
        po_id: poId,
        assigned_operator_id: options.assignedOperatorId ?? null,
      })
      .returning('stow_task_id');

    return {
      taskId: String((task as any).stow_task_id ?? task),
      variantId,
      binCode,
      alternateBinCode,
      lineA,
      lineB,
    };
  });
}

// STOW-ACTIVE-LOCATION-01 — a single Receive line carrying TWO physical
// units, so a task can legitimately span two active destinations (one unit
// committed before a switch, one after) as required by the multi-bin
// physical contract.
async function seedMultiUnitStowWork(
  fixture: Awaited<ReturnType<typeof createFixture>>
) {
  return withTenant(fixture.shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${fixture.shopId}-ROOT`;
    const binA = 'MB-A-1';
    const binB = 'MB-B-4';

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: fixture.shopId,
      title: 'Multi-bin stow product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: fixture.shopId,
      sku: `MB-${variantId.slice(0, 8)}`,
      title: 'Multi-bin stow variant',
      unit_cost: '5.00',
      status: 'active',
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: fixture.shopId,
      name: `Multi-bin warehouse ${crypto.randomUUID().slice(0, 8)}`,
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      {
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: binA,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: binB,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    const [supplier] = await trx('suppliers')
      .insert({ shop_id: fixture.shopId, name: 'Multi-bin supplier', active: true })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: fixture.shopId, supplier_id: (supplier as any).id ?? supplier, status: 'shipped' })
      .returning('id');
    const poId = String((po as any).id ?? po);
    const [poLine] = await trx('purchase_order_line_items')
      .insert({
        po_id: poId,
        shop_id: fixture.shopId,
        lasyncro_variant_id: variantId,
        description: 'Multi-bin PO line',
        quantity_ordered: 2,
        quantity_received: 2,
      })
      .returning('id');

    const [job] = await trx('receive_jobs')
      .insert({
        shop_id: fixture.shopId,
        po_id: poId,
        status: 'closed',
        total_variants: 1,
        total_units: 2,
      })
      .returning('receive_job_id');
    const receiveJobId = String((job as any).receive_job_id ?? job);
    const [line] = await trx('receive_job_lines')
      .insert({
        shop_id: fixture.shopId,
        receive_job_id: receiveJobId,
        po_line_item_id: (poLine as any).id ?? poLine,
        lasyncro_variant_id: variantId,
        quantity_expected: 2,
        quantity_accepted: 2,
        inspection_complete: true,
      })
      .returning('receive_job_line_id');
    const receiveJobLineId = String((line as any).receive_job_line_id ?? line);

    const lsuA = `LSU-${crypto.randomUUID().slice(0, 12)}`;
    const lsuB = `LSU-${crypto.randomUUID().slice(0, 12)}`;
    await trx('inventory_units').insert([
      {
        shop_id: fixture.shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: receiveJobLineId,
        receive_sequence: 1,
        status: 'received',
        current_location_code: null,
        lasyncro_unit_id: lsuA,
      },
      {
        shop_id: fixture.shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: receiveJobLineId,
        receive_sequence: 2,
        status: 'received',
        current_location_code: null,
        lasyncro_unit_id: lsuB,
      },
    ]);

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({
      shop_id: fixture.shopId,
      lasyncro_variant_id: variantId,
      location_code: rootCode,
      on_hand_quantity: 2,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: 2,
      last_evaluated_at: new Date(),
    });

    const [task] = await trx('stow_tasks')
      .insert({
        shop_id: fixture.shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: receiveJobLineId,
        quantity: 2,
        location_code: binA,
        status: 'pending',
        trigger: 'inbound_stock',
        po_id: poId,
      })
      .returning('stow_task_id');

    return {
      taskId: String((task as any).stow_task_id ?? task),
      variantId,
      receiveJobLineId,
      binA,
      binB,
      lsuA,
      lsuB,
    };
  });
}

// STOW-ACTIVE-LOCATION-01 — a problem_center re-stow fixture, needed to
// prove the existing source != destination guard is preserved unweakened
// now that the destination is mutable mid-task.
async function seedRestowWork(
  fixture: Awaited<ReturnType<typeof createFixture>>
) {
  return withTenant(fixture.shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${fixture.shopId}-ROOT`;
    const problemBin = 'RS-PROBLEM-1';

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: fixture.shopId,
      title: 'Re-stow product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: fixture.shopId,
      sku: `RS-${variantId.slice(0, 8)}`,
      title: 'Re-stow variant',
      unit_cost: '5.00',
      status: 'active',
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: fixture.shopId,
      name: `Re-stow warehouse ${crypto.randomUUID().slice(0, 8)}`,
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      {
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: problemBin,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    const [problemTask] = await trx('problem_center_tasks')
      .insert({
        shop_id: fixture.shopId,
        status: 'open',
        source: 'stow',
        lasyncro_variant_id: variantId,
        quantity: 1,
        exception_type: 'bin_over_capacity',
        problem_bin_location: problemBin,
      })
      .returning('problem_task_id');
    const problemTaskId = String((problemTask as any).problem_task_id ?? problemTask);

    const [task] = await trx('stow_tasks')
      .insert({
        shop_id: fixture.shopId,
        lasyncro_variant_id: variantId,
        quantity: 1,
        location_code: problemBin,
        status: 'pending',
        trigger: 'problem_center',
        source_task_id: problemTaskId,
        assigned_operator_id: fixture.operatorAId,
      })
      .returning('stow_task_id');

    return {
      taskId: String((task as any).stow_task_id ?? task),
      variantId,
      problemBin,
    };
  });
}

async function taskRow(shopId: number, taskId: string) {
  return withTenant(shopId, (trx) =>
    trx('stow_tasks')
      .where({ shop_id: shopId, stow_task_id: taskId })
      .first('status', 'assigned_operator_id', 'claimed_by', 'claimed_at', 'location_code')
  );
}

async function assignLocationDirect(
  shopId: number,
  taskId: string,
  locationCode: string,
  userId: number
) {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  await httpAssignStowLocation(
    {
      user: { shopId, userId },
      params: { taskId },
      body: { location_code: locationCode },
    } as any,
    res
  );

  return res;
}

async function stowSnapshot(shopId: number, variantId: string, taskId: string, unitId: string) {
  return withTenant(shopId, async (trx) => ({
    task: await trx('stow_tasks')
      .where({ shop_id: shopId, stow_task_id: taskId })
      .first('status', 'quantity_placed', 'claimed_by'),
    unit: await trx('inventory_units')
      .where({ shop_id: shopId, lasyncro_unit_id: unitId })
      .first('status', 'current_location_code'),
    movements: await trx('inventory_movements')
      .where({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        movement_type: 'location_transfer',
      })
      .orderBy('quantity_delta')
      .select('quantity_delta', 'location_code'),
    truth: await trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId })
      .orderBy('location_code')
      .select('location_code', 'on_hand_quantity', 'available_quantity'),
  }));
}

describe('STOW-LIFECYCLE-02 — first-one-to-claim + optional owner/admin assignment', () => {
  it('schema exposes assigned_operator_id with FK and tenant-scoped index', async () => {
    const schema = await systemTransaction(async (trx) => {
      const column = await trx.raw(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'stow_tasks'
          AND column_name = 'assigned_operator_id'
      `);
      const fk = await trx.raw(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.stow_tasks'::regclass
          AND conname = 'stow_tasks_assigned_operator_fk'
      `);
      const index = await trx.raw(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'stow_tasks'
          AND indexname = 'stow_tasks_shop_assigned_operator_idx'
      `);
      return {
        columns: column.rows,
        fks: fk.rows,
        indexes: index.rows,
      };
    });

    expect(schema.columns).toHaveLength(1);
    expect(schema.fks).toHaveLength(1);
    expect(schema.indexes).toHaveLength(1);
  });

  // C.1
  it('pending unassigned task can be claimed by operator A (first one to claim)', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture);

    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );

    const row = await taskRow(fixture.shopId, work.taskId);
    expect(row).toMatchObject({
      status: 'in_progress',
      assigned_operator_id: null,
      claimed_by: fixture.operatorAId,
    });
    expect(row?.claimed_at).toBeTruthy();
  });

  // C.2
  it('first-one-to-claim concurrency: A and B race on the same unassigned pending task; exactly one wins', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture);

    const [claimA, claimB] = await Promise.allSettled([
      withTenant(fixture.shopId, (trx) =>
        claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
      ),
      withTenant(fixture.shopId, (trx) =>
        claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorBId)
      ),
    ]);

    const outcomes = [claimA.status, claimB.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);

    const row = await taskRow(fixture.shopId, work.taskId);
    expect(row?.status).toBe('in_progress');
    expect([fixture.operatorAId, fixture.operatorBId]).toContain(row?.claimed_by);

    // No ownership overwrite: the winner recorded above is the sole owner.
    const winnerId = claimA.status === 'fulfilled' ? fixture.operatorAId : fixture.operatorBId;
    expect(row?.claimed_by).toBe(winnerId);
  });

  // C.5, C.6, C.7 — folded: one continuous pending-task lifecycle
  // (assign -> idempotent reassign -> reassign -> return to pool -> claim).
  it('assigns, idempotently reassigns, reassigns before claim, returns to shared pool, and lets an eligible operator then claim', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture);

    const assignA = await withTenant(fixture.shopId, (trx) =>
      assignStowTask(trx, {
        stowTaskId: work.taskId,
        shopId: fixture.shopId,
        assignedOperatorId: fixture.operatorAId,
        assignedBy: fixture.ownerId,
      })
    );
    expect(assignA.assigned_operator_id).toBe(fixture.operatorAId);

    const assignAAgain = await withTenant(fixture.shopId, (trx) =>
      assignStowTask(trx, {
        stowTaskId: work.taskId,
        shopId: fixture.shopId,
        assignedOperatorId: fixture.operatorAId,
        assignedBy: fixture.ownerId,
      })
    );
    expect(assignAAgain.status).toBe('pending');

    const assignB = await withTenant(fixture.shopId, (trx) =>
      assignStowTask(trx, {
        stowTaskId: work.taskId,
        shopId: fixture.shopId,
        assignedOperatorId: fixture.operatorBId,
        assignedBy: fixture.ownerId,
      })
    );
    expect(assignB.assigned_operator_id).toBe(fixture.operatorBId);

    const row = await taskRow(fixture.shopId, work.taskId);
    expect(row).toMatchObject({
      status: 'pending',
      assigned_operator_id: fixture.operatorBId,
      claimed_by: null,
    });

    // C.6 — return to shared pool.
    const returnedToPool = await withTenant(fixture.shopId, (trx) =>
      assignStowTask(trx, {
        stowTaskId: work.taskId,
        shopId: fixture.shopId,
        assignedOperatorId: null,
        assignedBy: fixture.ownerId,
      })
    );
    expect(returnedToPool.assigned_operator_id).toBeNull();

    const pooledRow = await taskRow(fixture.shopId, work.taskId);
    expect(pooledRow).toMatchObject({
      status: 'pending',
      assigned_operator_id: null,
      claimed_by: null,
    });

    // C.7 — after returning to pool, any eligible operator may claim it.
    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );

    const claimedRow = await taskRow(fixture.shopId, work.taskId);
    expect(claimedRow).toMatchObject({
      status: 'in_progress',
      assigned_operator_id: null,
      claimed_by: fixture.operatorAId,
    });
  });

  // C.3, C.4, C.9
  it('assigned task can be claimed by the assignee, rejects another operator, and reclaim by the same owner is idempotent', async () => {
    const assignedFixture = await createFixture();
    const assigned = await seedStowWork(assignedFixture, {
      assignedOperatorId: assignedFixture.operatorAId,
    });

    await expect(
      withTenant(assignedFixture.shopId, (trx) =>
        claimStowTask(
          trx,
          assigned.taskId,
          assignedFixture.shopId,
          assignedFixture.operatorBId
        )
      )
    ).rejects.toThrow('[STOW_CLAIM] TASK_ASSIGNED_TO_OTHER');

    await withTenant(assignedFixture.shopId, (trx) =>
      claimStowTask(
        trx,
        assigned.taskId,
        assignedFixture.shopId,
        assignedFixture.operatorAId
      )
    );

    const afterFirst = await taskRow(assignedFixture.shopId, assigned.taskId);
    expect(afterFirst?.status).toBe('in_progress');
    expect(afterFirst?.claimed_by).toBe(assignedFixture.operatorAId);
    expect(afterFirst?.claimed_at).toBeTruthy();

    await withTenant(assignedFixture.shopId, (trx) =>
      claimStowTask(
        trx,
        assigned.taskId,
        assignedFixture.shopId,
        assignedFixture.operatorAId
      )
    );
    const afterReclaim = await taskRow(assignedFixture.shopId, assigned.taskId);
    expect(afterReclaim?.claimed_at?.toISOString()).toBe(
      afterFirst?.claimed_at?.toISOString()
    );
  });

  it('does not claim an assigned task with no destination', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture, {
      assignedOperatorId: fixture.operatorAId,
      locationCode: null,
    });

    await expect(
      withTenant(fixture.shopId, (trx) =>
        claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
      )
    ).rejects.toThrow('[STOW_CLAIM] LOCATION_REQUIRED');

    const after = await taskRow(fixture.shopId, work.taskId);
    expect(after).toMatchObject({
      status: 'pending',
      claimed_by: null,
      claimed_at: null,
      location_code: null,
    });
  });

  // C.8 (partial: reassign + unassign after claim), plus non-owner confirm
  // and concurrent takeover on an assigned task.
  it('prevents reassignment and unassignment after claim, non-owner confirm, and concurrent takeover', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture, { assignedOperatorId: fixture.operatorAId });

    const [claimA, claimB] = await Promise.allSettled([
      withTenant(fixture.shopId, (trx) =>
        claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
      ),
      withTenant(fixture.shopId, (trx) =>
        claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorBId)
      ),
    ]);
    expect(claimA.status).toBe('fulfilled');
    expect(claimB.status).toBe('rejected');

    await expect(
      withTenant(fixture.shopId, (trx) =>
        assignStowTask(trx, {
          stowTaskId: work.taskId,
          shopId: fixture.shopId,
          assignedOperatorId: fixture.operatorBId,
          assignedBy: fixture.ownerId,
        })
      )
    ).rejects.toThrow('[STOW_ASSIGN] TASK_NOT_REASSIGNABLE');

    // C.8 — unassignment (return to pool) after claim must reject exactly
    // like reassignment does; claim freezes assignment in both directions.
    await expect(
      withTenant(fixture.shopId, (trx) =>
        assignStowTask(trx, {
          stowTaskId: work.taskId,
          shopId: fixture.shopId,
          assignedOperatorId: null,
          assignedBy: fixture.ownerId,
        })
      )
    ).rejects.toThrow('[STOW_ASSIGN] TASK_NOT_REASSIGNABLE');

    const before = await stowSnapshot(
      fixture.shopId,
      work.variantId,
      work.taskId,
      work.lineA.lasyncroUnitId
    );

    await expect(
      withTenant(fixture.shopId, async (trx) => {
        await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
        return confirmStow(trx, {
          stowTaskId: work.taskId,
          shopId: fixture.shopId,
          claimedBy: fixture.operatorBId,
          quantityPlaced: 1,
          lasyncroUnitId: work.lineA.lasyncroUnitId,
        });
      })
    ).rejects.toThrow('[STOW_CONFIRM] Task owned by different operator');

    const after = await stowSnapshot(
      fixture.shopId,
      work.variantId,
      work.taskId,
      work.lineA.lasyncroUnitId
    );
    expect(after).toEqual(before);
  });

  it('confirms matching LSU once, rejects replay, and preserves Receive-line mismatch rejection', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture, { assignedOperatorId: fixture.operatorAId });

    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );

    const wrongLine = await expect(
      withTenant(fixture.shopId, async (trx) => {
        await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
        return confirmStow(trx, {
          stowTaskId: work.taskId,
          shopId: fixture.shopId,
          claimedBy: fixture.operatorAId,
          quantityPlaced: 1,
          lasyncroUnitId: work.lineB.lasyncroUnitId,
        });
      })
    ).rejects.toThrow('[STOW_CONFIRM] INBOUND_LSU_MISMATCH');
    expect(wrongLine).toBeUndefined();

    const first = await withTenant(fixture.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      return confirmStow(trx, {
        stowTaskId: work.taskId,
        shopId: fixture.shopId,
        claimedBy: fixture.operatorAId,
        quantityPlaced: 1,
        lasyncroUnitId: work.lineA.lasyncroUnitId,
      });
    });
    expect(first).toMatchObject({ isFullyPlaced: true, placedNow: 1 });

    const afterFirst = await stowSnapshot(
      fixture.shopId,
      work.variantId,
      work.taskId,
      work.lineA.lasyncroUnitId
    );
    expect(afterFirst.movements).toEqual([
      { quantity_delta: -1, location_code: `WH-${fixture.shopId}-ROOT` },
      { quantity_delta: 1, location_code: work.binCode },
    ]);
    expect(afterFirst.unit).toEqual({
      status: 'stowed',
      current_location_code: work.binCode,
    });

    await expect(
      withTenant(fixture.shopId, async (trx) => {
        await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
        return confirmStow(trx, {
          stowTaskId: work.taskId,
          shopId: fixture.shopId,
          claimedBy: fixture.operatorAId,
          quantityPlaced: 1,
          lasyncroUnitId: work.lineA.lasyncroUnitId,
        });
      })
    ).rejects.toThrow('[STOW_CONFIRM] Task not in progress: completed');

    const afterReplay = await stowSnapshot(
      fixture.shopId,
      work.variantId,
      work.taskId,
      work.lineA.lasyncroUnitId
    );
    expect(afterReplay.movements).toEqual(afterFirst.movements);
    expect(afterReplay.truth).toEqual(afterFirst.truth);
  });
});

describe('STOW-ACTIVE-LOCATION-01 — mutable sticky destination', () => {
  // J.1-5
  it('claimed owner may switch active destination; task remains in_progress, claimed_by/claimed_at/quantity_placed unchanged', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture, {
      assignedOperatorId: fixture.operatorAId,
    });

    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );
    const before = await taskRow(fixture.shopId, work.taskId);

    const response = await assignLocationDirect(
      fixture.shopId,
      work.taskId,
      work.alternateBinCode,
      fixture.operatorAId
    );
    expect(response.statusCode).toBe(200);

    const after = await taskRow(fixture.shopId, work.taskId);
    expect(after?.location_code).toBe(work.alternateBinCode);
    expect(after?.status).toBe('in_progress');
    expect(after?.claimed_by).toBe(fixture.operatorAId);
    expect(after?.claimed_at?.toISOString()).toBe(
      before?.claimed_at?.toISOString()
    );

    const quantityPlaced = await withTenant(fixture.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fixture.shopId, stow_task_id: work.taskId })
        .first('quantity_placed')
    );
    expect(quantityPlaced?.quantity_placed).toBe(0);
  });

  // J.6
  it('different operator cannot switch active destination; zero mutation', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture, {
      assignedOperatorId: fixture.operatorAId,
    });

    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );
    const before = await taskRow(fixture.shopId, work.taskId);

    const response = await assignLocationDirect(
      fixture.shopId,
      work.taskId,
      work.alternateBinCode,
      fixture.operatorBId
    );
    expect(response.statusCode).toBe(403);

    const after = await taskRow(fixture.shopId, work.taskId);
    expect(after).toEqual(before);
  });

  // J.7
  it('completed task cannot switch destination; zero mutation', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture, {
      assignedOperatorId: fixture.operatorAId,
    });

    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );
    await withTenant(fixture.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      return confirmStow(trx, {
        stowTaskId: work.taskId,
        shopId: fixture.shopId,
        claimedBy: fixture.operatorAId,
        quantityPlaced: 1,
        lasyncroUnitId: work.lineA.lasyncroUnitId,
      });
    });

    const before = await taskRow(fixture.shopId, work.taskId);
    expect(before?.status).toBe('completed');

    const response = await assignLocationDirect(
      fixture.shopId,
      work.taskId,
      work.alternateBinCode,
      fixture.operatorAId
    );
    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: 'STOW_LOCATION_NOT_REASSIGNABLE' });

    const after = await taskRow(fixture.shopId, work.taskId);
    expect(after).toEqual(before);
  });

  // J.8
  it('same active destination switch is idempotent success with no destructive side effect', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture, {
      assignedOperatorId: fixture.operatorAId,
    });

    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );
    const before = await taskRow(fixture.shopId, work.taskId);
    expect(before?.location_code).toBe(work.binCode);

    const response = await assignLocationDirect(
      fixture.shopId,
      work.taskId,
      work.binCode,
      fixture.operatorAId
    );
    expect(response.statusCode).toBe(200);

    const after = await taskRow(fixture.shopId, work.taskId);
    expect(after).toEqual(before);
  });

  // J.9
  it('invalid destination is rejected; zero mutation', async () => {
    const fixture = await createFixture();
    const work = await seedStowWork(fixture, {
      assignedOperatorId: fixture.operatorAId,
    });

    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );
    const before = await taskRow(fixture.shopId, work.taskId);

    const response = await assignLocationDirect(
      fixture.shopId,
      work.taskId,
      'BIN-DOES-NOT-EXIST',
      fixture.operatorAId
    );
    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: 'Location not found' });

    const after = await taskRow(fixture.shopId, work.taskId);
    expect(after).toEqual(before);
  });

  // J.10
  it('re-stow source == destination remains rejected', async () => {
    const fixture = await createFixture();
    const work = await seedRestowWork(fixture);

    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );
    const before = await taskRow(fixture.shopId, work.taskId);

    const response = await assignLocationDirect(
      fixture.shopId,
      work.taskId,
      work.problemBin,
      fixture.operatorAId
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'Re-stow destination must differ from problem bin',
    });

    const after = await taskRow(fixture.shopId, work.taskId);
    expect(after).toEqual(before);
  });

  // Decisive multi-bin physical test (brief §J)
  it('multi-bin task: unit A commits to A-1, switch to B-4, unit B commits to B-4 — exact per-unit truth, no lost history', async () => {
    const fixture = await createFixture();
    const work = await seedMultiUnitStowWork(fixture);

    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );

    await withTenant(fixture.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      return confirmStow(trx, {
        stowTaskId: work.taskId,
        shopId: fixture.shopId,
        claimedBy: fixture.operatorAId,
        quantityPlaced: 1,
        lasyncroUnitId: work.lsuA,
      });
    });

    const switchResponse = await assignLocationDirect(
      fixture.shopId,
      work.taskId,
      work.binB,
      fixture.operatorAId
    );
    expect(switchResponse.statusCode).toBe(200);

    const confirmB = await withTenant(fixture.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      return confirmStow(trx, {
        stowTaskId: work.taskId,
        shopId: fixture.shopId,
        claimedBy: fixture.operatorAId,
        quantityPlaced: 1,
        lasyncroUnitId: work.lsuB,
      });
    });

    expect(confirmB).toMatchObject({
      isFullyPlaced: true,
      quantityPlaced: 2,
      quantityTotal: 2,
      placedNow: 1,
      locationCode: work.binB,
    });

    const finalTask = await withTenant(fixture.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fixture.shopId, stow_task_id: work.taskId })
        .first('quantity_placed', 'location_code', 'status')
    );
    expect(finalTask?.quantity_placed).toBe(2);
    expect(finalTask?.location_code).toBe(work.binB);
    expect(finalTask?.status).toBe('completed');

    const units = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_units')
        .where({ shop_id: fixture.shopId })
        .whereIn('lasyncro_unit_id', [work.lsuA, work.lsuB])
        .orderBy('lasyncro_unit_id')
        .select('lasyncro_unit_id', 'status', 'current_location_code')
    );
    const unitA = units.find((u) => u.lasyncro_unit_id === work.lsuA);
    const unitB = units.find((u) => u.lasyncro_unit_id === work.lsuB);
    expect(unitA).toMatchObject({ status: 'stowed', current_location_code: work.binA });
    expect(unitB).toMatchObject({ status: 'stowed', current_location_code: work.binB });

    const movements = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: fixture.shopId, lasyncro_variant_id: work.variantId })
        .orderBy(['location_code', 'quantity_delta'])
        .select('quantity_delta', 'location_code')
    );
    const rootCode = `WH-${fixture.shopId}-ROOT`;
    const rootDebits = movements.filter(
      (m) => m.location_code === rootCode && m.quantity_delta === -1
    );
    expect(rootDebits).toHaveLength(2);
    expect(
      movements.filter((m) => m.location_code === work.binA && m.quantity_delta === 1)
    ).toHaveLength(1);
    expect(
      movements.filter((m) => m.location_code === work.binB && m.quantity_delta === 1)
    ).toHaveLength(1);

    const placements = await withTenant(fixture.shopId, (trx) =>
      getStowTaskPlacements(trx, { shopId: fixture.shopId, stowTaskId: work.taskId })
    );
    expect(placements).toHaveLength(2);
    expect(placements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lasyncro_unit_id: work.lsuA, location_code: work.binA }),
        expect.objectContaining({ lasyncro_unit_id: work.lsuB, location_code: work.binB }),
      ])
    );
  });

  // Minimum permanent code evidence: confirmStow must lock the task row
  // FOR UPDATE before reading the active destination it will commit to.
  it('confirmStow source locks stow_tasks FOR UPDATE before reading the active destination', () => {
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../apps/backend/src/services/wms/stow.service.ts'
      ),
      'utf8'
    );
    const confirmStart = source.indexOf('export async function confirmStow');
    expect(confirmStart).toBeGreaterThan(-1);
    const nextExport = source.indexOf('\nexport ', confirmStart + 1);
    const body = source.slice(
      confirmStart,
      nextExport === -1 ? undefined : nextExport
    );
    expect(body).toMatch(/trx\('stow_tasks'\)[\s\S]{0,200}\.forUpdate\(\)/);
  });

  // Concurrency: a location switch racing confirmStow must serialize on the
  // task row — the confirmed unit must land exactly where confirmResult
  // .locationCode says, never a location the switch introduced mid-flight.
  it('location switch racing confirmStow serializes on the task row; the confirmed unit never half-commits', async () => {
    const fixture = await createFixture();
    const work = await seedMultiUnitStowWork(fixture);

    await withTenant(fixture.shopId, (trx) =>
      claimStowTask(trx, work.taskId, fixture.shopId, fixture.operatorAId)
    );

    const [confirmResult, switchResponse] = await Promise.all([
      withTenant(fixture.shopId, async (trx) => {
        await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
        return confirmStow(trx, {
          stowTaskId: work.taskId,
          shopId: fixture.shopId,
          claimedBy: fixture.operatorAId,
          quantityPlaced: 1,
          lasyncroUnitId: work.lsuA,
        });
      }),
      assignLocationDirect(
        fixture.shopId,
        work.taskId,
        work.binB,
        fixture.operatorAId
      ),
    ]);

    // Both operations must succeed — the row lock serializes them rather
    // than one corrupting the other's view.
    expect(switchResponse.statusCode).toBe(200);
    expect([work.binA, work.binB]).toContain(confirmResult.locationCode);

    const unit = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_units')
        .where({ shop_id: fixture.shopId, lasyncro_unit_id: work.lsuA })
        .first('current_location_code')
    );
    // Whichever destination confirmStow's locked snapshot actually used,
    // the physical unit and its ledger credit must agree with it exactly —
    // never the OTHER bin, and never left unset.
    expect(unit?.current_location_code).toBe(confirmResult.locationCode);

    const creditMovement = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_movements')
        .where({
          shop_id: fixture.shopId,
          lasyncro_variant_id: work.variantId,
          quantity_delta: 1,
        })
        .first('location_code')
    );
    expect(creditMovement?.location_code).toBe(confirmResult.locationCode);

    // The switch always eventually applies — task still in_progress after
    // only 1 of 2 units confirmed, regardless of interleaving order.
    const finalTask = await taskRow(fixture.shopId, work.taskId);
    expect(finalTask?.location_code).toBe(work.binB);
    expect(finalTask?.status).toBe('in_progress');
  });

  // K — Shopify sync race fix (permanent static contract).
  //
  // A live API/controller-level proof would require mocking
  // syncStowedQuantityToShopify through the full createApp() + entitlement
  // + FT2 fixture chain (see barcode-execution-invariant-1085.test.ts),
  // which is expensive to stand up correctly for one call-site assertion.
  // Per the brief's fallback, this is the cheapest permanent contract:
  // static proof that httpConfirmStow's Shopify sync call site uses
  // confirmResult.locationCode, and that the post-transaction stow_tasks
  // read it performs (`stowedTask`) never selects location_code at all —
  // so the mutable column cannot be the source of the destination Shopify
  // receives.
  it('httpConfirmStow syncs Shopify using confirmResult.locationCode, never a post-transaction task-location read', () => {
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../apps/backend/src/api/wms/wms.controller.ts'
      ),
      'utf8'
    );
    const handlerStart = source.indexOf('export const httpConfirmStow');
    expect(handlerStart).toBeGreaterThan(-1);
    const nextExport = source.indexOf('\nexport ', handlerStart + 1);
    const body = source.slice(
      handlerStart,
      nextExport === -1 ? undefined : nextExport
    );

    // The post-transaction task read must never select location_code.
    const stowedTaskReadMatch = body.match(
      /stowedTask = await db\('stow_tasks'\)[\s\S]{0,200}?\.select\(([^)]*)\)/
    );
    expect(stowedTaskReadMatch).toBeTruthy();
    expect(stowedTaskReadMatch![1]).not.toMatch(/location_code/);

    // The sync call itself must pass confirmResult.locationCode.
    const syncCallMatch = body.match(
      /syncStowedQuantityToShopify\([\s\S]{0,800}?\)\.catch/
    );
    expect(syncCallMatch).toBeTruthy();
    expect(syncCallMatch![0]).toMatch(/locationCode:\s*confirmResult\.locationCode/);
    expect(syncCallMatch![0]).not.toMatch(/locationCode:\s*stowedTask\.location_code/);
  });
});
