// tests/integration/inventory/opening-inventory-physical-target.service.test.ts
//
// GH-1179 RED-C — current physical target + local readiness contract.
//
// The Opening Inventory cutover target for variant V is CURRENT local physical
// truth owned by the participating warehouse W, read at cutover time:
//
//   TARGET(V) = SUM inventory_truth.on_hand_quantity
//               over rows whose (shop_id, location_code) is owned by
//               warehouse_locations.warehouse_id = W
//
// keyed by the union of the complete Slice-B snapshot's non-null
// lasyncro_variant_ids and the variants present in W-owned truth.
//
// FUTURE SERVICE CONTRACT (implemented in GREEN, never faked here):
//
//   apps/backend/src/services/wms/openingInventoryPhysicalTarget.service.ts
//
//   resolveOpeningInventoryParticipatingWarehouse(trx, shopId)
//     → { warehouseId: string, ... }
//     Scope-resolution integrity, NOT readiness: fails closed by rejecting
//     with an Error whose `code` is one of
//       OPENING_INVENTORY_SNAPSHOT_REQUIRED
//         no complete opening_inventory_shopify_snapshots row for the shop
//       OPENING_INVENTORY_COHORT_SCOPE_MISMATCH
//         DISTINCT opening_inventory task warehouses ≠ exactly {snapshot W}
//     and which carries no readiness `reasons`. It never picks the snapshot,
//     the cohort, a union or an active warehouse as a fallback.
//   buildOpeningInventoryPhysicalTarget(trx, shopId, warehouseId)
//     → Array<{ lasyncroVariantId: string; targetQuantity: number }>
//       sorted ascending by lasyncroVariantId
//   assertOpeningInventoryPhysicalReadiness(trx, shopId, warehouseId)
//     → resolves when ready; otherwise rejects with an Error whose
//       `reasons` is an array of reason codes:
//       ROOT_NONZERO | ORPHAN_NONZERO | NEGATIVE | PICK_PACK_IN_FLIGHT |
//       RETURN_PHYSICAL_UNRESOLVED | CANCELLED_PICK_UNRESOLVED
//
// The service is loaded lazily so this file always executes. While the module
// is absent every behavioural case builds its real fixture first and then
// fails with SLICE_C_SERVICE_MISSING at the production seam.
//
// Fixture: real Postgres, a v2 shop, warehouse W rooted at WH-{shopId}-ROOT,
// a REAL Slice-B start (complete Shopify snapshot + opening cohort through
// startShopOpeningInventory with an injected Location reader) and opening bins
// settled through the canonical Opening Inventory recount flow. Read-only
// guard cases seed the persisted state they interpret directly.
//
// Excluded by contract: the Shopify fulfillment gap (D/E) and the Problem
// Center discard/write_off/quarantine truth-mutation defect (separate P1).

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import {
  addOpeningInventoryRecountLine,
  claimRecountTask,
  closeCount,
  commitRecount,
  completeOpeningInventoryBin,
  createOpeningInventoryCohort,
  createRecountTask,
  recordCount,
  resolveOpeningInventoryStartScope,
  reviewLine,
} from 'api-src/services/wms/inventoryRecount.service';
import {
  startShopOpeningInventory,
  type OpeningInventoryLocationPageReader,
} from 'api-src/services/wms/shopifyOpeningInventorySnapshot.service';
import { confirmStow } from 'api-src/services/wms/stow.service';
import { setLineOwnerDecision } from 'api-src/services/returns/returnJobs.service';

jest.setTimeout(120000);

// ─── future production seam ────────────────────────────────────────────────

const REPO = path.resolve(__dirname, '../../..');
const SERVICE_SPECIFIER =
  'api-src/services/wms/openingInventoryPhysicalTarget.service';
const SERVICE_FILE = path.join(
  REPO,
  'apps/backend/src/services/wms/openingInventoryPhysicalTarget.service.ts'
);
const REQUIRED_EXPORTS = [
  'resolveOpeningInventoryParticipatingWarehouse',
  'buildOpeningInventoryPhysicalTarget',
  'assertOpeningInventoryPhysicalReadiness',
] as const;

type ReadinessReason =
  | 'ROOT_NONZERO'
  | 'ORPHAN_NONZERO'
  | 'NEGATIVE'
  | 'PICK_PACK_IN_FLIGHT'
  | 'RETURN_PHYSICAL_UNRESOLVED'
  | 'CANCELLED_PICK_UNRESOLVED';

type TargetRow = { lasyncroVariantId: string; targetQuantity: number };

type PhysicalTargetService = {
  resolveOpeningInventoryParticipatingWarehouse: (
    trx: any,
    shopId: number
  ) => Promise<{ warehouseId: string }>;
  buildOpeningInventoryPhysicalTarget: (
    trx: any,
    shopId: number,
    warehouseId: string
  ) => Promise<TargetRow[]>;
  assertOpeningInventoryPhysicalReadiness: (
    trx: any,
    shopId: number,
    warehouseId: string
  ) => Promise<unknown>;
};

/**
 * Diagnostic RED loader. A missing module or export is reported as
 * SLICE_C_SERVICE_MISSING instead of a module-resolution crash at file load.
 * Once the module exists it is required normally, so its own load errors
 * surface verbatim.
 */
