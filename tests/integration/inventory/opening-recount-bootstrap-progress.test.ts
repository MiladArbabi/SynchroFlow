import crypto from 'crypto';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  addOpeningInventoryRecountLine,
  claimRecountTask,
  completeOpeningInventoryBin,
  createRecountFinding,
  getOpeningInventoryProgress,
  getShopOpeningInventoryProgress,
  recordCount,
  skipLine,
  startOpeningInventoryReconciliation,
  startShopOpeningInventoryReconciliation,
} from 'api-src/services/wms/inventoryRecount.service';

jest.setTimeout(30000);

type Fixture = {
  shopId: number;
  warehouseId: string;
  ownerId: number;
  operatorId: number;
  variantId: string;
};

async function createFixture(
  bootstrapModel:
    | 'legacy_opening_balance_v1'
    | 'reconcile_opening_expectation_v2' =
    'reconcile_opening_expectation_v2'
): Promise<Fixture> {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `opening-recount-bootstrap-${crypto.randomUUID().slice(0, 8)}`
    );

    await setTenantContext(trx, id);
    return id;
  });

  return withTenant(shopId, async (trx) => {
    const ownerRow = await trx('users')
      .insert({
        shop_id: shopId,
        email: `opening-owner-${crypto.randomUUID().slice(0, 8)}@example.com`,
        password_hash: 'test-hash',
        role: 'owner',
      })
      .returning('id')
      .then((rows) => rows[0]);

    const operatorRow = await trx('users')
      .insert({
        shop_id: shopId,
        email: `opening-operator-${crypto.randomUUID().slice(0, 8)}@example.com`,
        password_hash: 'test-hash',
        role: 'operator',
      })
      .returning('id')
      .then((rows) => rows[0]);

    const ownerId = Number((ownerRow as any).id ?? ownerRow);
    const operatorId = Number((operatorRow as any).id ?? operatorRow);

    await trx('shop_wms_settings').insert({
      shop_id: shopId,
      bootstrap_model: bootstrapModel,
    });

    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Opening inventory warehouse',
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
        location_code: 'A-1',
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: 'A-2',
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: 'OLD-1',
        type: 'bin',
        parent_location_code: rootCode,
        active: false,
        zone_type: 'pick',
      },
    ]);

    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Opening inventory product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `OPEN-${variantId.slice(0, 8)}`,
      title: 'Opening inventory variant',
      unit_cost: '1.00',
      status: 'active',
    });

    return {
      shopId,
      warehouseId,
      ownerId,
      operatorId,
      variantId,
    };
  });
}

