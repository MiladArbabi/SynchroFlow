// tests/integration/inventory/inventory-state-read-model.test.ts
//
// INVENTORY INTELLIGENCE RED-B — canonical Inventory state read model.
//
// Contract, exercised through the EXISTING public Products operator-summary
// provider (getProductsOperatorSummary), which will expose:
//
//   inventoryState: {
//     onHandUnits, availableUnits, reservedUnits, noValidPickLocationCount
//   }
//
// QUANTITIES — whole-shop inventory_truth, one SUM per canonical column:
//   onHandUnits    = SUM(on_hand_quantity)    signed; phantom rows lower it
//   availableUnits = SUM(available_quantity)  NOT on_hand − reserved
//   reservedUnits  = SUM(reserved_quantity)
//   No variant status / SKU / location-type restriction. Another tenant's
//   rows never contribute.
//
// NO VALID PICK LOCATION — DISTINCT variants with on_hand > 0 somewhere and
// NO on_hand > 0 row at an active pick bin (zone_type='pick', type='bin',
// active). ROOT is NOT a valid pick location for this metric (this is not the
// WMS release pickable predicate). Reads on_hand, not available, so fully
// reserved stock still counts. A variant with no inventory_truth row is
// Not received and never counts here.
//
// The legacy warehouse.variants_with_stock_no_bin field is a separate
// semantic and is deliberately not asserted.
//
// FIXTURE — real ledger → projection path: inventory_movements rows, then
// rebuildInventoryProjectionForVariants, so available_quantity carries the
// writer's own per-row clamp (max(0, on_hand − reserved)).
//
// PLACEMENT: tests/integration/ (backend-integration project), disposable
// PostgreSQL harness.

import crypto from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { getProductsOperatorSummary } from 'api-src/services/products-operator/ProductsOperatorSummary.provider';

jest.setTimeout(120000);

type Location = {
  code: string;
  type: 'bin';
  zone_type: 'pick' | 'storage' | 'quarantine';
  active: boolean;
};

type Movement = {
  location: string;
  movement_type: 'inbound_purchase' | 'shrinkage' | 'reservation_hold';
  quantity_delta: number;
};

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedWarehouse(shopId: number, locations: Location[]): Promise<string> {
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;

  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'RED-B fixture warehouse',
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

    for (const loc of locations) {
      await trx('warehouse_locations').insert({
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: loc.code,
        type: loc.type,
        parent_location_code: rootCode,
        active: loc.active,
        zone_type: loc.zone_type,
      });
    }
  });

  return rootCode;
}

async function seedVariant(
  shopId: number,
  opts: { label: string; status?: 'active' | 'archived'; sku?: string | null }
): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const status = opts.status ?? 'active';

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: `RED-B ${opts.label}`,
      status,
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: opts.sku === undefined ? `REDB-${crypto.randomBytes(4).toString('hex')}` : opts.sku,
      title: `RED-B ${opts.label}`,
      unit_cost: '5.00',
      status,
    });
  });

  return variantId;
}

async function recordMovements(shopId: number, variantId: string, movements: Movement[]) {
  await withTenant(shopId, async (trx) => {
    for (const m of movements) {
      await trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        device_event_id: crypto.randomUUID(),
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        movement_type: m.movement_type,
        quantity_delta: m.quantity_delta,
        reference_type: 'test_fixture_red_b',
        reference_id: crypto.randomUUID(),
        platform: 'wms',
        location_code: m.location,
        occurred_at: new Date(),
        triggered_by: 'test_fixture',
      });
    }
  });
}

async function rebuild(shopId: number, variantIds: string[]) {
  await withTenant(shopId, (trx) =>
    rebuildInventoryProjectionForVariants(shopId, variantIds, trx, new Date())
  );
}

async function readTruth(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId })
      .select('lasyncro_variant_id', 'location_code', 'on_hand_quantity', 'reserved_quantity', 'available_quantity')
  );
}

function summaryPeriod() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

const PICK_A = 'REDB-PICK-A';
const PICK_INACTIVE = 'REDB-PICK-INACTIVE';
const RESERVE_A = 'REDB-RESERVE-A';
const QUARANTINE_A = 'REDB-QUARANTINE-A';

const LOCATIONS: Location[] = [
  { code: PICK_A, type: 'bin', zone_type: 'pick', active: true },
  { code: PICK_INACTIVE, type: 'bin', zone_type: 'pick', active: false },
  { code: RESERVE_A, type: 'bin', zone_type: 'storage', active: true },
  { code: QUARANTINE_A, type: 'bin', zone_type: 'quarantine', active: true },
];