function loadPhysicalTargetService(): PhysicalTargetService {
  if (!fs.existsSync(SERVICE_FILE)) {
    throw new Error(
      `SLICE_C_SERVICE_MISSING: ${path.relative(REPO, SERVICE_FILE)} does not exist`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const service = require(SERVICE_SPECIFIER);

  const missing = REQUIRED_EXPORTS.filter(
    (name) => typeof service[name] !== 'function'
  );

  if (missing.length > 0) {
    throw new Error(
      `SLICE_C_SERVICE_MISSING: missing export(s) ${missing.join(', ')}`
    );
  }

  return service as PhysicalTargetService;
}

async function resolveWarehouse(fixture: Fixture): Promise<{ warehouseId: string }> {
  const service = loadPhysicalTargetService();
  return withTenant(fixture.shopId, (trx) =>
    service.resolveOpeningInventoryParticipatingWarehouse(trx, fixture.shopId)
  );
}

/**
 * Resolver outcome without letting a missing seam masquerade as a rejection:
 * the service is loaded first, so SLICE_C_SERVICE_MISSING fails the test
 * directly instead of being captured as the resolver's error.
 */
async function resolveWarehouseOutcome(
  fixture: Fixture
): Promise<{ resolved?: unknown; error?: any }> {
  const service = loadPhysicalTargetService();

  try {
    const resolved = await withTenant(fixture.shopId, (trx) =>
      service.resolveOpeningInventoryParticipatingWarehouse(trx, fixture.shopId)
    );
    return { resolved };
  } catch (error) {
    return { error };
  }
}

function expectScopeRejection(
  outcome: { resolved?: unknown; error?: any },
  code: 'OPENING_INVENTORY_SNAPSHOT_REQUIRED' | 'OPENING_INVENTORY_COHORT_SCOPE_MISMATCH'
): void {
  expect(outcome.resolved).toBeUndefined();
  expect(outcome.error).toBeInstanceOf(Error);
  expect(outcome.error.code).toBe(code);
  expect(outcome.error.reasons).toBeUndefined();
}

async function readTarget(fixture: Fixture): Promise<TargetRow[]> {
  const service = loadPhysicalTargetService();
  return withTenant(fixture.shopId, (trx) =>
    service.buildOpeningInventoryPhysicalTarget(
      trx,
      fixture.shopId,
      fixture.warehouseId
    )
  );
}

/**
 * [] when ready. A rejection carrying `reasons` is a readiness verdict;
 * any other error is unexpected and propagates unchanged.
 */
async function readinessReasons(fixture: Fixture): Promise<string[]> {
  const service = loadPhysicalTargetService();

  try {
    await withTenant(fixture.shopId, (trx) =>
      service.assertOpeningInventoryPhysicalReadiness(
        trx,
        fixture.shopId,
        fixture.warehouseId
      )
    );
    return [];
  } catch (error: any) {
    if (!Array.isArray(error?.reasons)) throw error;
    return [...new Set<string>(error.reasons.map(String))].sort();
  }
}

function reasons(...codes: ReadinessReason[]): string[] {
  return [...codes].sort();
}

function expectedTarget(quantities: Record<string, number>): TargetRow[] {
  return Object.keys(quantities)
    .sort()
    .map((lasyncroVariantId) => ({
      lasyncroVariantId,
      targetQuantity: quantities[lasyncroVariantId],
    }));
}

// ─── fixture ───────────────────────────────────────────────────────────────

type Fixture = {
  shopId: number;
  unique: string;
  warehouseId: string;
  rootCode: string;
  literalRootCode: string;
  locationGid: string;
  problemBin: string;
  ownerId: number;
  operatorId: number;
  v1: string;
  v2: string;
  v3: string;
  productByVariant: Record<string, string>;
  unmappedItemGid: string;
};

type FixtureOptions = {
  // 'literal' is the production bootstrap shape (WH-{shopId}-ROOT).
  root?: 'literal' | 'nonLiteral';
};

const A1 = 'A1';
const A2 = 'A2';

// Opening count: A1 { V1: 3, V2: 1 }, A2 { V1: 2 }. Frozen Shopify on_hand at
// count start deliberately differs: V1 9, V2 1, V3 not stocked at the Location.
const SHOPIFY_ON_HAND_V1 = 9;
const SHOPIFY_ON_HAND_V2 = 1;

async function insertVariant(
  trx: any,
  shopId: number,
  label: string,
  identity: { externalVariantId: string; inventoryItemId: string } | null
): Promise<{ productId: string; variantId: string }> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  await trx('products').insert({
    lasyncro_product_id: productId,
    shop_id: shopId,
    title: `Physical target product ${label}`,
    status: 'active',
    product_type: 'physical',
  });

  await trx('variants').insert({
    lasyncro_variant_id: variantId,
    lasyncro_product_id: productId,
    shop_id: shopId,
    sku: `PT-${label}-${variantId.slice(0, 8)}`,
    title: `Physical target variant ${label}`,
    unit_cost: '1.00',
    status: 'active',
  });

  if (identity) {
    await trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: shopId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${identity.inventoryItemId}`,
      external_variant_id: identity.externalVariantId,
      external_inventory_item_id: identity.inventoryItemId,
      external_sku: `PT-${label}-${variantId.slice(0, 8)}`,
    });
  }

  return { productId, variantId };
}

function locationReader(fixture: {
  shopId: number;
  unmappedItemGid: string;
}): OpeningInventoryLocationPageReader {
  const level = (itemGid: string, onHand: number) => ({
    isActive: true,
    item: { id: itemGid, tracked: true, variant: null },
    quantities: [{ name: 'on_hand', quantity: onHand }],
  });

  return async ({ variables }) => ({
    data: {
      location: {
        id: variables.locationId,
        isActive: true,
        inventoryLevels: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            level(`gid://shopify/InventoryItem/${fixture.shopId}001`, SHOPIFY_ON_HAND_V1),
            level(`gid://shopify/InventoryItem/${fixture.shopId}002`, SHOPIFY_ON_HAND_V2),
            // Unmapped item at zero: provider evidence with a NULL variant.
            level(fixture.unmappedItemGid, 0),
          ],
        },
      },
    },
  });
}

async function countOpeningBin(
  fixture: Fixture,
  recountTaskId: string,
  counts: Array<[string, number]>
): Promise<void> {
  const { shopId, operatorId } = fixture;

  await withTenant(shopId, (trx) =>
    claimRecountTask(trx, shopId, recountTaskId, operatorId)
  );

  for (const [variantId, quantity] of counts) {
    const line = await withTenant(shopId, (trx) =>
      addOpeningInventoryRecountLine(trx, {
        shopId,
        recountTaskId,
        lasyncroVariantId: variantId,
        addedBy: operatorId,
      })
    );

    await withTenant(shopId, (trx) =>
      recordCount(trx, {
        shopId,
        recountTaskId,
        recountLineId: line.recount_line_id,
        countedQuantity: quantity,
        countMethod: 'bin_quantity',
        countedBy: operatorId,
      })
    );
  }

  await withTenant(shopId, (trx) =>
    completeOpeningInventoryBin(trx, shopId, recountTaskId, operatorId)
  );
}

/** Tenant + mapped warehouse + identities only: no Slice-B start yet. */
async function createShopFixture(
  options: FixtureOptions = {}
): Promise<Fixture> {
  const unique = crypto.randomUUID().slice(0, 8);

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `physical-target-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const literalRootCode = `WH-${shopId}-ROOT`;
  const rootCode =
    options.root === 'nonLiteral' ? `PT-${unique}-ROOT` : literalRootCode;
  const problemBin = 'PROB';
  const externalLocationId = `20${shopId}`;
  const unmappedItemGid = `gid://shopify/InventoryItem/${shopId}999`;

  const seeded = await withTenant(shopId, async (trx) => {
    const users = await trx('users')
      .insert([
        {
          shop_id: shopId,
          email: `pt-owner-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'owner',
        },
        {
          shop_id: shopId,
          email: `pt-operator-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'operator',
        },
      ])
      .returning(['id', 'role']);

    const ownerId = Number(users.find((row: any) => row.role === 'owner')!.id);
    const operatorId = Number(
      users.find((row: any) => row.role === 'operator')!.id
    );

    await trx('shop_memberships').insert([
      { shop_id: shopId, user_id: ownerId, role: 'owner' },
      { shop_id: shopId, user_id: operatorId, role: 'operator' },
    ]);

    await trx('shop_wms_settings').insert({
      shop_id: shopId,
      bootstrap_model: 'reconcile_opening_expectation_v2',
      problem_bin_location: problemBin,
    });

    const warehouseId = crypto.randomUUID();

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: `Physical target warehouse ${unique}`,
      root_location_code: rootCode,
      is_default: true,
      active: true,
      external_location_id: externalLocationId,
    });

    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: A1,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: A2,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'storage',
      },
      {
        // Problem staging: W-owned, outside the pick/storage opening cohort.
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: problemBin,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'problem',
      },
    ]);

    const identity = (n: number) => ({
      externalVariantId: `gid://shopify/ProductVariant/${shopId}0${n}`,
      inventoryItemId: `${shopId}00${n}`,
    });

    const v1 = await insertVariant(trx, shopId, 'V1', identity(1));
    const v2 = await insertVariant(trx, shopId, 'V2', identity(2));
    const v3 = await insertVariant(trx, shopId, 'V3', identity(3));

    await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: `physical-target-${unique}.myshopify.com`,
      access_token: 'test-token-no-network',
      scopes: 'read_products,write_inventory',
    });

    return {
      ownerId,
      operatorId,
      warehouseId,
      v1: v1.variantId,
      v2: v2.variantId,
      v3: v3.variantId,
      productByVariant: {
        [v1.variantId]: v1.productId,
        [v2.variantId]: v2.productId,
        [v3.variantId]: v3.productId,
      },
    };
  });

  const fixture: Fixture = {
    shopId,
    unique,
    rootCode,
    literalRootCode,
    locationGid: `gid://shopify/Location/${externalLocationId}`,
    problemBin,
    unmappedItemGid,
    ...seeded,
  };

  return fixture;
}

