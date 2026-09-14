// tests/integration/inventory/recount-enqueue-ordering.contract.test.ts
//
// STOCK-PROTECT-03 Slice 4 — commitRecount must enqueue a Stock Protection
// snapshot job ONLY AFTER rebuildInventoryProjectionForVariants has already
// corrected inventory_truth. PERMANENT regression contract, authored RED.
// ===========================================================================
// REQUIRED RED (at authoring time): commitRecount currently calls
// rebuildInventoryProjectionForVariants but never enqueues anything at all —
// enqueueShopSnapshotJob does not exist and is not imported here yet.
//
// Proves genuine call ORDER (not merely "both eventually true") by spying,
// not mocking, both the real rebuild function and the real enqueue helper —
// the actual rebuild still runs against real Postgres, so inventory_truth
// really is corrected by the time the ordering assertion is checked.

import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { commitRecount } from 'api-src/services/wms/inventoryRecount.service';
import * as rebuildInventoryProjectionModule from 'api-src/services/inventory/rebuildInventoryProjection';
import * as enqueueShopSnapshotJobModule from 'api-src/services/shop-snapshot/enqueueShopSnapshotJob';

async function createFixtureShop(unique: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sp-recount-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedRecountFixture(shopId: number) {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;
  const locationCode = 'A-1';

  const { recountTaskId } = await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Recount fixture product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SKU-${variantId.slice(0, 8)}`,
      title: 'Recount fixture variant',
      unit_cost: '5.00',
      status: 'active',
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Recount fixture warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert({
      shop_id: shopId,
      warehouse_id: warehouseId,
      location_code: rootCode,
      type: 'warehouse',
      parent_location_code: null,
      active: true,
    });

    await trx('warehouse_locations').insert({
      shop_id: shopId,
      warehouse_id: warehouseId,
      location_code: locationCode,
      type: 'bin',
      parent_location_code: rootCode,
      active: true,
      zone_type: 'pick',
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: locationCode,
      on_hand_quantity: 10,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: 10,
      last_evaluated_at: new Date(),
    });

    // Recount rebuilds inventory_truth from the movement ledger.
    // Back the initial physical quantity with canonical ledger evidence so
    // the rebuild preserves 10 and then applies the recount correction +3.
    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(),
      device_event_id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      movement_type: 'opening_balance',
      quantity_delta: 10,
      reference_type: 'opening_balance',
      reference_id: crypto.randomUUID(),
      platform: 'shopify',
      location_code: locationCode,
      occurred_at: new Date(),
      triggered_by: 'system',
    });

    const [taskRow] = await trx('inventory_recount_tasks')
      .insert({
        shop_id: shopId,
        warehouse_id: warehouseId,
        label: `RC-${crypto.randomUUID().slice(0, 8)}`,
        scope: 'location',
        status: 'manual_review',
        blind: true,
      })
      .returning('recount_task_id');
    const recountTaskId = String((taskRow as any).recount_task_id ?? taskRow);

    await trx('inventory_recount_lines').insert({
      recount_task_id: recountTaskId,
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: locationCode,
      expected_quantity: 10,
      counted_quantity: 13,
      variance: 3,
      variance_reason: 'count_error',
    });

    return { recountTaskId };
  });

  return { variantId, locationCode, recountTaskId };
}

async function hasSnapshotJob(shopId: number): Promise<boolean> {
  const row = await withTenant(shopId, (trx) =>
    trx('shop_snapshot_jobs').where({ shop_id: shopId }).first('shop_id'),
  );
  return row != null;
}

describe('commitRecount — enqueue ordering relative to inventory_truth correction', () => {
  it('enqueues a Stock Protection snapshot job, and only after rebuildInventoryProjectionForVariants has run', async () => {
    const shopId = await createFixtureShop(`order-${crypto.randomUUID().slice(0, 8)}`);
    const { variantId, locationCode, recountTaskId } = await seedRecountFixture(shopId);

    const rebuildSpy = jest.spyOn(rebuildInventoryProjectionModule, 'rebuildInventoryProjectionForVariants');
    const enqueueSpy = jest.spyOn(enqueueShopSnapshotJobModule, 'enqueueShopSnapshotJob');

    try {
      await withTenant(shopId, async (trx) => {
        const [operator] = await trx('users')
          .insert({
            shop_id: shopId,
            email: `recount-operator-${crypto.randomUUID()}@test.example`,
            role: 'operator',
            password_hash: 'test',
          })
          .returning('id');

        await commitRecount(trx, shopId, recountTaskId, operator.id);
      });

      expect(rebuildSpy).toHaveBeenCalled();
      expect(enqueueSpy).toHaveBeenCalled();

      const rebuildOrder = rebuildSpy.mock.invocationCallOrder[0];
      const enqueueOrder = enqueueSpy.mock.invocationCallOrder[0];
      expect(rebuildOrder).toBeLessThan(enqueueOrder);

      // Corroborate: inventory_truth is genuinely already corrected — the
      // real rebuild ran (not mocked away), so the on-hand quantity now
      // reflects the +3 count-error correction (10 -> 13).
      const truthRow = await withTenant(shopId, (trx) =>
        trx('inventory_truth')
          .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode })
          .first('on_hand_quantity'),
      );
      expect(Number(truthRow.on_hand_quantity)).toBe(13);

      expect(await hasSnapshotJob(shopId)).toBe(true);
    } finally {
      rebuildSpy.mockRestore();
      enqueueSpy.mockRestore();
    }
  });
});
