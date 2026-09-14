// tests/integration/inventory/stock-protection-monitoring-evidence.contract.test.ts
//
// STOCK-PROTECT-03 Slice 2 — DB integration contract for the dark
// monitoring/evidence service. PERMANENT regression contract, authored RED.
// ============================================================================
// INDEPENDENTLY RED
//   Imports a service module that does not exist yet:
//     api-src/services/inventory/stockProtectionMonitoring
//   expecting exports getStockProtectionActionEvidence(trx, shopId,
//   variantIds?) and evaluateStockProtectionForShop(trx, shopId, variantIds?).
//   The import fails with MODULE_NOT_FOUND until Slice 2 exists.
//
// TEST ECONOMY (per Slice 2 design note)
//   PO-status -> evidence-boolean classification (received/cancelled/
//   dismissed exclusion included) is tested directly against
//   getStockProtectionActionEvidence, which needs only reorder_requests /
//   purchase_orders / purchase_order_line_items rows — no Demand planning
//   fixture. Full evaluateStockProtectionForShop tests (urgency + evidence
//   -> treatment) use the smallest Demand fixture that reaches each urgency
//   value, reusing the seedAvailability/seedFulfilledSale/seedSupplier
//   pattern from tests/integration/suppliers/sourcing-worklist-contract.test.ts.
//   The 31 precedence combinations already proved pure at the unit layer
//   (tests/unit/inventory/stock-protection-treatment.test.ts) are NOT
//   re-proved here.
//
// DARK CONTRACT
//   This slice writes nothing to alerts, stock_protection_policies,
//   reorder_requests, purchase_orders, or shop_snapshot_jobs. It is not
//   called from any worker/controller/alert path — these tests only prove
//   the service's own read-only correctness in isolation.

import crypto from 'crypto';
import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  getStockProtectionActionEvidence,
  evaluateStockProtectionForShop,
} from 'api-src/services/inventory/stockProtectionMonitoring';