async function createCountedFixture(
  options: FixtureOptions = {}
): Promise<Fixture> {
  const fixture = await createShopFixture(options);
  const { shopId } = fixture;

  const started = await startShopOpeningInventory(
    {
      shopId,
      createdBy: fixture.ownerId,
      assignedTo: fixture.operatorId,
    },
    { readLocationPage: locationReader(fixture) }
  );

  const taskFor = (locationCode: string) => {
    const bin = started.bins.find((row) => row.location_code === locationCode);
    if (!bin) throw new Error(`[FIXTURE] opening cohort has no task for ${locationCode}`);
    return bin.recount_task_id;
  };

  await countOpeningBin(fixture, taskFor(A1), [
    [fixture.v1, 3],
    [fixture.v2, 1],
  ]);
  await countOpeningBin(fixture, taskFor(A2), [[fixture.v1, 2]]);

  return fixture;
}

// ─── persisted-state seeds ─────────────────────────────────────────────────

async function seedTruth(
  fixture: Fixture,
  rows: Array<{ locationCode: string; variantId: string; onHand: number }>
): Promise<void> {
  const now = new Date();

  await withTenant(fixture.shopId, (trx) =>
    trx('inventory_truth')
      .insert(
        rows.map((row) => ({
          shop_id: fixture.shopId,
          lasyncro_variant_id: row.variantId,
          location_code: row.locationCode,
          on_hand_quantity: row.onHand,
          reserved_quantity: 0,
          committed_quantity: 0,
          available_quantity: Math.max(0, row.onHand),
          last_evaluated_at: now,
        }))
      )
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
      .merge({
        on_hand_quantity: trx.raw('EXCLUDED.on_hand_quantity'),
        available_quantity: trx.raw('EXCLUDED.available_quantity'),
        last_evaluated_at: now,
        updated_at: now,
      })
  );
}

async function createLooseVariant(fixture: Fixture, label: string): Promise<string> {
  const created = await withTenant(fixture.shopId, (trx) =>
    insertVariant(trx, fixture.shopId, label, null)
  );
  fixture.productByVariant[created.variantId] = created.productId;
  return created.variantId;
}

async function createSecondWarehouse(fixture: Fixture): Promise<string> {
  const warehouseId = crypto.randomUUID();
  const rootCode = `W2-${fixture.shopId}-ROOT`;

  await withTenant(fixture.shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: fixture.shopId,
      name: `Second warehouse ${fixture.unique}`,
      root_location_code: rootCode,
      is_default: false,
      // Inactive so existing one-active-warehouse rules never reject it.
      active: false,
      external_location_id: null,
    });

    await trx('warehouse_locations').insert([
      {
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: fixture.shopId,
        warehouse_id: warehouseId,
        location_code: 'B1',
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'storage',
      },
    ]);
  });

  return warehouseId;
}

async function seedOrder(trx: any, fixture: Fixture): Promise<string> {
  const orderId = crypto.randomUUID();
  const now = new Date();

  await trx('orders').insert({
    lasyncro_order_id: orderId,
    shop_id: fixture.shopId,
    payment_state: 'paid',
    currency: 'USD',
    total_price: '10.00',
    subtotal_price: '10.00',
    total_tax: '0.00',
    order_created_at: now,
    order_updated_at: now,
    created_at: now,
    updated_at: now,
  });

  return orderId;
}

/**
 * A confirmed physical pick of one V1 unit from A1. The counted truth already
 * represents the post-pick state: the picked unit is not in inventory_truth.
 */
async function seedConfirmedPick(
  fixture: Fixture,
  lineStatus:
    | 'picked'
    | 'packed'
    | 'partially_shipped'
    | 'shipped'
    | 'cancelled'
    | null
): Promise<void> {
  const batchStatus =
    lineStatus === 'picked' || lineStatus === 'cancelled' || lineStatus === null
      ? 'picking'
      : lineStatus === 'packed'
        ? 'packing'
        : 'pack_complete';

  await withTenant(fixture.shopId, async (trx) => {
    const now = new Date();
    const orderId = await seedOrder(trx, fixture);
    const lineItemId = crypto.randomUUID();
    const pickBatchId = crypto.randomUUID();

    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineItemId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: fixture.productByVariant[fixture.v1],
      lasyncro_variant_id: fixture.v1,
      title: 'Physical target picked line',
      quantity: 1,
      unit_price: '10.00',
      line_total: '10.00',
      created_at: now,
      updated_at: now,
    });

    await trx('pick_batches').insert({
      pick_batch_id: pickBatchId,
      shop_id: fixture.shopId,
      status: batchStatus,
      release_trigger: 'manual',
      max_line_items: 10,
      total_line_items: 1,
      total_units: 1,
      released_at: now,
      picked_by: fixture.operatorId,
      pick_last_activity_at: now,
    });

    await trx('pick_scan_log').insert({
      shop_id: fixture.shopId,
      pick_batch_id: pickBatchId,
      lasyncro_line_item_id: lineItemId,
      lasyncro_variant_id: fixture.v1,
      location_code: A1,
      quantity_confirmed: 1,
      status: 'confirmed',
      scanned_by: fixture.operatorId,
      scanned_at: now,
    });

    if (lineStatus !== null) {
      await trx('order_line_item_warehouse_status').insert({
        lasyncro_line_item_id: lineItemId,
        lasyncro_order_id: orderId,
        shop_id: fixture.shopId,
        status: lineStatus,
        status_updated_at: now,
      });
    }
  });
}