describe('opening inventory Recount bootstrap and progress', () => {
  it('snapshots active bins into one durable task per bin and is retry-idempotent', async () => {
    const fixture = await createFixture();

    const first = await withTenant(fixture.shopId, (trx) =>
      startOpeningInventoryReconciliation(trx, {
        shopId: fixture.shopId,
        warehouseId: fixture.warehouseId,
        createdBy: fixture.ownerId,
      })
    );

    expect(first.total_bins).toBe(2);
    expect(first.not_started_bins).toBe(2);
    expect(first.progress_pct).toBe(0);
    expect(first.bins.map((bin) => bin.location_code)).toEqual([
      'A-1',
      'A-2',
    ]);

    await withTenant(fixture.shopId, (trx) =>
      trx('warehouse_locations').insert({
        shop_id: fixture.shopId,
        warehouse_id: fixture.warehouseId,
        location_code: 'A-3',
        type: 'bin',
        parent_location_code: `WH-${fixture.shopId}-ROOT`,
        active: true,
        zone_type: 'pick',
      })
    );

    const retry = await withTenant(fixture.shopId, (trx) =>
      startOpeningInventoryReconciliation(trx, {
        shopId: fixture.shopId,
        warehouseId: fixture.warehouseId,
        createdBy: fixture.ownerId,
      })
    );

    expect(retry.total_bins).toBe(2);
    expect(retry.bins.map((bin) => bin.location_code)).toEqual([
      'A-1',
      'A-2',
    ]);

    const taskCount = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_recount_tasks')
        .where({
          shop_id: fixture.shopId,
          warehouse_id: fixture.warehouseId,
          purpose: 'opening_inventory',
        })
        .count<{ count: string }>('* as count')
        .first()
    );

    expect(Number(taskCount?.count ?? 0)).toBe(2);
  });

  it('rejects initial reconciliation for a legacy bootstrap shop', async () => {
    const fixture = await createFixture('legacy_opening_balance_v1');

    await expect(
      withTenant(fixture.shopId, (trx) =>
        startOpeningInventoryReconciliation(trx, {
          shopId: fixture.shopId,
          warehouseId: fixture.warehouseId,
          createdBy: fixture.ownerId,
        })
      )
    ).rejects.toThrow(/bootstrap_model must be reconcile_opening_expectation_v2/);
  });

  it('adds discovered stock as an expected-zero line anchored to the task bin', async () => {
    const fixture = await createFixture();

    const progress = await withTenant(fixture.shopId, (trx) =>
      startOpeningInventoryReconciliation(trx, {
        shopId: fixture.shopId,
        warehouseId: fixture.warehouseId,
        createdBy: fixture.ownerId,
        assignedTo: fixture.operatorId,
      })
    );

    const task = progress.bins[0];

    await withTenant(fixture.shopId, (trx) =>
      claimRecountTask(
        trx,
        fixture.shopId,
        task.recount_task_id,
        fixture.operatorId
      )
    );

    const line = await withTenant(fixture.shopId, (trx) =>
      addOpeningInventoryRecountLine(trx, {
        shopId: fixture.shopId,
        recountTaskId: task.recount_task_id,
        lasyncroVariantId: fixture.variantId,
        addedBy: fixture.operatorId,
      })
    );

    expect(line.lasyncro_variant_id).toBe(fixture.variantId);
    expect(line.location_code).toBe(task.location_code);
    expect(line.expected_quantity).toBe(0);

    const retry = await withTenant(fixture.shopId, (trx) =>
      addOpeningInventoryRecountLine(trx, {
        shopId: fixture.shopId,
        recountTaskId: task.recount_task_id,
        lasyncroVariantId: fixture.variantId,
        addedBy: fixture.operatorId,
      })
    );

    expect(retry.recount_line_id).toBe(line.recount_line_id);

    const count = await withTenant(fixture.shopId, (trx) =>
      trx('inventory_recount_lines')
        .where({
          shop_id: fixture.shopId,
          recount_task_id: task.recount_task_id,
          lasyncro_variant_id: fixture.variantId,
        })
        .count<{ count: string }>('* as count')
        .first()
    );

    expect(Number(count?.count ?? 0)).toBe(1);
  });

  it('derives map-ready progress from the durable task states', async () => {
    const fixture = await createFixture();

    const started = await withTenant(fixture.shopId, (trx) =>
      startOpeningInventoryReconciliation(trx, {
        shopId: fixture.shopId,
        warehouseId: fixture.warehouseId,
        createdBy: fixture.ownerId,
      })
    );

    await withTenant(fixture.shopId, async (trx) => {
      await trx('inventory_recount_tasks')
        .where({
          shop_id: fixture.shopId,
          recount_task_id: started.bins[0].recount_task_id,
        })
        .update({
          status: 'committed',
          committed_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });

      await trx('inventory_recount_tasks')
        .where({
          shop_id: fixture.shopId,
          recount_task_id: started.bins[1].recount_task_id,
        })
        .update({
          status: 'manual_review',
          updated_at: trx.fn.now(),
        });
    });

    const progress = await withTenant(fixture.shopId, (trx) =>
      getOpeningInventoryProgress(
        trx,
        fixture.shopId,
        fixture.warehouseId
      )
    );

    expect(progress).toMatchObject({
      total_bins: 2,
      complete_bins: 1,
      needs_review_bins: 1,
      in_progress_bins: 0,
      not_started_bins: 0,
      remaining_bins: 1,
      progress_pct: 50,
      all_bins_settled: false,
    });

    expect(
      progress.bins.map((bin) => [
        bin.location_code,
        bin.progress_state,
      ])
    ).toEqual([
      ['A-1', 'complete'],
      ['A-2', 'needs_review'],
    ]);
  });
});