const now = new Date('2026-09-13T12:00:00.000Z');

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedProductAndVariant(shopId: number): Promise<{ productId: string; variantId: string }> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Monitoring fixture product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SKU-${variantId.slice(0, 8)}`,
      title: 'Monitoring fixture variant',
      unit_cost: '5.00',
      status: 'active',
    });
  });
  return { productId, variantId };
}

async function seedPickableWarehouse(shopId: number): Promise<string> {
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;
  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Monitoring fixture warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      { shop_id: shopId, warehouse_id: warehouseId, location_code: rootCode, type: 'warehouse', parent_location_code: null, active: true, zone_type: null },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: 'A-1', type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' },
    ]);
  });
  return 'A-1';
}

async function seedAvailability(shopId: number, variantId: string, locationCode: string, qty: number) {
  await withTenant(shopId, async (trx) => {
    // inventory_truth is projection-owned (single-writer trigger). Mechanical
    // fixture prerequisite, not a business-semantics change.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: locationCode,
      on_hand_quantity: qty,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: qty,
      last_evaluated_at: now,
    });
  });
}

/** A fulfilled sale: contributes velocity history AND units_sold_all_time. */
async function seedFulfilledSale(
  shopId: number,
  productId: string,
  variantId: string,
  quantity: number,
  fulfilledAt: Date,
  externalSuffix: string,
) {
  const orderId = crypto.randomUUID();
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
      order_created_at: fulfilledAt,
      order_updated_at: fulfilledAt,
      created_at: fulfilledAt,
      updated_at: fulfilledAt,
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: `${Date.now()}${externalSuffix}`,
    });
    // order_fulfillment_status is projection-owned (single-writer trigger).
    // Mechanical fixture prerequisite, not a business-semantics change.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: null,
      title: 'Monitoring fixture fulfilled sale',
      quantity,
      fulfilled_quantity: quantity,
      unit_price: '100.00',
      line_total: (100 * quantity).toFixed(2),
      estimated_unit_cost: '5.00',
    });
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'fulfilled',
      status_updated_at: fulfilledAt,
      fulfilled_at: fulfilledAt,
    });
  });
}

async function seedSupplier(shopId: number, name: string, leadTimeDays: number | null = null) {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers')
      .insert({ shop_id: shopId, name, active: true, lead_time_days: leadTimeDays })
      .returning('id');
    return Number((row as any).id ?? row);
  });
}

async function seedPo(
  shopId: number,
  supplierId: number,
  status: string,
  lines: Array<{ variantId: string | null; quantityOrdered: number; quantityReceived?: number }>,
): Promise<string> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: supplierId, status })
      .returning('id');
    const poId = String((row as any).id ?? row);
    for (const line of lines) {
      await trx('purchase_order_line_items').insert({
        po_id: poId,
        shop_id: shopId,
        lasyncro_variant_id: line.variantId,
        description: 'Monitoring fixture line',
        quantity_ordered: line.quantityOrdered,
        quantity_received: line.quantityReceived ?? 0,
      });
    }
    return poId;
  });
}

async function seedReorderRequest(
  shopId: number,
  supplierId: number,
  variantId: string,
  status: 'pending' | 'converted' | 'dismissed' = 'pending',
) {
  await withTenant(shopId, async (trx) => {
    await trx('reorder_requests').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      supplier_id: supplierId,
      qty_requested: 5,
      source: 'manual',
      status,
    });
  });
}

describe('STOCK-PROTECT-03 Slice 2 — evidence classification (getStockProtectionActionEvidence)', () => {
  it('EV-01: no reorder/PO rows at all -> no evidence entry for the variant', async () => {
    const shopId = await createFixtureShop('spmonev01');
    const { variantId } = await seedProductAndVariant(shopId);

    const evidence = await withTenant(shopId, (trx) =>
      getStockProtectionActionEvidence(trx, shopId, [variantId]),
    );

    expect(evidence.has(variantId)).toBe(false);
  });

  it('EV-02: pending reorder_request -> hasPendingReorderRequest=true only', async () => {
    const shopId = await createFixtureShop('spmonev02');
    const { variantId } = await seedProductAndVariant(shopId);
    const supplierId = await seedSupplier(shopId, 'Evidence Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const evidence = await withTenant(shopId, (trx) =>
      getStockProtectionActionEvidence(trx, shopId, [variantId]),
    );

    expect(evidence.get(variantId)).toEqual({
      hasPendingReorderRequest: true,
      hasDraftPo: false,
      hasCommittedPo: false,
      hasReceivingBoundaryPo: false,
    });
  });

  it('EV-03: dismissed reorder_request is NOT active evidence', async () => {
    const shopId = await createFixtureShop('spmonev03');
    const { variantId } = await seedProductAndVariant(shopId);
    const supplierId = await seedSupplier(shopId, 'Evidence Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'dismissed');

    const evidence = await withTenant(shopId, (trx) =>
      getStockProtectionActionEvidence(trx, shopId, [variantId]),
    );

    expect(evidence.has(variantId)).toBe(false);
  });

  it.each([
    ['draft', 'hasDraftPo'],
    ['ordered', 'hasCommittedPo'],
    ['confirmed', 'hasCommittedPo'],
    ['in_production', 'hasCommittedPo'],
    ['shipped', 'hasReceivingBoundaryPo'],
    ['partially_received', 'hasReceivingBoundaryPo'],
  ] as const)('EV-04 (%s): PO status classifies as %s', async (status, expectedFlag) => {
    const shopId = await createFixtureShop(`spmonev04${status}`);
    const { variantId } = await seedProductAndVariant(shopId);
    const supplierId = await seedSupplier(shopId, 'Evidence Supplier');
    await seedPo(shopId, supplierId, status, [{ variantId, quantityOrdered: 10 }]);

    const evidence = await withTenant(shopId, (trx) =>
      getStockProtectionActionEvidence(trx, shopId, [variantId]),
    );

    const flags = evidence.get(variantId);
    expect(flags).toBeDefined();
    for (const key of ['hasPendingReorderRequest', 'hasDraftPo', 'hasCommittedPo', 'hasReceivingBoundaryPo'] as const) {
      expect(flags![key]).toBe(key === expectedFlag);
    }
  });

  it.each(['received', 'cancelled'] as const)(
    'EV-05 (%s): PO status is resolved history, NOT active evidence',
    async (status) => {
      const shopId = await createFixtureShop(`spmonev05${status}`);
      const { variantId } = await seedProductAndVariant(shopId);
      const supplierId = await seedSupplier(shopId, 'Evidence Supplier');
      await seedPo(shopId, supplierId, status, [{ variantId, quantityOrdered: 10, quantityReceived: status === 'received' ? 10 : 0 }]);

      const evidence = await withTenant(shopId, (trx) =>
        getStockProtectionActionEvidence(trx, shopId, [variantId]),
      );

      expect(evidence.has(variantId)).toBe(false);
    },
  );

  it('EV-06: variant filter evaluates ONLY requested variants', async () => {
    const shopId = await createFixtureShop('spmonev06');
    const { variantId: variantA } = await seedProductAndVariant(shopId);
    const { variantId: variantB } = await seedProductAndVariant(shopId);
    const supplierId = await seedSupplier(shopId, 'Evidence Supplier');
    await seedReorderRequest(shopId, supplierId, variantA, 'pending');
    await seedReorderRequest(shopId, supplierId, variantB, 'pending');

    const evidence = await withTenant(shopId, (trx) =>
      getStockProtectionActionEvidence(trx, shopId, [variantA]),
    );

    expect(evidence.has(variantA)).toBe(true);
    expect(evidence.has(variantB)).toBe(false);
  });

  it('EV-08: variantIds=[] returns an empty Map immediately, even with active evidence in the DB', async () => {
    const shopId = await createFixtureShop('spmonev08');
    const { variantId } = await seedProductAndVariant(shopId);
    const supplierId = await seedSupplier(shopId, 'Evidence Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');
    await seedPo(shopId, supplierId, 'shipped', [{ variantId, quantityOrdered: 5 }]);

    const evidence = await withTenant(shopId, (trx) =>
      getStockProtectionActionEvidence(trx, shopId, []),
    );

    expect(evidence.size).toBe(0);
  });

  it('EV-07: evidence lookup performs no DB writes', async () => {
    const shopId = await createFixtureShop('spmonev07');
    const { variantId } = await seedProductAndVariant(shopId);
    const supplierId = await seedSupplier(shopId, 'Evidence Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');
    await seedPo(shopId, supplierId, 'draft', [{ variantId, quantityOrdered: 3 }]);

    const countsBefore = await withTenant(shopId, async (trx) => ({
      reorderRequests: Number((await trx('reorder_requests').where({ shop_id: shopId }).count({ n: '*' }).first())?.n ?? 0),
      purchaseOrders: Number((await trx('purchase_orders').where({ shop_id: shopId }).count({ n: '*' }).first())?.n ?? 0),
    }));

    await withTenant(shopId, (trx) => getStockProtectionActionEvidence(trx, shopId, [variantId]));

    const countsAfter = await withTenant(shopId, async (trx) => ({
      reorderRequests: Number((await trx('reorder_requests').where({ shop_id: shopId }).count({ n: '*' }).first())?.n ?? 0),
      purchaseOrders: Number((await trx('purchase_orders').where({ shop_id: shopId }).count({ n: '*' }).first())?.n ?? 0),
    }));

    expect(countsAfter).toEqual(countsBefore);
  });
});

describe('STOCK-PROTECT-03 Slice 2 — end-to-end evaluation (evaluateStockProtectionForShop)', () => {
  it('E2E-01: critical urgency, no action evidence -> reorder_now (pure fallback)', async () => {
    const shopId = await createFixtureShop('spmone2e01');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    // available_quantity = 0 drives urgency to 'critical' unconditionally
    // (deriveUrgency's first branch); a fulfilled sale is required so the
    // variant survives computeVariantPlanning's own
    // `units_sold_all_time > 0 || available_quantity > 0` filter.
    await seedAvailability(shopId, variantId, locationCode, 0);
    await seedFulfilledSale(shopId, productId, variantId, 2, new Date('2026-08-01'), '01');

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      lasyncro_variant_id: variantId,
      reorder_urgency: 'critical',
      treatment: 'reorder_now',
    });
  });

  it('E2E-02: pending reorder_request -> finish_reorder', async () => {
    const shopId = await createFixtureShop('spmone2e02');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    await seedAvailability(shopId, variantId, locationCode, 0);
    await seedFulfilledSale(shopId, productId, variantId, 2, new Date('2026-08-01'), '02');
    const supplierId = await seedSupplier(shopId, 'E2E Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    expect(results[0]).toMatchObject({ reorder_urgency: 'critical', treatment: 'finish_reorder' });
  });

  it('E2E-03: draft PO -> finish_reorder', async () => {
    const shopId = await createFixtureShop('spmone2e03');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    await seedAvailability(shopId, variantId, locationCode, 0);
    await seedFulfilledSale(shopId, productId, variantId, 2, new Date('2026-08-01'), '03');
    const supplierId = await seedSupplier(shopId, 'E2E Supplier');
    await seedPo(shopId, supplierId, 'draft', [{ variantId, quantityOrdered: 5 }]);

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    expect(results[0]).toMatchObject({ reorder_urgency: 'critical', treatment: 'finish_reorder' });
  });

  it('E2E-04: receiving-boundary PO outranks a simultaneous pending reorder_request -> receive_inbound', async () => {
    const shopId = await createFixtureShop('spmone2e04');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    await seedAvailability(shopId, variantId, locationCode, 0);
    await seedFulfilledSale(shopId, productId, variantId, 2, new Date('2026-08-01'), '04');
    const supplierId = await seedSupplier(shopId, 'E2E Supplier');
    await seedPo(shopId, supplierId, 'shipped', [{ variantId, quantityOrdered: 5 }]);
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    expect(results[0]).toMatchObject({ reorder_urgency: 'critical', treatment: 'receive_inbound' });
  });

  it('E2E-05: committed PO fully covers suggested_reorder_qty (nets to 0) despite a pending request -> none, never a duplicate reorder', async () => {
    const shopId = await createFixtureShop('spmone2e05');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    await seedAvailability(shopId, variantId, locationCode, 0);
    // velocity ~ 30/180 units/day so the suggestion before netting is small.
    await seedFulfilledSale(shopId, productId, variantId, 30, new Date('2026-04-01'), '05');
    const supplierId = await seedSupplier(shopId, 'E2E Supplier', 7);
    // Committed PO large enough that computeVariantPlanning's OWN reliable-
    // inbound netting already drives suggested_reorder_qty to 0 — this
    // service must not re-subtract PO quantity itself.
    await seedPo(shopId, supplierId, 'ordered', [{ variantId, quantityOrdered: 50 }]);
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    expect(results[0].suggested_reorder_qty).toBe(0);
    expect(results[0]).toMatchObject({ treatment: 'none' });
  });

  it('E2E-06: committed PO does NOT fully cover suggested_reorder_qty, pending request remains unfinished -> finish_reorder', async () => {
    const shopId = await createFixtureShop('spmone2e06');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    await seedAvailability(shopId, variantId, locationCode, 0);
    await seedFulfilledSale(shopId, productId, variantId, 30, new Date('2026-04-01'), '06');
    const supplierId = await seedSupplier(shopId, 'E2E Supplier', 7);
    // Small committed PO — nets only part of the suggestion.
    await seedPo(shopId, supplierId, 'ordered', [{ variantId, quantityOrdered: 1 }]);
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    expect(results[0].suggested_reorder_qty).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({ treatment: 'finish_reorder' });
  });

  it('E2E-07: committed PO leaves uncovered quantity with no unfinished pending/draft intent -> reorder_now, not finish_reorder', async () => {
    const shopId = await createFixtureShop('spmone2e07');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    await seedAvailability(shopId, variantId, locationCode, 0);
    await seedFulfilledSale(shopId, productId, variantId, 30, new Date('2026-04-01'), '07');
    const supplierId = await seedSupplier(shopId, 'E2E Supplier', 7);
    // Small committed PO — leaves suggested_reorder_qty > 0 uncovered.
    await seedPo(shopId, supplierId, 'ordered', [{ variantId, quantityOrdered: 1 }]);

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    expect(results[0].suggested_reorder_qty).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({ treatment: 'reorder_now' });
  });

  it('E2E-08: planning_data_required (no supplier lead time) is absolute over a pending reorder_request -> complete_setup', async () => {
    const shopId = await createFixtureShop('spmone2e08');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    // Positive stock so availableQty<=0 does not force 'critical'.
    await seedAvailability(shopId, variantId, locationCode, 10);
    // Fulfilled history gives velocityPerDay > 0 without any PO ever
    // existing for this variant, so supplier lead time stays null and
    // deriveUrgency resolves to 'planning_data_required'.
    await seedFulfilledSale(shopId, productId, variantId, 5, new Date('2026-08-01'), '08');
    const supplierId = await seedSupplier(shopId, 'E2E Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    expect(results[0]).toMatchObject({ reorder_urgency: 'planning_data_required', treatment: 'complete_setup' });
  });

  it('E2E-09: no_velocity urgency is absolute over draft+committed+pending evidence -> none', async () => {
    const shopId = await createFixtureShop('spmone2e09');
    const { variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    // Positive stock, zero fulfilled demand ever -> velocityPerDay=0 -> no_velocity.
    await seedAvailability(shopId, variantId, locationCode, 10);
    const supplierId = await seedSupplier(shopId, 'E2E Supplier');
    await seedPo(shopId, supplierId, 'draft', [{ variantId, quantityOrdered: 5 }]);
    await seedPo(shopId, supplierId, 'ordered', [{ variantId, quantityOrdered: 5 }]);
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    expect(results[0]).toMatchObject({ reorder_urgency: 'no_velocity', treatment: 'none' });
  });

  it('E2E-10: variant filter evaluates ONLY requested variants', async () => {
    const shopId = await createFixtureShop('spmone2e10');
    const { productId, variantId: variantA } = await seedProductAndVariant(shopId);
    const { productId: productB, variantId: variantB } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    await seedAvailability(shopId, variantA, locationCode, 0);
    await seedFulfilledSale(shopId, productId, variantA, 2, new Date('2026-08-01'), '101');
    await seedAvailability(shopId, variantB, locationCode, 0);
    await seedFulfilledSale(shopId, productB, variantB, 2, new Date('2026-08-01'), '102');

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantA]));

    expect(results.map((r) => r.lasyncro_variant_id)).toEqual([variantA]);
  });

  it('E2E-11: shop A evidence/inventory cannot leak into shop B evaluation', async () => {
    const shopA = await createFixtureShop('spmone2e11a');
    const shopB = await createFixtureShop('spmone2e11b');
    const { productId: productA, variantId: variantA } = await seedProductAndVariant(shopA);
    const locationA = await seedPickableWarehouse(shopA);
    await seedAvailability(shopA, variantA, locationA, 0);
    await seedFulfilledSale(shopA, productA, variantA, 2, new Date('2026-08-01'), '11');
    const supplierA = await seedSupplier(shopA, 'Shop A Supplier');
    await seedPo(shopA, supplierA, 'shipped', [{ variantId: variantA, quantityOrdered: 5 }]);

    // Evaluating shop B for shop A's variant id must return nothing — the
    // planning query is scoped by shop_id, so cross-shop evidence/inventory
    // is invisible regardless of the id passed in.
    const resultsFromShopB = await withTenant(shopB, (trx) =>
      evaluateStockProtectionForShop(trx, shopB, [variantA]),
    );

    expect(resultsFromShopB).toEqual([]);
  });

  it('E2E-12: service performs no DB writes', async () => {
    const shopId = await createFixtureShop('spmone2e12');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    await seedAvailability(shopId, variantId, locationCode, 0);
    await seedFulfilledSale(shopId, productId, variantId, 2, new Date('2026-08-01'), '12');
    const supplierId = await seedSupplier(shopId, 'E2E Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const alertsBefore = Number(
      (await withTenant(shopId, (trx) => trx('alerts').where({ shop_id: shopId }).count({ n: '*' }).first()))?.n ?? 0,
    );

    await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    const alertsAfter = Number(
      (await withTenant(shopId, (trx) => trx('alerts').where({ shop_id: shopId }).count({ n: '*' }).first()))?.n ?? 0,
    );

    expect(alertsAfter).toBe(alertsBefore);
  });

  it('E2E-14: variantIds=[] returns [] immediately, even with eligible planned variants in the DB', async () => {
    const shopId = await createFixtureShop('spmone2e14');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    await seedAvailability(shopId, variantId, locationCode, 0);
    await seedFulfilledSale(shopId, productId, variantId, 2, new Date('2026-08-01'), '14');

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, []));

    expect(results).toEqual([]);
  });

  it('E2E-13: repeated evaluation of unchanged DB state is idempotent (same result)', async () => {
    const shopId = await createFixtureShop('spmone2e13');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const locationCode = await seedPickableWarehouse(shopId);
    await seedAvailability(shopId, variantId, locationCode, 0);
    await seedFulfilledSale(shopId, productId, variantId, 2, new Date('2026-08-01'), '13');
    const supplierId = await seedSupplier(shopId, 'E2E Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const first = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));
    const second = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));

    expect(second).toEqual(first);
  });
});
