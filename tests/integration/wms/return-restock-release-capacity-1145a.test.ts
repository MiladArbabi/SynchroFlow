// tests/integration/wms/return-restock-release-capacity-1145a.test.ts
//
// GH-1145-A1 RETURN-01 — WMS return restock after PHYSICAL execution is
// trusted physical capacity, including for reconcile_opening_expectation_v2
// tenants (whose Shopify refund webhook alone mints none — see
// refund-webhook-physicality-1145a.test.ts).
//
// Drives the real confirmStow on a return_restock stow task (the
// inventory-credit branch: refund_return, platform 'wms', triggered_by
// 'stow') and reads capacity through the shared readReleaseCapacity.
//
// Fixture shape mirrors stow-inventory-credit-enqueue.contract.test.ts.

import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { confirmStow } from 'api-src/services/wms/stow.service';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { readReleaseCapacity } from 'api-src/services/inventory/releaseCapacity.service';

jest.setTimeout(120000);

async function createV2Shop(): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1145a-return-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
  await withTenant(shopId, (trx) =>
    trx('shop_wms_settings').insert({
      shop_id: shopId,
      bootstrap_model: 'reconcile_opening_expectation_v2',
    })
  );
  return shopId;
}

async function seedReturnRestockStow(shopId: number) {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;
  const binCode = 'A-1';

  const seeded = await withTenant(shopId, async (trx) => {
    const [userRow] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `return-restock-${crypto.randomUUID().slice(0, 8)}@example.com`,
        password_hash: 'test-hash',
        role: 'operator',
      })
      .returning('id');
    const claimedBy = Number((userRow as any).id ?? userRow);

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Return restock product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `RR-${variantId.slice(0, 8)}`,
      title: 'Return restock variant',
      unit_cost: '5.00',
      status: 'active',
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Return restock warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      { shop_id: shopId, warehouse_id: warehouseId, location_code: rootCode, type: 'warehouse', parent_location_code: null, active: true, zone_type: null },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: binCode, type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' },
    ]);

    // inventory_units.receive_job_line_id is NOT NULL even for a
    // return-originated unit — synthetic FK anchor chain only.
    const [supplierRow] = await trx('suppliers')
      .insert({ shop_id: shopId, name: 'Return restock supplier', active: true })
      .returning('id');
    const supplierId = Number((supplierRow as any).id ?? supplierRow);
    const [poRow] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: supplierId, status: 'shipped' })
      .returning('id');
    const poId = String((poRow as any).id ?? poRow);
    const [poLineRow] = await trx('purchase_order_line_items')
      .insert({
        po_id: poId,
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        description: 'Return restock line',
        quantity_ordered: 1,
        quantity_received: 1,
      })
      .returning('id');
    const [receiveJobRow] = await trx('receive_jobs')
      .insert({ shop_id: shopId, po_id: poId, status: 'closed', total_variants: 1, total_units: 1 })
      .returning('receive_job_id');
    const receiveJobId = String((receiveJobRow as any).receive_job_id ?? receiveJobRow);
    const [receiveJobLineRow] = await trx('receive_job_lines')
      .insert({
        shop_id: shopId,
        receive_job_id: receiveJobId,
        po_line_item_id: (poLineRow as any).id ?? poLineRow,
        lasyncro_variant_id: variantId,
        quantity_expected: 1,
        quantity_accepted: 1,
        inspection_complete: true,
      })
      .returning('receive_job_line_id');
    const receiveJobLineId = String((receiveJobLineRow as any).receive_job_line_id ?? receiveJobLineRow);

    const lasyncroUnitId = `LSU-${crypto.randomUUID().slice(0, 12)}`;
    await trx('inventory_units').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      receive_job_line_id: receiveJobLineId,
      receive_sequence: 1,
      status: 'received',
      current_location_code: null,
      lasyncro_unit_id: lasyncroUnitId,
    });

    const [stowTaskRow] = await trx('stow_tasks')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        quantity: 1,
        location_code: binCode,
        status: 'in_progress',
        trigger: 'return_restock',
        po_id: null,
        claimed_by: claimedBy,
        claimed_at: new Date(),
      })
      .returning('stow_task_id');
    const stowTaskId = String((stowTaskRow as any).stow_task_id ?? stowTaskRow);

    return { stowTaskId, lasyncroUnitId, claimedBy };
  });

  return { variantId, binCode, ...seeded };
}

async function capacityRows(shopId: number, variantId: string) {
  return withTenant(shopId, (trx) =>
    readReleaseCapacity(trx, { shopId, variantIds: [variantId], lock: 'none' })
  );
}

describe('GH-1145-A1 — WMS return restock is physical release capacity', () => {
  it('RETURN-01: a v2 tenant\'s physically executed return_restock stow increases readReleaseCapacity', async () => {
    const shopId = await createV2Shop();
    const { variantId, binCode, stowTaskId, lasyncroUnitId, claimedBy } =
      await seedReturnRestockStow(shopId);

    expect(await capacityRows(shopId, variantId)).toEqual([]);

    const result = await withTenant(shopId, (trx) =>
      confirmStow(trx, { stowTaskId, shopId, claimedBy, quantityPlaced: 1, lasyncroUnitId })
    );
    expect(result.isFullyPlaced).toBe(true);

    const credit = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, movement_type: 'refund_return' })
        .select('quantity_delta', 'location_code', 'platform', 'triggered_by')
    );
    expect(credit).toEqual([
      { quantity_delta: 1, location_code: binCode, platform: 'wms', triggered_by: 'stow' },
    ]);

    // Live projection write and a full ledger replay agree.
    expect(await capacityRows(shopId, variantId)).toEqual([
      { lasyncroVariantId: variantId, locationCode: binCode, locationRank: 0, availableQuantity: 1 },
    ]);

    await withTenant(shopId, (trx) =>
      rebuildInventoryProjectionForVariants(shopId, [variantId], trx, new Date())
    );
    expect(await capacityRows(shopId, variantId)).toEqual([
      { lasyncroVariantId: variantId, locationCode: binCode, locationRank: 0, availableQuantity: 1 },
    ]);
  });
});