async function prepareOpeningInventoryLine(
  fixture: Fixture,
  options?: {
    recordQuantity?: number;
    record?: boolean;
  }
) {
  const started = await withTenant(fixture.shopId, (trx) =>
    startOpeningInventoryReconciliation(trx, {
      shopId: fixture.shopId,
      warehouseId: fixture.warehouseId,
      createdBy: fixture.ownerId,
      assignedTo: fixture.operatorId,
    })
  );

  const task = started.bins.find(
    (bin) => bin.location_code === 'A-1'
  );

  if (!task) {
    throw new Error('A-1 opening inventory task missing');
  }

  await withTenant(fixture.shopId, (trx) =>
    claimRecountTask(
      trx,
      fixture.shopId,
      task.recount_task_id,
      fixture.operatorId
    )
  );

  const line = await withTenant(fixture.shopId, (trx) =>
    addOpeningInventoryRecountLine(trx, {
      shopId: fixture.shopId,
      recountTaskId: task.recount_task_id,
      lasyncroVariantId: fixture.variantId,
      addedBy: fixture.operatorId,
    })
  );

  if (options?.record !== false) {
    await withTenant(fixture.shopId, (trx) =>
      recordCount(trx, {
        shopId: fixture.shopId,
        recountTaskId: task.recount_task_id,
        recountLineId: line.recount_line_id,
        countedQuantity: options?.recordQuantity ?? 3,
        countMethod: 'bin_quantity',
        countedBy: fixture.operatorId,
      })
    );
  }

  return { task, line };
}

