// tests/integration/inventory/eligibility-reservation-parity-1145d.test.ts
//
// GH-1145-D1 REGRESSION CONTRACT
// ------------------------------
// Originally A1-06 in opening-balance-physical-capacity-1145a, relocated here
// as a GH-1145-D characterization of the eligibility/reservation disagreement.
// GH-1145-D1 converts it into the desired parity regression:
//
//   eligibility permits -> reservation also permits.
//
// For genuine physical ROOT stock of a variant with no external barcode, zero
// inventory_units and zero label_printed_at evidence:
//
//   - evaluateInventoryConstraint (order eligibility) says the order is NOT
//     inventory-blocked;
//   - the real reserveBatchInventory must reserve the same stock: canonical
//     physical stock may Release/reserve regardless of barcode,
//     inventory_units, label_printed_at or barcode_print_jobs state.
//
// Scan identity/recovery belongs to Pick execution; Pick execution
// safeguards are not weakened by this contract.
//
// Fixture helpers are a minimal local copy of the 1145-A suite's helpers:
// test files cannot import each other without also registering their tests.
//
// No production code or schema is touched by this file.

import crypto from 'crypto';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import { evaluateInventoryConstraint } from 'api-src/services/constraints/evaluators/inventoryConstraintEvaluator';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { reserveBatchInventory } from 'api-src/services/wms/batchReservation.service';

jest.setTimeout(120000);

async function createShop(): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1145d-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

/** Minimal product/variant/warehouse-root fixture — no bins, no barcode. */
async function seedBarcodelessVariantAtRoot(shopId: number) {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;

  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'GH-1145-D fixture warehouse',
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
      zone_type: null,
    });

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'GH-1145-D fixture product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `GH1145D-${crypto.randomBytes(4).toString('hex')}`,
      title: 'GH-1145-D fixture variant',
      unit_cost: '5.00',
      status: 'active',
      barcode: null,
    });
  });

  return { productId, variantId, rootCode };
}

/** Genuine physical receipt (receiveJob-shaped) — NOT an opening_balance. */
async function recordGenuinePhysicalReceipt(
  shopId: number,
  variantId: string,
  locationCode: string,
  qty: number
) {
  await withTenant(shopId, (trx) =>
    trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(),
      device_event_id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      movement_type: 'inbound_purchase',
      quantity_delta: qty,
      reference_type: 'test_fixture_receipt',
      reference_id: crypto.randomUUID(),
      platform: 'wms',
      location_code: locationCode,
      occurred_at: new Date(),
      triggered_by: 'test_fixture',
    })
  );
}

async function createDemandOrder(
  shopId: number,
  productId: string,
  variantId: string,
  quantity: number
): Promise<{ orderId: string; lineItemId: string }> {
  const orderId = crypto.randomUUID();
  const lineItemId = crypto.randomUUID();
  const now = new Date();

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      aggregate_version: 1,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: null,
      title: 'GH-1145-D fixture line',
      quantity,
      fulfilled_quantity: 0,
      unit_price: '10.00',
      line_total: (10 * quantity).toFixed(2),
      estimated_unit_cost: '5.00',
    });

    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineItemId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      title: 'GH-1145-D fixture line',
      quantity,
      unit_price: '10.00',
      line_total: (10 * quantity).toFixed(2),
      created_at: now,
      updated_at: now,
    });
  });

  return { orderId, lineItemId };
}

/** Minimal pick_batches row — same shape as opening-balance-physical-capacity-1145a. */
async function createPickBatch(shopId: number): Promise<string> {
  const pickBatchId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('pick_batches').insert({
      pick_batch_id: pickBatchId,
      shop_id: shopId,
      status: 'pending',
      released_at: new Date(),
      release_trigger: 'manual',
      max_line_items: 10,
      total_line_items: 1,
      total_units: 1,
    })
  );
  return pickBatchId;
}

async function readRootTruth(shopId: number, variantId: string, rootCode: string) {
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: rootCode })
      .first('on_hand_quantity', 'reserved_quantity', 'available_quantity')
  );
  expect(row).toBeDefined();
  return {
    onHand: Number(row.on_hand_quantity),
    reserved: Number(row.reserved_quantity),
    available: Number(row.available_quantity),
  };
}

