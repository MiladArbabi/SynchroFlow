// GH-1179 Slice E / E06 — Opening Inventory cutover ORCHESTRATION.
//
// RED contract only. The orchestration export does not exist yet; a runtime
// lookup on the executor module turns its absence into a controlled
// [GH1179_E06_ORCHESTRATOR_MISSING] per case, so the suite loads and every
// fixture is proven through the committed Slice-D / E02 / E04 entrypoints.
//
// Locked by this suite (advanceOpeningInventoryCutoverExecution):
// - advances ONE already-frozen generation; never creates a generation;
// - happy path in ONE call: owned E02 → verifying → same-token lease renewal
//   → owned E04 convergence (no second public claim, no lease-expiry wait);
// - an ambiguous dispatch stops pending (no immediate readback, no resend);
//   a live-lease retry is busy; after real DB-time expiry, the authoritative
//   E03 recovery runs and, on the same recovered owner lease, may finish
//   through E04;
// - not_applied → requires_regeneration (E03 semantics, no N+1 here);
// - live verifying owner is never stolen; expired verifying is reclaimed by
//   E04 rules; blocked / requires_regeneration / converged are not work.
//
// Shopify is dependency-injected only and routed by GraphQL document; the
// real client module is mocked fail-closed.

const mockShopifyRequest = jest.fn(async (..._args: unknown[]) => {
  throw new Error(
    '[GH1179_E06_TEST] default Shopify transport must not be reached'
  );
});

const mockCreateShopifyGraphQLClient = jest.fn((..._args: unknown[]) => ({
  request: mockShopifyRequest,
}));

jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  createShopifyGraphQLClient: (...args: unknown[]) =>
    mockCreateShopifyGraphQLClient(...args),
}));

import crypto from 'crypto';
import { knex as knexFactory, type Knex } from 'knex';
import { HttpRequestError } from '@shopify/shopify-api';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

import { encrypt } from 'api-src/security/encryption.service';

import {
  addOpeningInventoryRecountLine,
  claimRecountTask,
  completeOpeningInventoryBin,
  recordCount,
} from 'api-src/services/wms/inventoryRecount.service';

import {
  OPENING_INVENTORY_SNAPSHOT_QUERY,
  startShopOpeningInventory,
  type OpeningInventoryLocationPageReader,
} from 'api-src/services/wms/shopifyOpeningInventorySnapshot.service';

import { createOpeningInventoryCutoverGeneration } from
  'api-src/services/wms/openingInventoryCutoverGeneration.service';

import * as executionModule from
  'api-src/services/wms/openingInventoryCutoverExecution.service';

jest.setTimeout(120000);

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';
const EXECUTIONS = 'opening_inventory_cutover_executions';
const BATCH_EXECUTIONS = 'opening_inventory_cutover_batch_executions';
const ATTEMPTS = 'opening_inventory_cutover_batch_attempts';
const VERIFICATIONS = 'opening_inventory_cutover_verifications';
const VERIFICATION_LINES = 'opening_inventory_cutover_verification_lines';

const FROZEN_API_VERSION = '2026-04';

// Owner lease that must expire for real (DB time) in the later-call cases.
const SHORT_LEASE_MS = 2000;

// A happy path that waited for a default (5 min) lease would time out; one
// orchestration call must finish far inside this bound.
const ONE_CALL_BUDGET_MS = 30000;

const ORCHESTRATOR_MISSING =
  '[GH1179_E06_ORCHESTRATOR_MISSING] advanceOpeningInventoryCutoverExecution is not exported';

// ─── controlled runtime lookup (E06-O01) ────────────────────────────────────

type ShopifyClientArgs = Record<string, unknown>;

type InjectedShopifyClient = {
  request: (document: string, options?: any) => Promise<unknown>;
};

type OrchestratorDeps = {
  createShopifyGraphQLClient?: (args: ShopifyClientArgs) => InjectedShopifyClient;
  leaseDurationMs?: number;
};

type Orchestrator = (
  params: { shopId: number; generationId: string },
  deps?: OrchestratorDeps
) => Promise<unknown>;

function requireOrchestrator(): Orchestrator {
  const candidate = (executionModule as Record<string, unknown>)
    .advanceOpeningInventoryCutoverExecution;

  if (typeof candidate !== 'function') {
    throw new Error(ORCHESTRATOR_MISSING);
  }

  return candidate as Orchestrator;
}

const executeGeneration =
  executionModule.executeOpeningInventoryCutoverGeneration as unknown as Orchestrator;

