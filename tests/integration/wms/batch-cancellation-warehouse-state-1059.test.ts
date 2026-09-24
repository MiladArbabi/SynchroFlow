/** GH-1059: cancelling a pending batch returns every order to the unreleased pool.
 * Real service + restricted tenant transactions; disposable integration DB only.
 * Active lines have complete reservation ownership, as required by R0-1.
 */
import { randomUUID } from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { cancelUnclaimedBatch } from 'api-src/services/wms/batchCancellation.service';

it('GH-1059 — cancellation removes order and line warehouse state for both returned orders', async () => {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `batch-cancel-1059-${randomUUID()}`);
    await setTenantContext(trx, id);
    return id;
  });
  const batchId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const warehouseId = randomUUID();
  const locationCode = `WH-${shopId}-ROOT`;
  const orders = [
    { orderId: randomUUID(), lineId: randomUUID() },
    { orderId: randomUUID(), lineId: randomUUID() },
  ];
  const orderIds = orders.map((order) => order.orderId).sort();
  const lineIds = orders.map((order) => order.lineId).sort();
  const now = new Date();

  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('warehouses').insert({
      warehouse_id: warehouseId, shop_id: shopId, name: 'Cancellation fixture',
      root_location_code: locationCode, is_default: true, active: true,
    });
    await trx('warehouse_locations').insert({
      shop_id: shopId, warehouse_id: warehouseId, location_code: locationCode,
      type: 'warehouse', parent_location_code: null, active: true,
    });
    await trx('products').insert({ lasyncro_product_id: productId, shop_id: shopId, title: 'Cancellation fixture', status: 'active' });
    await trx('variants').insert({ lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shopId, sku: 'CANCEL-1059', title: 'Fixture variant', unit_cost: '1.00', status: 'active' });
    await trx('pick_batches').insert({
      pick_batch_id: batchId, shop_id: shopId, status: 'pending', release_trigger: 'manual',
      max_line_items: 10, total_line_items: 2, total_units: 2, released_at: now,
    });
    for (const order of orders) {
      await trx('orders').insert({
        lasyncro_order_id: order.orderId, shop_id: shopId, payment_state: 'paid', currency: 'USD',
        total_price: '10.00', subtotal_price: '10.00', total_tax: '0.00',
        order_created_at: now, order_updated_at: now, created_at: now, updated_at: now,
      });
      await trx('order_line_items').insert({
        lasyncro_line_item_id: order.lineId, lasyncro_order_id: order.orderId,
        lasyncro_product_id: productId, lasyncro_variant_id: variantId, title: 'Cancellation fixture line',
        quantity: 1, unit_price: '10.00', line_total: '10.00', created_at: now, updated_at: now,
      });
      await trx('pick_batch_orders').insert({ pick_batch_id: batchId, lasyncro_order_id: order.orderId, shop_id: shopId });
      await trx('order_warehouse_status').insert({ lasyncro_order_id: order.orderId, pick_batch_id: batchId, status: 'awaiting_pick' });
      await trx('order_line_item_warehouse_status').insert({
        lasyncro_line_item_id: order.lineId, lasyncro_order_id: order.orderId, shop_id: shopId, status: 'awaiting_pick',
      });
      await trx('pick_reservation_allocations').insert({
        shop_id: shopId, pick_batch_id: batchId, lasyncro_order_id: order.orderId,
        lasyncro_line_item_id: order.lineId, lasyncro_variant_id: variantId,
        location_code: locationCode, quantity: 1,
      });
    }
    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: randomUUID(), shop_id: shopId,
      lasyncro_variant_id: variantId, location_code: locationCode,
      movement_type: 'reservation_hold', quantity_delta: 2,
      reference_type: 'pick_batch', reference_id: batchId,
      platform: 'wms', occurred_at: now, triggered_by: 'test_fixture',
    });
    await trx('inventory_truth').insert({
      shop_id: shopId, lasyncro_variant_id: variantId, location_code: locationCode,
      on_hand_quantity: 2, reserved_quantity: 2, committed_quantity: 0,
      available_quantity: 0, last_evaluated_at: now,
    });
  });

  const snapshot = () => withTenant(shopId, async (trx) => ({
    batch: await trx('pick_batches').where({ shop_id: shopId, pick_batch_id: batchId }).first('status'),
    memberships: await trx('pick_batch_orders').where({ shop_id: shopId, pick_batch_id: batchId }).orderBy('lasyncro_order_id').select('lasyncro_order_id'),
    orderStates: await trx('order_warehouse_status').whereIn('lasyncro_order_id', orderIds).orderBy('lasyncro_order_id').select('lasyncro_order_id', 'pick_batch_id', 'status'),
    lineStates: await trx('order_line_item_warehouse_status').where({ shop_id: shopId }).whereIn('lasyncro_line_item_id', lineIds).orderBy('lasyncro_line_item_id').select('lasyncro_line_item_id', 'lasyncro_order_id', 'status'),
  }));
  const before = await snapshot();
  expect(before.batch.status).toBe('pending');
  expect(before.memberships).toEqual(orderIds.map((id) => ({ lasyncro_order_id: id })));
  expect(before.orderStates).toEqual(orderIds.map((id) => ({ lasyncro_order_id: id, pick_batch_id: batchId, status: 'awaiting_pick' })));
  expect(before.lineStates).toEqual([...orders].sort((a, b) => a.lineId.localeCompare(b.lineId)).map((order) => ({
    lasyncro_line_item_id: order.lineId, lasyncro_order_id: order.orderId, status: 'awaiting_pick',
  })));

  // withTenant supplies the same tenant-scoped transaction used by the controller.
  const result = await withTenant(shopId, (trx) => cancelUnclaimedBatch(trx, shopId, batchId));
  const after = await snapshot();
  expect(result.status).toBe('cancelled');
  expect(result.returned_order_count).toBe(2);
  expect(result.released_units).toBe(2);
  expect(after.batch.status).toBe('cancelled');
  expect(after.memberships).toEqual([]);

  // One assertion exposes stale rows in BOTH tables even in the RED phase.
  expect({
    remainingOrderWarehouseRows: after.orderStates.length,
    remainingLineWarehouseRows: after.lineStates.length,
  }).toEqual({ remainingOrderWarehouseRows: 0, remainingLineWarehouseRows: 0 });
  await withTenant(shopId, async trx => {
    expect(await trx('pick_reservation_allocations').where({ shop_id: shopId, pick_batch_id: batchId })).toEqual([]);
    const truth = await trx('inventory_truth').where({ shop_id: shopId, lasyncro_variant_id: variantId }).first();
    expect(Number(truth.reserved_quantity)).toBe(0);
    expect(Number(truth.available_quantity)).toBe(2);
  });
});