async function seedStowTask(
  fixture: Fixture,
  params: {
    trigger: 'return_restock' | 'problem_center' | 'order_cancelled_mid_pick';
    status: 'pending' | 'in_progress' | 'completed';
    quantity: number;
    quantityPlaced: number;
    variantId?: string;
    locationCode?: string | null;
    sourceTaskId?: string | null;
  }
): Promise<string> {
  const now = new Date();
  const inProgress = params.status === 'in_progress';

  const [row] = await withTenant(fixture.shopId, (trx) =>
    trx('stow_tasks')
      .insert({
        shop_id: fixture.shopId,
        lasyncro_variant_id: params.variantId ?? fixture.v1,
        quantity: params.quantity,
        quantity_placed: params.quantityPlaced,
        location_code: params.locationCode ?? A1,
        status: params.status,
        trigger: params.trigger,
        source_task_id: params.sourceTaskId ?? null,
        claimed_by: inProgress || params.status === 'completed' ? fixture.operatorId : null,
        claimed_at: inProgress || params.status === 'completed' ? now : null,
        completed_at: params.status === 'completed' ? now : null,
        created_at: now,
        updated_at: now,
      })
      .returning('stow_task_id')
  );

  return String((row as any).stow_task_id ?? row);
}

async function seedProblemTask(
  fixture: Fixture,
  params: {
    source: 'returns' | 'pick';
    exceptionType: 'repackaging_required' | 'order_cancelled';
    status: 'open' | 'investigating' | 'resolved';
    resolutionAction?: 're_stow' | 'quarantine' | null;
    quantity?: number;
  }
): Promise<string> {
  const now = new Date();
  const resolved = params.status === 'resolved';

  const [row] = await withTenant(fixture.shopId, (trx) =>
    trx('problem_center_tasks')
      .insert({
        shop_id: fixture.shopId,
        status: params.status,
        source: params.source,
        source_exception_id: crypto.randomUUID(),
        lasyncro_variant_id: fixture.v1,
        quantity: params.quantity ?? 1,
        exception_type: params.exceptionType,
        problem_bin_location: fixture.problemBin,
        resolution_action: params.resolutionAction ?? null,
        resolved_by: resolved ? fixture.ownerId : null,
        resolved_at: resolved ? now : null,
        notes: `PT ${params.exceptionType}`,
      })
      .returning('problem_task_id')
  );

  return String((row as any).problem_task_id ?? row);
}

/**
 * A processed damaged/unsellable return line in the scan-intake shape:
 * RELI → order_revenue_units → orders.shop_id, linked to its job through
 * return_job_id. The received unit was never credited to inventory_truth.
 */
async function seedReturnLine(
  fixture: Fixture,
  params: {
    itemCondition: 'damaged' | 'unsellable';
    quantityReceived: number;
    ownerDecision: 'write_off' | 'contact_customer' | null;
  }
): Promise<string> {
  return withTenant(fixture.shopId, async (trx) => {
    const now = new Date();
    const orderId = await seedOrder(trx, fixture);
    const revenueUnitId = crypto.randomUUID();
    const lineItemId = crypto.randomUUID();

    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: revenueUnitId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: fixture.productByVariant[fixture.v1],
      lasyncro_variant_id: fixture.v1,
      title: 'Physical target returned line',
      quantity: 1,
      unit_price: 10,
      line_total: 10,
      estimated_unit_cost: 1,
    });

    const [job] = await trx('return_jobs')
      .insert({
        shop_id: fixture.shopId,
        origin: 'customer_return',
        lasyncro_refund_execution_id: null,
        lasyncro_order_id: orderId,
        status: params.ownerDecision ? 'complete' : 'awaiting_decision',
        claimed_by: fixture.operatorId,
        claimed_at: now,
        source: 'scan_intake',
        created_at: now,
        updated_at: now,
      })
      .returning('return_job_id');

    await trx('refund_execution_line_items').insert({
      lasyncro_refund_line_item_id: lineItemId,
      lasyncro_refund_execution_id: null,
      lasyncro_revenue_unit_id: revenueUnitId,
      return_job_id: (job as any).return_job_id ?? job,
      refunded_quantity: params.quantityReceived,
      item_condition: params.itemCondition,
      quantity_received: params.quantityReceived,
      condition_notes: 'Physical target return fixture',
      processed_by: fixture.operatorId,
      processed_at: now,
      source: 'scan_intake_manual',
      owner_decision: params.ownerDecision,
      decision_by: params.ownerDecision ? fixture.ownerId : null,
      decision_at: params.ownerDecision ? now : null,
      created_at: now,
    });

    return lineItemId;
  });
}

/**
 * A returned V1 unit awaiting restock. inventory_units requires a source
 * anchor, so a synthetic Receive chain anchors the LSU (same shape as
 * return-restock-release-capacity-1145a.test.ts).
 */
async function seedReturnedUnit(fixture: Fixture): Promise<string> {
  return withTenant(fixture.shopId, async (trx) => {
    const [supplierRow] = await trx('suppliers')
      .insert({ shop_id: fixture.shopId, name: 'Physical target supplier', active: true })
      .returning('id');
    const supplierId = Number((supplierRow as any).id ?? supplierRow);

    const [poRow] = await trx('purchase_orders')
      .insert({ shop_id: fixture.shopId, supplier_id: supplierId, status: 'shipped' })
      .returning('id');
    const poId = String((poRow as any).id ?? poRow);

    const [poLineRow] = await trx('purchase_order_line_items')
      .insert({
        po_id: poId,
        shop_id: fixture.shopId,
        lasyncro_variant_id: fixture.v1,
        description: 'Physical target return anchor',
        quantity_ordered: 1,
        quantity_received: 1,
      })
      .returning('id');

    const [receiveJobRow] = await trx('receive_jobs')
      .insert({
        shop_id: fixture.shopId,
        po_id: poId,
        status: 'closed',
        total_variants: 1,
        total_units: 1,
      })
      .returning('receive_job_id');
    const receiveJobId = String((receiveJobRow as any).receive_job_id ?? receiveJobRow);

    const [receiveJobLineRow] = await trx('receive_job_lines')
      .insert({
        shop_id: fixture.shopId,
        receive_job_id: receiveJobId,
        po_line_item_id: (poLineRow as any).id ?? poLineRow,
        lasyncro_variant_id: fixture.v1,
        quantity_expected: 1,
        quantity_accepted: 1,
        inspection_complete: true,
      })
      .returning('receive_job_line_id');
    const receiveJobLineId = String(
      (receiveJobLineRow as any).receive_job_line_id ?? receiveJobLineRow
    );

    const lasyncroUnitId = `LSU-${crypto.randomUUID().slice(0, 12)}`;

    await trx('inventory_units').insert({
      shop_id: fixture.shopId,
      lasyncro_variant_id: fixture.v1,
      receive_job_line_id: receiveJobLineId,
      receive_sequence: 1,
      status: 'received',
      current_location_code: null,
      lasyncro_unit_id: lasyncroUnitId,
    });

    return lasyncroUnitId;
  });
}