/**
 * One isolated tenant with ROOT + one active pick bin (PICK-A) and a single
 * variant whose ledger is replayed through the real projection rebuild.
 * Nothing is shared with the combined Shop A matrix or other discriminators.
 */
async function seedIsolatedShop(
  namePrefix: string,
  movements: (rootCode: string) => Movement[]
): Promise<{ shopId: number; variantId: string; rootCode: string }> {
  const shopId = await createFixtureShop(namePrefix);
  const rootCode = await seedWarehouse(shopId, [
    { code: PICK_A, type: 'bin', zone_type: 'pick', active: true },
  ]);
  const variantId = await seedVariant(shopId, { label: namePrefix });
  await recordMovements(shopId, variantId, movements(rootCode));
  await rebuild(shopId, [variantId]);
  return { shopId, variantId, rootCode };
}

function rowAt(rows: Array<Record<string, unknown>>, locationCode: string) {
  const row = rows.find((r) => r.location_code === locationCode);
  expect(row).toBeDefined();
  return {
    onHand: Number(row!.on_hand_quantity),
    reserved: Number(row!.reserved_quantity),
    available: Number(row!.available_quantity),
  };
}

describe('INVENTORY INTELLIGENCE RED-B — Inventory state read model (operator summary)', () => {
  let shopA: number;
  let shopB: number;
  let rootA: string;
  const v: Record<string, string> = {};

  // Expected shop A canonical column sums, per row (location):
  //
  //   variant              location        on_hand reserved available
  //   case1 pick+root      PICK-A              4       0        4
  //                        ROOT                3       0        3
  //   case2 root reserved  ROOT                6       6        0
  //   case3 reserve        RESERVE-A           5       0        5
  //                        PICK-A              0       0        0
  //   case4 inactive bin   PICK-INACTIVE       3       0        3
  //   case5 two non-pick   RESERVE-A           2       0        2
  //                        QUARANTINE-A        1       0        1
  //   phantom              PICK-A             -2       0        0   (clamped)
  //   over-reserved        PICK-A              2       5        0   (clamped)
  //   archived variant     PICK-A             10       0       10
  //   SKU-less variant     PICK-A              1       0        1
  //   not received         (no inventory_truth row)
  //                                          ----     ----     ----
  //                                            35      11       29
  //
  //   SUM(on_hand) − SUM(reserved) = 24 ≠ SUM(available) = 29
  //   A clamped On hand (negative row as 0) would read 37.
  //   Active + SKU'd variants only would read on_hand 24 (35 − 10 − 1).
  const SHOP_A_ON_HAND = 35;
  const SHOP_A_RESERVED = 11;
  const SHOP_A_AVAILABLE = 29;
  const SHOP_A_NO_VALID_PICK = 4; // case2, case3, case4, case5

  beforeAll(async () => {
    shopA = await createFixtureShop('redb-inventory-state-a');
    shopB = await createFixtureShop('redb-inventory-state-b');

    rootA = await seedWarehouse(shopA, LOCATIONS);

    v.case1 = await seedVariant(shopA, { label: 'case1 pick+root' });
    v.case2 = await seedVariant(shopA, { label: 'case2 root fully reserved' });
    v.case3 = await seedVariant(shopA, { label: 'case3 reserve only' });
    v.case4 = await seedVariant(shopA, { label: 'case4 inactive pick bin' });
    v.case5 = await seedVariant(shopA, { label: 'case5 two non-pick' });
    v.phantom = await seedVariant(shopA, { label: 'phantom' });
    v.overReserved = await seedVariant(shopA, { label: 'over-reserved' });
    v.archived = await seedVariant(shopA, { label: 'archived', status: 'archived' });
    v.skuLess = await seedVariant(shopA, { label: 'sku-less', sku: null });
    v.notReceived = await seedVariant(shopA, { label: 'not received' });

    await recordMovements(shopA, v.case1, [
      { location: PICK_A, movement_type: 'inbound_purchase', quantity_delta: 4 },
      { location: rootA, movement_type: 'inbound_purchase', quantity_delta: 3 },
    ]);
    await recordMovements(shopA, v.case2, [
      { location: rootA, movement_type: 'inbound_purchase', quantity_delta: 6 },
      { location: rootA, movement_type: 'reservation_hold', quantity_delta: 6 },
    ]);
    await recordMovements(shopA, v.case3, [
      { location: RESERVE_A, movement_type: 'inbound_purchase', quantity_delta: 5 },
      { location: PICK_A, movement_type: 'inbound_purchase', quantity_delta: 2 },
      { location: PICK_A, movement_type: 'shrinkage', quantity_delta: -2 },
    ]);
    await recordMovements(shopA, v.case4, [
      { location: PICK_INACTIVE, movement_type: 'inbound_purchase', quantity_delta: 3 },
    ]);
    await recordMovements(shopA, v.case5, [
      { location: RESERVE_A, movement_type: 'inbound_purchase', quantity_delta: 2 },
      { location: QUARANTINE_A, movement_type: 'inbound_purchase', quantity_delta: 1 },
    ]);
    await recordMovements(shopA, v.phantom, [
      { location: PICK_A, movement_type: 'shrinkage', quantity_delta: -2 },
    ]);
    await recordMovements(shopA, v.overReserved, [
      { location: PICK_A, movement_type: 'inbound_purchase', quantity_delta: 2 },
      { location: PICK_A, movement_type: 'reservation_hold', quantity_delta: 5 },
    ]);
    await recordMovements(shopA, v.archived, [
      { location: PICK_A, movement_type: 'inbound_purchase', quantity_delta: 10 },
    ]);
    await recordMovements(shopA, v.skuLess, [
      { location: PICK_A, movement_type: 'inbound_purchase', quantity_delta: 1 },
    ]);

    // notReceived is deliberately NOT rebuilt: a rebuild would zero-fill a
    // ROOT row and it would no longer be "no inventory_truth row".
    await rebuild(shopA, [
      v.case1, v.case2, v.case3, v.case4, v.case5,
      v.phantom, v.overReserved, v.archived, v.skuLess,
    ]);

    // Shop B — another tenant whose rows must never reach shop A's totals.
    // Its stock sits only at ROOT, so it would also inflate shop A's
    // noValidPickLocationCount if tenant scoping leaked.
    const rootB = await seedWarehouse(shopB, []);
    const shopBVariant = await seedVariant(shopB, { label: 'other tenant' });
    await recordMovements(shopB, shopBVariant, [
      { location: rootB, movement_type: 'inbound_purchase', quantity_delta: 100 },
      { location: rootB, movement_type: 'reservation_hold', quantity_delta: 7 },
    ]);
    await rebuild(shopB, [shopBVariant]);
  });

  it('fixture precondition: projected rows carry the intended canonical column sums', async () => {
    const rows = await readTruth(shopA);
    const sum = (col: 'on_hand_quantity' | 'reserved_quantity' | 'available_quantity') =>
      rows.reduce((s: number, r: Record<string, number>) => s + Number(r[col]), 0);

    expect(sum('on_hand_quantity')).toBe(SHOP_A_ON_HAND);
    expect(sum('reserved_quantity')).toBe(SHOP_A_RESERVED);
    expect(sum('available_quantity')).toBe(SHOP_A_AVAILABLE);
    expect(SHOP_A_ON_HAND - SHOP_A_RESERVED).not.toBe(SHOP_A_AVAILABLE);

    const phantomRow = rows.find((r: Record<string, unknown>) => r.lasyncro_variant_id === v.phantom);
    expect(Number(phantomRow.on_hand_quantity)).toBe(-2);
    expect(Number(phantomRow.available_quantity)).toBe(0);

    const overReservedRow = rows.find((r: Record<string, unknown>) => r.lasyncro_variant_id === v.overReserved);
    expect(Number(overReservedRow.on_hand_quantity)).toBe(2);
    expect(Number(overReservedRow.reserved_quantity)).toBe(5);
    expect(Number(overReservedRow.available_quantity)).toBe(0);

    expect(rows.some((r: Record<string, unknown>) => r.lasyncro_variant_id === v.notReceived)).toBe(false);

    const shopBRows = await readTruth(shopB);
    expect(shopBRows).toHaveLength(1);
    expect(Number(shopBRows[0].on_hand_quantity)).toBe(100);
  });

  it('A + C: exposes the three canonical column sums independently (Available is not On hand − Reserved)', async () => {
    const summary = await getProductsOperatorSummary({ shopId: shopA, period: summaryPeriod() });

    expect(summary).toHaveProperty('inventoryState.onHandUnits', SHOP_A_ON_HAND);
    expect(summary).toHaveProperty('inventoryState.reservedUnits', SHOP_A_RESERVED);
    expect(summary).toHaveProperty('inventoryState.availableUnits', SHOP_A_AVAILABLE);
  });

  it('B: a negative (phantom) on_hand row lowers onHandUnits — signed SUM, never clamped', async () => {
    const summary = await getProductsOperatorSummary({ shopId: shopA, period: summaryPeriod() });

    // 37 would be the clamped reading (the −2 phantom row treated as 0).
    expect(summary).toHaveProperty('inventoryState.onHandUnits', SHOP_A_ON_HAND);
  });

  it('D: whole-shop scope — archived and SKU-less variants still contribute to the totals', async () => {
    const summary = await getProductsOperatorSummary({ shopId: shopA, period: summaryPeriod() });

    // Restricted to active, SKU'd variants the totals would read
    // on_hand 24 / available 18; the archived (10) and SKU-less (1) rows count.
    expect(summary).toHaveProperty('inventoryState.onHandUnits', SHOP_A_ON_HAND);
    expect(summary).toHaveProperty('inventoryState.availableUnits', SHOP_A_AVAILABLE);
  });

  it('E: tenant isolation — each shop reads only its own inventory_truth', async () => {
    const summaryA = await getProductsOperatorSummary({ shopId: shopA, period: summaryPeriod() });
    const summaryB = await getProductsOperatorSummary({ shopId: shopB, period: summaryPeriod() });

    expect(summaryA).toHaveProperty('inventoryState.onHandUnits', SHOP_A_ON_HAND);
    expect(summaryA).toHaveProperty('inventoryState.reservedUnits', SHOP_A_RESERVED);
    expect(summaryA).toHaveProperty('inventoryState.availableUnits', SHOP_A_AVAILABLE);
    expect(summaryA).toHaveProperty('inventoryState.noValidPickLocationCount', SHOP_A_NO_VALID_PICK);

    expect(summaryB).toHaveProperty('inventoryState.onHandUnits', 100);
    expect(summaryB).toHaveProperty('inventoryState.reservedUnits', 7);
    expect(summaryB).toHaveProperty('inventoryState.availableUnits', 93);
    expect(summaryB).toHaveProperty('inventoryState.noValidPickLocationCount', 1);
  });

  it('F: noValidPickLocationCount over the five-case matrix, excluding Not received', async () => {
    // case1 PICK-A 4 + ROOT 3        → has active pick-bin stock → NOT counted
    // case2 ROOT 6, fully reserved   → on_hand, not available     → COUNTED
    // case3 RESERVE-A 5, PICK-A 0    → zero pick-bin row           → COUNTED
    // case4 inactive pick bin only   → inactive is not valid       → COUNTED
    // case5 RESERVE-A + QUARANTINE-A → distinct variant, once      → COUNTED
    // phantom / over-reserved / archived / SKU-less hold positive or negative
    // stock at the active PICK-A bin or none positive → NOT counted.
    // notReceived has no inventory_truth row → Not received, NOT counted.
    const summary = await getProductsOperatorSummary({ shopId: shopA, period: summaryPeriod() });

    expect(summary).toHaveProperty('inventoryState.noValidPickLocationCount', SHOP_A_NO_VALID_PICK);
  });
});