const verifyConvergence =
  executionModule.verifyOpeningInventoryCutoverConvergence as unknown as Orchestrator;

// ─── environment / independent coordinator ──────────────────────────────────

const originalApiVersion = process.env.SHOPIFY_API_VERSION;

let coord: Knex;

beforeAll(async () => {
  process.env.SHOPIFY_API_VERSION = FROZEN_API_VERSION;

  const testDb = String(process.env.PGDATABASE);
  expect(testDb).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  coord = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: String(process.env.PGPASSWORD || ''),
      database: testDb,
    },
    pool: { min: 1, max: 1 },
  });

  const who = await coord.raw('SELECT current_database() AS db');
  expect(who.rows[0].db).toBe(testDb);
});

afterAll(async () => {
  if (originalApiVersion === undefined) {
    delete process.env.SHOPIFY_API_VERSION;
  } else {
    process.env.SHOPIFY_API_VERSION = originalApiVersion;
  }

  await coord?.destroy();
});

beforeEach(() => {
  process.env.SHOPIFY_API_VERSION = FROZEN_API_VERSION;
  mockShopifyRequest.mockClear();
  mockCreateShopifyGraphQLClient.mockClear();
});

afterEach(() => {
  expect(mockCreateShopifyGraphQLClient).not.toHaveBeenCalled();
  expect(mockShopifyRequest).not.toHaveBeenCalled();
});

async function coordTenant<T>(
  shopId: number,
  fn: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return coord.transaction(async (trx) => {
    await trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [
      String(shopId),
    ]);

    return fn(trx);
  });
}

