// tests/integration/inventory/stock-protection-eligibility.contract.test.ts
//
// STOCK-PROTECT-03 — canonical opt-in planning eligibility correction.
// PERMANENT regression contract, authored RED.
// ===========================================================================
// WHAT THIS PROTECTS
//   computeVariantPlanning's legacy candidate query is INNER-JOIN-anchored
//   on inventory_truth: a variant with no inventory_truth row can never
//   appear, and an explicit zero-quantity row is dropped unless it has
//   historical fulfilled sales. This silently hides operationally-relevant
//   zero-stock SKUs (open demand, an approved Stock Protection policy, a
//   pending reorder_request, or an unfinished/receiving-boundary PO) from
//   Stock Protection.
//
//   The fix is strictly opt-in via `eligibilityMode: 'stock_protection'` —
//   every existing caller that omits `options` (or passes 'legacy') must see
//   byte-for-byte unchanged behavior. This suite proves both: the new
//   eligibility surface (stock_protection mode) AND legacy-mode
//   non-regression, plus the single-evidence-read invariant.
//
// PO-STATUS CORRECTION: ordered/confirmed/in_production ("committed,
// pre-arrival") must NOT independently establish eligibility — only
// draft/shipped/partially_received can. Committed-only PO evidence keeps
// participating in treatment once eligibility is established some other way
// (proven via evaluateStockProtectionForShop, not re-proving Slice 1's
// pure-function precedence here).
//
// INDEPENDENTLY RED (at authoring time)
//   Imports api-src/services/inventory/purchaseOrderStatusGroups and
//   api-src/services/inventory/replenishmentEvidence, neither of which
//   exist yet — MODULE_NOT_FOUND. computeVariantPlanning's 4th `options`
//   argument does not exist in its current signature either; even once the
//   two new modules exist, calling it with `{ eligibilityMode:
//   'stock_protection' }` before the eligibility branch is implemented is a
//   silently-ignored extra argument (this repo transpiles via babel-jest,
//   no call-signature type-checking at test time) — RED then manifests as
//   assertion failures (still-excluded variants), not an import error.

import crypto from 'crypto';
import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { computeVariantPlanning, type DemandVelocity } from 'api-src/services/demand/demandIntelligence.service';
import {
  getActiveReplenishmentEvidence,
  type ActiveReplenishmentEvidence,
} from 'api-src/services/inventory/replenishmentEvidence';
import * as replenishmentEvidenceModule from 'api-src/services/inventory/replenishmentEvidence';
import { evaluateStockProtectionForShop } from 'api-src/services/inventory/stockProtectionMonitoring';

const now = new Date('2026-09-13T12:00:00.000Z');

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedProductAndVariant(
  shopId: number,
  opts: { active?: boolean; productType?: string } = {},
): Promise<{ productId: string; variantId: string }> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Eligibility fixture product',
      status: 'active',
      product_type: opts.productType ?? 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `SKU-${variantId.slice(0, 8)}`,
      title: 'Eligibility fixture variant',
      unit_cost: '5.00',
      status: opts.active === false ? 'inactive' : 'active',
    });
  });
  return { productId, variantId };
}

async function seedPickableWarehouse(shopId: number): Promise<{ pickable: string; nonPickable: string }> {
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;
  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Eligibility fixture warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      { shop_id: shopId, warehouse_id: warehouseId, location_code: rootCode, type: 'warehouse', parent_location_code: null, active: true, zone_type: null },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: 'A-1', type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: 'A-2', type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' },
      // Non-pickable: quarantine zone. Stock here must never count as available.
      { shop_id: shopId, warehouse_id: warehouseId, location_code: 'Q-1', type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'quarantine' },
    ]);
  });
  return { pickable: 'A-1', nonPickable: 'Q-1' };
}

async function seedInventoryRow(shopId: number, variantId: string, locationCode: string, qty: number) {
  await withTenant(shopId, async (trx) => {
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

async function seedOpenDemand(
  shopId: number,
  productId: string,
  variantId: string,
  quantity: number,
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
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: `${Date.now()}${externalSuffix}`,
    });
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: null,
      title: 'Eligibility fixture open-demand line',
      quantity,
      fulfilled_quantity: 0,
      unit_price: '100.00',
      line_total: (100 * quantity).toFixed(2),
      estimated_unit_cost: '5.00',
    });
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: now,
      fulfilled_at: null,
    });
  });
  return orderId;
}

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
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: null,
      title: 'Eligibility fixture fulfilled sale',
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
        description: 'Eligibility fixture line',
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

