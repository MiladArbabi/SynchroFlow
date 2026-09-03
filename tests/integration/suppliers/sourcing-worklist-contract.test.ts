// SOURCING-UX-COGNITIVE-01 Slice 2 — UNIFIED SOURCING WORKLIST (RED)
//
// Ratified backend contracts for GET /api/v1/suppliers/sourcing-worklist —
// the portfolio-wide replacement for the generic (no-variantId) Sourcing
// view. Distinct from, and does not replace, the per-variant targeted
// endpoint covered by tests/integration/suppliers/sourcing-targeted-contract.test.ts.
//
// The endpoint does not exist yet (no route, no controller). Every test in
// this file is expected to fail with 404 ("Cannot GET
// /api/v1/suppliers/sourcing-worklist") — that is the RED signal for this
// slice.
//
// SRC-WL-BE-01  canonical one-row-per-variant grain
// SRC-WL-BE-02  multi-location inventory aggregates without duplicate variants
// SRC-WL-BE-03  preserve short_now / still_to_source / committed_inbound semantics
// SRC-WL-BE-04  preserve pending_queue_qty / draft_po_qty / in_purchasing / unplanned
// SRC-WL-BE-05  usable supplier does not require saved preference
// SRC-WL-BE-06  exclusive category precedence
// SRC-WL-BE-07  reactive need wins over preventive planning
// SRC-WL-BE-08  plan_ahead reuses canonical Demand planning signal
// SRC-WL-BE-09  summary counts cover full filtered universe
// SRC-WL-BE-10  covered_inbound excluded from default immediate-action rows
// SRC-WL-BE-11  server search: product / variant / SKU
// SRC-WL-BE-12  orthogonal filters
// SRC-WL-BE-13  deterministic approved sorting
// SRC-WL-BE-14  default page_size=50 + pagination metadata
// SRC-WL-BE-15  tenant isolation across every aggregate
// SRC-WL-BE-16  read-only and no per-variant targeted-resolution pattern
//
// RESPONSE ENVELOPE (ratified in TEST STRATEGY / RED CORRECTION):
//   { summary, items, page, page_size, total }
// `items` replaces the earlier `rows` assumption throughout this file.
//
// CATEGORY-ASSIGNMENT ALGORITHM (ratified in TEST STRATEGY / RED CORRECTION,
// replacing this file's earlier still_to_source-gated precedence):
//
//   if unplanned > 0:
//     no usable supplier -> needs_supplier
//     usable supplier    -> needs_purchase
//   else if in_purchasing > 0:
//     -> in_purchasing
//   else if short_now > 0 && still_to_source == 0 && committed_inbound > 0:
//     -> covered_inbound
//   else if canonical planning signal requires replenishment:
//     no usable supplier -> needs_supplier
//     usable supplier    -> plan_ahead
//   else:
//     exclude
//
// "usable supplier" reuses sourcingRecommendations.controller.ts §6a Branch A:
// any active supplier with purchase_order_line_items history for the variant,
// independent of supplier_product_preferences (SRC-WL-BE-05). "canonical
// planning signal" reuses demandIntelligence.service.ts computeVariantPlanning
// -> reorder_signal (SRC-WL-BE-08); deriveUrgency there returns 'critical'
// whenever available_quantity <= 0, independent of supplier lead time, which
// is what makes a no-usable-supplier plan-ahead case (-> needs_supplier)
// reachable without any purchase_order_line_items row at all.

import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const now = new Date('2026-09-03T12:00:00.000Z');

const WORKLIST_PATH = '/api/v1/suppliers/sourcing-worklist';