async function waitFor<T>(
  probe: () => Promise<T> | T,
  label: string,
  { tries = 800, intervalMs = 25 } = {}
): Promise<NonNullable<T>> {
  for (let i = 0; i < tries; i += 1) {
    const value = await probe();

    if (value) {
      return value as NonNullable<T>;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`[GH1179_E06_TEST] waitFor timed out: ${label}`);
}

// ─── injected Shopify provider, routed by GraphQL document ──────────────────

type ProviderCall = { document: string; options: any };
type ProviderHandler = (call: ProviderCall) => Promise<unknown>;

function isMutationDocument(document: string): boolean {
  return /\bmutation\b/.test(document);
}

function routedShopify(
  label: string,
  params: { reads?: ProviderHandler[]; mutations?: ProviderHandler[] } = {}
) {
  const reads = params.reads ?? [];
  const mutations = params.mutations ?? [];

  const clients: ShopifyClientArgs[] = [];
  const readCalls: ProviderCall[] = [];
  const mutationCalls: ProviderCall[] = [];
  const unknownCalls: ProviderCall[] = [];

  const createShopifyGraphQLClient = (args: ShopifyClientArgs): InjectedShopifyClient => {
    clients.push(args);

    return {
      request: async (document, options = {}) => {
        const call: ProviderCall = { document, options };
        let handler: ProviderHandler | undefined;

        if (document === OPENING_INVENTORY_SNAPSHOT_QUERY) {
          handler = reads[readCalls.length];
          readCalls.push(call);
        } else if (isMutationDocument(document)) {
          handler = mutations[mutationCalls.length];
          mutationCalls.push(call);
        } else {
          unknownCalls.push(call);
        }

        if (!handler) {
          throw new Error(`[GH1179_E06_TEST] unexpected provider call on ${label}`);
        }

        return handler(call);
      },
    };
  };

  return { clients, readCalls, mutationCalls, unknownCalls, createShopifyGraphQLClient };
}

type RoutedShopify = ReturnType<typeof routedShopify>;

function mutationSuccess(shopId: number, suffix: number) {
  return {
    data: {
      inventorySetQuantities: {
        inventoryAdjustmentGroup: {
          id: `gid://shopify/InventoryAdjustmentGroup/${shopId}${String(suffix).padStart(4, '0')}`,
        },
        userErrors: [],
      },
    },
    extensions: {},
    headers: { 'X-Shopify-API-Version': [FROZEN_API_VERSION] },
  };
}

function mutationUserErrors() {
  return {
    data: {
      inventorySetQuantities: {
        inventoryAdjustmentGroup: null,
        userErrors: [
          {
            field: ['input', 'quantities', '0'],
            message: '[GH1179_E06_TEST] synthetic rejection',
            code: 'INVALID_QUANTITY',
          },
        ],
      },
    },
    extensions: {},
    headers: { 'X-Shopify-API-Version': [FROZEN_API_VERSION] },
  };
}

function noResponseError(): Error {
  return new HttpRequestError(
    'Http request error, no response available: [GH1179_E06_TEST] simulated lost response'
  );
}

// ─── Slice-C fixture (E02 / E04 / E05 precedent) ────────────────────────────

type Fixture = {
  shopId: number;
  ownerId: number;
  operatorId: number;
  warehouseId: string;
  a1: string;
  a2: string;
  locationGid: string;
  variantId: string;
  itemGid: string;
  variantGid: string;
};

async function createFixture(): Promise<Fixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1179e06o-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const warehouseId = crypto.randomUUID();
  const rootCode = `E06-${unique}-ROOT`;
  const a1 = `E06-${unique}-A1`;
  const a2 = `E06-${unique}-A2`;

  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  const locationRaw = `20${shopId}`;
  const inventoryItemRaw = `${shopId}001`;
  const variantRaw = `${shopId}101`;

  let ownerId = 0;
  let operatorId = 0;

  await withTenant(shopId, async (trx) => {
    const users = await trx('users')
      .insert([
        {
          shop_id: shopId,
          email: `e06-owner-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'owner',
        },
        {
          shop_id: shopId,
          email: `e06-operator-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'operator',
        },
      ])
      .returning(['id', 'role']);

    ownerId = Number(users.find((row: any) => row.role === 'owner')!.id);
    operatorId = Number(users.find((row: any) => row.role === 'operator')!.id);

    await trx('shop_memberships').insert([
      { shop_id: shopId, user_id: ownerId, role: 'owner' },
      { shop_id: shopId, user_id: operatorId, role: 'operator' },
    ]);

    await trx('shop_wms_settings').insert({
      shop_id: shopId,
      bootstrap_model: 'reconcile_opening_expectation_v2',
    });

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: `Slice E06 warehouse ${unique}`,
      root_location_code: rootCode,
      is_default: true,
      active: true,
      external_location_id: locationRaw,
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
        location_code: a1,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: a2,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'storage',
      },
    ]);

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Slice E06 product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `E06-${unique}`,
      title: 'Slice E06 variant',
      unit_cost: '1.00',
      status: 'active',
    });

    await trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: shopId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${shopId}01`,
      external_variant_id: `gid://shopify/ProductVariant/${variantRaw}`,
      external_inventory_item_id: inventoryItemRaw,
      external_sku: `E06-${unique}`,
    });

    await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: `gh1179e06o-${unique}.myshopify.com`,
      shop_gid: `gid://shopify/Shop/${shopId}`,
      access_token: encrypt(`e06-offline-token-${unique}`),
      scopes: 'read_products,write_inventory',
    });
  });

  return {
    shopId,
    ownerId,
    operatorId,
    warehouseId,
    a1,
    a2,
    locationGid: `gid://shopify/Location/${locationRaw}`,
    variantId,
    itemGid: `gid://shopify/InventoryItem/${inventoryItemRaw}`,
    variantGid: `gid://shopify/ProductVariant/${variantRaw}`,
  };
}

async function countOpeningBin(
  fixture: Fixture,
  recountTaskId: string,
  quantity: number | null
): Promise<void> {
  await withTenant(fixture.shopId, (trx) =>
    claimRecountTask(trx, fixture.shopId, recountTaskId, fixture.operatorId)
  );

  if (quantity !== null) {
    const line = await withTenant(fixture.shopId, (trx) =>
      addOpeningInventoryRecountLine(trx, {
        shopId: fixture.shopId,
        recountTaskId,
        lasyncroVariantId: fixture.variantId,
        addedBy: fixture.operatorId,
      })
    );

    await withTenant(fixture.shopId, (trx) =>
      recordCount(trx, {
        shopId: fixture.shopId,
        recountTaskId,
        recountLineId: line.recount_line_id,
        countedQuantity: quantity,
        countMethod: 'bin_quantity',
        countedBy: fixture.operatorId,
      })
    );
  }

  await withTenant(fixture.shopId, (trx) =>
    completeOpeningInventoryBin(trx, fixture.shopId, recountTaskId, fixture.operatorId)
  );
}

async function seedTruth(fixture: Fixture, quantity: number): Promise<void> {
  const now = new Date();

  await withTenant(fixture.shopId, (trx) =>
    trx('inventory_truth')
      .insert({
        shop_id: fixture.shopId,
        lasyncro_variant_id: fixture.variantId,
        location_code: fixture.a1,
        on_hand_quantity: quantity,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: Math.max(0, quantity),
        last_evaluated_at: now,
      })
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
      .merge({
        on_hand_quantity: quantity,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: Math.max(0, quantity),
        last_evaluated_at: now,
        updated_at: now,
      })
  );
}

