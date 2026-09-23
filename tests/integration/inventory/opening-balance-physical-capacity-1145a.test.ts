// tests/integration/inventory/opening-balance-physical-capacity-1145a.test.ts
//
// GH-1145-A1 — opening expectation vs physical release capacity.
//
// Ratified A1 architecture (bootstrap-model reconciliation):
//   - shop_wms_settings.bootstrap_model (migration 0193) classifies every
//     tenant: existing tenants legacy_opening_balance_v1, new tenants
//     reconcile_opening_expectation_v2.
//   - v2: Shopify inventoryQuantity is an opening EXPECTATION only
//     (shopify_opening_inventory_expectations, migration 0194) — zero
//     opening_balance movements, zero physical capacity.
//   - legacy: Shopify opening_balance keeps its current physical semantics
//     until A2 physically verifies it. Nothing zeros legacy capacity in A1.
//   - Release capacity = inventory_truth.available_quantity at canonical
//     pickable locations (readReleaseCapacity), shared by the eligibility
//     evaluator, the release precheck and the reservation lock.
//   - Warehouse root is pickable. Quantity capacity never reads
//     inventory_units, LSU/LSP identity, barcode or label/print state.
//
// SUPERSEDED: the pre-reconciliation A1-04/A1-05 asserted that a legacy
// Shopify opening_balance is unusable. The bootstrap-model reconciliation
// keeps legacy tenants compatible until A2, so those cases now assert the
// ratified compatibility contract instead, and the "unusable" contract is
// asserted for v2 tenants (A1-01, A1-05-V2).
//
// Pick scan readiness (barcode / printed labels) is GH-1145-D and is
// characterised separately in eligibility-reservation-parity-1145d.test.ts.
// PARITY-01 gives its variant a barcode so it exercises quantity capacity,
// not scan readiness.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import { evaluateInventoryConstraint } from 'api-src/services/constraints/evaluators/inventoryConstraintEvaluator';
import { seedShopifyOpeningBalances } from 'api-src/services/inventory/seedShopifyOpeningBalances';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { readReleaseCapacity } from 'api-src/services/inventory/releaseCapacity.service';
import {
  InventoryChangedDuringReleaseError,
  reserveBatchInventory,
} from 'api-src/services/wms/batchReservation.service';

jest.setTimeout(120000);

const REPO = path.resolve(__dirname, '../../..');

type BootstrapModel =
  | 'legacy_opening_balance_v1'
  | 'reconcile_opening_expectation_v2';

/**
 * `bootstrapModel === null` leaves shop_wms_settings unprovisioned
 * (LEGACY-02 classifies it afterwards with the migration's own SQL shape).
 */
async function createShop(bootstrapModel: BootstrapModel | null): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1145a-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  if (bootstrapModel !== null) {
    await withTenant(shopId, (trx) =>
      trx('shop_wms_settings').insert({ shop_id: shopId, bootstrap_model: bootstrapModel })
    );
  }

  return shopId;
}

type Fixture = {
  productId: string;
  variantId: string;
  warehouseId: string;
  rootCode: string;
};

/** Minimal product/variant/warehouse-root fixture — no bins, matching a fresh install. */
async function seedProductAndWarehouse(
  shopId: number,
  opts: { barcode?: string | null } = {}
): Promise<Fixture> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;

  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'GH-1145-A fixture warehouse',
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
      title: 'GH-1145-A fixture product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `GH1145A-${crypto.randomBytes(4).toString('hex')}`,
      title: 'GH-1145-A fixture variant',
      unit_cost: '5.00',
      status: 'active',
      barcode: opts.barcode ?? null,
    });
  });

  return { productId, variantId, warehouseId, rootCode };
}

async function addPickBin(shopId: number, fixture: Fixture, binCode: string) {
  await withTenant(shopId, (trx) =>
    trx('warehouse_locations').insert({
      shop_id: shopId,
      warehouse_id: fixture.warehouseId,
      location_code: binCode,
      type: 'bin',
      parent_location_code: fixture.rootCode,
      active: true,
      zone_type: 'pick',
    })
  );
}