/** Normal (non-opening) recount of one W bin through the real commit path. */
async function recountBin(
  fixture: Fixture,
  locationCode: string,
  counted: Record<string, number>
): Promise<void> {
  const { shopId, ownerId, operatorId } = fixture;

  const created = await withTenant(shopId, (trx) =>
    createRecountTask(trx, {
      shopId,
      warehouseId: fixture.warehouseId,
      scope: 'location',
      locationCode,
      createdBy: ownerId,
      assignedTo: operatorId,
    })
  );

  await withTenant(shopId, (trx) =>
    claimRecountTask(trx, shopId, created.recount_task_id, operatorId)
  );

  const lines = await withTenant(shopId, (trx) =>
    trx('inventory_recount_lines')
      .where({ shop_id: shopId, recount_task_id: created.recount_task_id })
      .select('recount_line_id', 'lasyncro_variant_id')
  );

  for (const line of lines) {
    const quantity = counted[String(line.lasyncro_variant_id)];
    if (quantity === undefined) {
      throw new Error(`[FIXTURE] no recount quantity for ${line.lasyncro_variant_id}`);
    }

    await withTenant(shopId, (trx) =>
      recordCount(trx, {
        shopId,
        recountTaskId: created.recount_task_id,
        recountLineId: line.recount_line_id,
        countedQuantity: quantity,
        countMethod: 'bin_quantity',
        countedBy: operatorId,
      })
    );
  }

  const closed = await withTenant(shopId, (trx) =>
    closeCount(trx, shopId, created.recount_task_id, operatorId)
  );
  expect(closed.status).toBe('manual_review');

  const varianceLines = await withTenant(shopId, (trx) =>
    trx('inventory_recount_lines')
      .where({ shop_id: shopId, recount_task_id: created.recount_task_id })
      .whereNot('variance', 0)
      .select('recount_line_id')
  );

  for (const line of varianceLines) {
    await withTenant(shopId, (trx) =>
      reviewLine(trx, {
        shopId,
        recountTaskId: created.recount_task_id,
        recountLineId: line.recount_line_id,
        decision: 'accept',
        varianceReason: 'count_error',
        notes: 'GH-1179 RED-C post-opening recount',
        reviewedBy: ownerId,
      })
    );
  }

  await withTenant(shopId, (trx) =>
    commitRecount(trx, shopId, created.recount_task_id, ownerId)
  );
}

async function readTruthRows(fixture: Fixture) {
  return withTenant(fixture.shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: fixture.shopId })
      .orderBy([
        { column: 'location_code', order: 'asc' },
        { column: 'lasyncro_variant_id', order: 'asc' },
      ])
      .select('location_code', 'lasyncro_variant_id', 'on_hand_quantity')
  );
}

function baselineTarget(fixture: Fixture): TargetRow[] {
  return expectedTarget({ [fixture.v1]: 5, [fixture.v2]: 1, [fixture.v3]: 0 });
}

// ─── fixture preconditions (must pass in RED) ──────────────────────────────

describe('GH-1179 RED-C fixture preconditions', () => {
  it('P01 — real Slice-B start + canonical opening count produce the expected persisted state', async () => {
    const f = await createCountedFixture();

    const state = await withTenant(f.shopId, async (trx) => ({
      warehouse: await trx('warehouses')
        .where({ shop_id: f.shopId, warehouse_id: f.warehouseId })
        .first('root_location_code'),
      rootLocation: await trx('warehouse_locations')
        .where({ shop_id: f.shopId, location_code: f.rootCode })
        .first('warehouse_id', 'type'),
      snapshots: await trx('opening_inventory_shopify_snapshots')
        .where({ shop_id: f.shopId })
        .select('snapshot_id', 'status', 'warehouse_id', 'shopify_location_id'),
      lines: await trx('opening_inventory_shopify_snapshot_lines')
        .where({ shop_id: f.shopId })
        .select('lasyncro_variant_id', 'on_hand_quantity', 'inventory_level_present'),
      tasks: await trx('inventory_recount_tasks')
        .where({ shop_id: f.shopId, purpose: 'opening_inventory' })
        .orderBy('scope_location_code', 'asc')
        .select('warehouse_id', 'scope_location_code', 'status'),
    }));

    expect(state.warehouse.root_location_code).toBe(`WH-${f.shopId}-ROOT`);
    expect(state.rootLocation).toEqual({ warehouse_id: f.warehouseId, type: 'warehouse' });

    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0]).toMatchObject({
      status: 'complete',
      warehouse_id: f.warehouseId,
      shopify_location_id: f.locationGid,
    });

    const byVariant = new Map(
      state.lines
        .filter((line: any) => line.lasyncro_variant_id !== null)
        .map((line: any) => [String(line.lasyncro_variant_id), line])
    );
    expect([...byVariant.keys()].sort()).toEqual([f.v1, f.v2, f.v3].sort());
    expect(byVariant.get(f.v1)).toMatchObject({ on_hand_quantity: SHOPIFY_ON_HAND_V1 });
    expect(byVariant.get(f.v3)).toMatchObject({ inventory_level_present: false });
    expect(
      state.lines.filter((line: any) => line.lasyncro_variant_id === null)
    ).toHaveLength(1);

    expect(state.tasks).toEqual([
      { warehouse_id: f.warehouseId, scope_location_code: A1, status: 'committed' },
      { warehouse_id: f.warehouseId, scope_location_code: A2, status: 'committed' },
    ]);

    expect(await readTruthRows(f)).toEqual(
      [
        { location_code: A1, lasyncro_variant_id: f.v1, on_hand_quantity: 3 },
        { location_code: A1, lasyncro_variant_id: f.v2, on_hand_quantity: 1 },
        { location_code: A2, lasyncro_variant_id: f.v1, on_hand_quantity: 2 },
      ].sort(
        (a, b) =>
          a.location_code.localeCompare(b.location_code) ||
          (a.lasyncro_variant_id < b.lasyncro_variant_id ? -1 : 1)
      )
    );
  });

  it('P02 — a non-literal configured root fixture is constructible for the ROOT compatibility discriminator', async () => {
    const f = await createCountedFixture({ root: 'nonLiteral' });

    expect(f.rootCode).not.toBe(f.literalRootCode);

    const literalOwner = await withTenant(f.shopId, (trx) =>
      trx('warehouse_locations')
        .where({ shop_id: f.shopId, location_code: f.literalRootCode })
        .first('location_code')
    );
    expect(literalOwner).toBeUndefined();
  });

  it('P03 — the C08A return_restock fixture completes through the real confirmStow credit', async () => {
    const f = await createCountedFixture();
    const lasyncroUnitId = await seedReturnedUnit(f);
    const stowTaskId = await seedStowTask(f, {
      trigger: 'return_restock',
      status: 'in_progress',
      quantity: 2,
      quantityPlaced: 1,
      locationCode: A1,
    });

    await withTenant(f.shopId, (trx) =>
      confirmStow(trx, {
        stowTaskId,
        shopId: f.shopId,
        claimedBy: f.operatorId,
        quantityPlaced: 1,
        lasyncroUnitId,
      })
    );

    const task = await withTenant(f.shopId, (trx) =>
      trx('stow_tasks')
        .where({ shop_id: f.shopId, stow_task_id: stowTaskId })
        .first('status', 'quantity', 'quantity_placed')
    );
    expect(task).toEqual({ status: 'completed', quantity: 2, quantity_placed: 2 });

    const a1V1 = (await readTruthRows(f)).find(
      (row: any) => row.location_code === A1 && row.lasyncro_variant_id === f.v1
    );
    expect(a1V1?.on_hand_quantity).toBe(4);
  });

  it('P04 — the C08D damaged-return fixture accepts the real write_off decision without touching truth', async () => {
    const f = await createCountedFixture();
    const truthBefore = await readTruthRows(f);
    const lineItemId = await seedReturnLine(f, {
      itemCondition: 'damaged',
      quantityReceived: 1,
      ownerDecision: null,
    });

    await setLineOwnerDecision({
      shopId: f.shopId,
      lineItemId,
      decision: 'write_off',
      decisionNotes: 'GH-1179 RED-C disposal',
      decidedBy: f.ownerId,
    });

    const persisted = await withTenant(f.shopId, async (trx) => ({
      line: await trx('refund_execution_line_items')
        .where({ lasyncro_refund_line_item_id: lineItemId })
        .first('owner_decision'),
      writeOffs: await trx('inventory_movements')
        .where({
          shop_id: f.shopId,
          movement_type: 'write_off_return',
          reference_id: lineItemId,
        })
        .select('location_code', 'quantity_delta'),
    }));

    expect(persisted.line).toEqual({ owner_decision: 'write_off' });
    expect(persisted.writeOffs).toEqual([
      { location_code: f.problemBin, quantity_delta: -1 },
    ]);
    expect(await readTruthRows(f)).toEqual(truthBefore);
  });
});