async function makeCountedReady(fixture: Fixture, targetQuantity: number): Promise<void> {
  const startReader: OpeningInventoryLocationPageReader = async ({ variables }) => ({
    data: {
      location: {
        id: variables.locationId,
        isActive: true,
        inventoryLevels: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: `gid://shopify/InventoryLevel/${fixture.shopId}001`,
              isActive: true,
              item: {
                id: fixture.itemGid,
                tracked: true,
                variant: { id: fixture.variantGid },
              },
              quantities: [{ name: 'on_hand', quantity: 11 }],
            },
          ],
        },
      },
    },
  });

  const started = await startShopOpeningInventory(
    { shopId: fixture.shopId, createdBy: fixture.ownerId, assignedTo: fixture.operatorId },
    { readLocationPage: startReader }
  );

  const first = started.bins.find((row) => row.location_code === fixture.a1);
  const second = started.bins.find((row) => row.location_code === fixture.a2);

  if (!first || !second) {
    throw new Error('[GH1179_E06_TEST] opening cohort bins missing');
  }

  await countOpeningBin(fixture, first.recount_task_id, targetQuantity);
  await countOpeningBin(fixture, second.recount_task_id, null);
  await seedTruth(fixture, targetQuantity);
}

async function seedAdditionalTargets(
  fixture: Fixture,
  count: number,
  quantity: number
): Promise<Array<{ itemGid: string; variantGid: string }>> {
  return withTenant(fixture.shopId, async (trx) => {
    const base = await trx('variants')
      .where({ shop_id: fixture.shopId, lasyncro_variant_id: fixture.variantId })
      .first('lasyncro_product_id');

    const now = new Date();
    const result: Array<{ itemGid: string; variantGid: string }> = [];
    const variants: any[] = [];
    const identities: any[] = [];
    const truthRows: any[] = [];

    for (let index = 0; index < count; index += 1) {
      const variantId = crypto.randomUUID();
      const itemRaw = `${fixture.shopId}${String(index + 5000).padStart(7, '0')}`;
      const variantRaw = `${fixture.shopId}${String(index + 8000).padStart(7, '0')}`;
      const productRaw = `${fixture.shopId}${String(index + 9000).padStart(7, '0')}`;

      result.push({
        itemGid: `gid://shopify/InventoryItem/${itemRaw}`,
        variantGid: `gid://shopify/ProductVariant/${variantRaw}`,
      });

      variants.push({
        lasyncro_variant_id: variantId,
        lasyncro_product_id: base.lasyncro_product_id,
        shop_id: fixture.shopId,
        sku: `E06-BULK-${index}-${variantId.slice(0, 8)}`,
        title: `Slice E06 bulk variant ${index}`,
        unit_cost: '1.00',
        status: 'active',
      });

      identities.push({
        id: crypto.randomUUID(),
        lasyncro_variant_id: variantId,
        shop_id: fixture.shopId,
        platform: 'shopify',
        external_product_id: `gid://shopify/Product/${productRaw}`,
        external_variant_id: `gid://shopify/ProductVariant/${variantRaw}`,
        external_inventory_item_id: itemRaw,
        external_sku: `E06-BULK-${index}`,
      });

      truthRows.push({
        shop_id: fixture.shopId,
        lasyncro_variant_id: variantId,
        location_code: fixture.a1,
        on_hand_quantity: quantity,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: quantity,
        last_evaluated_at: now,
      });
    }

    await trx('variants').insert(variants);
    await trx('external_product_identity_map').insert(identities);
    await trx('inventory_truth').insert(truthRows);

    return result;
  });
}

type LocationLevel = { itemGid: string; variantGid: string; onHand: number };

function locationPage(fixture: Fixture, levels: LocationLevel[]) {
  return {
    data: {
      location: {
        id: fixture.locationGid,
        isActive: true,
        inventoryLevels: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: levels.map((level, index) => ({
            id:
              `gid://shopify/InventoryLevel/${index + 1}` +
              `?inventory_item_id=${level.itemGid.split('/').pop()}`,
            isActive: true,
            item: { id: level.itemGid, tracked: true, variant: { id: level.variantGid } },
            quantities: [{ name: 'on_hand', quantity: level.onHand }],
          })),
        },
      },
    },
    extensions: {},
    headers: { 'X-Shopify-API-Version': [FROZEN_API_VERSION] },
  };
}

