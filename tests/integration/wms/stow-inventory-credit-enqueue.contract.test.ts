// tests/integration/wms/stow-inventory-credit-enqueue.contract.test.ts
//
// STOCK-PROTECT-03 Slice 4 — confirmStow must enqueue a Stock Protection
// snapshot job ONLY on its inventory-credit branch (isInventoryCredit ===
// true — return_restock / order_cancelled_mid_pick), never on an ordinary
// ROOT->bin transfer (net-zero change to total pickable availability).
// PERMANENT regression contract, authored RED (positive case) and
// BASELINE-GREEN (negative case).
// ===========================================================================
// REQUIRED RED: return_restock stow currently produces no shop_snapshot_jobs
// row — no enqueue call exists in confirmStow yet.
// BASELINE-GREEN GUARD: ordinary inbound_stock (transfer) stow currently
// produces no row either, correctly so — must stay that way once the credit
// branch gains its enqueue.

import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { confirmStow } from 'api-src/services/wms/stow.service';

async function createFixtureShop(unique: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sp-stow-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

/**
 * Builds the minimal FK chain confirmStow needs regardless of trigger:
 * product/variant, a warehouse with a ROOT + one pick bin, a synthetic
 * PO/receive-job/receive-job-line (inventory_units.receive_job_line_id is
 * NOT NULL even for a return-originated unit — "works for both PO and
 * no-PO receives — always non-null", per the table's own migration
 * comment), one inventory_units row (status='received', unlocated), and a
 * stow_tasks row with the given trigger.
 */
async function seedStowFixture(
  shopId: number,
  opts: { trigger: 'inbound_stock' | 'return_restock'; seedRootStock: boolean },
) {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;
  const binCode = 'A-1';

  const { stowTaskId, lasyncroUnitId, claimedBy } = await withTenant(shopId, async (trx) => {
    const [userRow] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `stow-fixture-${crypto.randomUUID().slice(0, 8)}@example.com`,
        password_hash: 'test-hash',
        role: 'operator',
      })
      .returning('id');
    const claimedBy = Number((userRow as any).id ?? userRow);

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Stow fixture product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SKU-${variantId.slice(0, 8)}`,
      title: 'Stow fixture variant',
      unit_cost: '5.00',
      status: 'active',
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Stow fixture warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      { shop_id: shopId, warehouse_id: warehouseId, location_code: rootCode, type: 'warehouse', parent_location_code: null, active: true, zone_type: null },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: binCode, type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' },
    ]);

    // Synthetic FK anchor chain — a real PO/receive-job is not the subject
    // under test; only inventory_units' NOT NULL receive_job_line_id needs
    // satisfying, for both the ordinary and the return-originated unit.
    const [supplierRow] = await trx('suppliers')
      .insert({ shop_id: shopId, name: 'Stow fixture supplier', active: true })
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
        description: 'Stow fixture line',
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

    if (opts.seedRootStock) {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await trx('inventory_truth').insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        location_code: rootCode,
        on_hand_quantity: 5,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: 5,
        last_evaluated_at: new Date(),
      });
    }

    const [stowTaskRow] = await trx('stow_tasks')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        quantity: 1,
        location_code: binCode,
        status: 'in_progress',
        trigger: opts.trigger,
        po_id: opts.trigger === 'inbound_stock' ? poId : null,
        claimed_by: claimedBy,
        claimed_at: new Date(),
      })
      .returning('stow_task_id');
    const stowTaskId = String((stowTaskRow as any).stow_task_id ?? stowTaskRow);

    return { stowTaskId, lasyncroUnitId, claimedBy };
  });

  return { variantId, stowTaskId, lasyncroUnitId, claimedBy };
}

async function hasSnapshotJob(shopId: number): Promise<boolean> {
  const row = await withTenant(shopId, (trx) =>
    trx('shop_snapshot_jobs').where({ shop_id: shopId }).first('shop_id'),
  );
  return row != null;
}

describe('confirmStow — Stock Protection enqueue conditioned on isInventoryCredit', () => {
  it('BASELINE-GREEN: ordinary inbound_stock transfer stow does NOT enqueue (net-zero pickable availability change)', async () => {
    const shopId = await createFixtureShop(`transfer-${crypto.randomUUID().slice(0, 8)}`);
    const { stowTaskId, lasyncroUnitId, claimedBy } = await seedStowFixture(shopId, {
      trigger: 'inbound_stock',
      seedRootStock: true,
    });

    const result = await withTenant(shopId, (trx) =>
      confirmStow(trx, { stowTaskId, shopId, claimedBy, quantityPlaced: 1, lasyncroUnitId }),
    );

    expect(result.isFullyPlaced).toBe(true);
    expect(await hasSnapshotJob(shopId)).toBe(false);
  });

  it('REQUIRED RED: return_restock (inventory-credit) stow DOES enqueue', async () => {
    const shopId = await createFixtureShop(`credit-${crypto.randomUUID().slice(0, 8)}`);
    const { stowTaskId, lasyncroUnitId, claimedBy } = await seedStowFixture(shopId, {
      trigger: 'return_restock',
      seedRootStock: false, // isInventoryCredit skips the debit entirely — no source stock needed
    });

    const result = await withTenant(shopId, (trx) =>
      confirmStow(trx, { stowTaskId, shopId, claimedBy, quantityPlaced: 1, lasyncroUnitId }),
    );

    expect(result.isFullyPlaced).toBe(true);
    expect(await hasSnapshotJob(shopId)).toBe(true);
  });
});