describe('opening inventory bin settlement', () => {
  it('accepts only positive opening_inventory_reconcile ledger movements', async () => {
    const fixture = await createFixture();

    const positiveReferenceId = crypto.randomUUID();

    await withTenant(fixture.shopId, (trx) =>
      trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        device_event_id: crypto.randomUUID(),
        shop_id: fixture.shopId,
        lasyncro_variant_id: fixture.variantId,
        movement_type: 'opening_inventory_reconcile',
        quantity_delta: 1,
        reference_type: 'recount_line',
        reference_id: positiveReferenceId,
        location_code: 'A-1',
        platform: 'wms',
        occurred_at: new Date(),
        triggered_by: 'inventory_recount',
      })
    );

    await expect(
      withTenant(fixture.shopId, (trx) =>
        trx('inventory_movements').insert({
          lasyncro_inventory_movement_id: crypto.randomUUID(),
          device_event_id: crypto.randomUUID(),
          shop_id: fixture.shopId,
          lasyncro_variant_id: fixture.variantId,
          movement_type: 'opening_inventory_reconcile',
          quantity_delta: -1,
          reference_type: 'recount_line',
          reference_id: crypto.randomUUID(),
          location_code: 'A-1',
          platform: 'wms',
          occurred_at: new Date(),
          triggered_by: 'inventory_recount',
        })
      )
    ).rejects.toThrow();

    await expect(
      withTenant(fixture.shopId, (trx) =>
        trx('inventory_movements').insert({
          lasyncro_inventory_movement_id: crypto.randomUUID(),
          device_event_id: crypto.randomUUID(),
          shop_id: fixture.shopId,
          lasyncro_variant_id: fixture.variantId,
          movement_type: 'opening_inventory_reconcile',
          quantity_delta: 0,
          reference_type: 'recount_line',
          reference_id: crypto.randomUUID(),
          location_code: 'A-1',
          platform: 'wms',
          occurred_at: new Date(),
          triggered_by: 'inventory_recount',
        })
      )
    ).rejects.toThrow();
  });

  it('settles a clean counted bin into matching ledger, projection, and LSUs', async () => {
    const fixture = await createFixture();
    const { task, line } = await prepareOpeningInventoryLine(
      fixture,
      { recordQuantity: 3 }
    );

    const result = await withTenant(fixture.shopId, (trx) =>
      completeOpeningInventoryBin(
        trx,
        fixture.shopId,
        task.recount_task_id,
        fixture.operatorId
      )
    );

    expect(result).toMatchObject({
      status: 'committed',
      movements: 1,
      units: 3,
    });

    const evidence = await withTenant(
      fixture.shopId,
      async (trx) => {
        const movement = await trx('inventory_movements')
          .where({
            shop_id: fixture.shopId,
            movement_type: 'opening_inventory_reconcile',
            reference_type: 'recount_line',
            reference_id: line.recount_line_id,
          })
          .first();

        const units = await trx('inventory_units')
          .where({
            shop_id: fixture.shopId,
            recount_line_id: line.recount_line_id,
          })
          .orderBy('receive_sequence', 'asc');

        const truth = await trx('inventory_truth')
          .where({
            shop_id: fixture.shopId,
            lasyncro_variant_id: fixture.variantId,
            location_code: 'A-1',
          })
          .first();

        const persistedLine = await trx('inventory_recount_lines')
          .where({
            shop_id: fixture.shopId,
            recount_line_id: line.recount_line_id,
          })
          .first();

        return { movement, units, truth, persistedLine };
      }
    );

    expect(Number(evidence.movement.quantity_delta)).toBe(3);
    expect(evidence.movement.location_code).toBe('A-1');

    expect(evidence.units).toHaveLength(3);
    expect(
      evidence.units.every(
        (unit: any) =>
          unit.source === 'opening_inventory_reconcile' &&
          unit.status === 'stowed' &&
          unit.current_location_code === 'A-1'
      )
    ).toBe(true);

    expect(Number(evidence.truth.on_hand_quantity)).toBe(3);
    expect(Number(evidence.truth.on_hand_quantity)).toBe(
      evidence.units.length
    );

    expect(evidence.persistedLine.inventory_movement_id).toBe(
      evidence.movement.lasyncro_inventory_movement_id
    );

    const progress = await withTenant(fixture.shopId, (trx) =>
      getOpeningInventoryProgress(
        trx,
        fixture.shopId,
        fixture.warehouseId
      )
    );

    expect(progress).toMatchObject({
      total_bins: 2,
      complete_bins: 1,
      remaining_bins: 1,
      progress_pct: 50,
    });
  });

  it('retries a committed bin without duplicating economic or physical truth', async () => {
    const fixture = await createFixture();
    const { task, line } = await prepareOpeningInventoryLine(
      fixture,
      { recordQuantity: 2 }
    );

    await withTenant(fixture.shopId, (trx) =>
      completeOpeningInventoryBin(
        trx,
        fixture.shopId,
        task.recount_task_id,
        fixture.operatorId
      )
    );

    const retry = await withTenant(fixture.shopId, (trx) =>
      completeOpeningInventoryBin(
        trx,
        fixture.shopId,
        task.recount_task_id,
        fixture.operatorId
      )
    );

    expect(retry).toMatchObject({
      status: 'committed',
      movements: 1,
      units: 2,
    });

    const counts = await withTenant(
      fixture.shopId,
      async (trx) => {
        const movementCount = await trx('inventory_movements')
          .where({
            shop_id: fixture.shopId,
            movement_type: 'opening_inventory_reconcile',
            reference_id: line.recount_line_id,
          })
          .count<{ count: string }>('* as count')
          .first();

        const unitCount = await trx('inventory_units')
          .where({
            shop_id: fixture.shopId,
            recount_line_id: line.recount_line_id,
          })
          .count<{ count: string }>('* as count')
          .first();

        return {
          movements: Number(movementCount?.count ?? 0),
          units: Number(unitCount?.count ?? 0),
        };
      }
    );

    expect(counts).toEqual({
      movements: 1,
      units: 2,
    });
  });

  it('commits an empty bin without movements or LSUs and advances progress', async () => {
    const fixture = await createFixture();

    const started = await withTenant(fixture.shopId, (trx) =>
      startOpeningInventoryReconciliation(trx, {
        shopId: fixture.shopId,
        warehouseId: fixture.warehouseId,
        createdBy: fixture.ownerId,
        assignedTo: fixture.operatorId,
      })
    );

    const task = started.bins.find(
      (bin) => bin.location_code === 'A-1'
    );

    if (!task) {
      throw new Error('A-1 opening inventory task missing');
    }

    await withTenant(fixture.shopId, (trx) =>
      claimRecountTask(
        trx,
        fixture.shopId,
        task.recount_task_id,
        fixture.operatorId
      )
    );

    const result = await withTenant(fixture.shopId, (trx) =>
      completeOpeningInventoryBin(
        trx,
        fixture.shopId,
        task.recount_task_id,
        fixture.operatorId
      )
    );

    expect(result).toMatchObject({
      status: 'committed',
      movements: 0,
      units: 0,
    });

    const progress = await withTenant(fixture.shopId, (trx) =>
      getOpeningInventoryProgress(
        trx,
        fixture.shopId,
        fixture.warehouseId
      )
    );

    expect(progress.complete_bins).toBe(1);
    expect(progress.progress_pct).toBe(50);
  });

  it('refuses to complete while an active line is unresolved', async () => {
    const fixture = await createFixture();
    const { task } = await prepareOpeningInventoryLine(
      fixture,
      { record: false }
    );

    await expect(
      withTenant(fixture.shopId, (trx) =>
        completeOpeningInventoryBin(
          trx,
          fixture.shopId,
          task.recount_task_id,
          fixture.operatorId
        )
      )
    ).rejects.toThrow(/not yet resolved/);
  });

  it('routes a skipped line to review without establishing stock', async () => {
    const fixture = await createFixture();
    const { task, line } = await prepareOpeningInventoryLine(
      fixture,
      { record: false }
    );

    await withTenant(fixture.shopId, (trx) =>
      skipLine(trx, {
        shopId: fixture.shopId,
        recountTaskId: task.recount_task_id,
        recountLineId: line.recount_line_id,
        skipReason: 'bin_inaccessible',
        skippedBy: fixture.operatorId,
      })
    );

    const result = await withTenant(fixture.shopId, (trx) =>
      completeOpeningInventoryBin(
        trx,
        fixture.shopId,
        task.recount_task_id,
        fixture.operatorId
      )
    );

    expect(result.status).toBe('manual_review');
    expect(result.skipped).toBe(1);
    expect(result.movements).toBe(0);
    expect(result.units).toBe(0);
  });

  it('routes movement-contested observation to review without establishing stock', async () => {
    const fixture = await createFixture();
    const { task, line } = await prepareOpeningInventoryLine(
      fixture,
      { record: false }
    );

    await withTenant(fixture.shopId, (trx) =>
      trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        device_event_id: crypto.randomUUID(),
        shop_id: fixture.shopId,
        lasyncro_variant_id: fixture.variantId,
        movement_type: 'manual_adjustment',
        quantity_delta: 1,
        reference_type: 'recount_line',
        reference_id: crypto.randomUUID(),
        location_code: 'A-1',
        platform: 'wms',
        occurred_at: new Date(),
        triggered_by: 'test',
      })
    );

    await withTenant(fixture.shopId, (trx) =>
      recordCount(trx, {
        shopId: fixture.shopId,
        recountTaskId: task.recount_task_id,
        recountLineId: line.recount_line_id,
        countedQuantity: 1,
        countMethod: 'bin_quantity',
        countedBy: fixture.operatorId,
      })
    );

    const result = await withTenant(fixture.shopId, (trx) =>
      completeOpeningInventoryBin(
        trx,
        fixture.shopId,
        task.recount_task_id,
        fixture.operatorId
      )
    );

    expect(result.status).toBe('manual_review');
    expect(result.contested).toBe(1);
    expect(result.movements).toBe(0);
    expect(result.units).toBe(0);
  });

  it('routes recorded physical findings to review without establishing stock', async () => {
    const fixture = await createFixture();
    const { task, line } = await prepareOpeningInventoryLine(
      fixture,
      { recordQuantity: 1 }
    );

    await withTenant(fixture.shopId, (trx) =>
      createRecountFinding(trx, {
        shopId: fixture.shopId,
        recountTaskId: task.recount_task_id,
        reportedBy: fixture.operatorId,
        finding: {
          clientEventId: crypto.randomUUID(),
          recountLineId: line.recount_line_id,
          lasyncroVariantId: fixture.variantId,
          locationCode: 'A-1',
          findingType: 'product_defect',
          quantity: 1,
          notes: 'Opening reconciliation finding',
        },
      })
    );

    const result = await withTenant(fixture.shopId, (trx) =>
      completeOpeningInventoryBin(
        trx,
        fixture.shopId,
        task.recount_task_id,
        fixture.operatorId
      )
    );

    expect(result.status).toBe('manual_review');
    expect(result.findings).toBe(1);
    expect(result.movements).toBe(0);
    expect(result.units).toBe(0);
  });

  it('cannot use opening settlement for a cycle_count task', async () => {
    const fixture = await createFixture();

    const recountTaskId = crypto.randomUUID();

    await withTenant(fixture.shopId, (trx) =>
      trx('inventory_recount_tasks').insert({
        recount_task_id: recountTaskId,
        shop_id: fixture.shopId,
        warehouse_id: fixture.warehouseId,
        label: `CNT-${crypto.randomUUID().slice(0, 8)}`,
        scope: 'location',
        status: 'claimed',
        blind: true,
        assigned_to: fixture.operatorId,
        claimed_by: fixture.operatorId,
        created_by: fixture.ownerId,
      })
    );

    await expect(
      withTenant(fixture.shopId, (trx) =>
        completeOpeningInventoryBin(
          trx,
          fixture.shopId,
          recountTaskId,
          fixture.operatorId
        )
      )
    ).rejects.toThrow(/not an opening_inventory task/);
  });
});