// ─── frozen generation (real Slice D) ───────────────────────────────────────

// one_batch: 3 ← 8 (one write). zero_write: 3 = 3 (no_op, zero batches).
// two_batches: 251 writes 1 ← 0 → batches 250 + 1.
type Shape = 'one_batch' | 'zero_write' | 'two_batches';

type Frozen = {
  fixture: Fixture;
  generationId: string;
  batches: any[];
  entries: any[];
};

async function freeze(shape: Shape): Promise<Frozen> {
  const fixture = await createFixture();
  let levels: LocationLevel[];

  if (shape === 'two_batches') {
    await makeCountedReady(fixture, 1);
    const extras = await seedAdditionalTargets(fixture, 250, 1);
    levels = [
      { itemGid: fixture.itemGid, variantGid: fixture.variantGid, onHand: 0 },
      ...extras.map((extra) => ({ ...extra, onHand: 0 })),
    ];
  } else {
    await makeCountedReady(fixture, 3);
    levels = [
      {
        itemGid: fixture.itemGid,
        variantGid: fixture.variantGid,
        onHand: shape === 'zero_write' ? 3 : 8,
      },
    ];
  }

  let served = false;

  const generation: any = await createOpeningInventoryCutoverGeneration(
    { shopId: fixture.shopId, actingUserId: fixture.ownerId, acceptPhysicalTruth: true },
    {
      readLocationPage: async () => {
        if (served) throw new Error('[GH1179_E06_TEST] generation reader exhausted');
        served = true;
        return locationPage(fixture, levels);
      },
    }
  );

  const generationId = String(generation.generation_id);

  const { batches, entries } = await coordTenant(fixture.shopId, async (trx) => ({
    batches: await trx(BATCHES)
      .where({ shop_id: fixture.shopId, generation_id: generationId })
      .orderBy('batch_index', 'asc'),
    entries: await trx(ENTRIES)
      .where({ shop_id: fixture.shopId, generation_id: generationId })
      .orderBy('ordinal', 'asc'),
  }));

  const expectedBatches = shape === 'two_batches' ? 2 : shape === 'one_batch' ? 1 : 0;
  expect(batches).toHaveLength(expectedBatches);

  return { fixture, generationId, batches, entries };
}

// Provider levels: each frozen entry at its target (or, for the listed batch
// indexes, still at its frozen old value).
function levelsFor(frozen: Frozen, oldBatches: number[] = []): LocationLevel[] {
  return frozen.entries.map((entry: any) => ({
    itemGid: String(entry.shopify_inventory_item_gid),
    variantGid: String(entry.shopify_variant_gid),
    onHand:
      entry.batch_index !== null && oldBatches.includes(Number(entry.batch_index))
        ? Number(entry.observed_on_hand_quantity)
        : Number(entry.target_quantity),
  }));
}

async function state(frozen: Frozen) {
  const { shopId } = frozen.fixture;

  return coordTenant(shopId, async (trx) => ({
    generations: await trx(GENERATIONS).where({ shop_id: shopId }),
    executions: await trx(EXECUTIONS).where({ shop_id: shopId }),
    batchExecutions: await trx(BATCH_EXECUTIONS)
      .where({ shop_id: shopId, generation_id: frozen.generationId })
      .orderBy('batch_index', 'asc'),
    attempts: await trx(ATTEMPTS)
      .where({ shop_id: shopId, generation_id: frozen.generationId })
      .orderBy([{ column: 'batch_index' }, { column: 'attempt_number' }]),
    verifications: await trx(VERIFICATIONS)
      .where({ shop_id: shopId })
      .orderBy([{ column: 'read_started_at' }, { column: 'verification_id' }]),
    lines: await trx(VERIFICATION_LINES).where({ shop_id: shopId }),
    legacyCutovers: await trx('opening_inventory_cutovers').where({ shop_id: shopId }),
    marker: (
      await trx.raw(
        `SELECT opening_inventory_shopify_synced_at::text AS synced_at
           FROM shop_wms_settings WHERE shop_id = ?`,
        [shopId]
      )
    ).rows[0]?.synced_at as string | null,
    dbNow: (await trx.raw('SELECT clock_timestamp() AS now')).rows[0].now as Date,
  }));
}

type State = Awaited<ReturnType<typeof state>>;

function finals(current: State): any[] {
  return current.verifications.filter((row: any) => row.purpose === 'final_convergence');
}