/** Runs the REAL Shopify opening ingestion path against an injected client. */
async function seedShopifyOpening(
  shopId: number,
  variantId: string,
  qty: number
) {
  const externalVariantId = `gid://shopify/ProductVariant/${crypto.randomBytes(4).toString('hex')}`;

  await withTenant(shopId, (trx) =>
    trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${crypto.randomBytes(4).toString('hex')}`,
      external_variant_id: externalVariantId,
    })
  );

  const client = {
    request: jest.fn().mockResolvedValue({
      data: {
        products: {
          edges: [
            {
              node: {
                variants: {
                  edges: [
                    { node: { id: externalVariantId, inventoryQuantity: qty } },
                  ],
                },
              },
            },
          ],
        },
      },
    }),
  };

  await withTenant(shopId, (trx) =>
    seedShopifyOpeningBalances(
      trx as any,
      'test-access-token',
      'gh1145a.myshopify.com',
      shopId,
      client
    )
  );

  return externalVariantId;
}

/**
 * Existing-tenant ledger shape: a canonical Shopify opening_balance with an
 * old `occurred_at`, set AT INSERT TIME (inventory_movements is append-only,
 * so backdating an inserted row is not legal). Mirrors the legacy
 * seedShopifyOpeningBalances insert shape exactly.
 */
async function recordLegacyShopifyOpeningBalance(
  shopId: number,
  variantId: string,
  locationCode: string,
  qty: number,
  occurredAt: Date
) {
  await withTenant(shopId, (trx) =>
    trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(),
      device_event_id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      movement_type: 'opening_balance',
      quantity_delta: qty,
      reference_type: 'opening_balance',
      reference_id: crypto.randomUUID(),
      platform: 'shopify',
      location_code: locationCode,
      occurred_at: occurredAt,
      triggered_by: 'system',
    })
  );
}

/** A genuine physical receipt (e.g. receiveJob outcome) — NOT an opening_balance. */
async function recordGenuinePhysicalReceipt(
  shopId: number,
  variantId: string,
  locationCode: string,
  qty: number,
  triggeredBy: string = 'test_fixture'
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
      triggered_by: triggeredBy,
    })
  );
}

async function rebuildProjection(shopId: number, variantId: string) {
  await withTenant(shopId, (trx) =>
    rebuildInventoryProjectionForVariants(shopId, [variantId], trx, new Date())
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
      title: 'GH-1145-A fixture line',
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
      title: 'GH-1145-A fixture line',
      quantity,
      unit_price: '10.00',
      line_total: (10 * quantity).toFixed(2),
      created_at: now,
      updated_at: now,
    });
  });

  return { orderId, lineItemId };
}

async function isOversellBlocked(
  shopId: number,
  orderId: string,
  variantId: string
): Promise<boolean> {
  const results = await withTenant(shopId, (trx) =>
    evaluateInventoryConstraint(trx, orderId, shopId)
  );
  const row = results.find((r) => r.targetId === variantId);
  expect(row).toBeDefined();
  return !!row?.isActive;
}

async function releaseCapacity(shopId: number, variantId: string): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    readReleaseCapacity(trx, { shopId, variantIds: [variantId], lock: 'none' })
  );
  return rows.reduce((sum, row) => sum + row.availableQuantity, 0);
}

async function countMovements(
  shopId: number,
  variantId: string,
  movementType: string
): Promise<number> {
  const [{ count }] = await withTenant(shopId, (trx) =>
    trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, movement_type: movementType })
      .count<{ count: string }[]>('* as count')
  );
  return Number(count);
}

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

describe('GH-1145-A1 — opening expectation vs physical release capacity', () => {
  it('A1-01 / NEW-01: v2 Shopify qty=20 is an expectation only — zero opening_balance, release capacity 0, demand blocked', async () => {
    const shopId = await createShop('reconcile_opening_expectation_v2');
    const { productId, variantId } = await seedProductAndWarehouse(shopId);

    await seedShopifyOpening(shopId, variantId, 20);
    await rebuildProjection(shopId, variantId);

    const expectation = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .first('expected_quantity')
    );
    expect(Number(expectation?.expected_quantity)).toBe(20);
    expect(await countMovements(shopId, variantId, 'opening_balance')).toBe(0);

    expect(await releaseCapacity(shopId, variantId)).toBe(0);

    const { orderId } = await createDemandOrder(shopId, productId, variantId, 20);
    expect(await isOversellBlocked(shopId, orderId, variantId)).toBe(true);
  });

  it('A1-02: physical root stock (a genuine receipt, not an opening_balance) is usable at WH-{shopId}-ROOT', async () => {
    const shopId = await createShop('reconcile_opening_expectation_v2');
    const { productId, variantId, rootCode } = await seedProductAndWarehouse(shopId);

    await recordGenuinePhysicalReceipt(shopId, variantId, rootCode, 20);
    await rebuildProjection(shopId, variantId);

    expect(await releaseCapacity(shopId, variantId)).toBe(20);

    const { orderId } = await createDemandOrder(shopId, productId, variantId, 20);
    expect(await isOversellBlocked(shopId, orderId, variantId)).toBe(false);
  });

  it('A1-03 / NEW-03: physical stock with zero inventory_units, no barcode and no printed labels is release capacity', async () => {
    const shopId = await createShop('reconcile_opening_expectation_v2');
    const { productId, variantId, rootCode } = await seedProductAndWarehouse(shopId, {
      barcode: null,
    });

    await recordGenuinePhysicalReceipt(shopId, variantId, rootCode, 5);
    await rebuildProjection(shopId, variantId);

    // Preconditions: no external barcode, zero inventory_units — therefore
    // zero LSU/LSP identity and zero label_printed_at evidence.
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

    expect(await releaseCapacity(shopId, variantId)).toBe(5);

    const { orderId } = await createDemandOrder(shopId, productId, variantId, 5);
    expect(await isOversellBlocked(shopId, orderId, variantId)).toBe(false);
  });

  it('A1-04 / LEGACY-01: a legacy tenant\'s Shopify opening_balance keeps current behaviour in A1 — written, and usable capacity', async () => {
    const shopId = await createShop('legacy_opening_balance_v1');
    const { productId, variantId } = await seedProductAndWarehouse(shopId);

    await seedShopifyOpening(shopId, variantId, 20);
    await rebuildProjection(shopId, variantId);

    // Legacy ingestion path unchanged: one opening_balance movement, no
    // expectation snapshot.
    const opening = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, movement_type: 'opening_balance' })
        .select('quantity_delta', 'platform', 'location_code')
    );
    expect(opening).toEqual([
      { quantity_delta: 20, platform: 'shopify', location_code: `WH-${shopId}-ROOT` },
    ]);

    const [{ count: expectationCount }] = await withTenant(shopId, (trx) =>
      trx('shopify_opening_inventory_expectations')
        .where({ shop_id: shopId })
        .count<{ count: string }[]>('* as count')
    );
    expect(Number(expectationCount)).toBe(0);

    expect(await releaseCapacity(shopId, variantId)).toBe(20);

    const { orderId: orderOfTwenty } = await createDemandOrder(shopId, productId, variantId, 20);
    const { orderId: orderOfTwentyOne } = await createDemandOrder(shopId, productId, variantId, 21);
    expect(await isOversellBlocked(shopId, orderOfTwenty, variantId)).toBe(false);
    expect(await isOversellBlocked(shopId, orderOfTwentyOne, variantId)).toBe(true);
  });

  it('A1-05-LEGACY: legacy opening 20 plus a genuine receipt of 5 remains current legacy capacity of 25 until A2', async () => {
    const shopId = await createShop('legacy_opening_balance_v1');
    const { productId, variantId, rootCode } = await seedProductAndWarehouse(shopId);

    await recordLegacyShopifyOpeningBalance(
      shopId,
      variantId,
      rootCode,
      20,
      new Date('2026-01-01T00:00:00.000Z')
    );
    await recordGenuinePhysicalReceipt(shopId, variantId, rootCode, 5, 'receive_job');
    await rebuildProjection(shopId, variantId);

    expect(await releaseCapacity(shopId, variantId)).toBe(25);

    const { orderId: orderOfTwentyFive } = await createDemandOrder(shopId, productId, variantId, 25);
    const { orderId: orderOfTwentySix } = await createDemandOrder(shopId, productId, variantId, 26);
    expect(await isOversellBlocked(shopId, orderOfTwentyFive, variantId)).toBe(false);
    expect(await isOversellBlocked(shopId, orderOfTwentySix, variantId)).toBe(true);
  });

  it('A1-05-V2 / NEW-02: v2 expectation 20 plus a physical receipt of 5 exposes exactly 5', async () => {
    const shopId = await createShop('reconcile_opening_expectation_v2');
    const { productId, variantId, rootCode } = await seedProductAndWarehouse(shopId);

    await seedShopifyOpening(shopId, variantId, 20);
    await recordGenuinePhysicalReceipt(shopId, variantId, rootCode, 5, 'receive_job');
    await rebuildProjection(shopId, variantId);

    expect(await releaseCapacity(shopId, variantId)).toBe(5);

    // Not 0 (genuine stock hidden) and not 25 (expectation commingled).
    const { orderId: orderOfFive } = await createDemandOrder(shopId, productId, variantId, 5);
    const { orderId: orderOfSix } = await createDemandOrder(shopId, productId, variantId, 6);
    expect(await isOversellBlocked(shopId, orderOfFive, variantId)).toBe(false);
    expect(await isOversellBlocked(shopId, orderOfSix, variantId)).toBe(true);
  });

  it('LEGACY-02: classifying an existing tenant legacy zeros nothing, and the A1 migrations contain no inventory cutover', async () => {
    // An existing tenant: Shopify opening stock already in the ledger and
    // projection BEFORE any bootstrap classification exists.
    const shopId = await createShop(null);
    const { productId, variantId, rootCode } = await seedProductAndWarehouse(shopId);

    await recordLegacyShopifyOpeningBalance(
      shopId,
      variantId,
      rootCode,
      20,
      new Date('2026-01-01T00:00:00.000Z')
    );
    await rebuildProjection(shopId, variantId);

    const movementsBefore = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .orderBy('lasyncro_inventory_movement_id')
    );
    expect(await releaseCapacity(shopId, variantId)).toBe(20);

    // Migration 0193 steps 2+3 shape (bootstrap_model inline — the NOT NULL
    // it adds is already active in this harness).
    await withTenant(shopId, (trx) =>
      trx.raw(
        `
        INSERT INTO public.shop_wms_settings (shop_id, bootstrap_model)
        SELECT s.id, 'legacy_opening_balance_v1'
        FROM public.shops AS s
        LEFT JOIN public.shop_wms_settings AS sws ON sws.shop_id = s.id
        WHERE sws.shop_id IS NULL AND s.id = ?
      `,
        [shopId]
      )
    );

    const settings = await withTenant(shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: shopId }).first('bootstrap_model')
    );
    expect(settings?.bootstrap_model).toBe('legacy_opening_balance_v1');

    // Capacity survives classification AND a fresh projection replay.
    expect(await releaseCapacity(shopId, variantId)).toBe(20);
    await rebuildProjection(shopId, variantId);
    expect(await releaseCapacity(shopId, variantId)).toBe(20);

    const movementsAfter = await withTenant(shopId, (trx) =>
      trx('inventory_movements')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId })
        .orderBy('lasyncro_inventory_movement_id')
    );
    expect(movementsAfter).toEqual(movementsBefore);

    const { orderId } = await createDemandOrder(shopId, productId, variantId, 20);
    expect(await isOversellBlocked(shopId, orderId, variantId)).toBe(false);

    // Structural: neither A1 migration's executable code touches inventory
    // state (comments stripped — they may name these tables).
    for (const file of [
      'apps/backend/migrations/20260923140000_0193_add_shop_wms_settings_bootstrap_model.ts',
      'apps/backend/migrations/20260923150000_0194_create_shopify_opening_inventory_expectations.ts',
    ]) {
      const code = fs
        .readFileSync(path.join(REPO, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/inventory_movements|inventory_truth|inventory_units/);
    }
  });

  it('PARITY-01: evaluator, release precheck and reservation share one capacity source and agree on the same quantity', async () => {
    const shopId = await createShop('reconcile_opening_expectation_v2');
    // Barcode present so reservation's scan-readiness gate (GH-1145-D) is
    // satisfied and this case isolates quantity capacity.
    const fixture = await seedProductAndWarehouse(shopId, {
      barcode: `1145A${crypto.randomInt(10_000_000, 99_999_999)}`,
    });
    const { productId, variantId, rootCode } = fixture;
    const binCode = `A1-${crypto.randomBytes(3).toString('hex')}`;
    await addPickBin(shopId, fixture, binCode);

    // Expectation (not capacity) + 3 physical in a pick bin + 5 at root.
    await seedShopifyOpening(shopId, variantId, 20);
    await recordGenuinePhysicalReceipt(shopId, variantId, binCode, 3);
    await recordGenuinePhysicalReceipt(shopId, variantId, rootCode, 5);
    await rebuildProjection(shopId, variantId);

    // Shared source: bins before ROOT, expectation absent.
    const rows = await withTenant(shopId, (trx) =>
      readReleaseCapacity(trx, { shopId, variantIds: [variantId], lock: 'none' })
    );
    expect(rows).toEqual([
      { lasyncroVariantId: variantId, locationCode: binCode, locationRank: 0, availableQuantity: 3 },
      { lasyncroVariantId: variantId, locationCode: rootCode, locationRank: 1, availableQuantity: 5 },
    ]);

    // Eligibility: 8 eligible, 9 blocked.
    const eight = await createDemandOrder(shopId, productId, variantId, 8);
    const nine = await createDemandOrder(shopId, productId, variantId, 9);
    expect(await isOversellBlocked(shopId, eight.orderId, variantId)).toBe(false);
    expect(await isOversellBlocked(shopId, nine.orderId, variantId)).toBe(true);

    // Reservation under lock refuses the same 9 the evaluator blocks —
    // reporting the same 8 — with zero side effects.
    const shortBatchId = await createPickBatch(shopId);
    let caught: unknown = null;
    await withTenant(shopId, async (trx) => {
      try {
        await reserveBatchInventory(trx, {
          shopId,
          pickBatchId: shortBatchId,
          releasedBy: null,
          lineItems: [
            {
              lasyncro_variant_id: variantId,
              quantity: 9,
              lasyncro_order_id: nine.orderId,
              lasyncro_line_item_id: nine.lineItemId,
            },
          ],
        });
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(InventoryChangedDuringReleaseError);
    expect((caught as InventoryChangedDuringReleaseError).requiredQuantity).toBe(9);
    expect((caught as InventoryChangedDuringReleaseError).availableQuantity).toBe(8);
    expect(await countMovements(shopId, variantId, 'reservation_hold')).toBe(0);

    // Reservation of the eligible 8 allocates exactly the shared rows,
    // bins first, and consumes all of them.
    const batchId = await createPickBatch(shopId);
    const allocations = await withTenant(shopId, (trx) =>
      reserveBatchInventory(trx, {
        shopId,
        pickBatchId: batchId,
        releasedBy: null,
        lineItems: [
          {
            lasyncro_variant_id: variantId,
            quantity: 8,
            lasyncro_order_id: eight.orderId,
            lasyncro_line_item_id: eight.lineItemId,
          },
        ],
      })
    );
    expect(allocations).toEqual([
      { lasyncroVariantId: variantId, locationCode: binCode, quantity: 3 },
      { lasyncroVariantId: variantId, locationCode: rootCode, quantity: 5 },
    ]);
    expect(await releaseCapacity(shopId, variantId)).toBe(0);

    // Structural: all three consumers read readReleaseCapacity and none
    // carries its own pickable-location capacity query.
    for (const file of [
      'apps/backend/src/services/constraints/evaluators/inventoryConstraintEvaluator.ts',
      'apps/backend/src/services/wms/pickBatch.service.ts',
      'apps/backend/src/services/wms/batchReservation.service.ts',
    ]) {
      const source = fs.readFileSync(path.join(REPO, file), 'utf8');
      expect(source).toMatch(/readReleaseCapacity\(/);
      expect(source).not.toMatch(/pickableLocationCondition/);
      expect(source).not.toMatch(/inventory_units/);
    }
  });
});