async function addOpeningTestWarehouse(
  fixture: any,
  options?: {
    active?: boolean;
    binCount?: number;
  }
): Promise<{
  warehouseId: string;
  rootCode: string;
  binCodes: string[];
}> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-OPEN-${suffix}-ROOT`;
  const binCount = options?.binCount ?? 2;
  const binCodes = Array.from(
    { length: binCount },
    (_, index) => `OPEN-${suffix}-B${index + 1}`
  );

  await withTenant(fixture.shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: fixture.shopId,
      name: `Opening test ${suffix}`,
      root_location_code: rootCode,
      is_default: false,
      active: options?.active ?? true,
    });

    await trx('warehouse_locations').insert({
      location_code: rootCode,
      shop_id: fixture.shopId,
      warehouse_id: warehouseId,
      parent_location_code: null,
      type: 'warehouse',
      active: true,
    });

    for (const binCode of binCodes) {
      await trx('warehouse_locations').insert({
        location_code: binCode,
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        parent_location_code: rootCode,
        type: 'bin',
        active: true,
      });
    }
  });

  return {
    warehouseId,
    rootCode,
    binCodes,
  };
}

async function commitOpeningBinEmpty(
  fixture: any,
  recountTaskId: string
): Promise<void> {
  await withTenant(fixture.shopId, (trx) =>
    claimRecountTask(
      trx,
      fixture.shopId,
      recountTaskId,
      fixture.operatorId
    )
  );

  await withTenant(fixture.shopId, (trx) =>
    completeOpeningInventoryBin(
      trx,
      fixture.shopId,
      recountTaskId,
      fixture.operatorId
    )
  );
}

describe('shop-wide opening inventory reconciliation', () => {
  it('freezes all active bins across active warehouses and keeps the denominator stable on retry', async () => {
    const fixture = await createFixture();

    const secondWarehouse =
      await addOpeningTestWarehouse(fixture, {
        active: true,
        binCount: 2,
      });

    await addOpeningTestWarehouse(fixture, {
      active: false,
      binCount: 1,
    });

    await withTenant(fixture.shopId, (trx) =>
      trx('warehouse_locations')
        .where({
          shop_id: fixture.shopId,
          warehouse_id: fixture.warehouseId,
          location_code: 'A-2',
        })
        .update({ active: false })
    );

    const started = await withTenant(
      fixture.shopId,
      (trx) =>
        startShopOpeningInventoryReconciliation(
          trx,
          {
            shopId: fixture.shopId,
            createdBy: fixture.ownerId,
            assignedTo: fixture.operatorId,
          }
        )
    );

    expect(started.state).toBe('counting');
    expect(started.total_bins).toBe(3);
    expect(started.complete_bins).toBe(0);
    expect(started.progress_pct).toBe(0);
    expect(started.started_at).toBeTruthy();

    expect(
      started.bins.map((bin) => bin.location_code).sort()
    ).toEqual(
      ['A-1', ...secondWarehouse.binCodes].sort()
    );

    const frozenStartedAt =
      started.started_at?.toISOString();

    await addOpeningTestWarehouse(fixture, {
      active: true,
      binCount: 1,
    });

    const retry = await withTenant(
      fixture.shopId,
      (trx) =>
        startShopOpeningInventoryReconciliation(
          trx,
          {
            shopId: fixture.shopId,
            createdBy: fixture.ownerId,
            assignedTo: fixture.operatorId,
          }
        )
    );

    expect(retry.total_bins).toBe(3);
    expect(retry.started_at?.toISOString()).toBe(
      frozenStartedAt
    );

    const taskCount = await withTenant(
      fixture.shopId,
      async (trx) =>
        Number(
          (
            await trx('inventory_recount_tasks')
              .where({
                shop_id: fixture.shopId,
                purpose: 'opening_inventory',
              })
              .count<{ count: string }>('* as count')
              .first()
          )?.count ?? 0
        )
    );

    expect(taskCount).toBe(3);
  });

  it('derives shop progress independently from warehouse-specific map progress', async () => {
    const fixture = await createFixture();

    const secondWarehouse =
      await addOpeningTestWarehouse(fixture, {
        active: true,
        binCount: 2,
      });

    const started = await withTenant(
      fixture.shopId,
      (trx) =>
        startShopOpeningInventoryReconciliation(
          trx,
          {
            shopId: fixture.shopId,
            createdBy: fixture.ownerId,
            assignedTo: fixture.operatorId,
          }
        )
    );

    expect(started.total_bins).toBe(4);

    const defaultWarehouseTasks =
      started.bins.filter(
        (bin) =>
          bin.warehouse_id === fixture.warehouseId
      );

    expect(defaultWarehouseTasks).toHaveLength(2);

    for (const bin of defaultWarehouseTasks) {
      await commitOpeningBinEmpty(
        fixture,
        bin.recount_task_id
      );
    }

    const shopProgress = await withTenant(
      fixture.shopId,
      (trx) =>
        getShopOpeningInventoryProgress(
          trx,
          fixture.shopId
        )
    );

    expect(shopProgress).toMatchObject({
      state: 'counting',
      total_bins: 4,
      complete_bins: 2,
      remaining_bins: 2,
      progress_pct: 50,
      all_bins_settled: false,
    });

    const warehouseProgress = await withTenant(
      fixture.shopId,
      (trx) =>
        getOpeningInventoryProgress(
          trx,
          fixture.shopId,
          fixture.warehouseId
        )
    );

    expect(warehouseProgress).toMatchObject({
      total_bins: 2,
      complete_bins: 2,
      progress_pct: 100,
      all_bins_settled: true,
    });

    const otherWarehouseProgress =
      await withTenant(
        fixture.shopId,
        (trx) =>
          getOpeningInventoryProgress(
            trx,
            fixture.shopId,
            secondWarehouse.warehouseId
          )
      );

    expect(otherWarehouseProgress).toMatchObject({
      total_bins: 2,
      complete_bins: 0,
      progress_pct: 0,
      all_bins_settled: false,
    });
  });

  it('enters ready_for_cutover only after every frozen bin settles and expectation exactly matches', async () => {
    const fixture = await createFixture();

    await withTenant(fixture.shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .insert({
        external_variant_id: `gid://shopify/ProductVariant/${fixture.variantId}`,
          shop_id: fixture.shopId,
          lasyncro_variant_id: fixture.variantId,
          reported_quantity: 0,
          expected_quantity: 0,
          observed_at: new Date(),
        })
    );

    const started = await withTenant(
      fixture.shopId,
      (trx) =>
        startShopOpeningInventoryReconciliation(
          trx,
          {
            shopId: fixture.shopId,
            createdBy: fixture.ownerId,
            assignedTo: fixture.operatorId,
          }
        )
    );

    for (const bin of started.bins) {
      await commitOpeningBinEmpty(
        fixture,
        bin.recount_task_id
      );
    }

    const complete = await withTenant(
      fixture.shopId,
      (trx) =>
        getShopOpeningInventoryProgress(
          trx,
          fixture.shopId
        )
    );

    expect(complete).toMatchObject({
      state: 'ready_for_cutover',
      all_bins_settled: true,
      progress_pct: 100,
      difference_count: 0,
    });

    expect(complete.differences).toEqual([]);
  });

  it('reports Shopify-only expectation as review_required without fabricating physical stock', async () => {
    const fixture = await createFixture();

    await withTenant(fixture.shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .insert({
        external_variant_id: `gid://shopify/ProductVariant/${fixture.variantId}`,
          shop_id: fixture.shopId,
          lasyncro_variant_id: fixture.variantId,
          reported_quantity: 3,
          expected_quantity: 3,
          observed_at: new Date(),
        })
    );

    const started = await withTenant(
      fixture.shopId,
      (trx) =>
        startShopOpeningInventoryReconciliation(
          trx,
          {
            shopId: fixture.shopId,
            createdBy: fixture.ownerId,
            assignedTo: fixture.operatorId,
          }
        )
    );

    for (const bin of started.bins) {
      await commitOpeningBinEmpty(
        fixture,
        bin.recount_task_id
      );
    }

    const result = await withTenant(
      fixture.shopId,
      (trx) =>
        getShopOpeningInventoryProgress(
          trx,
          fixture.shopId
        )
    );

    expect(result.state).toBe('review_required');
    expect(result.differences).toEqual([
      {
        lasyncro_variant_id: fixture.variantId,
        expected_quantity: 3,
        observed_quantity: 0,
        delta: -3,
      },
    ]);

    const movementCount = await withTenant(
      fixture.shopId,
      async (trx) =>
        Number(
          (
            await trx('inventory_movements')
              .where({
                shop_id: fixture.shopId,
                movement_type:
                  'opening_inventory_reconcile',
              })
              .count<{ count: string }>('* as count')
              .first()
          )?.count ?? 0
        )
    );

    expect(movementCount).toBe(0);
  });

  it('reports physical-only opening stock as review_required with expected zero', async () => {
    const fixture = await createFixture();

    const started = await withTenant(
      fixture.shopId,
      (trx) =>
        startShopOpeningInventoryReconciliation(
          trx,
          {
            shopId: fixture.shopId,
            createdBy: fixture.ownerId,
            assignedTo: fixture.operatorId,
          }
        )
    );

    const firstBin = started.bins[0];

    await withTenant(fixture.shopId, (trx) =>
      claimRecountTask(
        trx,
        fixture.shopId,
        firstBin.recount_task_id,
        fixture.operatorId
      )
    );

    const line = await withTenant(
      fixture.shopId,
      (trx) =>
        addOpeningInventoryRecountLine(trx, {
          shopId: fixture.shopId,
          recountTaskId:
            firstBin.recount_task_id,
          lasyncroVariantId: fixture.variantId,
          addedBy: fixture.operatorId,
        })
    );

    await withTenant(fixture.shopId, (trx) =>
      recordCount(trx, {
        shopId: fixture.shopId,
        recountTaskId:
          firstBin.recount_task_id,
        recountLineId: line.recount_line_id,
        countedQuantity: 1,
        countMethod: 'bin_quantity',
        countedBy: fixture.operatorId,
      })
    );

    await withTenant(fixture.shopId, (trx) =>
      completeOpeningInventoryBin(
        trx,
        fixture.shopId,
        firstBin.recount_task_id,
        fixture.operatorId
      )
    );

    for (const bin of started.bins.slice(1)) {
      await commitOpeningBinEmpty(
        fixture,
        bin.recount_task_id
      );
    }

    const result = await withTenant(
      fixture.shopId,
      (trx) =>
        getShopOpeningInventoryProgress(
          trx,
          fixture.shopId
        )
    );

    expect(result.state).toBe('review_required');
    expect(result.differences).toEqual([
      {
        lasyncro_variant_id: fixture.variantId,
        expected_quantity: 0,
        observed_quantity: 1,
        delta: 1,
      },
    ]);
  });

  it('needs_bin_review dominates final comparison while any bin requires review', async () => {
    const fixture = await createFixture();

    const started = await withTenant(
      fixture.shopId,
      (trx) =>
        startShopOpeningInventoryReconciliation(
          trx,
          {
            shopId: fixture.shopId,
            createdBy: fixture.ownerId,
            assignedTo: fixture.operatorId,
          }
        )
    );

    await withTenant(fixture.shopId, (trx) =>
      trx('inventory_recount_tasks')
        .where({
          shop_id: fixture.shopId,
          recount_task_id:
            started.bins[0].recount_task_id,
        })
        .update({
          status: 'manual_review',
          updated_at: trx.fn.now(),
        })
    );

    const progress = await withTenant(
      fixture.shopId,
      (trx) =>
        getShopOpeningInventoryProgress(
          trx,
          fixture.shopId
        )
    );

    expect(progress.state).toBe('needs_bin_review');
    expect(progress.needs_review_bins).toBe(1);
    expect(progress.all_bins_settled).toBe(false);
    expect(progress.differences).toEqual([]);
  });
});