// ─── production seam ───────────────────────────────────────────────────────

describe('GH-1179 RED-C production seam', () => {
  it('S01 — openingInventoryPhysicalTarget.service exposes the Slice-C surface', () => {
    const service = loadPhysicalTargetService();

    for (const name of REQUIRED_EXPORTS) {
      expect(typeof (service as any)[name]).toBe('function');
    }
  });
});

// ─── behavioural contract ──────────────────────────────────────────────────

async function readScopeFacts(fixture: Fixture) {
  return withTenant(fixture.shopId, async (trx) => ({
    snapshots: await trx('opening_inventory_shopify_snapshots')
      .where({ shop_id: fixture.shopId })
      .orderBy('attempt_number', 'asc')
      .select('status', 'warehouse_id'),
    taskWarehouses: (
      await trx('inventory_recount_tasks')
        .where({ shop_id: fixture.shopId, purpose: 'opening_inventory' })
        .distinct('warehouse_id')
        .pluck('warehouse_id')
    )
      .map(String)
      .sort(),
    settings: await trx('shop_wms_settings')
      .where({ shop_id: fixture.shopId })
      .first('opening_inventory_reconciliation_started_at'),
    warehouse: await trx('warehouses')
      .where({ shop_id: fixture.shopId, warehouse_id: fixture.warehouseId })
      .first('active', 'external_location_id'),
  }));
}

describe('GH-1179 RED-C participating warehouse resolution', () => {
  it('C00A — without a complete Slice-B snapshot the resolver fails closed with OPENING_INVENTORY_SNAPSHOT_REQUIRED', async () => {
    const f = await createShopFixture();

    // A real Slice-B attempt that never completes: the provider read fails,
    // the attempt persists as 'failed' and no cohort is created by it.
    await expect(
      startShopOpeningInventory(
        { shopId: f.shopId, createdBy: f.ownerId, assignedTo: f.operatorId },
        {
          readLocationPage: async () => {
            throw new Error('provider unavailable');
          },
        }
      )
    ).rejects.toThrow();

    // Pre-Slice-B shape: the opening cohort and started_at exist with no
    // complete snapshot, so the snapshot is the only missing fact.
    await withTenant(f.shopId, async (trx) => {
      const scope = await resolveOpeningInventoryStartScope(trx, {
        shopId: f.shopId,
        assignedTo: f.operatorId,
      });
      await createOpeningInventoryCohort(trx, {
        shopId: f.shopId,
        createdBy: f.ownerId,
        assignedTo: f.operatorId,
        bins: scope.bins,
      });
    });

    const facts = await readScopeFacts(f);
    expect(facts.snapshots).toEqual([{ status: 'failed', warehouse_id: f.warehouseId }]);
    expect(facts.taskWarehouses).toEqual([f.warehouseId]);
    expect(facts.settings.opening_inventory_reconciliation_started_at).not.toBeNull();
    expect(facts.warehouse).toEqual({
      active: true,
      external_location_id: `20${f.shopId}`,
    });

    expectScopeRejection(
      await resolveWarehouseOutcome(f),
      'OPENING_INVENTORY_SNAPSHOT_REQUIRED'
    );
  });

  it('C00B — a cohort that disagrees with the complete snapshot warehouse fails closed with OPENING_INVENTORY_COHORT_SCOPE_MISMATCH', async () => {
    // movedAll: every opening task now proves W2. mixed: the cohort is {W, W2}.
    const movedAll = await createCountedFixture();
    const mixed = await createCountedFixture();
    const movedAllW2 = await createSecondWarehouse(movedAll);
    const mixedW2 = await createSecondWarehouse(mixed);

    await withTenant(movedAll.shopId, (trx) =>
      trx('inventory_recount_tasks')
        .where({ shop_id: movedAll.shopId, purpose: 'opening_inventory' })
        .update({ warehouse_id: movedAllW2 })
    );
    await withTenant(mixed.shopId, (trx) =>
      trx('inventory_recount_tasks')
        .where({
          shop_id: mixed.shopId,
          purpose: 'opening_inventory',
          scope_location_code: A2,
        })
        .update({ warehouse_id: mixedW2 })
    );

    const movedAllFacts = await readScopeFacts(movedAll);
    expect(movedAllFacts.snapshots).toEqual([
      { status: 'complete', warehouse_id: movedAll.warehouseId },
    ]);
    expect(movedAllFacts.taskWarehouses).toEqual([movedAllW2]);

    const mixedFacts = await readScopeFacts(mixed);
    expect(mixedFacts.snapshots).toEqual([
      { status: 'complete', warehouse_id: mixed.warehouseId },
    ]);
    expect(mixedFacts.taskWarehouses).toEqual([mixed.warehouseId, mixedW2].sort());

    expectScopeRejection(
      await resolveWarehouseOutcome(movedAll),
      'OPENING_INVENTORY_COHORT_SCOPE_MISMATCH'
    );
    expectScopeRejection(
      await resolveWarehouseOutcome(mixed),
      'OPENING_INVENTORY_COHORT_SCOPE_MISMATCH'
    );
  });
});

