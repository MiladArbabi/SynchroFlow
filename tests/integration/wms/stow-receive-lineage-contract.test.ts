import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  assignStowTask,
  claimStowTask,
  confirmStow,
  createStowTask,
} from 'api-src/services/wms/stow.service';
import {
  httpAssignStowLocation,
  httpGetStowTasks,
} from 'api-src/api/wms/wms.controller';

/**
 * STOW-HANDOFF-01
 *
 * An inbound stow task must retain the exact Receive line that produced it.
 *
 * Permanent contract:
 * stow_tasks.receive_job_line_id is the authoritative Receive -> Stow handoff.
 */

async function createFixtureShop(): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `stow-lineage-${crypto.randomUUID().slice(0, 8)}`
    );
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedLineageFixture(shopId: number) {
  return withTenant(shopId, async (trx) => {
    const userRow = await trx('users')
      .insert({
        shop_id: shopId,
        email: `stow-lineage-${crypto.randomUUID().slice(0, 8)}@example.com`,
        password_hash: 'test-hash',
        role: 'operator',
      })
      .returning('id')
      .then((rows) => rows[0]);
    const claimedBy = Number((userRow as any).id ?? userRow);

    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;
    const binCode = 'A-1';

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Stow lineage product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SL-${variantId.slice(0, 8)}`,
      title: 'Stow lineage variant',
      unit_cost: '5.00',
      status: 'active',
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Stow lineage warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: binCode,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    const supplierRow = await trx('suppliers')
      .insert({ shop_id: shopId, name: 'Stow lineage supplier', active: true })
      .returning('id')
      .then((rows) => rows[0]);
    const supplierId = Number((supplierRow as any).id ?? supplierRow);

    async function receiveLine(receiveSequence: number) {
      const poRow = await trx('purchase_orders')
        .insert({ shop_id: shopId, supplier_id: supplierId, status: 'shipped' })
        .returning('id')
        .then((rows) => rows[0]);
      const poId = String((poRow as any).id ?? poRow);
      const poLineRow = await trx('purchase_order_line_items')
        .insert({
          po_id: poId,
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          description: 'Stow lineage line',
          quantity_ordered: 1,
          quantity_received: 1,
        })
        .returning('id')
        .then((rows) => rows[0]);
      const receiveJobRow = await trx('receive_jobs')
        .insert({
          shop_id: shopId,
          po_id: poId,
          status: 'closed',
          total_variants: 1,
          total_units: 1,
        })
        .returning('receive_job_id')
        .then((rows) => rows[0]);
      const receiveJobId = String(
        (receiveJobRow as any).receive_job_id ?? receiveJobRow
      );
      const receiveJobLineRow = await trx('receive_job_lines')
        .insert({
          shop_id: shopId,
          receive_job_id: receiveJobId,
          po_line_item_id: (poLineRow as any).id ?? poLineRow,
          lasyncro_variant_id: variantId,
          quantity_expected: 1,
          quantity_accepted: 1,
          inspection_complete: true,
        })
        .returning('receive_job_line_id')
        .then((rows) => rows[0]);
      const receiveJobLineId = String(
        (receiveJobLineRow as any).receive_job_line_id ?? receiveJobLineRow
      );
      const lasyncroUnitId = `LSU-${crypto.randomUUID().slice(0, 12)}`;
      await trx('inventory_units').insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: receiveJobLineId,
        receive_sequence: receiveSequence,
        status: 'received',
        current_location_code: null,
        lasyncro_unit_id: lasyncroUnitId,
      });
      return { poId, receiveJobLineId, lasyncroUnitId };
    }

    const lineA = await receiveLine(1);
    const lineB = await receiveLine(1);

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: rootCode,
      on_hand_quantity: 2,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: 2,
      last_evaluated_at: new Date(),
    });

    const taskA = await trx('stow_tasks')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: lineA.receiveJobLineId,
        quantity: 1,
        location_code: binCode,
        status: 'in_progress',
        trigger: 'inbound_stock',
        po_id: lineA.poId,
        claimed_by: claimedBy,
        claimed_at: new Date(),
      })
      .returning('stow_task_id')
      .then((rows) => rows[0]);

    return {
      shopId,
      claimedBy,
      variantId,
      binCode,
      lineA,
      lineB,
      taskA: String((taskA as any).stow_task_id ?? taskA),
    };
  });
}

async function readAttemptState(
  shopId: number,
  variantId: string,
  taskId: string,
  unitId: string
) {
  return withTenant(shopId, async (trx) => ({
    movementCount: Number(
      (
        await trx('inventory_movements')
          .where({
            shop_id: shopId,
            lasyncro_variant_id: variantId,
            movement_type: 'location_transfer',
          })
          .count<{ count: string }[]>('* as count')
      )[0].count
    ),
    unit: await trx('inventory_units')
      .where({ shop_id: shopId, lasyncro_unit_id: unitId })
      .first('status', 'current_location_code'),
    task: await trx('stow_tasks')
      .where({ shop_id: shopId, stow_task_id: taskId })
      .first('status'),
  }));
}

describe('STOW-HANDOFF-01 — exact Receive line lineage', () => {
  it('schema contract: stow_tasks.receive_job_line_id exists', async () => {
    const columns = await systemTransaction(async (trx) => {
      const result = await trx.raw(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'stow_tasks'
          AND column_name = 'receive_job_line_id'
      `);

      return result.rows.map(
        (row: { column_name: string }) => row.column_name,
      );
    });

    expect(columns).toContain('receive_job_line_id');
  });

  it('handoff persistence: inbound createStowTask persists exact receive_job_line_id', async () => {
    const fixture = await seedLineageFixture(await createFixtureShop());

    const persisted = await withTenant(fixture.shopId, async (trx) => {
      const taskId = await createStowTask(trx, {
        shopId: fixture.shopId,
        lasyncroVariantId: fixture.variantId,
        quantity: 1,
        locationCode: fixture.binCode,
        trigger: 'inbound_stock',
        poId: fixture.lineA.poId,
        receiveJobLineId: fixture.lineA.receiveJobLineId,
      });

      return trx('stow_tasks')
        .where({ shop_id: fixture.shopId, stow_task_id: taskId })
        .first('receive_job_line_id');
    });

    expect(persisted?.receive_job_line_id).toBe(
      fixture.lineA.receiveJobLineId
    );
  });

  it('rejects same-variant LSU from another Receive line before side effects', async () => {
    const fixture = await seedLineageFixture(await createFixtureShop());
    const before = await readAttemptState(
      fixture.shopId,
      fixture.variantId,
      fixture.taskA,
      fixture.lineB.lasyncroUnitId
    );

    await expect(
      withTenant(fixture.shopId, async (trx) => {
        await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
        return confirmStow(trx, {
          stowTaskId: fixture.taskA,
          shopId: fixture.shopId,
          claimedBy: fixture.claimedBy,
          quantityPlaced: 1,
          lasyncroUnitId: fixture.lineB.lasyncroUnitId,
        });
      })
    ).rejects.toThrow('[STOW_CONFIRM] INBOUND_LSU_MISMATCH');

    const after = await readAttemptState(
      fixture.shopId,
      fixture.variantId,
      fixture.taskA,
      fixture.lineB.lasyncroUnitId
    );

    expect(after.movementCount).toBe(before.movementCount);
    expect(after.unit).toEqual({
      status: 'received',
      current_location_code: null,
    });
    expect(after.task).toEqual({ status: 'in_progress' });
  });

  it('positive control: stows the matching LSU from the linked Receive line', async () => {
    const fixture = await seedLineageFixture(await createFixtureShop());

    const result = await withTenant(fixture.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      return confirmStow(trx, {
        stowTaskId: fixture.taskA,
        shopId: fixture.shopId,
        claimedBy: fixture.claimedBy,
        quantityPlaced: 1,
        lasyncroUnitId: fixture.lineA.lasyncroUnitId,
      });
    });

    const after = await withTenant(fixture.shopId, async (trx) => ({
      movements: await trx('inventory_movements')
        .where({
          shop_id: fixture.shopId,
          lasyncro_variant_id: fixture.variantId,
          movement_type: 'location_transfer',
        })
        .orderBy('quantity_delta')
        .select('quantity_delta', 'location_code'),
      unit: await trx('inventory_units')
        .where({
          shop_id: fixture.shopId,
          lasyncro_unit_id: fixture.lineA.lasyncroUnitId,
        })
        .first('status', 'current_location_code'),
    }));

    expect(result).toMatchObject({ isFullyPlaced: true, placedNow: 1 });
    expect(after.movements).toEqual([
      { quantity_delta: -1, location_code: `WH-${fixture.shopId}-ROOT` },
      { quantity_delta: 1, location_code: fixture.binCode },
    ]);
    expect(after.unit).toEqual({
      status: 'stowed',
      current_location_code: fixture.binCode,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// STOW-LEGACY-LINEAGE-01 — trigger='inbound_stock' MUST imply
// receive_job_line_id IS NOT NULL. Legacy rows written before that lineage
// was required may still exist in the database for historical/audit
// purposes, but they must never be executable: not listed, assigned,
// located, claimed, resumed, or confirmed. Non-inbound triggers legitimately
// have receive_job_line_id = NULL and must be unaffected by every guard
// below.
// ═══════════════════════════════════════════════════════════════════════

async function mockRes() {
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
  return res;
}

async function callGetStowTasks(shopId: number) {
  const res = await mockRes();
  await httpGetStowTasks({ user: { shopId } } as any, res);
  return res;
}

async function callAssignLocation(
  shopId: number,
  taskId: string,
  locationCode: string,
  userId: number
) {
  const res = await mockRes();
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

async function seedLegacyLineageFixture() {
  const shopId = await createFixtureShop();

  return withTenant(shopId, async (trx) => {
    const opARow = await trx('users')
      .insert({
        shop_id: shopId,
        email: `stow-legacy-a-${crypto.randomUUID().slice(0, 8)}@example.com`,
        password_hash: 'test-hash',
        role: 'operator',
      })
      .returning('id')
      .then((rows) => rows[0]);
    const opBRow = await trx('users')
      .insert({
        shop_id: shopId,
        email: `stow-legacy-b-${crypto.randomUUID().slice(0, 8)}@example.com`,
        password_hash: 'test-hash',
        role: 'operator',
      })
      .returning('id')
      .then((rows) => rows[0]);
    const operatorAId = Number((opARow as any).id ?? opARow);
    const operatorBId = Number((opBRow as any).id ?? opBRow);

    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;
    const binCode = 'A-1';
    const altBinCode = 'B-2';

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Legacy lineage product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `LL-${variantId.slice(0, 8)}`,
      title: 'Legacy lineage variant',
      unit_cost: '5.00',
      status: 'active',
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Legacy lineage warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: binCode,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: altBinCode,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    const supplierRow = await trx('suppliers')
      .insert({ shop_id: shopId, name: 'Legacy lineage supplier', active: true })
      .returning('id')
      .then((rows) => rows[0]);
    const supplierId = Number((supplierRow as any).id ?? supplierRow);

    const poRow = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: supplierId, status: 'shipped' })
      .returning('id')
      .then((rows) => rows[0]);
    const poId = String((poRow as any).id ?? poRow);
    const poLineRow = await trx('purchase_order_line_items')
      .insert({
        po_id: poId,
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        description: 'Legacy lineage PO line',
        quantity_ordered: 1,
        quantity_received: 1,
      })
      .returning('id')
      .then((rows) => rows[0]);
    const receiveJobRow = await trx('receive_jobs')
      .insert({
        shop_id: shopId,
        po_id: poId,
        status: 'closed',
        total_variants: 1,
        total_units: 1,
      })
      .returning('receive_job_id')
      .then((rows) => rows[0]);
    const receiveJobId = String(
      (receiveJobRow as any).receive_job_id ?? receiveJobRow
    );
    const receiveJobLineRow = await trx('receive_job_lines')
      .insert({
        shop_id: shopId,
        receive_job_id: receiveJobId,
        po_line_item_id: (poLineRow as any).id ?? poLineRow,
        lasyncro_variant_id: variantId,
        quantity_expected: 1,
        quantity_accepted: 1,
        inspection_complete: true,
      })
      .returning('receive_job_line_id')
      .then((rows) => rows[0]);
    const receiveJobLineId = String(
      (receiveJobLineRow as any).receive_job_line_id ?? receiveJobLineRow
    );
    const validLasyncroUnitId = `LSU-${crypto.randomUUID().slice(0, 12)}`;
    await trx('inventory_units').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      receive_job_line_id: receiveJobLineId,
      receive_sequence: 1,
      status: 'received',
      current_location_code: null,
      lasyncro_unit_id: validLasyncroUnitId,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: rootCode,
      on_hand_quantity: 1,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: 1,
      last_evaluated_at: new Date(),
    });

    // Legacy row #1 — pending, inbound_stock, NULL lineage. May exist for
    // historical/audit purposes but must never be executable.
    const legacyPendingId = await trx('stow_tasks')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: null,
        quantity: 1,
        location_code: binCode,
        status: 'pending',
        trigger: 'inbound_stock',
        po_id: poId,
      })
      .returning('stow_task_id')
      .then((rows) => String((rows[0] as any).stow_task_id ?? rows[0]));

    // Legacy row #2 — already in_progress/claimed, inbound_stock, NULL
    // lineage. Simulates a row claimed before this guard existed; the fix
    // must still fail closed on any further mutation attempt.
    const legacyInProgressId = await trx('stow_tasks')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: null,
        quantity: 1,
        location_code: binCode,
        status: 'in_progress',
        trigger: 'inbound_stock',
        po_id: poId,
        claimed_by: operatorAId,
        claimed_at: new Date(),
      })
      .returning('stow_task_id')
      .then((rows) => String((rows[0] as any).stow_task_id ?? rows[0]));

    // Valid inbound row — real lineage, must remain fully executable.
    const validInboundId = await trx('stow_tasks')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: receiveJobLineId,
        quantity: 1,
        location_code: binCode,
        status: 'pending',
        trigger: 'inbound_stock',
        po_id: poId,
      })
      .returning('stow_task_id')
      .then((rows) => String((rows[0] as any).stow_task_id ?? rows[0]));

    // Non-inbound trigger with NULL lineage — legitimate, must be unaffected
    // by every guard in this describe block.
    const nonInboundNullLineageId = await trx('stow_tasks')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        receive_job_line_id: null,
        quantity: 1,
        location_code: binCode,
        status: 'pending',
        trigger: 'return_restock',
      })
      .returning('stow_task_id')
      .then((rows) => String((rows[0] as any).stow_task_id ?? rows[0]));

    return {
      shopId,
      operatorAId,
      operatorBId,
      variantId,
      binCode,
      altBinCode,
      receiveJobLineId,
      validLasyncroUnitId,
      legacyPendingId,
      legacyInProgressId,
      validInboundId,
      nonInboundNullLineageId,
    };
  });
}