async function waitForLeaseExpiry(frozen: Frozen): Promise<void> {
  await waitFor(async () => {
    const result = await coordTenant(frozen.fixture.shopId, (trx) =>
      trx.raw(
        `SELECT lease_expires_at <= clock_timestamp() AS expired
           FROM ${EXECUTIONS} WHERE shop_id = ? AND generation_id = ?`,
        [frozen.fixture.shopId, frozen.generationId]
      )
    );

    return result.rows[0]?.expired === true;
  }, 'execution lease expired');
}

async function orchestrate(
  frozen: Frozen,
  provider: RoutedShopify,
  leaseDurationMs?: number
) {
  const advance = requireOrchestrator();
  const started = Date.now();

  const result = await advance(
    { shopId: frozen.fixture.shopId, generationId: frozen.generationId },
    { createShopifyGraphQLClient: provider.createShopifyGraphQLClient, leaseDurationMs }
  );

  return { result, elapsedMs: Date.now() - started };
}

async function publicCall(
  entry: Orchestrator,
  frozen: Frozen,
  provider: RoutedShopify,
  leaseDurationMs?: number
) {
  return entry(
    { shopId: frozen.fixture.shopId, generationId: frozen.generationId },
    { createShopifyGraphQLClient: provider.createShopifyGraphQLClient, leaseDurationMs }
  );
}

// Converged in this call: exactly one final_convergence verification started
// by the SAME owner token that dispatched (no second public claim).
function expectConverged(current: State, expectedLines: number): void {
  const execution = current.executions[0];
  const final = finals(current);

  expect(current.executions).toHaveLength(1);
  expect(execution.status).toBe('converged');
  expect(execution.terminal_reason).toBe('OPENING_CUTOVER_CONVERGED');
  expect(execution.lease_token).toBeNull();

  expect(final).toHaveLength(1);
  expect(final[0]).toMatchObject({ status: 'complete', verdict: 'converged' });
  expect(final[0].finalized_by_lease_token).toBe(final[0].started_by_lease_token);
  expect(
    current.lines.filter((line: any) => line.verification_id === final[0].verification_id)
  ).toHaveLength(expectedLines);

  expect(current.marker).not.toBeNull();
  expect(current.legacyCutovers).toHaveLength(0);
}

function expectNoProgressCalls(provider: RoutedShopify): void {
  expect(provider.readCalls).toHaveLength(0);
  expect(provider.mutationCalls).toHaveLength(0);
  expect(provider.unknownCalls).toHaveLength(0);
}

function durable(current: State) {
  return {
    executions: current.executions,
    batchExecutions: current.batchExecutions,
    attempts: current.attempts,
    verifications: current.verifications,
    lines: current.lines,
    marker: current.marker,
  };
}

// First orchestration call whose single dispatch is lost (ambiguous).
async function ambiguousFirstCall(shape: Shape, leaseDurationMs?: number) {
  const frozen = await freeze(shape);
  const provider = routedShopify('o-ambiguous-first', {
    mutations: [
      async () => {
        throw noResponseError();
      },
    ],
  });

  const { result } = await orchestrate(frozen, provider, leaseDurationMs);

  return { frozen, provider, result, after: await state(frozen) };
}

