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
} from 'api-src/services/wms/inventoryRecount.service';
import {
  startShopOpeningInventory,
  type OpeningInventoryLocationPageReader,
} from 'api-src/services/wms/shopifyOpeningInventorySnapshot.service';

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

    // These users participate in real WMS assignment/claim flows, so the
    // fixture must model the canonical active shop-membership boundary.
    await trx('shop_memberships').insert([
      {
        shop_id: shopId,
        user_id: ownerId,
        role: 'owner',
        revoked_at: null,
      },
      {
        shop_id: shopId,
        user_id: operatorId,
        role: 'operator',
        revoked_at: null,
      },
    ]);

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
      // GH-1179: shop-wide Opening Inventory start requires the participating
      // warehouse to be explicitly mapped to a Shopify Location.
      external_location_id: `${shopId}0001`,
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


import type { Knex } from 'knex';
import { lockLocationHierarchy } from 'api-src/services/inventory/locationHierarchy.service';
import { assertLocationLifecycleEligible } from 'api-src/services/inventory/locationLifecycleEligibility.service';
const complete = (f: Fixture, id: string, user = f.operatorId) => withTenant(f.shopId,
  trx => completeOpeningInventoryBin(trx, f.shopId, id, user));
async function prepared() {
  const f = await createFixture();
  const started = await withTenant(f.shopId, trx => startOpeningInventoryReconciliation(trx, {
    shopId: f.shopId, warehouseId: f.warehouseId, createdBy: f.ownerId, assignedTo: f.operatorId,
  }));
  const id = started.bins.find(b => b.location_code === 'A-1')!.recount_task_id;
  await withTenant(f.shopId, trx => claimRecountTask(trx, f.shopId, id, f.operatorId));
  return { f, id };
}
async function state(f: Fixture) {
  return withTenant(f.shopId, async trx => {
    const result: Record<string, any[]> = {};
    for (const table of ['inventory_recount_tasks', 'inventory_recount_lines', 'inventory_movements',
      'inventory_units', 'inventory_truth', 'shop_wms_settings', 'warehouse_locations']) {
      result[table] = await trx(table).where({ shop_id: f.shopId }).orderByRaw('to_jsonb(??)::text', [table]);
    }
    console.info('F3_DATABASE_STATE', JSON.stringify(result));
    return result;
  });
}
async function deactivate(f: Fixture) {
  await withTenant(f.shopId, async trx => {
    await assertLocationLifecycleEligible(trx, f.shopId, ['A-1']);
    expect(await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: 'A-1' })
      .update({ active: false })).toBe(1);
  });
}
async function unchanged(f: Fixture, action: () => Promise<unknown>, error: string) {
  const before = await state(f);
  await expect(action()).rejects.toThrow(error);
  expect(await state(f)).toEqual(before);
  console.info('F3_REJECTION', error, 'MUTATION_COUNT=0');
}
describe('GH-1305 F3 committed opening replay lifecycle', () => {
  it('replays the same committed empty result after safe deactivation repeatedly without writes', async () => {
    const { f, id } = await prepared();
    const result = await complete(f, id);
    expect(result).toEqual({ status: 'committed', movements: 0, units: 0, unresolved: 0,
      skipped: 0, contested: 0, findings: 0, preexisting_canonical_signals: 0 });
    await deactivate(f);
    const before = await state(f);
    for (let i = 0; i < 3; i++) {
      const replay = await complete(f, id);
      console.info('F3_REPLAY_RESPONSE', JSON.stringify(replay));
      expect(replay).toEqual(result);
    }
    expect(await state(f)).toEqual(before);
    expect(before.inventory_movements).toHaveLength(0); expect(before.inventory_units).toHaveLength(0);
    console.info('F3_REPLAY_MUTATION_COUNT=0');
  });
  it('rejects first completion at an inactive location and preserves unfinished work', async () => {
    const { f, id } = await prepared();
    await expect(deactivate(f)).rejects.toThrow('LOCATION_LIFECYCLE_BLOCKED: recount');
    // Adverse historical state: direct fixture write; no eligibility guard is disabled.
    await withTenant(f.shopId, trx => trx('warehouse_locations').where({ shop_id: f.shopId,
      location_code: 'A-1' }).update({ active: false }));
    await unchanged(f, () => complete(f, id), 'RECOUNT_LOCATION_INELIGIBLE');
  });
  it('rejects unknown task, wrong operator, foreign task and mismatched tenant context even for committed history', async () => {
    const { f, id } = await prepared(); const foreign = await createFixture();
    await complete(f, id); await deactivate(f);
    await unchanged(f, () => complete(f, crypto.randomUUID()), 'Task not found');
    await unchanged(f, () => complete(f, id, f.ownerId), 'different operator');
    await unchanged(f, () => complete(f, id, -1), 'different operator');
    await unchanged(foreign, () => complete(foreign, id), 'Task not found');
    await unchanged(f, () => withTenant(foreign.shopId, trx => completeOpeningInventoryBin(trx,
      f.shopId, id, f.operatorId)), 'LOCATION_TENANT_CONTEXT_INVALID');
  });
  it('rejects an unresolved line and an unclaimed task without writes', async () => {
    const { f, id } = await prepared();
    await withTenant(f.shopId, trx => addOpeningInventoryRecountLine(trx, { shopId: f.shopId,
      recountTaskId: id, lasyncroVariantId: f.variantId, addedBy: f.operatorId }));
    await unchanged(f, () => complete(f, id), 'not yet resolved');
    const before = await state(f);
    const other = before.inventory_recount_tasks.find(t => t.scope_location_code === 'A-2');
    await unchanged(f, () => complete(f, other.recount_task_id), 'different operator');
  });
  it('preserves caller rollback of first completion', async () => {
    const { f, id } = await prepared();
    await unchanged(f, () => withTenant(f.shopId, async trx => {
      await completeOpeningInventoryBin(trx, f.shopId, id, f.operatorId);
      throw new Error('F3_CALLER_ROLLBACK');
    }), 'F3_CALLER_ROLLBACK');
    expect((await complete(f, id)).status).toBe('committed');
  });
  it('serializes overlapping completion and replay to one durable outcome', async () => {
    const { f, id } = await prepared();
    const r = await overlap(f.shopId,
      trx => completeOpeningInventoryBin(trx, f.shopId, id, f.operatorId),
      trx => completeOpeningInventoryBin(trx, f.shopId, id, f.operatorId));
    expect(r.first.error).toBeNull(); expect(r.second.error).toBeNull();
    expect(r.second.value).toEqual(r.first.value);
    await deactivate(f);
    const before = await state(f);
    expect(await complete(f, id)).toEqual(r.first.value);
    expect(await state(f)).toEqual(before);
    expect(before.inventory_recount_tasks.filter(t => t.status === 'committed')).toHaveLength(1);
    expect(before.inventory_movements).toHaveLength(0); expect(before.inventory_units).toHaveLength(0);
  });
});

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