describe('STOW-LEGACY-LINEAGE-01 — executable projection fails closed on legacy inbound rows', () => {
  it('GET /stow-tasks excludes pending and in_progress legacy inbound/null-lineage rows, keeps valid inbound and non-inbound null-lineage rows', async () => {
    const fx = await seedLegacyLineageFixture();

    const res = await callGetStowTasks(fx.shopId);
    expect(res.statusCode).toBe(200);
    const ids = (res.body.stow_tasks as Array<{ stow_task_id: string }>).map(
      (t) => t.stow_task_id
    );

    expect(ids).not.toContain(fx.legacyPendingId);
    expect(ids).not.toContain(fx.legacyInProgressId);
    expect(ids).toContain(fx.validInboundId);
    expect(ids).toContain(fx.nonInboundNullLineageId);
  });

  it('unit_ids lineage: exact Receive-line scoping never surfaces a sibling line\'s LSU', async () => {
    const lineageFixture = await seedLineageFixture(await createFixtureShop());

    const res = await callGetStowTasks(lineageFixture.shopId);
    expect(res.statusCode).toBe(200);
    const taskA = (res.body.stow_tasks as Array<{
      stow_task_id: string;
      unit_ids: string[] | null;
    }>).find((t) => t.stow_task_id === lineageFixture.taskA);

    expect(taskA).toBeDefined();
    expect(taskA?.unit_ids).toEqual([lineageFixture.lineA.lasyncroUnitId]);
    expect(taskA?.unit_ids).not.toContain(lineageFixture.lineB.lasyncroUnitId);
  });

  it('claim: pending legacy inbound rejects with zero mutation', async () => {
    const fx = await seedLegacyLineageFixture();
    const before = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.legacyPendingId })
        .first('status', 'claimed_by', 'claimed_at')
    );

    await expect(
      withTenant(fx.shopId, (trx) =>
        claimStowTask(trx, fx.legacyPendingId, fx.shopId, fx.operatorAId)
      )
    ).rejects.toThrow('[STOW_CLAIM] INBOUND_RECEIVE_LINE_REQUIRED');

    const after = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.legacyPendingId })
        .first('status', 'claimed_by', 'claimed_at')
    );
    expect(after).toEqual(before);
  });

  it('claim: same-owner resume of an already in_progress legacy inbound row rejects (never idempotent-success)', async () => {
    const fx = await seedLegacyLineageFixture();
    const before = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.legacyInProgressId })
        .first('status', 'claimed_by', 'claimed_at')
    );

    await expect(
      withTenant(fx.shopId, (trx) =>
        claimStowTask(trx, fx.legacyInProgressId, fx.shopId, fx.operatorAId)
      )
    ).rejects.toThrow('[STOW_CLAIM] INBOUND_RECEIVE_LINE_REQUIRED');

    const after = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.legacyInProgressId })
        .first('status', 'claimed_by', 'claimed_at')
    );
    expect(after).toEqual(before);
  });

  it('claim: valid inbound task still claims successfully', async () => {
    const fx = await seedLegacyLineageFixture();

    await withTenant(fx.shopId, (trx) =>
      claimStowTask(trx, fx.validInboundId, fx.shopId, fx.operatorAId)
    );

    const after = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.validInboundId })
        .first('status', 'claimed_by')
    );
    expect(after).toMatchObject({ status: 'in_progress', claimed_by: fx.operatorAId });
  });

  it('claim: non-inbound trigger with NULL lineage remains unaffected', async () => {
    const fx = await seedLegacyLineageFixture();

    await withTenant(fx.shopId, (trx) =>
      claimStowTask(trx, fx.nonInboundNullLineageId, fx.shopId, fx.operatorAId)
    );

    const after = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.nonInboundNullLineageId })
        .first('status', 'claimed_by')
    );
    expect(after).toMatchObject({ status: 'in_progress', claimed_by: fx.operatorAId });
  });

  it('assignment: pending legacy inbound rejects with zero mutation', async () => {
    const fx = await seedLegacyLineageFixture();
    const before = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.legacyPendingId })
        .first('assigned_operator_id', 'status')
    );

    await expect(
      withTenant(fx.shopId, (trx) =>
        assignStowTask(trx, {
          stowTaskId: fx.legacyPendingId,
          shopId: fx.shopId,
          assignedOperatorId: fx.operatorAId,
          assignedBy: fx.operatorBId,
        })
      )
    ).rejects.toThrow('[STOW_ASSIGN] INBOUND_RECEIVE_LINE_REQUIRED');

    const after = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.legacyPendingId })
        .first('assigned_operator_id', 'status')
    );
    expect(after).toEqual(before);
  });

  it('location: pending legacy inbound location assignment rejects (409) with zero mutation', async () => {
    const fx = await seedLegacyLineageFixture();
    const before = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.legacyPendingId })
        .first('location_code', 'status')
    );

    const res = await callAssignLocation(
      fx.shopId,
      fx.legacyPendingId,
      fx.altBinCode,
      fx.operatorAId
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'STOW_INBOUND_RECEIVE_LINE_REQUIRED' });

    const after = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.legacyPendingId })
        .first('location_code', 'status')
    );
    expect(after).toEqual(before);
  });

  it('location: in_progress legacy inbound location switch rejects (409) with zero mutation', async () => {
    const fx = await seedLegacyLineageFixture();
    const before = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.legacyInProgressId })
        .first('location_code', 'status', 'claimed_by')
    );

    const res = await callAssignLocation(
      fx.shopId,
      fx.legacyInProgressId,
      fx.altBinCode,
      fx.operatorAId
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'STOW_INBOUND_RECEIVE_LINE_REQUIRED' });

    const after = await withTenant(fx.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: fx.shopId, stow_task_id: fx.legacyInProgressId })
        .first('location_code', 'status', 'claimed_by')
    );
    expect(after).toEqual(before);
  });

  it('location: valid inbound and non-inbound null-lineage tasks remain switchable', async () => {
    const fx = await seedLegacyLineageFixture();

    await withTenant(fx.shopId, (trx) =>
      claimStowTask(trx, fx.validInboundId, fx.shopId, fx.operatorAId)
    );
    const validRes = await callAssignLocation(
      fx.shopId,
      fx.validInboundId,
      fx.altBinCode,
      fx.operatorAId
    );
    expect(validRes.statusCode).toBe(200);

    const nonInboundRes = await callAssignLocation(
      fx.shopId,
      fx.nonInboundNullLineageId,
      fx.altBinCode,
      fx.operatorAId
    );
    expect(nonInboundRes.statusCode).toBe(200);
  });

  it('confirm: legacy inbound remains rejected with zero inventory mutation', async () => {
    const fx = await seedLegacyLineageFixture();

    async function snapshot() {
      return withTenant(fx.shopId, async (trx) => ({
        movementCount: Number(
          (
            await trx('inventory_movements')
              .where({ shop_id: fx.shopId, lasyncro_variant_id: fx.variantId })
              .count<{ count: string }[]>('* as count')
          )[0].count
        ),
        truth: await trx('inventory_truth')
          .where({ shop_id: fx.shopId, lasyncro_variant_id: fx.variantId })
          .orderBy('location_code')
          .select('location_code', 'on_hand_quantity', 'available_quantity'),
        unit: await trx('inventory_units')
          .where({ shop_id: fx.shopId, lasyncro_unit_id: fx.validLasyncroUnitId })
          .first('status', 'current_location_code'),
      }));
    }

    const before = await snapshot();

    await expect(
      withTenant(fx.shopId, async (trx) => {
        await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
        return confirmStow(trx, {
          stowTaskId: fx.legacyInProgressId,
          shopId: fx.shopId,
          claimedBy: fx.operatorAId,
          quantityPlaced: 1,
          lasyncroUnitId: fx.validLasyncroUnitId,
        });
      })
    ).rejects.toThrow('[STOW_CONFIRM] INBOUND_RECEIVE_LINE_REQUIRED');

    const after = await snapshot();
    expect(after).toEqual(before);
  });
});