async function seedApprovedPolicy(shopId: number, variantId: string) {
  await withTenant(shopId, async (trx) => {
    await trx('stock_protection_policies').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      version: 1,
      safety_days: 5,
      review_cycle_days: 7,
      planning_supplier_id: null,
      source: 'ui_approval',
      approved_by_actor_type: 'user',
      approved_by_actor_id: null,
      approved_at: now,
    });
  });
}

function findPlanned(rows: DemandVelocity[], variantId: string): DemandVelocity | undefined {
  return rows.find((r) => r.lasyncro_variant_id === variantId);
}

describe('STOCK-PROTECT-03 — planning eligibility correction (stock_protection mode)', () => {
  // ── 1-2: open demand ────────────────────────────────────────────────────
  it('1. no inventory_truth row + open demand -> included, available_quantity=0, critical, suggested_reorder_qty=null', async () => {
    const shopId = await createFixtureShop('spelig01');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    await seedOpenDemand(shopId, productId, variantId, 3, '01');

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    const row = findPlanned(rows, variantId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ available_quantity: 0, reorder_urgency: 'critical', suggested_reorder_qty: null });
  });

  it('2. explicit zero inventory row + open demand -> included', async () => {
    const shopId = await createFixtureShop('spelig02');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const { pickable } = await seedPickableWarehouse(shopId);
    await seedInventoryRow(shopId, variantId, pickable, 0);
    await seedOpenDemand(shopId, productId, variantId, 3, '02');

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toBeDefined();
  });

  // ── 3: approved policy ──────────────────────────────────────────────────
  it('3. no inventory_truth row + approved policy -> included', async () => {
    const shopId = await createFixtureShop('spelig03');
    const { variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    await seedApprovedPolicy(shopId, variantId);

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toBeDefined();
  });

  // ── 4: pending reorder_request ──────────────────────────────────────────
  it('4. no inventory_truth row + pending reorder_request -> included', async () => {
    const shopId = await createFixtureShop('spelig04');
    const { variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    const supplierId = await seedSupplier(shopId, 'Eligibility Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toBeDefined();
  });

  // ── 5-7: draft/shipped/partially_received PO -> included ────────────────
  it.each([
    ['draft'],
    ['shipped'],
    ['partially_received'],
  ] as const)('5-7 (%s): no inventory_truth row + %s PO -> included', async (status) => {
    const shopId = await createFixtureShop(`spelig5${status}`);
    const { variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    const supplierId = await seedSupplier(shopId, 'Eligibility Supplier');
    await seedPo(shopId, supplierId, status, [{ variantId, quantityOrdered: 5 }]);

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toBeDefined();
  });

  // ── 8-10: committed-only PO status -> stays dormant/excluded ────────────
  it.each([
    ['ordered'],
    ['confirmed'],
    ['in_production'],
  ] as const)('8-10 (%s): no inventory_truth row + %s PO ONLY -> excluded (committed-only never wakes a dormant SKU)', async (status) => {
    const shopId = await createFixtureShop(`spelig8${status}`);
    const { variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    const supplierId = await seedSupplier(shopId, 'Eligibility Supplier');
    await seedPo(shopId, supplierId, status, [{ variantId, quantityOrdered: 5 }]);

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toBeUndefined();
  });

  // ── 11-12: terminal history alone -> excluded ───────────────────────────
  it.each(['received', 'cancelled'] as const)(
    '11 (%s): terminal PO status only -> excluded',
    async (status) => {
      const shopId = await createFixtureShop(`spelig11${status}`);
      const { variantId } = await seedProductAndVariant(shopId);
      await seedPickableWarehouse(shopId);
      const supplierId = await seedSupplier(shopId, 'Eligibility Supplier');
      await seedPo(shopId, supplierId, status, [{ variantId, quantityOrdered: 5, quantityReceived: status === 'received' ? 5 : 0 }]);

      const rows = await withTenant(shopId, (trx) =>
        computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
      );

      expect(findPlanned(rows, variantId)).toBeUndefined();
    },
  );

  it.each(['converted', 'dismissed'] as const)(
    '12 (%s): terminal reorder_request status only -> excluded',
    async (status) => {
      const shopId = await createFixtureShop(`spelig12${status}`);
      const { variantId } = await seedProductAndVariant(shopId);
      await seedPickableWarehouse(shopId);
      const supplierId = await seedSupplier(shopId, 'Eligibility Supplier');
      await seedReorderRequest(shopId, supplierId, variantId, status);

      const rows = await withTenant(shopId, (trx) =>
        computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
      );

      expect(findPlanned(rows, variantId)).toBeUndefined();
    },
  );

  // ── 13-14: parity with today's already-correct legacy-visible cases ────
  it('13. positive pickable stock + zero history -> included, no_velocity', async () => {
    const shopId = await createFixtureShop('spelig13');
    const { variantId } = await seedProductAndVariant(shopId);
    const { pickable } = await seedPickableWarehouse(shopId);
    await seedInventoryRow(shopId, variantId, pickable, 10);

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toMatchObject({ reorder_urgency: 'no_velocity' });
  });

  it('14. sales history + zero stock -> included, critical', async () => {
    const shopId = await createFixtureShop('spelig14');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const { pickable } = await seedPickableWarehouse(shopId);
    await seedInventoryRow(shopId, variantId, pickable, 0);
    await seedFulfilledSale(shopId, productId, variantId, 2, new Date('2026-08-01'), '14');

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toMatchObject({ reorder_urgency: 'critical' });
  });

  // ── 15: truly dormant SKU -> excluded ───────────────────────────────────
  it('15. truly dormant SKU (no A-F signal) -> excluded', async () => {
    const shopId = await createFixtureShop('spelig15');
    const { variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toBeUndefined();
  });

  // ── 16-17: inactive / non-physical stay excluded regardless of signal ──
  it('16. inactive variant with a real eligibility signal -> excluded', async () => {
    const shopId = await createFixtureShop('spelig16');
    const { productId, variantId } = await seedProductAndVariant(shopId, { active: false });
    await seedPickableWarehouse(shopId);
    await seedOpenDemand(shopId, productId, variantId, 3, '16');

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toBeUndefined();
  });

  it('17. non-physical product with a real eligibility signal -> excluded', async () => {
    const shopId = await createFixtureShop('spelig17');
    const { productId, variantId } = await seedProductAndVariant(shopId, { productType: 'digital' });
    await seedPickableWarehouse(shopId);
    await seedOpenDemand(shopId, productId, variantId, 3, '17');

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toBeUndefined();
  });

  // ── 18: non-pickable-only stock -> available_quantity=0 ─────────────────
  it('18. stock exists ONLY in a non-pickable location -> available_quantity=0', async () => {
    const shopId = await createFixtureShop('spelig18');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const { nonPickable } = await seedPickableWarehouse(shopId);
    await seedInventoryRow(shopId, variantId, nonPickable, 20);
    // Needs a real eligibility signal since available stays 0.
    await seedOpenDemand(shopId, productId, variantId, 3, '18');

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toMatchObject({ available_quantity: 0 });
  });

  // ── 19: multiple pickable locations aggregate correctly ─────────────────
  it('19. stock split across multiple pickable locations -> correctly summed', async () => {
    const shopId = await createFixtureShop('spelig19');
    const { variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    await seedInventoryRow(shopId, variantId, 'A-1', 3);
    await seedInventoryRow(shopId, variantId, 'A-2', 4);

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toMatchObject({ available_quantity: 7 });
  });

  // ── 20: explicit variantIds does not override dormant eligibility ───────
  it('20. explicit variantIds does not make a dormant SKU eligible', async () => {
    const shopId = await createFixtureShop('spelig20');
    const { variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(rows).toEqual([]);
  });

  // ── 21: committed PO + open demand -> eligible through open demand,
  // committed evidence still participates in treatment (end-to-end) ───────
  it('21. committed PO + open demand -> eligible through open demand; committed evidence still participates in Stock Protection treatment', async () => {
    const shopId = await createFixtureShop('spelig21');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    await seedOpenDemand(shopId, productId, variantId, 3, '21');
    const supplierId = await seedSupplier(shopId, 'Eligibility Supplier');
    await seedPo(shopId, supplierId, 'ordered', [{ variantId, quantityOrdered: 5 }]);

    const planned = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );
    expect(findPlanned(planned, variantId)).toMatchObject({ reorder_urgency: 'critical' });

    const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));
    expect(results).toHaveLength(1);
    // No pending/draft, only a committed PO -> falls through to reorder_now
    // per Slice 1's precedence (qty is null, not <=0, so rule 4 doesn't fire).
    expect(results[0]).toMatchObject({ reorder_urgency: 'critical', treatment: 'reorder_now' });
  });
});

describe('STOCK-PROTECT-03 — legacy-mode non-regression', () => {
  it('omitting options entirely preserves legacy exclusion of a zero-stock, zero-history SKU with open demand', async () => {
    const shopId = await createFixtureShop('speliglegacy01');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    await seedOpenDemand(shopId, productId, variantId, 3, '01');

    const rows = await withTenant(shopId, (trx) => computeVariantPlanning(trx, shopId, [variantId]));

    expect(rows).toEqual([]);
  });

  it('explicit eligibilityMode: legacy is identical to omitting options', async () => {
    const shopId = await createFixtureShop('speliglegacy02');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const { pickable } = await seedPickableWarehouse(shopId);
    await seedInventoryRow(shopId, variantId, pickable, 0);
    await seedFulfilledSale(shopId, productId, variantId, 4, new Date('2026-08-01'), '02');

    const withoutOptions = await withTenant(shopId, (trx) => computeVariantPlanning(trx, shopId, [variantId]));
    const withExplicitLegacy = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'legacy' }),
    );

    // estimated_stockout_date is derived from Date.now() at call time, so the
    // two sequential calls can legitimately differ by a few milliseconds —
    // that is not a behavioral difference between omitting options and
    // passing eligibilityMode: 'legacy' explicitly.
    const strip = (rows: typeof withoutOptions) => rows.map((r) => ({ ...r, estimated_stockout_date: null }));
    expect(strip(withExplicitLegacy)).toEqual(strip(withoutOptions));
  });

  it('legacy mode never calls getActiveReplenishmentEvidence', async () => {
    const shopId = await createFixtureShop('speliglegacy03');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    const { pickable } = await seedPickableWarehouse(shopId);
    await seedInventoryRow(shopId, variantId, pickable, 0);
    await seedFulfilledSale(shopId, productId, variantId, 4, new Date('2026-08-01'), '03');
    const supplierId = await seedSupplier(shopId, 'Legacy Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const spy = jest.spyOn(replenishmentEvidenceModule, 'getActiveReplenishmentEvidence');
    try {
      await withTenant(shopId, (trx) => computeVariantPlanning(trx, shopId, [variantId]));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('STOCK-PROTECT-03 — evidence-read ownership (single canonical read per evaluation)', () => {
  it('evaluateStockProtectionForShop loads replenishment evidence exactly once', async () => {
    const shopId = await createFixtureShop('spelighread01');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    await seedOpenDemand(shopId, productId, variantId, 3, '01');
    const supplierId = await seedSupplier(shopId, 'Evidence Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');
    await seedPo(shopId, supplierId, 'draft', [{ variantId, quantityOrdered: 5 }]);

    const spy = jest.spyOn(replenishmentEvidenceModule, 'getActiveReplenishmentEvidence');
    try {
      const results = await withTenant(shopId, (trx) => evaluateStockProtectionForShop(trx, shopId, [variantId]));
      expect(results).toHaveLength(1);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('computeVariantPlanning(stock_protection) with supplied evidence does not reload it', async () => {
    const shopId = await createFixtureShop('spelighread02');
    const { productId, variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    await seedOpenDemand(shopId, productId, variantId, 3, '02');

    const preloaded: ActiveReplenishmentEvidence = await withTenant(shopId, (trx) =>
      getActiveReplenishmentEvidence(trx, shopId, [variantId]),
    );

    const spy = jest.spyOn(replenishmentEvidenceModule, 'getActiveReplenishmentEvidence');
    try {
      const rows = await withTenant(shopId, (trx) =>
        computeVariantPlanning(trx, shopId, [variantId], {
          eligibilityMode: 'stock_protection',
          replenishmentEvidence: preloaded,
        }),
      );
      expect(findPlanned(rows, variantId)).toBeDefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('computeVariantPlanning(stock_protection) WITHOUT supplied evidence loads it itself and still works (standalone fallback)', async () => {
    const shopId = await createFixtureShop('spelighread03');
    const { variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    const supplierId = await seedSupplier(shopId, 'Fallback Supplier');
    await seedReorderRequest(shopId, supplierId, variantId, 'pending');

    const rows = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    expect(findPlanned(rows, variantId)).toBeDefined();
  });

  it('supplied-evidence and self-loaded-evidence paths produce equivalent planning output', async () => {
    const shopId = await createFixtureShop('spelighread04');
    const { variantId } = await seedProductAndVariant(shopId);
    await seedPickableWarehouse(shopId);
    const supplierId = await seedSupplier(shopId, 'Equivalence Supplier');
    await seedPo(shopId, supplierId, 'draft', [{ variantId, quantityOrdered: 5 }]);

    const selfLoaded = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], { eligibilityMode: 'stock_protection' }),
    );

    const preloaded = await withTenant(shopId, (trx) => getActiveReplenishmentEvidence(trx, shopId, [variantId]));
    const withSupplied = await withTenant(shopId, (trx) =>
      computeVariantPlanning(trx, shopId, [variantId], {
        eligibilityMode: 'stock_protection',
        replenishmentEvidence: preloaded,
      }),
    );

    expect(withSupplied).toEqual(selfLoaded);
  });
});