describe('GH-1179 RED-C current physical target + local readiness', () => {
  it('C01 —warehouse-scoped target sums W-owned truth by variant (resolved W, ready)', async () => {
    const f = await createCountedFixture();

    const participating = await resolveWarehouse(f);
    expect(participating.warehouseId).toBe(f.warehouseId);

    expect(await readTarget(f)).toEqual(baselineTarget(f));
    expect(await readinessReasons(f)).toEqual([]);
  });

  it('C02 — nonzero ROOT blocks; a nonzero literal WH-{shopId}-ROOT fails closed when the configured root differs', async () => {
    const f = await createCountedFixture();
    await seedTruth(f, [{ locationCode: f.rootCode, variantId: f.v1, onHand: 2 }]);

    expect(await readinessReasons(f)).toEqual(reasons('ROOT_NONZERO'));

    const nonLiteral = await createCountedFixture({ root: 'nonLiteral' });
    await seedTruth(nonLiteral, [
      { locationCode: nonLiteral.literalRootCode, variantId: nonLiteral.v1, onHand: 2 },
    ]);

    const literalReasons = await readinessReasons(nonLiteral);
    expect(literalReasons.length).toBeGreaterThan(0);
    for (const reason of literalReasons) {
      expect(['ROOT_NONZERO', 'ORPHAN_NONZERO']).toContain(reason);
    }
  });

  it('C03 — nonzero orphan truth blocks as ORPHAN_NONZERO', async () => {
    const f = await createCountedFixture();
    await seedTruth(f, [{ locationCode: 'GHOST-1', variantId: f.v1, onHand: 4 }]);

    expect(await readinessReasons(f)).toEqual(reasons('ORPHAN_NONZERO'));
  });

  it('C04 — zero orphan truth neither blocks nor contributes a target key', async () => {
    const f = await createCountedFixture();
    const v4 = await createLooseVariant(f, 'V4');
    await seedTruth(f, [{ locationCode: 'GHOST-0', variantId: v4, onHand: 0 }]);

    expect(await readinessReasons(f)).toEqual([]);
    expect(await readTarget(f)).toEqual(baselineTarget(f));
  });

  it('C05 — negative W-owned truth blocks as NEGATIVE', async () => {
    const f = await createCountedFixture();
    await seedTruth(f, [{ locationCode: A1, variantId: f.v1, onHand: -1 }]);

    expect(await readinessReasons(f)).toEqual(reasons('NEGATIVE'));
  });

  it('C06 — a confirmed pick on a picked line blocks as PICK_PACK_IN_FLIGHT', async () => {
    const f = await createCountedFixture();
    await seedConfirmedPick(f, 'picked');

    expect(await readinessReasons(f)).toEqual(reasons('PICK_PACK_IN_FLIGHT'));
  });

  it('C06B — a confirmed pick with no warehouse line status fails closed', async () => {
    const f = await createCountedFixture();
    await seedConfirmedPick(f, null);

    expect(await readinessReasons(f)).toEqual(reasons('PICK_PACK_IN_FLIGHT'));
  });

  it('C07 — a confirmed pick on a packed line blocks as PICK_PACK_IN_FLIGHT', async () => {
    const f = await createCountedFixture();
    await seedConfirmedPick(f, 'packed');

    expect(await readinessReasons(f)).toEqual(reasons('PICK_PACK_IN_FLIGHT'));
  });

  it('C07B — a confirmed pick on a partially_shipped line is not conclusively settled', async () => {
    const f = await createCountedFixture();
    await seedConfirmedPick(f, 'partially_shipped');

    expect(await readinessReasons(f)).toEqual(reasons('PICK_PACK_IN_FLIGHT'));
  });

  it('C07C — a confirmed pick on a conclusively shipped or cancelled line does not block', async () => {
    // A confirmed pick alone is not enough: the matching warehouse line
    // status decides. Cancelled-pick recovery is its own guard (C09*); with
    // no open recovery state a cancelled line is settled.
    const shipped = await createCountedFixture();
    await seedConfirmedPick(shipped, 'shipped');

    const cancelled = await createCountedFixture();
    await seedConfirmedPick(cancelled, 'cancelled');

    expect(await readinessReasons(shipped)).toEqual([]);
    expect(await readinessReasons(cancelled)).toEqual([]);
  });

  it('C08A — a partially placed return_restock blocks until the real final placement credits W', async () => {
    const f = await createCountedFixture();
    const lasyncroUnitId = await seedReturnedUnit(f);
    const stowTaskId = await seedStowTask(f, {
      trigger: 'return_restock',
      status: 'in_progress',
      quantity: 2,
      quantityPlaced: 1,
      locationCode: A1,
    });

    expect(await readinessReasons(f)).toEqual(reasons('RETURN_PHYSICAL_UNRESOLVED'));

    await withTenant(f.shopId, (trx) =>
      confirmStow(trx, {
        stowTaskId,
        shopId: f.shopId,
        claimedBy: f.operatorId,
        quantityPlaced: 1,
        lasyncroUnitId,
      })
    );

    expect(await readinessReasons(f)).toEqual([]);
    expect(await readTarget(f)).toEqual(
      expectedTarget({ [f.v1]: 6, [f.v2]: 1, [f.v3]: 0 })
    );
  });

  it('C08B — a held repackaging_required return blocks', async () => {
    const f = await createCountedFixture();
    await seedProblemTask(f, {
      source: 'returns',
      exceptionType: 'repackaging_required',
      status: 'open',
      quantity: 2,
    });

    expect(await readinessReasons(f)).toEqual(reasons('RETURN_PHYSICAL_UNRESOLVED'));
  });

  it('C08C — a pending problem_center re_stow of a repackaging return blocks', async () => {
    const f = await createCountedFixture();
    const problemTaskId = await seedProblemTask(f, {
      source: 'returns',
      exceptionType: 'repackaging_required',
      status: 'resolved',
      resolutionAction: 're_stow',
    });
    await seedStowTask(f, {
      trigger: 'problem_center',
      status: 'pending',
      quantity: 1,
      quantityPlaced: 0,
      locationCode: null,
      sourceTaskId: problemTaskId,
    });

    expect(await readinessReasons(f)).toEqual(reasons('RETURN_PHYSICAL_UNRESOLVED'));
  });

  it('C08D — an undecided damaged return blocks; a real write_off disposes it without changing the target', async () => {
    const f = await createCountedFixture();
    const lineItemId = await seedReturnLine(f, {
      itemCondition: 'damaged',
      quantityReceived: 1,
      ownerDecision: null,
    });

    expect(await readinessReasons(f)).toEqual(reasons('RETURN_PHYSICAL_UNRESOLVED'));
    const before = await readTarget(f);

    await setLineOwnerDecision({
      shopId: f.shopId,
      lineItemId,
      decision: 'write_off',
      decisionNotes: 'GH-1179 RED-C disposal',
      decidedBy: f.ownerId,
    });

    expect(await readinessReasons(f)).toEqual([]);
    expect(await readTarget(f)).toEqual(before);
    expect(before).toEqual(baselineTarget(f));
  });

  it('C08E — an unsellable return decided contact_customer still blocks (strict R4)', async () => {
    const f = await createCountedFixture();
    await seedReturnLine(f, {
      itemCondition: 'unsellable',
      quantityReceived: 1,
      ownerDecision: 'contact_customer',
    });

    expect(await readinessReasons(f)).toEqual(reasons('RETURN_PHYSICAL_UNRESOLVED'));
  });

  it('C08F — a repackaging return resolved as quarantine still blocks', async () => {
    const f = await createCountedFixture();
    await seedProblemTask(f, {
      source: 'returns',
      exceptionType: 'repackaging_required',
      status: 'resolved',
      resolutionAction: 'quarantine',
    });

    expect(await readinessReasons(f)).toEqual(reasons('RETURN_PHYSICAL_UNRESOLVED'));
  });

  it('C09A — an open order_cancelled pick problem blocks as CANCELLED_PICK_UNRESOLVED', async () => {
    const f = await createCountedFixture();
    await seedProblemTask(f, {
      source: 'pick',
      exceptionType: 'order_cancelled',
      status: 'open',
    });

    expect(await readinessReasons(f)).toEqual(reasons('CANCELLED_PICK_UNRESOLVED'));
  });

  it('C09B — a pending order_cancelled_mid_pick restow blocks as CANCELLED_PICK_UNRESOLVED', async () => {
    const f = await createCountedFixture();
    const problemTaskId = await seedProblemTask(f, {
      source: 'pick',
      exceptionType: 'order_cancelled',
      status: 'resolved',
      resolutionAction: 're_stow',
    });
    await seedStowTask(f, {
      trigger: 'order_cancelled_mid_pick',
      status: 'pending',
      quantity: 1,
      quantityPlaced: 0,
      locationCode: null,
      sourceTaskId: problemTaskId,
    });

    expect(await readinessReasons(f)).toEqual(reasons('CANCELLED_PICK_UNRESOLVED'));
  });

  it('C10 — settled return and cancelled-pick recovery states do not block', async () => {
    const f = await createCountedFixture();

    await seedStowTask(f, {
      trigger: 'return_restock',
      status: 'completed',
      quantity: 1,
      quantityPlaced: 1,
    });

    const repackTaskId = await seedProblemTask(f, {
      source: 'returns',
      exceptionType: 'repackaging_required',
      status: 'resolved',
      resolutionAction: 're_stow',
    });
    await seedStowTask(f, {
      trigger: 'problem_center',
      status: 'completed',
      quantity: 1,
      quantityPlaced: 1,
      sourceTaskId: repackTaskId,
    });

    await seedReturnLine(f, {
      itemCondition: 'damaged',
      quantityReceived: 1,
      ownerDecision: 'write_off',
    });
    await seedReturnLine(f, {
      itemCondition: 'unsellable',
      quantityReceived: 1,
      ownerDecision: 'write_off',
    });

    const cancelledTaskId = await seedProblemTask(f, {
      source: 'pick',
      exceptionType: 'order_cancelled',
      status: 'resolved',
      resolutionAction: 're_stow',
    });
    await seedStowTask(f, {
      trigger: 'order_cancelled_mid_pick',
      status: 'completed',
      quantity: 1,
      quantityPlaced: 1,
      sourceTaskId: cancelledTaskId,
    });

    expect(await readinessReasons(f)).toEqual([]);
  });

  it('C11 — the target is current truth after a real post-opening recount, not count-time or Shopify quantity', async () => {
    const f = await createCountedFixture();

    await recountBin(f, A1, { [f.v1]: 6, [f.v2]: 1 });

    // Opening count was V1=5; frozen Shopify on_hand was 9; current is 6 + 2.
    expect(await readTarget(f)).toEqual(
      expectedTarget({ [f.v1]: 8, [f.v2]: 1, [f.v3]: 0 })
    );
  });

  it('C12 — another warehouse\'s positive truth is excluded and does not block', async () => {
    const f = await createCountedFixture();
    await createSecondWarehouse(f);
    await seedTruth(f, [{ locationCode: 'B1', variantId: f.v1, onHand: 7 }]);

    expect(await readTarget(f)).toEqual(baselineTarget(f));
    expect(await readinessReasons(f)).toEqual([]);
  });

  it('C12B — another warehouse\'s negative truth does not block W', async () => {
    const f = await createCountedFixture();
    await createSecondWarehouse(f);
    await seedTruth(f, [{ locationCode: 'B1', variantId: f.v1, onHand: -3 }]);

    expect(await readinessReasons(f)).toEqual([]);
    expect(await readTarget(f)).toEqual(baselineTarget(f));
  });

  it('C13 — rows group by variant with exact integers; a zero-sum W variant stays at target 0', async () => {
    const f = await createCountedFixture();
    const v4 = await createLooseVariant(f, 'V4');
    await seedTruth(f, [
      { locationCode: A2, variantId: f.v2, onHand: 0 },
      { locationCode: A1, variantId: v4, onHand: 0 },
      { locationCode: A2, variantId: v4, onHand: 0 },
    ]);

    const target = await readTarget(f);

    expect(target).toEqual(
      expectedTarget({ [f.v1]: 5, [f.v2]: 1, [f.v3]: 0, [v4]: 0 })
    );
    for (const row of target) {
      expect(typeof row.targetQuantity).toBe('number');
      expect(Number.isInteger(row.targetQuantity)).toBe(true);
    }
  });

  it('C14 — the target equals the W sum where the shop-wide sum differs', async () => {
    const f = await createCountedFixture();
    await createSecondWarehouse(f);
    await seedTruth(f, [
      { locationCode: 'B1', variantId: f.v1, onHand: 6 },
      { locationCode: 'B1', variantId: f.v2, onHand: 4 },
    ]);

    const shopWide = await withTenant(f.shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: f.shopId })
        .groupBy('lasyncro_variant_id')
        .select('lasyncro_variant_id')
        .sum({ on_hand: 'on_hand_quantity' })
    );
    const shopWideByVariant = new Map(
      shopWide.map((row: any) => [String(row.lasyncro_variant_id), Number(row.on_hand)])
    );
    expect(shopWideByVariant.get(f.v1)).toBe(11);
    expect(shopWideByVariant.get(f.v2)).toBe(5);

    expect(await readTarget(f)).toEqual(baselineTarget(f));
  });

  it('C15 — a snapshot-known variant with no W truth is an explicit 0; NULL snapshot variants are never keys', async () => {
    const f = await createCountedFixture();

    const target = await readTarget(f);

    expect(target.map((row) => row.lasyncroVariantId)).toEqual(
      [f.v1, f.v2, f.v3].sort()
    );
    expect(target.find((row) => row.lasyncroVariantId === f.v3)).toEqual({
      lasyncroVariantId: f.v3,
      targetQuantity: 0,
    });
  });

  it('C16 — an inactive W-owned location still contributes and does not block', async () => {
    const f = await createCountedFixture();

    await withTenant(f.shopId, async (trx) => {
      await trx('warehouse_locations').insert({
        shop_id: f.shopId,
        warehouse_id: f.warehouseId,
        location_code: 'A3',
        type: 'bin',
        parent_location_code: f.rootCode,
        active: true,
        zone_type: 'storage',
      });
      await trx('warehouse_locations')
        .where({ shop_id: f.shopId, location_code: 'A3' })
        .update({ active: false, updated_at: new Date() });
    });
    await seedTruth(f, [{ locationCode: 'A3', variantId: f.v1, onHand: 2 }]);

    expect(await readTarget(f)).toEqual(
      expectedTarget({ [f.v1]: 7, [f.v2]: 1, [f.v3]: 0 })
    );
    expect(await readinessReasons(f)).toEqual([]);
  });
});