describe('shop-wide opening inventory frozen cohort guard', () => {
  it('rejects warehouse-level expansion after the shop-wide opening cohort is frozen', async () => {
    const fixture = await createFixture();

    const started = await withTenant(
      fixture.shopId,
      (trx) =>
        startShopOpeningInventoryReconciliation(
          trx,
          {
            shopId: fixture.shopId,
            createdBy: fixture.ownerId,
            assignedTo: fixture.operatorId,
          }
        )
    );

    const frozenTotal = started.total_bins;

    const lateWarehouse =
      await addOpeningTestWarehouse(fixture, {
        active: true,
        binCount: 1,
      });

    await expect(
      withTenant(
        fixture.shopId,
        (trx) =>
          startOpeningInventoryReconciliation(
            trx,
            {
              shopId: fixture.shopId,
              warehouseId:
                lateWarehouse.warehouseId,
              createdBy: fixture.ownerId,
              assignedTo: fixture.operatorId,
            }
          )
      )
    ).rejects.toThrow(
      /Shop-wide opening reconciliation cohort already frozen/
    );

    const progress = await withTenant(
      fixture.shopId,
      (trx) =>
        getShopOpeningInventoryProgress(
          trx,
          fixture.shopId
        )
    );

    expect(progress.total_bins).toBe(frozenTotal);

    expect(
      progress.bins.some(
        (bin) =>
          bin.warehouse_id ===
          lateWarehouse.warehouseId
      )
    ).toBe(false);

    const lateTaskCount = await withTenant(
      fixture.shopId,
      async (trx) =>
        Number(
          (
            await trx('inventory_recount_tasks')
              .where({
                shop_id: fixture.shopId,
                warehouse_id:
                  lateWarehouse.warehouseId,
                purpose: 'opening_inventory',
              })
              .count<{ count: string }>(
                '* as count'
              )
              .first()
          )?.count ?? 0
        )
    );

    expect(lateTaskCount).toBe(0);
  });
});