// ---------------------------------------------------------------------------
// DISCRIMINATORS — No valid pick location vs the legacy
// warehouse.variants_with_stock_no_bin semantic ("any row with
// available_quantity > 0 outside an active pick bin"). Each runs on its own
// tenant so its expected count depends on nothing else in this file.
// ---------------------------------------------------------------------------

describe('INVENTORY INTELLIGENCE RED-B — discriminator A: valid pick bin plus extra ROOT stock', () => {
  // PICK-A (active pick bin) on_hand 4, ROOT on_hand 3.
  // The variant HAS positive physical stock in an active pick bin, so the
  // extra ROOT stock does not make it lack a valid pick location → 0.
  let fixture: { shopId: number; variantId: string; rootCode: string };

  beforeAll(async () => {
    fixture = await seedIsolatedShop('redb-disc-a-pick-plus-root', (rootCode) => [
      { location: PICK_A, movement_type: 'inbound_purchase', quantity_delta: 4 },
      { location: rootCode, movement_type: 'inbound_purchase', quantity_delta: 3 },
    ]);
  });

  it('fixture control: PICK-A on_hand 4 and ROOT on_hand 3 are projected', async () => {
    const rows = await readTruth(fixture.shopId);

    expect(rows).toHaveLength(2);
    expect(rowAt(rows, PICK_A).onHand).toBe(4);
    expect(rowAt(rows, fixture.rootCode).onHand).toBe(3);
  });

  it('noValidPickLocationCount is 0 — a valid pick bin with stock wins over extra ROOT stock', async () => {
    const summary = await getProductsOperatorSummary({ shopId: fixture.shopId, period: summaryPeriod() });

    expect(summary).toHaveProperty('inventoryState.noValidPickLocationCount', 0);
  });
});

