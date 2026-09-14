// tests/integration/inventory/receive-close-enqueue.contract.test.ts
//
// STOCK-PROTECT-03 Slice 4 — closeReceiveJob is the single consequential
// receive-flow operation that must enqueue a Stock Protection snapshot job.
// PERMANENT regression contract, authored RED.
// ===========================================================================
// REQUIRED RED (at authoring time): closeReceiveJob currently produces no
// shop_snapshot_jobs row at all — confirmed by trace, no enqueue call exists
// anywhere in the receive flow yet.
//
// Also locks the negative half of the same contract: createReceiveJob alone
// (before any inspection/close) must NOT enqueue — it changes no canonical
// Stock Protection input (BASELINE-GREEN today, must stay true once the
// positive enqueue is added to closeReceiveJob specifically).

import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  createReceiveJob,
  inspectReceiveJobLine,
  closeReceiveJob,
} from 'api-src/services/wms/receiveJob.service';

async function createFixtureShop(unique: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sp-receive-close-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedFixtureUser(shopId: number): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [userRow] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `receive-close-fixture-${crypto.randomUUID().slice(0, 8)}@example.com`,
        password_hash: 'test-hash',
        role: 'operator',
      })
      .returning('id');
    return Number((userRow as any).id ?? userRow);
  });
}

async function seedProductAndVariant(shopId: number): Promise<{ productId: string; variantId: string }> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Receive-close fixture product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SKU-${variantId.slice(0, 8)}`,
      title: 'Receive-close fixture variant',
      unit_cost: '5.00',
      status: 'active',
      // A real merchant barcode satisfies receiveBarcodeReadiness's
      // authoritative rule without needing inventory_units/label printing.
      barcode: '1234567890123',
    });
  });
  return { productId, variantId };
}

async function seedPoWithLine(shopId: number, variantId: string, qty: number) {
  return withTenant(shopId, async (trx) => {
    const [supplierRow] = await trx('suppliers')
      .insert({ shop_id: shopId, name: 'Receive-close fixture supplier', active: true })
      .returning('id');
    const supplierId = Number((supplierRow as any).id ?? supplierRow);

    const [poRow] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: supplierId, status: 'shipped' })
      .returning('id');
    const poId = String((poRow as any).id ?? poRow);

    const [lineRow] = await trx('purchase_order_line_items')
      .insert({
        po_id: poId,
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        description: 'Receive-close fixture line',
        quantity_ordered: qty,
        quantity_received: 0,
      })
      .returning('id');

    return { poId, poLineItemId: (lineRow as any).id ?? lineRow };
  });
}

async function hasSnapshotJob(shopId: number): Promise<boolean> {
  const row = await withTenant(shopId, (trx) =>
    trx('shop_snapshot_jobs').where({ shop_id: shopId }).first('shop_id'),
  );
  return row != null;
}

describe('closeReceiveJob — Stock Protection enqueue placement', () => {
  it('createReceiveJob alone does not enqueue (no consequential state has changed yet)', async () => {
    const shopId = await createFixtureShop(`create-only-${crypto.randomUUID().slice(0, 8)}`);
    const { variantId } = await seedProductAndVariant(shopId);
    const { poId } = await seedPoWithLine(shopId, variantId, 5);

    await withTenant(shopId, (trx) => createReceiveJob(trx, { shopId, poId, operatorId: null as any }));

    expect(await hasSnapshotJob(shopId)).toBe(false);
  });

  it('closeReceiveJob enqueues a Stock Protection snapshot job after the consequential writes complete', async () => {
    const shopId = await createFixtureShop(`close-${crypto.randomUUID().slice(0, 8)}`);
    const { variantId } = await seedProductAndVariant(shopId);
    const { poId } = await seedPoWithLine(shopId, variantId, 5);

    const receiveJobId = await withTenant(shopId, (trx) =>
      createReceiveJob(trx, { shopId, poId, operatorId: null as any }),
    );

    const line = await withTenant(shopId, (trx) =>
      trx('receive_job_lines').where({ shop_id: shopId, receive_job_id: receiveJobId }).first(),
    );

    const operatorId = await seedFixtureUser(shopId);

    await withTenant(shopId, (trx) =>
      inspectReceiveJobLine(trx, {
        shopId,
        receiveJobId,
        lasyncroVariantId: variantId,
        receiveJobLineId: line.receive_job_line_id,
        quantityAccepted: 5,
        quantityRejected: 0,
        inspectedBy: operatorId,
      }),
    );

    await withTenant(shopId, (trx) =>
      closeReceiveJob(trx, {
        shopId,
        receiveJobId,
        actualDeliveryDate: '2026-09-14',
        closedBy: operatorId,
      }),
    );

    // Sanity: the consequential writes this enqueue depends on really happened.
    const poLine = await withTenant(shopId, (trx) =>
      trx('purchase_order_line_items').where({ po_id: poId, shop_id: shopId }).first(),
    );
    expect(Number(poLine.quantity_received)).toBe(5);

    expect(await hasSnapshotJob(shopId)).toBe(true);
  });
});