describe('GH-1179 Slice E / E06 — opening inventory cutover orchestration', () => {
  it('E06-O01 — exposes advanceOpeningInventoryCutoverExecution from the executor service module', () => {
    expect(typeof requireOrchestrator()).toBe('function');
  });

  it('E06-O02 — happy path in ONE call: one mutation, same-token E04 convergence, marker set by E04, no lease wait', async () => {
    const frozen = await freeze('one_batch');
    const { shopId } = frozen.fixture;

    const provider = routedShopify('o02', {
      mutations: [async () => mutationSuccess(shopId, 1)],
      reads: [async () => locationPage(frozen.fixture, levelsFor(frozen))],
    });

    const { elapsedMs } = await orchestrate(frozen, provider);

    expect(elapsedMs).toBeLessThan(ONE_CALL_BUDGET_MS);
    expect(provider.mutationCalls).toHaveLength(1);
    expect(provider.mutationCalls[0].document).toBe(frozen.batches[0].graphql_document);
    expect(provider.mutationCalls[0].options.variables).toEqual(
      JSON.parse(frozen.batches[0].canonical_variables)
    );
    expect(provider.readCalls).toHaveLength(1);
    expect(provider.unknownCalls).toHaveLength(0);

    const after = await state(frozen);

    expectConverged(after, 1);
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0].outcome).toBe('succeeded');
    // Same owner end to end: the dispatching token started the convergence.
    expect(finals(after)[0].started_by_lease_token).toBe(after.attempts[0].dispatch_lease_token);
  });

  it('E06-O03 — zero-write generation in ONE call: zero mutations, E04 read, converged, marker set', async () => {
    const frozen = await freeze('zero_write');

    const provider = routedShopify('o03', {
      reads: [async () => locationPage(frozen.fixture, levelsFor(frozen))],
    });

    const { elapsedMs } = await orchestrate(frozen, provider);

    expect(elapsedMs).toBeLessThan(ONE_CALL_BUDGET_MS);
    expect(provider.mutationCalls).toHaveLength(0);
    expect(provider.readCalls).toHaveLength(1);

    const after = await state(frozen);

    expectConverged(after, 1);
    expect(after.attempts).toHaveLength(0);
  });

  it('E06-O04 — ambiguous dispatch stops pending: executing/live lease, batch ambiguous, no readback, no resend, no convergence', async () => {
    const { provider, after } = await ambiguousFirstCall('one_batch');

    expect(provider.mutationCalls).toHaveLength(1);
    expect(provider.readCalls).toHaveLength(0);

    expect(after.executions).toHaveLength(1);
    expect(after.executions[0].status).toBe('executing');
    expect(new Date(after.executions[0].lease_expires_at).getTime()).toBeGreaterThan(
      new Date(after.dbNow).getTime()
    );
    expect(after.batchExecutions.map((row: any) => row.status)).toEqual(['ambiguous']);
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0].outcome).toBe('no_response');
    expect(after.verifications).toHaveLength(0);
    expect(after.marker).toBeNull();
  });

  it('E06-O05 — live-lease retry after ambiguity is pending/busy: zero provider calls, durable state unchanged', async () => {
    const { frozen, after: first } = await ambiguousFirstCall('one_batch');

    const retry = routedShopify('o05-retry');
    await orchestrate(frozen, retry);

    expectNoProgressCalls(retry);
    expect(durable(await state(frozen))).toEqual(durable(first));
  });

  it('E06-O06 — after real expiry: E03 readback applied, only the pending batch is sent, then same-owner E04 converges', async () => {
    const { frozen, after: first } = await ambiguousFirstCall('two_batches', SHORT_LEASE_MS);
    const { shopId } = frozen.fixture;

    expect(first.batchExecutions.map((row: any) => row.status)).toEqual(['ambiguous', 'pending']);

    await waitForLeaseExpiry(frozen);

    const provider = routedShopify('o06-later', {
      reads: [
        // Ambiguity readback: batch 1 applied, batch 2 still old.
        async () => locationPage(frozen.fixture, levelsFor(frozen, [2])),
        // Final convergence: every frozen target.
        async () => locationPage(frozen.fixture, levelsFor(frozen)),
      ],
      mutations: [async () => mutationSuccess(shopId, 2)],
    });

    await orchestrate(frozen, provider);

    expect(provider.readCalls).toHaveLength(2);
    expect(provider.mutationCalls).toHaveLength(1);
    expect(provider.mutationCalls[0].document).toBe(frozen.batches[1].graphql_document);
    expect(provider.mutationCalls[0].options.variables).toEqual(
      JSON.parse(frozen.batches[1].canonical_variables)
    );

    const after = await state(frozen);

    expectConverged(after, 251);

    // Batch 1 recovered (never resent); batch 2 dispatched exactly once.
    expect(after.attempts.filter((row: any) => Number(row.batch_index) === 1)).toEqual(
      first.attempts.filter((row: any) => Number(row.batch_index) === 1)
    );
    expect(after.attempts.filter((row: any) => Number(row.batch_index) === 2)).toHaveLength(1);

    const inspection = after.verifications.filter(
      (row: any) => row.purpose === 'ambiguity_inspection'
    );

    expect(inspection).toHaveLength(1);
    expect(inspection[0].verdict).toBe('applied');
    // The recovering owner carried the cutover through to convergence.
    expect(finals(after)[0].started_by_lease_token).toBe(inspection[0].started_by_lease_token);
  });

  it('E06-O07 — after real expiry: E03 readback not_applied → requires_regeneration, no resend, no convergence, marker NULL', async () => {
    const { frozen } = await ambiguousFirstCall('one_batch', SHORT_LEASE_MS);

    await waitForLeaseExpiry(frozen);

    const provider = routedShopify('o07-later', {
      reads: [async () => locationPage(frozen.fixture, levelsFor(frozen, [1]))],
    });

    await orchestrate(frozen, provider);

    expect(provider.readCalls).toHaveLength(1);
    expect(provider.mutationCalls).toHaveLength(0);

    const after = await state(frozen);

    expect(after.executions[0].status).toBe('requires_regeneration');
    expect(after.verifications.map((row: any) => row.verdict)).toEqual(['not_applied']);
    expect(finals(after)).toHaveLength(0);
    expect(after.marker).toBeNull();
    // The orchestrator never creates a generation.
    expect(after.generations).toHaveLength(1);
  });

  it('E06-O08 — verifying with a LIVE lease owned elsewhere: busy, no provider call, nothing stolen', async () => {
    const frozen = await freeze('one_batch');

    const e02 = routedShopify('o08-e02', {
      mutations: [async () => mutationSuccess(frozen.fixture.shopId, 8)],
    });

    expect(await publicCall(executeGeneration, frozen, e02)).toMatchObject({ outcome: 'verifying' });

    const before = await state(frozen);
    const provider = routedShopify('o08');

    await orchestrate(frozen, provider);

    expectNoProgressCalls(provider);
    expect(durable(await state(frozen))).toEqual(durable(before));
  });

  it('E06-O09 — verifying with an EXPIRED lease: reclaimed under E04 rules and converged, marker set', async () => {
    const frozen = await freeze('one_batch');

    const e02 = routedShopify('o09-e02', {
      mutations: [async () => mutationSuccess(frozen.fixture.shopId, 9)],
    });

    expect(await publicCall(executeGeneration, frozen, e02, SHORT_LEASE_MS)).toMatchObject({
      outcome: 'verifying',
    });

    await waitForLeaseExpiry(frozen);

    const provider = routedShopify('o09', {
      reads: [async () => locationPage(frozen.fixture, levelsFor(frozen))],
    });

    await orchestrate(frozen, provider);

    expect(provider.mutationCalls).toHaveLength(0);
    expect(provider.readCalls).toHaveLength(1);

    expectConverged(await state(frozen), 1);
  });

  it('E06-O10a — blocked execution: no provider call, no convergence, blocked surfaced', async () => {
    const frozen = await freeze('one_batch');

    const e02 = routedShopify('o10a-e02', { mutations: [async () => mutationUserErrors()] });
    expect(await publicCall(executeGeneration, frozen, e02)).toMatchObject({ outcome: 'blocked' });

    const before = await state(frozen);
    const provider = routedShopify('o10a');
    const { result } = await orchestrate(frozen, provider);

    expectNoProgressCalls(provider);
    expect(JSON.stringify(result)).toMatch(/blocked/i);
    expect(durable(await state(frozen))).toEqual(durable(before));
  });

  it('E06-O10b — requires_regeneration execution: no provider call, no N+1 by the orchestrator, surfaced', async () => {
    const frozen = await freeze('one_batch');

    await seedTruth(frozen.fixture, 5);

    const e02 = routedShopify('o10b-e02');
    expect(await publicCall(executeGeneration, frozen, e02)).toMatchObject({
      outcome: 'requires_regeneration',
    });

    const before = await state(frozen);
    const provider = routedShopify('o10b');
    const { result } = await orchestrate(frozen, provider);

    expectNoProgressCalls(provider);
    expect(JSON.stringify(result)).toMatch(/requires_regeneration/i);

    const after = await state(frozen);

    expect(durable(after)).toEqual(durable(before));
    expect(after.generations).toHaveLength(1);
  });

  it('E06-O10c — converged execution: idempotent replay, zero provider calls, marker and evidence preserved', async () => {
    const frozen = await freeze('one_batch');

    const e02 = routedShopify('o10c-e02', {
      mutations: [async () => mutationSuccess(frozen.fixture.shopId, 10)],
    });
    expect(await publicCall(executeGeneration, frozen, e02, SHORT_LEASE_MS)).toMatchObject({
      outcome: 'verifying',
    });

    await waitForLeaseExpiry(frozen);

    const e04 = routedShopify('o10c-e04', {
      reads: [async () => locationPage(frozen.fixture, levelsFor(frozen))],
    });
    expect(await publicCall(verifyConvergence, frozen, e04)).toMatchObject({ outcome: 'converged' });

    const before = await state(frozen);
    const provider = routedShopify('o10c');
    const { result } = await orchestrate(frozen, provider);

    expectNoProgressCalls(provider);
    expect(JSON.stringify(result)).toMatch(/converged/i);
    expect(durable(await state(frozen))).toEqual(durable(before));
  });
});