describe('INVENTORY INTELLIGENCE RED-B — discriminator B: fully reserved stock only at ROOT', () => {
  // ROOT on_hand 6, reserved 6, available 0; no pick-bin stock.
  // The metric reads PHYSICAL on_hand, not available, so fully reserved
  // stock with no valid pick location still counts → 1.
  let fixture: { shopId: number; variantId: string; rootCode: string };

  beforeAll(async () => {
    fixture = await seedIsolatedShop('redb-disc-b-reserved-root', (rootCode) => [
      { location: rootCode, movement_type: 'inbound_purchase', quantity_delta: 6 },
      { location: rootCode, movement_type: 'reservation_hold', quantity_delta: 6 },
    ]);
  });

  it('fixture control: ROOT on_hand 6 / reserved 6 / available 0 is the only projected row', async () => {
    const rows = await readTruth(fixture.shopId);

    expect(rows).toHaveLength(1);
    expect(rowAt(rows, fixture.rootCode)).toEqual({ onHand: 6, reserved: 6, available: 0 });
  });

  it('noValidPickLocationCount is 1 — fully reserved physical stock still lacks a valid pick location', async () => {
    const summary = await getProductsOperatorSummary({ shopId: fixture.shopId, period: summaryPeriod() });

    expect(summary).toHaveProperty('inventoryState.noValidPickLocationCount', 1);
  });
});