async function bootstrapShop(unique: string) {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sourcing-worklist-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `sourcing-worklist+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return Number(row.id ?? row);
  });

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role: 'owner' });
    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: now,
      last_event_id: crypto.randomUUID(),
    });
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    const warehouseId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Worklist warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });
    await trx('warehouse_locations').insert([
      { shop_id: shopId, warehouse_id: warehouseId, location_code: rootCode, type: 'warehouse', parent_location_code: null, active: true, zone_type: null },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: 'A-1', type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: 'B-1', type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' },
    ]);
  });

  return { shopId, userId, token: issueTestToken({ userId, shopId, tier: 'core' }) };
}

async function seedProduct(shopId: number, productId: string, title: string) {
  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title,
      status: 'active',
      product_type: 'physical',
    });
  });
}

async function seedVariant(
  shopId: number,
  productId: string,
  opts: { variantId: string; sku: string; title: string; imageUrl?: string | null }
) {
  await withTenant(shopId, async (trx) => {
    await trx('variants').insert({
      lasyncro_variant_id: opts.variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: opts.sku,
      title: opts.title,
      image_url: opts.imageUrl ?? null,
      unit_cost: '5.00',
      status: 'active',
    });
  });
}

async function seedAvailability(
  shopId: number,
  variantId: string,
  locations: Array<{ code: string; qty: number }>
) {
  await withTenant(shopId, async (trx) => {
    // inventory_truth is projection-owned (single-writer trigger). Mechanical
    // fixture prerequisite for the SAME authorised fixture — not a business
    // semantics change (COMMAND CORRECTIONS / Mechanical fixture corrections).
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    for (const loc of locations) {
      await trx('inventory_truth').insert({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        location_code: loc.code,
        on_hand_quantity: loc.qty,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: loc.qty,
        last_evaluated_at: now,
      });
    }
  });
}

async function seedOpenDemand(
  shopId: number,
  productId: string,
  variantId: string,
  quantity: number,
  externalSuffix: string,
  orderCreatedAt: Date = now
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
      order_created_at: orderCreatedAt,
      order_updated_at: orderCreatedAt,
      created_at: orderCreatedAt,
      updated_at: orderCreatedAt,
    });
    // external_order_id is CHECK-constrained to '^[0-9]+$' — numeric suffix
    // only. Mechanical fixture prerequisite, not a business semantics change.
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: `${Date.now()}${externalSuffix}`,
    });
    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: null,
      title: 'Worklist open-demand line',
      quantity,
      fulfilled_quantity: 0,
      unit_price: '100.00',
      line_total: (100 * quantity).toFixed(2),
      estimated_unit_cost: '5.00',
    });
  });
  return orderId;
}

/** A fully fulfilled order line: contributes velocity history, zero open demand. */
async function seedFulfilledSale(
  shopId: number,
  productId: string,
  variantId: string,
  quantity: number,
  fulfilledAt: Date,
  externalSuffix: string
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
    // order_fulfillment_status is projection-owned (single-writer trigger,
    // migration 0076): a raw insert requires the same transaction-local
    // projection guard already used for inventory_truth. Mechanical fixture
    // prerequisite, not a business-semantics change.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: null,
      title: 'Worklist fulfilled sale',
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

async function seedSupplier(shopId: number, name: string) {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers').insert({ shop_id: shopId, name, active: true }).returning('id');
    return Number(row.id ?? row);
  });
}

async function seedPoLine(
  shopId: number,
  supplierId: number,
  variantId: string,
  opts: { status: string; ordered: number; received: number; leadTimeDays?: number | null }
) {
  await withTenant(shopId, async (trx) => {
    if (opts.leadTimeDays !== undefined) {
      await trx('suppliers').where({ id: supplierId, shop_id: shopId }).update({ lead_time_days: opts.leadTimeDays });
    }
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: supplierId, status: opts.status })
      .returning('id');
    await trx('purchase_order_line_items').insert({
      po_id: po.id ?? po,
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      description: `Worklist inbound line (${opts.status})`,
      quantity_ordered: opts.ordered,
      quantity_received: opts.received,
    });
  });
}

async function seedReorderRequest(shopId: number, supplierId: number, variantId: string, qty: number) {
  await withTenant(shopId, async (trx) => {
    await trx('reorder_requests').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      supplier_id: supplierId,
      qty_requested: qty,
      source: 'manual',
      status: 'pending',
    });
  });
}

type CategoryFixture = {
  shopId: number;
  token: string;
  productId: string;
  productTitle: string;
  supplierId: number;
  needsSupplierVariantId: string;
  needsPurchaseVariantId: string;
  inPurchasingVariantId: string;
  coveredInboundVariantId: string;
  planAheadVariantId: string;
  planAheadNoSupplierVariantId: string;
  fullyCoveredVariantId: string;
  multiLocationVariantId: string;
  skus: {
    needsSupplier: string;
    needsPurchase: string;
    inPurchasing: string;
    coveredInbound: string;
    planAhead: string;
    planAheadNoSupplier: string;
    fullyCovered: string;
    multiLocation: string;
  };
  foreignShopId: number;
  foreignVariantId: string;
  foreignSku: string;
};

async function createCategoryFixture(): Promise<CategoryFixture> {
  const unique = crypto.randomBytes(6).toString('hex');
  const { shopId, token } = await bootstrapShop(unique);

  const productId = crypto.randomUUID();
  const productTitle = 'Unified Worklist Product';
  await seedProduct(shopId, productId, productTitle);

  const skus = {
    needsSupplier: `SRC-WL-NS-${unique}`,
    needsPurchase: `SRC-WL-NP-${unique}`,
    inPurchasing: `SRC-WL-IP-${unique}`,
    coveredInbound: `SRC-WL-CI-${unique}`,
    planAhead: `SRC-WL-PA-${unique}`,
    planAheadNoSupplier: `SRC-WL-PANS-${unique}`,
    fullyCovered: `SRC-WL-OK-${unique}`,
    multiLocation: `SRC-WL-ML-${unique}`,
  };

  const needsSupplierVariantId = crypto.randomUUID();
  const needsPurchaseVariantId = crypto.randomUUID();
  const inPurchasingVariantId = crypto.randomUUID();
  const coveredInboundVariantId = crypto.randomUUID();
  const planAheadVariantId = crypto.randomUUID();
  const planAheadNoSupplierVariantId = crypto.randomUUID();
  const fullyCoveredVariantId = crypto.randomUUID();
  const multiLocationVariantId = crypto.randomUUID();

  await seedVariant(shopId, productId, { variantId: needsSupplierVariantId, sku: skus.needsSupplier, title: 'Needs Supplier Variant' });
  await seedVariant(shopId, productId, { variantId: needsPurchaseVariantId, sku: skus.needsPurchase, title: 'Needs Purchase Variant' });
  await seedVariant(shopId, productId, { variantId: inPurchasingVariantId, sku: skus.inPurchasing, title: 'In Purchasing Variant' });
  await seedVariant(shopId, productId, { variantId: coveredInboundVariantId, sku: skus.coveredInbound, title: 'Covered Inbound Variant' });
  await seedVariant(shopId, productId, { variantId: planAheadVariantId, sku: skus.planAhead, title: 'Plan Ahead Variant' });
  await seedVariant(shopId, productId, { variantId: planAheadNoSupplierVariantId, sku: skus.planAheadNoSupplier, title: 'Plan Ahead No Supplier Variant' });
  await seedVariant(shopId, productId, { variantId: fullyCoveredVariantId, sku: skus.fullyCovered, title: 'Fully Covered Variant' });
  await seedVariant(shopId, productId, { variantId: multiLocationVariantId, sku: skus.multiLocation, title: 'Multi Location Variant' });

  const supplierId = await seedSupplier(shopId, 'Worklist Supplier');

  // ── needs_supplier: unplanned > 0, ZERO usable supplier (no PO history). ──
  await seedOpenDemand(shopId, productId, needsSupplierVariantId, 8, '101');

  // ── needs_purchase: unplanned > 0, usable supplier via history (fully
  // received — no committed_inbound, no draft, no queue), no preference row. ──
  await seedOpenDemand(shopId, productId, needsPurchaseVariantId, 6, '102');
  await seedPoLine(shopId, supplierId, needsPurchaseVariantId, { status: 'received', ordered: 5, received: 5 });

  // ── in_purchasing: unplanned == 0 (queue fully covers the need) AND
  // in_purchasing > 0 -> takes precedence regardless of usable-supplier state. ──
  await seedOpenDemand(shopId, productId, inPurchasingVariantId, 5, '103');
  await seedReorderRequest(shopId, supplierId, inPurchasingVariantId, 5);

  // ── covered_inbound: unplanned == 0, in_purchasing == 0, short_now > 0,
  // still_to_source == 0, committed_inbound > 0. ──
  await seedOpenDemand(shopId, productId, coveredInboundVariantId, 8, '104');
  await seedPoLine(shopId, supplierId, coveredInboundVariantId, { status: 'ordered', ordered: 8, received: 0 });

  // ── plan_ahead: NO reactive need at all (no open demand, so unplanned == 0,
  // in_purchasing == 0, short_now == 0 -> skips straight past the reactive
  // branches), but the canonical Demand signal fires: 3 fulfilled sales in the
  // last 30 days (velocity 0.5/day), available 5 -> 10 days of stock, lead
  // time 7 days (via a NON-draft, committed-status PO line so it does not
  // itself create in_purchasing qty; committed_inbound is irrelevant here
  // because short_now == 0) -> 10 <= 7+5 -> warning -> reorder_signal true.
  // A usable supplier exists (the same PO line item is history) -> plan_ahead. ──
  await seedAvailability(shopId, planAheadVariantId, [{ code: 'A-1', qty: 5 }]);
  const planAheadFulfilledAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  await seedFulfilledSale(shopId, productId, planAheadVariantId, 5, planAheadFulfilledAt, '105');
  await seedFulfilledSale(shopId, productId, planAheadVariantId, 5, planAheadFulfilledAt, '106');
  await seedFulfilledSale(shopId, productId, planAheadVariantId, 5, planAheadFulfilledAt, '107');
  await seedPoLine(shopId, supplierId, planAheadVariantId, { status: 'ordered', ordered: 1, received: 0, leadTimeDays: 7 });

  // ── plan_ahead branch with NO usable supplier -> needs_supplier: available
  // 0 -> deriveUrgency returns 'critical' regardless of lead time, so the
  // canonical signal fires WITHOUT any purchase_order_line_items row at all
  // (and therefore with no usable supplier). No open demand -> every reactive
  // field is 0, so this reaches the planning branch.
  //
  // CORRECTION (VERIFY-phase evidence): computeVariantPlanning's catalogue
  // query INNER JOINs inventory_truth, so a variant with NO row there never
  // enters its output at all — absence does not mean "available=0" the way
  // it does for the targeted endpoint's shortfall math. An EXPLICIT
  // available=0 row is required for this variant to be visible to the
  // canonical planning signal at all. ──
  await seedAvailability(shopId, planAheadNoSupplierVariantId, [{ code: 'A-1', qty: 0 }]);
  const planAheadNoSupplierFulfilledAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  await seedFulfilledSale(shopId, productId, planAheadNoSupplierVariantId, 5, planAheadNoSupplierFulfilledAt, '110');
  await seedFulfilledSale(shopId, productId, planAheadNoSupplierVariantId, 5, planAheadNoSupplierFulfilledAt, '111');
  await seedFulfilledSale(shopId, productId, planAheadNoSupplierVariantId, 5, planAheadNoSupplierFulfilledAt, '112');

  // ── fully_covered: no reactive need, no demand signal -> excluded entirely. ──
  await seedAvailability(shopId, fullyCoveredVariantId, [{ code: 'A-1', qty: 10 }]);

  // ── multi_location: grain probe. Two location rows summing to 7 available,
  // TWO PO-history suppliers (both fully received), open demand 10 -> a
  // correct implementation emits exactly ONE item with still_to_source 3. ──
  await seedAvailability(shopId, multiLocationVariantId, [
    { code: 'A-1', qty: 3 },
    { code: 'B-1', qty: 4 },
  ]);
  await seedOpenDemand(shopId, productId, multiLocationVariantId, 10, '108');
  const secondSupplierId = await seedSupplier(shopId, 'Worklist Second Supplier');
  await seedPoLine(shopId, supplierId, multiLocationVariantId, { status: 'received', ordered: 2, received: 2 });
  await seedPoLine(shopId, secondSupplierId, multiLocationVariantId, { status: 'received', ordered: 3, received: 3 });

  // ── foreign tenant probe (SRC-WL-BE-15). ──
  const foreignUnique = crypto.randomBytes(6).toString('hex');
  const foreign = await bootstrapShop(foreignUnique);
  const foreignProductId = crypto.randomUUID();
  await seedProduct(foreign.shopId, foreignProductId, 'Foreign Tenant Product');
  const foreignVariantId = crypto.randomUUID();
  const foreignSku = `SRC-WL-FOREIGN-${foreignUnique}`;
  await seedVariant(foreign.shopId, foreignProductId, { variantId: foreignVariantId, sku: foreignSku, title: 'Foreign Tenant Variant' });
  await seedOpenDemand(foreign.shopId, foreignProductId, foreignVariantId, 999, '109');

  return {
    shopId,
    token,
    productId,
    productTitle,
    supplierId,
    needsSupplierVariantId,
    needsPurchaseVariantId,
    inPurchasingVariantId,
    coveredInboundVariantId,
    planAheadVariantId,
    planAheadNoSupplierVariantId,
    fullyCoveredVariantId,
    multiLocationVariantId,
    skus,
    foreignShopId: foreign.shopId,
    foreignVariantId,
    foreignSku,
  };
}

// ── SRC-WL-BE-12 — dedicated filter fixture ────────────────────────────────
// Isolated from createCategoryFixture() so strengthening BE-12 does not
// perturb the already-ratified BE-06/BE-09/BE-10 category/summary numbers.
//
// Ratified enum readings this test author adopted (not yet confirmed against
// an implementation):
//   supplier_readiness=ready          -> usable supplier (PO history) exists
//   supplier_readiness=needs_supplier -> category is exactly needs_supplier
//   supplier_readiness=no_history     -> zero purchase_order_line_items ever,
//                                        REGARDLESS of category (distinct
//                                        from needs_supplier: a variant can
//                                        reach in_purchasing purely via a
//                                        pending reorder_request with no PO
//                                        history at all)
//   purchasing_stage=not_started      -> pending_queue_qty==0 && draft_po_qty==0
//   purchasing_stage=queued           -> pending_queue_qty > 0
//   purchasing_stage=draft            -> draft_po_qty > 0
//   purchasing_stage=committed        -> committed_inbound > 0
//   coverage=short                    -> still_to_source > 0
//   coverage=covered_inbound          -> same condition as the covered_inbound
//                                        category (short_now>0 && still_to_source==0
//                                        && committed_inbound>0)
type FilterFixture = {
  shopId: number;
  token: string;
  productId: string;
  readyVariantId: string;
  needsSupplierVariantId: string;
  noHistoryQueuedVariantId: string;
  coveredCommittedVariantId: string;
  draftStageVariantId: string;
  skus: {
    ready: string;
    needsSupplier: string;
    noHistoryQueued: string;
    coveredCommitted: string;
    draftStage: string;
  };
};

async function createFilterFixture(): Promise<FilterFixture> {
  const unique = crypto.randomBytes(6).toString('hex');
  const { shopId, token } = await bootstrapShop(unique);

  const productId = crypto.randomUUID();
  await seedProduct(shopId, productId, 'Filter Fixture Product');

  const skus = {
    ready: `SRC-WL-F-READY-${unique}`,
    needsSupplier: `SRC-WL-F-NEEDSSUP-${unique}`,
    noHistoryQueued: `SRC-WL-F-NOHIST-${unique}`,
    coveredCommitted: `SRC-WL-F-COVERED-${unique}`,
    draftStage: `SRC-WL-F-DRAFT-${unique}`,
  };

  const readyVariantId = crypto.randomUUID();
  const needsSupplierVariantId = crypto.randomUUID();
  const noHistoryQueuedVariantId = crypto.randomUUID();
  const coveredCommittedVariantId = crypto.randomUUID();
  const draftStageVariantId = crypto.randomUUID();

  await seedVariant(shopId, productId, { variantId: readyVariantId, sku: skus.ready, title: 'Ready Supplier Variant' });
  await seedVariant(shopId, productId, { variantId: needsSupplierVariantId, sku: skus.needsSupplier, title: 'Needs Supplier Readiness Variant' });
  await seedVariant(shopId, productId, { variantId: noHistoryQueuedVariantId, sku: skus.noHistoryQueued, title: 'No History Queued Variant' });
  await seedVariant(shopId, productId, { variantId: coveredCommittedVariantId, sku: skus.coveredCommitted, title: 'Covered Committed Variant' });
  await seedVariant(shopId, productId, { variantId: draftStageVariantId, sku: skus.draftStage, title: 'Draft Stage Variant' });

  const supplierId = await seedSupplier(shopId, 'Filter Fixture Supplier');

  // ready: usable supplier via fully-received PO history, no queue/draft.
  await seedOpenDemand(shopId, productId, readyVariantId, 6, '201');
  await seedPoLine(shopId, supplierId, readyVariantId, { status: 'received', ordered: 5, received: 5 });

  // needs_supplier: no PO history at all, no queue/draft -> category needs_supplier.
  await seedOpenDemand(shopId, productId, needsSupplierVariantId, 6, '202');

  // no_history + queued: ZERO purchase_order_line_items ever, but a pending
  // reorder_request fully covers the need -> category in_purchasing, not
  // needs_supplier, while still carrying zero supplier history.
  await seedOpenDemand(shopId, productId, noHistoryQueuedVariantId, 6, '203');
  await seedReorderRequest(shopId, supplierId, noHistoryQueuedVariantId, 6);

  // covered + committed: a real committed-status PO covers the need fully.
  await seedOpenDemand(shopId, productId, coveredCommittedVariantId, 8, '204');
  await seedPoLine(shopId, supplierId, coveredCommittedVariantId, { status: 'ordered', ordered: 8, received: 0 });

  // draft stage: a draft PO line (not yet sent) fully covers the need.
  await seedOpenDemand(shopId, productId, draftStageVariantId, 4, '205');
  await seedPoLine(shopId, supplierId, draftStageVariantId, { status: 'draft', ordered: 4, received: 0 });

  return {
    shopId,
    token,
    productId,
    readyVariantId,
    needsSupplierVariantId,
    noHistoryQueuedVariantId,
    coveredCommittedVariantId,
    draftStageVariantId,
    skus,
  };
}

// ── SRC-WL-BE-13 — dedicated sort fixture ──────────────────────────────────
// Three variants, all category=needs_supplier (no usable supplier, reactive
// need only) so category precedence never interferes with the sort keys
// under test. Each dimension (demand age, shortfall size, stockout urgency,
// alphabetical title) is deliberately set to a DIFFERENT relative ordering
// across the three variants, so a test for one sort key cannot pass by
// accident from another key's ordering.
//
//   oldest_demand:   ascending order_created_at (oldest/most-overdue first)
//   still_to_source: descending still_to_source (worst shortfall first)
//   stockout_soonest: ascending available/velocity "days of stock" (soonest first)
//   product_az:      ascending product_title
type SortFixture = {
  shopId: number;
  token: string;
  productId: string;
  alphaVariantId: string;
  bravoVariantId: string;
  charlieVariantId: string;
};

async function createSortFixture(): Promise<SortFixture> {
  const unique = crypto.randomBytes(6).toString('hex');
  const { shopId, token } = await bootstrapShop(unique);

  const alphaProductId = crypto.randomUUID();
  const bravoProductId = crypto.randomUUID();
  const charlieProductId = crypto.randomUUID();
  await seedProduct(shopId, alphaProductId, 'Alpha Sort Product');
  await seedProduct(shopId, bravoProductId, 'Bravo Sort Product');
  await seedProduct(shopId, charlieProductId, 'Charlie Sort Product');

  const alphaVariantId = crypto.randomUUID();
  const bravoVariantId = crypto.randomUUID();
  const charlieVariantId = crypto.randomUUID();

  await seedVariant(shopId, alphaProductId, { variantId: alphaVariantId, sku: `SRC-WL-SORT-A-${unique}`, title: 'Alpha Sort Variant' });
  await seedVariant(shopId, bravoProductId, { variantId: bravoVariantId, sku: `SRC-WL-SORT-B-${unique}`, title: 'Bravo Sort Variant' });
  await seedVariant(shopId, charlieProductId, { variantId: charlieVariantId, sku: `SRC-WL-SORT-C-${unique}`, title: 'Charlie Sort Variant' });

  // oldest_demand: Charlie oldest, Alpha middle, Bravo newest.
  const charlieOrderAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const alphaOrderAt = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
  const bravoOrderAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

  // still_to_source (demand - available), independent of the availability
  // seeded below for stockout_soonest: Alpha 30, Charlie 20, Bravo 10.
  //   Alpha:   demand 36, available 6  -> still_to_source 30
  //   Bravo:   demand 12, available 2  -> still_to_source 10
  //   Charlie: demand 32, available 12 -> still_to_source 20
  await seedAvailability(shopId, alphaVariantId, [{ code: 'A-1', qty: 6 }]);
  await seedAvailability(shopId, bravoVariantId, [{ code: 'A-1', qty: 2 }]);
  await seedAvailability(shopId, charlieVariantId, [{ code: 'A-1', qty: 12 }]);

  await seedOpenDemand(shopId, alphaProductId, alphaVariantId, 36, '301', alphaOrderAt);
  await seedOpenDemand(shopId, bravoProductId, bravoVariantId, 12, '302', bravoOrderAt);
  await seedOpenDemand(shopId, charlieProductId, charlieVariantId, 32, '303', charlieOrderAt);

  // stockout_soonest: same 1 unit/day velocity for all three (3 fulfilled
  // sales of 10 units each in the last 30 days), so "days of stock" is
  // driven purely by the available quantities above: Bravo 2, Alpha 6,
  // Charlie 12 -> soonest first is [Bravo, Alpha, Charlie].
  const salesAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  for (const [productId, variantId, suffixBase] of [
    [alphaProductId, alphaVariantId, 310],
    [bravoProductId, bravoVariantId, 320],
    [charlieProductId, charlieVariantId, 330],
  ] as const) {
    await seedFulfilledSale(shopId, productId, variantId, 10, salesAt, `${suffixBase}`);
    await seedFulfilledSale(shopId, productId, variantId, 10, salesAt, `${suffixBase + 1}`);
    await seedFulfilledSale(shopId, productId, variantId, 10, salesAt, `${suffixBase + 2}`);
  }

  return { shopId, token, productId: alphaProductId, alphaVariantId, bravoVariantId, charlieVariantId };
}

function getWorklist(token: string, query: Record<string, string | number> = {}) {
  return request(app)
    .get(WORKLIST_PATH)
    .set('Authorization', `Bearer ${token}`)
    .query(query);
}

async function purchasingStateSnapshot(shopId: number) {
  return withTenant(shopId, async (trx) => {
    const count = async (table: string) => {
      const row = await trx(table).where({ shop_id: shopId }).count({ n: '*' }).first();
      return Number(row?.n ?? 0);
    };
    return {
      purchase_orders: await count('purchase_orders'),
      purchase_order_line_items: await count('purchase_order_line_items'),
      reorder_requests: await count('reorder_requests'),
      inventory_truth: await count('inventory_truth'),
      variants: await count('variants'),
    };
  });
}

describe('SOURCING-UX-COGNITIVE-01 Slice 2 — unified sourcing worklist contract (RED)', () => {
  let fixture: CategoryFixture;
  let filterFixture: FilterFixture;
  let sortFixture: SortFixture;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
    fixture = await createCategoryFixture();
    filterFixture = await createFilterFixture();
    sortFixture = await createSortFixture();
  });

  it('SRC-WL-BE-01: canonical one-item-per-variant grain (no fan-out from multi-location or multi-supplier joins)', async () => {
    const response = await getWorklist(fixture.token, { q: fixture.skus.multiLocation });

    expect(response.status).toBe(200);
    const items = response.body.items.filter((r: any) => r.lasyncro_variant_id === fixture.multiLocationVariantId);
    expect(items).toHaveLength(1);
  });

  it('SRC-WL-BE-02: multi-location inventory aggregates without duplicating the variant', async () => {
    const response = await getWorklist(fixture.token, { q: fixture.skus.multiLocation });

    expect(response.status).toBe(200);
    const item = response.body.items.find((r: any) => r.lasyncro_variant_id === fixture.multiLocationVariantId);
    expect(item).toBeDefined();
    // available 3 + 4 = 7; open demand 10 -> still_to_source 3, never per-location fragments (10 or 6).
    expect(item.still_to_source).toBe(3);
  });

  it('SRC-WL-BE-03: preserves short_now / still_to_source / committed_inbound semantics per item', async () => {
    const explicit = await getWorklist(fixture.token, { q: fixture.skus.coveredInbound, category: 'covered_inbound' });
    expect(explicit.status).toBe(200);
    const item = explicit.body.items.find((r: any) => r.lasyncro_variant_id === fixture.coveredInboundVariantId);
    expect(item).toBeDefined();
    expect(item.short_now).toBe(8);
    expect(item.committed_inbound).toBe(8);
    expect(item.still_to_source).toBe(0);
    expect(item.still_to_source).toBe(Math.max(0, item.short_now - item.committed_inbound));
  });

  it('SRC-WL-BE-04: preserves pending_queue_qty / draft_po_qty / in_purchasing / unplanned per item', async () => {
    const response = await getWorklist(fixture.token, { q: fixture.skus.inPurchasing, category: 'in_purchasing' });

    expect(response.status).toBe(200);
    const item = response.body.items.find((r: any) => r.lasyncro_variant_id === fixture.inPurchasingVariantId);
    expect(item).toBeDefined();
    expect(item.pending_queue_qty).toBe(5);
    expect(item.draft_po_qty).toBe(0);
    expect(item.in_purchasing).toBe(item.pending_queue_qty + item.draft_po_qty);
    expect(item.still_to_source).toBe(5);
    expect(item.unplanned).toBe(0);
    expect(item.unplanned).toBe(Math.max(0, item.still_to_source - item.in_purchasing));
  });

  it('SRC-WL-BE-05: a usable supplier via PO history alone (no saved preference) keeps a variant OUT of needs_supplier', async () => {
    const noPreference = await withTenant(fixture.shopId, async (trx) => {
      const row = await trx('supplier_product_preferences')
        .where({ shop_id: fixture.shopId })
        .andWhere(function () {
          this.where({ scope_id: fixture.needsPurchaseVariantId }).orWhere({ scope_id: fixture.productId });
        })
        .first();
      return row === undefined;
    });
    expect(noPreference).toBe(true);

    const response = await getWorklist(fixture.token, { q: fixture.skus.needsPurchase });

    expect(response.status).toBe(200);
    const item = response.body.items.find((r: any) => r.lasyncro_variant_id === fixture.needsPurchaseVariantId);
    expect(item).toBeDefined();
    expect(item.category).toBe('needs_purchase');
    expect(item.category).not.toBe('needs_supplier');
  });

  it('SRC-WL-BE-06: exclusive category precedence assigns each seeded variant its ratified category', async () => {
    const response = await getWorklist(fixture.token, { category: 'all' });
    expect(response.status).toBe(200);

    const byId = new Map(response.body.items.map((r: any) => [r.lasyncro_variant_id, r.category]));

    expect(byId.get(fixture.needsSupplierVariantId)).toBe('needs_supplier');
    expect(byId.get(fixture.needsPurchaseVariantId)).toBe('needs_purchase');
    expect(byId.get(fixture.inPurchasingVariantId)).toBe('in_purchasing');
    expect(byId.get(fixture.coveredInboundVariantId)).toBe('covered_inbound');
    expect(byId.get(fixture.planAheadVariantId)).toBe('plan_ahead');
    // Planning-branch reached with NO usable supplier -> needs_supplier, not plan_ahead.
    expect(byId.get(fixture.planAheadNoSupplierVariantId)).toBe('needs_supplier');
    // Fully covered, no signal -> not present under any category.
    expect(byId.has(fixture.fullyCoveredVariantId)).toBe(false);
  });

  it('SRC-WL-BE-07: reactive need wins over preventive planning (in_purchasing variant is never plan_ahead)', async () => {
    const response = await getWorklist(fixture.token, { category: 'all', q: fixture.skus.inPurchasing });
    expect(response.status).toBe(200);
    const item = response.body.items.find((r: any) => r.lasyncro_variant_id === fixture.inPurchasingVariantId);
    expect(item).toBeDefined();
    expect(item.still_to_source).toBeGreaterThan(0);
    expect(item.category).not.toBe('plan_ahead');
  });

  it('SRC-WL-BE-08: plan_ahead reuses the canonical Demand planning signal, not a second copy of the formula', async () => {
    const response = await getWorklist(fixture.token, { category: 'all', q: fixture.skus.planAhead });
    expect(response.status).toBe(200);
    const item = response.body.items.find((r: any) => r.lasyncro_variant_id === fixture.planAheadVariantId);
    expect(item).toBeDefined();
    expect(item.still_to_source).toBe(0);
    expect(item.category).toBe('plan_ahead');

    // Same signal, no usable supplier -> needs_supplier (not plan_ahead, not excluded).
    const noSupplierResponse = await getWorklist(fixture.token, { category: 'all', q: fixture.skus.planAheadNoSupplier });
    expect(noSupplierResponse.status).toBe(200);
    const noSupplierItem = noSupplierResponse.body.items.find((r: any) => r.lasyncro_variant_id === fixture.planAheadNoSupplierVariantId);
    expect(noSupplierItem).toBeDefined();
    expect(noSupplierItem.category).toBe('needs_supplier');
  });

  it('SRC-WL-BE-09: summary counts cover the full filtered universe, not just the current page', async () => {
    const response = await getWorklist(fixture.token, { category: 'all' });
    expect(response.status).toBe(200);
    // needs_supplier: needsSupplierVariantId + planAheadNoSupplierVariantId
    //   (planning-branch, no usable supplier).
    // needs_purchase: needsPurchaseVariantId + multiLocationVariantId
    //   (grain-probe variant legitimately has a usable supplier via PO
    //   history and unplanned>0, landing it in needs_purchase too).
    expect(response.body.summary).toMatchObject({
      needs_supplier: 2,
      needs_purchase: 2,
      in_purchasing: 1,
      covered_inbound: 1,
      plan_ahead: 1,
    });
  });

  it('SRC-WL-BE-10: covered_inbound is excluded from the default immediate-action view but still counted in summary', async () => {
    const defaultView = await getWorklist(fixture.token, {});
    expect(defaultView.status).toBe(200);
    const defaultIds = defaultView.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(defaultIds).not.toContain(fixture.coveredInboundVariantId);
    expect(defaultView.body.summary.covered_inbound).toBe(1);

    const explicit = await getWorklist(fixture.token, { category: 'covered_inbound' });
    expect(explicit.status).toBe(200);
    const explicitIds = explicit.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(explicitIds).toContain(fixture.coveredInboundVariantId);
  });

  it('SRC-WL-BE-11: server-side search matches product title, variant title, and SKU', async () => {
    const bySku = await getWorklist(fixture.token, { q: fixture.skus.needsSupplier });
    expect(bySku.status).toBe(200);
    expect(bySku.body.items.map((r: any) => r.lasyncro_variant_id)).toContain(fixture.needsSupplierVariantId);

    const byVariantTitle = await getWorklist(fixture.token, { q: 'Needs Supplier Variant' });
    expect(byVariantTitle.status).toBe(200);
    expect(byVariantTitle.body.items.map((r: any) => r.lasyncro_variant_id)).toContain(fixture.needsSupplierVariantId);

    const byProductTitle = await getWorklist(fixture.token, { q: fixture.productTitle, category: 'all' });
    expect(byProductTitle.status).toBe(200);
    expect(byProductTitle.body.items.length).toBeGreaterThanOrEqual(5);
  });

  it('SRC-WL-BE-12: category filter and search compose orthogonally', async () => {
    const matches = await getWorklist(fixture.token, { category: 'needs_purchase', q: fixture.skus.needsPurchase });
    expect(matches.status).toBe(200);
    expect(matches.body.items.map((r: any) => r.lasyncro_variant_id)).toEqual([fixture.needsPurchaseVariantId]);

    const noMatch = await getWorklist(fixture.token, { category: 'needs_purchase', q: fixture.skus.needsSupplier });
    expect(noMatch.status).toBe(200);
    expect(noMatch.body.items).toHaveLength(0);
  });

  it('SRC-WL-BE-12: supplier_readiness filters to the ratified readiness state, not just category', async () => {
    const ready = await getWorklist(filterFixture.token, { supplier_readiness: 'ready', category: 'all' });
    expect(ready.status).toBe(200);
    const readyIds = ready.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(readyIds).toContain(filterFixture.readyVariantId);
    expect(readyIds).not.toContain(filterFixture.needsSupplierVariantId);
    expect(readyIds).not.toContain(filterFixture.noHistoryQueuedVariantId);

    const needsSupplier = await getWorklist(filterFixture.token, { supplier_readiness: 'needs_supplier', category: 'all' });
    expect(needsSupplier.status).toBe(200);
    const needsSupplierIds = needsSupplier.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(needsSupplierIds).toContain(filterFixture.needsSupplierVariantId);
    expect(needsSupplierIds).not.toContain(filterFixture.readyVariantId);
    // in_purchasing via a bare reorder_request (no PO history) is NOT the
    // needs_supplier category, so it must not match this readiness filter.
    expect(needsSupplierIds).not.toContain(filterFixture.noHistoryQueuedVariantId);

    const noHistory = await getWorklist(filterFixture.token, { supplier_readiness: 'no_history', category: 'all' });
    expect(noHistory.status).toBe(200);
    const noHistoryIds = noHistory.body.items.map((r: any) => r.lasyncro_variant_id);
    // Distinguishing example: zero PO history AND category in_purchasing
    // (not needs_supplier) — proves no_history is a distinct axis from the
    // needs_supplier category, not an alias for it.
    expect(noHistoryIds).toContain(filterFixture.noHistoryQueuedVariantId);
    expect(noHistoryIds).toContain(filterFixture.needsSupplierVariantId);
    expect(noHistoryIds).not.toContain(filterFixture.readyVariantId);
  });

  it('SRC-WL-BE-12: purchasing_stage filters to the ratified workflow stage', async () => {
    const notStarted = await getWorklist(filterFixture.token, { purchasing_stage: 'not_started', category: 'all' });
    expect(notStarted.status).toBe(200);
    const notStartedIds = notStarted.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(notStartedIds).toContain(filterFixture.needsSupplierVariantId);
    expect(notStartedIds).not.toContain(filterFixture.noHistoryQueuedVariantId);
    expect(notStartedIds).not.toContain(filterFixture.draftStageVariantId);

    const queued = await getWorklist(filterFixture.token, { purchasing_stage: 'queued', category: 'all' });
    expect(queued.status).toBe(200);
    const queuedIds = queued.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(queuedIds).toContain(filterFixture.noHistoryQueuedVariantId);
    expect(queuedIds).not.toContain(filterFixture.draftStageVariantId);

    const draft = await getWorklist(filterFixture.token, { purchasing_stage: 'draft', category: 'all' });
    expect(draft.status).toBe(200);
    const draftIds = draft.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(draftIds).toContain(filterFixture.draftStageVariantId);
    expect(draftIds).not.toContain(filterFixture.noHistoryQueuedVariantId);

    const committed = await getWorklist(filterFixture.token, { purchasing_stage: 'committed', category: 'all' });
    expect(committed.status).toBe(200);
    const committedIds = committed.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(committedIds).toContain(filterFixture.coveredCommittedVariantId);
    expect(committedIds).not.toContain(filterFixture.needsSupplierVariantId);
  });

  it('SRC-WL-BE-12: coverage filters distinguish an open shortfall from an inbound-covered one', async () => {
    const short = await getWorklist(filterFixture.token, { coverage: 'short', category: 'all' });
    expect(short.status).toBe(200);
    const shortIds = short.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(shortIds).toContain(filterFixture.needsSupplierVariantId);
    expect(shortIds).not.toContain(filterFixture.coveredCommittedVariantId);

    const covered = await getWorklist(filterFixture.token, { coverage: 'covered_inbound', category: 'all' });
    expect(covered.status).toBe(200);
    const coveredIds = covered.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(coveredIds).toContain(filterFixture.coveredCommittedVariantId);
    expect(coveredIds).not.toContain(filterFixture.needsSupplierVariantId);
  });

  it('SRC-WL-BE-12: supplier_readiness, purchasing_stage, coverage, category, and q compose orthogonally together', async () => {
    const composed = await getWorklist(filterFixture.token, {
      category: 'in_purchasing',
      purchasing_stage: 'draft',
      q: 'Draft Stage Variant',
    });
    expect(composed.status).toBe(200);
    expect(composed.body.items.map((r: any) => r.lasyncro_variant_id)).toEqual([filterFixture.draftStageVariantId]);

    // Same category, same purchasing_stage, but the search excludes the match.
    const noMatch = await getWorklist(filterFixture.token, {
      category: 'in_purchasing',
      purchasing_stage: 'draft',
      q: 'No History Queued Variant',
    });
    expect(noMatch.status).toBe(200);
    expect(noMatch.body.items).toHaveLength(0);
  });

  it('SRC-WL-BE-13: sorting is deterministic across identical requests and honours category precedence in the default view', async () => {
    const first = await getWorklist(fixture.token, {});
    const second = await getWorklist(fixture.token, {});
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.items.map((r: any) => r.lasyncro_variant_id)).toEqual(
      second.body.items.map((r: any) => r.lasyncro_variant_id)
    );

    const precedence = ['needs_supplier', 'needs_purchase', 'in_purchasing', 'covered_inbound', 'plan_ahead'];
    const ranks = first.body.items.map((r: any) => precedence.indexOf(r.category));
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
  });

  it('SRC-WL-BE-13: sort=action_priority explicitly honours the same category precedence', async () => {
    const response = await getWorklist(fixture.token, { sort: 'action_priority' });
    expect(response.status).toBe(200);

    const precedence = ['needs_supplier', 'needs_purchase', 'in_purchasing', 'covered_inbound', 'plan_ahead'];
    const ranks = response.body.items.map((r: any) => precedence.indexOf(r.category));
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
  });

  it('SRC-WL-BE-13: sort=oldest_demand orders by open-demand order age, oldest first', async () => {
    const response = await getWorklist(sortFixture.token, { sort: 'oldest_demand', category: 'all' });
    expect(response.status).toBe(200);
    const ids = response.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(ids).toEqual([sortFixture.charlieVariantId, sortFixture.alphaVariantId, sortFixture.bravoVariantId]);
  });

  it('SRC-WL-BE-13: sort=still_to_source orders by shortfall size, worst first', async () => {
    const response = await getWorklist(sortFixture.token, { sort: 'still_to_source', category: 'all' });
    expect(response.status).toBe(200);
    const items = response.body.items.filter((r: any) =>
      [sortFixture.alphaVariantId, sortFixture.bravoVariantId, sortFixture.charlieVariantId].includes(r.lasyncro_variant_id)
    );
    expect(items.map((r: any) => r.lasyncro_variant_id)).toEqual([
      sortFixture.alphaVariantId,
      sortFixture.charlieVariantId,
      sortFixture.bravoVariantId,
    ]);
    expect(items.map((r: any) => r.still_to_source)).toEqual([30, 20, 10]);
  });

  it('SRC-WL-BE-13: sort=stockout_soonest orders by days-of-stock-remaining, soonest first', async () => {
    const response = await getWorklist(sortFixture.token, { sort: 'stockout_soonest', category: 'all' });
    expect(response.status).toBe(200);
    const ids = response.body.items.map((r: any) => r.lasyncro_variant_id);
    // Same 1 unit/day velocity for all three; available 2/6/12 -> days 2/6/12.
    expect(ids).toEqual([sortFixture.bravoVariantId, sortFixture.alphaVariantId, sortFixture.charlieVariantId]);
  });

  it('SRC-WL-BE-13: sort=product_az orders alphabetically by product title', async () => {
    const response = await getWorklist(sortFixture.token, { sort: 'product_az', category: 'all' });
    expect(response.status).toBe(200);
    const ids = response.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(ids).toEqual([sortFixture.alphaVariantId, sortFixture.bravoVariantId, sortFixture.charlieVariantId]);
  });

  it('SRC-WL-BE-15: every aggregate (items and summary) is scoped to the requesting tenant', async () => {
    const response = await getWorklist(fixture.token, { category: 'all' });
    expect(response.status).toBe(200);
    const ids = response.body.items.map((r: any) => r.lasyncro_variant_id);
    expect(ids).not.toContain(fixture.foreignVariantId);

    const bySku = await getWorklist(fixture.token, { q: fixture.foreignSku, category: 'all' });
    expect(bySku.status).toBe(200);
    expect(bySku.body.items).toHaveLength(0);
  });

  it('SRC-WL-BE-16: the endpoint is read-only and mutates no purchasing/inventory state', async () => {
    const before = await purchasingStateSnapshot(fixture.shopId);

    const r1 = await getWorklist(fixture.token, {});
    const r2 = await getWorklist(fixture.token, { category: 'all', q: fixture.skus.needsSupplier, page: 1, page_size: 10 });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const after = await purchasingStateSnapshot(fixture.shopId);
    expect(after).toEqual(before);
  });
});

describe('SOURCING-UX-COGNITIVE-01 Slice 2 — pagination contract (RED)', () => {
  const TOTAL_ROWS = 51;
  let shopId: number;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
    const unique = crypto.randomBytes(6).toString('hex');
    const shop = await bootstrapShop(unique);
    shopId = shop.shopId;
    token = shop.token;

    const productId = crypto.randomUUID();
    await seedProduct(shopId, productId, 'Pagination Scale Product');

    for (let i = 0; i < TOTAL_ROWS; i++) {
      const variantId = crypto.randomUUID();
      const sku = `SRC-WL-PG-${unique}-${String(i).padStart(3, '0')}`;
      await seedVariant(shopId, productId, { variantId, sku, title: `Pagination Variant ${i}` });
      await seedOpenDemand(shopId, productId, variantId, 3, `${900 + i}`);
    }
  });

  it('SRC-WL-BE-14: defaults to page_size=50 and reports pagination metadata against the full matching set', async () => {
    const response = await getWorklist(token, {});
    expect(response.status).toBe(200);
    expect(response.body.page_size).toBe(50);
    expect(response.body.items.length).toBe(50);
    expect(response.body.total).toBe(TOTAL_ROWS);

    const page2 = await getWorklist(token, { page: 2 });
    expect(page2.status).toBe(200);
    expect(page2.body.items.length).toBe(1);
  });

  it('SRC-WL-BE-09 (scale): summary counts the full filtered universe even though the page holds only 50 items', async () => {
    const response = await getWorklist(token, {});
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeLessThan(TOTAL_ROWS);
    expect(response.body.summary.needs_supplier).toBe(TOTAL_ROWS);
  });
});
