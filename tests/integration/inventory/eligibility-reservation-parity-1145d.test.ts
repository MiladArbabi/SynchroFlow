// tests/integration/inventory/eligibility-reservation-parity-1145d.test.ts
//
// GH-1145-D CHARACTERIZATION
// --------------------------
// This is intentionally CURRENT DEFECTIVE BEHAVIOUR, pinned so it cannot
// change silently. It was A1-06 in opening-balance-physical-capacity-1145a
// and was relocated here because it belongs to GH-1145-D, not GH-1145-A1.
//
// For the same physical stock state — genuine physical ROOT stock, a variant
// with no external barcode, zero inventory_units, zero label_printed_at
// evidence — the two release gates disagree today:
//
//   - evaluateInventoryConstraint (order eligibility) reads only
//     inventory_truth and says the order is NOT inventory-blocked;
//   - assertPickAllocationsScanReady (called by reserveBatchInventory before
//     any reservation_hold is written) requires a variant barcode OR enough
//     label-printed inventory_units, and throws PickExecutionReadinessError
//     with code PICK_SCAN_READINESS_REQUIRED.
//
// When GH-1145-D removes label/print readiness from Release, this test MUST
// be rewritten into the desired parity regression:
//   eligibility permits -> reservation also permits.
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
import {
  assertPickAllocationsScanReady,
  PickExecutionReadinessError,
  PICK_SCAN_READINESS_REQUIRED,
} from 'api-src/services/wms/pickExecutionReadiness.service';

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
): Promise<string> {
  const orderId = crypto.randomUUID();
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
  });

  return orderId;
}

describe('GH-1145-D — eligibility vs reservation-readiness (CHARACTERIZATION)', () => {
  it('CURRENT DEFECT: eligibility permits barcode-less, unit-less physical ROOT stock while reservation-readiness throws PICK_SCAN_READINESS_REQUIRED', async () => {
    const shopId = await createShop();
    const { productId, variantId, rootCode } = await seedBarcodelessVariantAtRoot(shopId);

    await recordGenuinePhysicalReceipt(shopId, variantId, rootCode, 5);
    await withTenant(shopId, (trx) =>
      rebuildInventoryProjectionForVariants(shopId, [variantId], trx, new Date())
    );

    // Fixture preconditions: no external barcode, zero inventory_units,
    // therefore zero label_printed_at evidence.
    const identity = await withTenant(shopId, async (trx) => ({
      variant: await trx('variants')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .first('barcode'),
      units: await trx('inventory_units')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .count<{ count: string }[]>('* as count'),
    }));
    expect(identity.variant?.barcode ?? null).toBeNull();
    expect(Number(identity.units[0].count)).toBe(0);

    // 1. Eligibility: NOT inventory-blocked.
    const orderId = await createDemandOrder(shopId, productId, variantId, 5);
    const results = await withTenant(shopId, (trx) =>
      evaluateInventoryConstraint(trx, orderId, shopId)
    );
    const row = results.find((r) => r.targetId === variantId);
    expect(row).toBeDefined();
    const eligibilityBlocked = !!row?.isActive;
    expect(eligibilityBlocked).toBe(false);

    // 2. Reservation-readiness: throws PICK_SCAN_READINESS_REQUIRED for the
    //    same variant, same location, same quantity.
    let caught: unknown = null;
    await withTenant(shopId, async (trx) => {
      try {
        await assertPickAllocationsScanReady(trx, shopId, [
          { lasyncroVariantId: variantId, locationCode: rootCode, quantity: 5 },
        ]);
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBeInstanceOf(PickExecutionReadinessError);
    expect((caught as PickExecutionReadinessError).code).toBe(
      PICK_SCAN_READINESS_REQUIRED
    );
    expect((caught as PickExecutionReadinessError).code).toBe(
      'PICK_SCAN_READINESS_REQUIRED'
    );
  });
});