// ---------------------------------------------------------------------------
// RED-D — TRUTH ESTABLISHMENT. Aggregate zero is not the same fact as the
// absence of canonical truth. Both shops below report 0 / 0 / 0; only the
// one with an inventory_truth row has established Inventory truth.
// ---------------------------------------------------------------------------

describe('INVENTORY INTELLIGENCE RED-D — hasInventoryTruth: no truth vs explicit zero', () => {
  let emptyShopId: number;
  let zeroShopId: number;

  beforeAll(async () => {
    // EMPTY — a shop with no inventory_truth rows at all.
    emptyShopId = await createFixtureShop('redd-no-truth');

    // EXPLICIT ZERO — stock recorded and removed → one canonical 0 / 0 / 0 row.
    const zero = await seedIsolatedShop('redd-explicit-zero', () => [
      { location: PICK_A, movement_type: 'inbound_purchase', quantity_delta: 2 },
      { location: PICK_A, movement_type: 'shrinkage', quantity_delta: -2 },
    ]);
    zeroShopId = zero.shopId;
  });

  it('fixture control: the empty shop has no truth rows; the zero shop has one 0 / 0 / 0 row', async () => {
    expect(await readTruth(emptyShopId)).toHaveLength(0);

    const rows = await readTruth(zeroShopId);
    expect(rows).toHaveLength(1);
    expect(rowAt(rows, PICK_A)).toEqual({ onHand: 0, reserved: 0, available: 0 });
  });

  it('existing B1 totals: both shops report numeric 0 / 0 / 0', async () => {
    for (const shopId of [emptyShopId, zeroShopId]) {
      const summary = await getProductsOperatorSummary({ shopId, period: summaryPeriod() });
      expect(summary).toHaveProperty('inventoryState.onHandUnits', 0);
      expect(summary).toHaveProperty('inventoryState.availableUnits', 0);
      expect(summary).toHaveProperty('inventoryState.reservedUnits', 0);
    }
  });

  it('EMPTY SHOP: hasInventoryTruth is false', async () => {
    const summary = await getProductsOperatorSummary({ shopId: emptyShopId, period: summaryPeriod() });

    expect(summary).toHaveProperty('inventoryState.hasInventoryTruth', false);
  });

  it('EXPLICIT ZERO: hasInventoryTruth is true', async () => {
    const summary = await getProductsOperatorSummary({ shopId: zeroShopId, period: summaryPeriod() });

    expect(summary).toHaveProperty('inventoryState.hasInventoryTruth', true);
  });
});