describe('GH-1145-D1 — eligibility / reservation parity', () => {
  it('barcode-less, unit-less, unlabelled physical ROOT stock that eligibility permits is also reserved by reserveBatchInventory', async () => {
    const shopId = await createShop();
    const { productId, variantId, rootCode } = await seedBarcodelessVariantAtRoot(shopId);

    await recordGenuinePhysicalReceipt(shopId, variantId, rootCode, 5);
    await withTenant(shopId, (trx) =>
      rebuildInventoryProjectionForVariants(shopId, [variantId], trx, new Date())
    );

    // Fixture preconditions: no external barcode, zero inventory_units,
    // therefore zero label_printed_at evidence.
    const readIdentity = () =>
      withTenant(shopId, async (trx) => ({
        variant: await trx('variants')
          .where({ shop_id: shopId, lasyncro_variant_id: variantId })
          .first('barcode'),
        units: await trx('inventory_units')
          .where({ shop_id: shopId, lasyncro_variant_id: variantId })
          .count<{ count: string }[]>('* as count'),
      }));
    const identity = await readIdentity();
    expect(identity.variant?.barcode ?? null).toBeNull();
    expect(Number(identity.units[0].count)).toBe(0);

    // 1. Eligibility: NOT inventory-blocked.
    const { orderId, lineItemId } = await createDemandOrder(shopId, productId, variantId, 5);
    const results = await withTenant(shopId, (trx) =>
      evaluateInventoryConstraint(trx, orderId, shopId)
    );
    const row = results.find((r) => r.targetId === variantId);
    expect(row).toBeDefined();
    const eligibilityBlocked = !!row?.isActive;
    expect(eligibilityBlocked).toBe(false);

    // 2. Reservation: the real reserveBatchInventory permits the same stock.
    const truthBefore = await readRootTruth(shopId, variantId, rootCode);
    const pickBatchId = await createPickBatch(shopId);

    const allocations = await withTenant(shopId, (trx) =>
      reserveBatchInventory(trx, {
        shopId,
        pickBatchId,
        releasedBy: null,
        lineItems: [
          {
            lasyncro_variant_id: variantId,
            quantity: 5,
            lasyncro_order_id: orderId,
            lasyncro_line_item_id: lineItemId,
          },
        ],
      })
    );

    // 3. Allocation is exactly ROOT qty 5.
    expect(allocations).toEqual([
      { lasyncroVariantId: variantId, locationCode: rootCode, quantity: 5 },
    ]);

    // 4. One reservation_hold for this batch/variant/location.
    const holds = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({
          shop_id: shopId,
          movement_type: 'reservation_hold',
          reference_type: 'pick_batch',
          reference_id: pickBatchId,
          lasyncro_variant_id: variantId,
          location_code: rootCode,
        })
        .select('quantity_delta')
    );
    expect(holds).toHaveLength(1);
    expect(Number(holds[0].quantity_delta)).toBe(5);

    // 5. One ownership row for the order line.
    const ownership = await withTenant(shopId, (trx) =>
      trx('pick_reservation_allocations')
        .where({
          shop_id: shopId,
          pick_batch_id: pickBatchId,
          lasyncro_order_id: orderId,
          lasyncro_line_item_id: lineItemId,
        })
        .select('lasyncro_variant_id', 'location_code', 'quantity')
    );
    expect(ownership).toHaveLength(1);
    expect(ownership[0].lasyncro_variant_id).toBe(variantId);
    expect(ownership[0].location_code).toBe(rootCode);
    expect(Number(ownership[0].quantity)).toBe(5);

    // 6-8. on_hand unchanged, reserved +5, available -5.
    const truthAfter = await readRootTruth(shopId, variantId, rootCode);
    expect(truthAfter.onHand).toBe(truthBefore.onHand);
    expect(truthAfter.reserved).toBe(truthBefore.reserved + 5);
    expect(truthAfter.available).toBe(truthBefore.available - 5);

    // 9. The fixture still proves what it claims: no barcode, zero units.
    const identityAfter = await readIdentity();
    expect(identityAfter.variant?.barcode ?? null).toBeNull();
    expect(Number(identityAfter.units[0].count)).toBe(0);
  });
});
