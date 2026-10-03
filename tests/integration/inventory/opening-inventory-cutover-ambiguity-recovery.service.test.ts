// GH-1179 Slice E / E03A — RATIFIED ambiguity recovery RED contract.
// Real PostgreSQL fixtures use the existing Slice-B/C/D/E02 service paths.
// The missing recovery module/export is a controlled RED gate reached only
// AFTER an ambiguous batch and its durable attempt exist. No production edits.
// Shopify transport is injected and default transport fails closed.
// Proposed recovery API is locked below; every call recovers one batch only.
// Fixture support copied locally from the E02 suite; no shared helper added.

const mockShopifyRequest = jest.fn(async (..._args: unknown[]) => {
  throw new Error(
    '[GH1179_E03A_TEST] default Shopify transport must not be reached'
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
import fs from 'fs';
import path from 'path';
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
  startShopOpeningInventory,
  type OpeningInventoryLocationPageReader,
} from 'api-src/services/wms/shopifyOpeningInventorySnapshot.service';

import { createOpeningInventoryCutoverGeneration } from
  'api-src/services/wms/openingInventoryCutoverGeneration.service';

jest.setTimeout(120000);

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';

const EXECUTIONS = 'opening_inventory_cutover_executions';
const BATCH_EXECUTIONS = 'opening_inventory_cutover_batch_executions';
const ATTEMPTS = 'opening_inventory_cutover_batch_attempts';

const FROZEN_API_VERSION = '2026-04';
const DIFFERENT_API_VERSION = '2026-07';

// Recovery owner A's short lease permits real DB-time expiry during a held read.
const OWNER_A_LEASE_MS = 3000;

const STALE_CLAIM = /STALE|LEASE|CLAIM/i;

// ─── controlled runtime loader (E02-01 RED gate) ────────────────────────────

const E02_RED_GATE =
  '[E02_RED_GATE] opening inventory cutover executor not implemented';

const EXECUTOR_SOURCE = path.resolve(
  __dirname,
  '../../../apps/backend/src/services/wms/openingInventoryCutoverExecution.service'
);

type ShopifyClientArgs = {
  accessToken?: unknown;
  platformShopName?: unknown;
  shopId?: unknown;
  apiVersion?: unknown;
  [key: string]: unknown;
};

type ShopifyRequestOptions = {
  variables?: any;
  retries?: number;
  [key: string]: unknown;
};

type InjectedShopifyClient = {
  request: (
    document: string,
    options?: ShopifyRequestOptions
  ) => Promise<unknown>;
};

type ExecutorDeps = {
  createShopifyGraphQLClient?: (
    args: ShopifyClientArgs
  ) => InjectedShopifyClient;
  leaseDurationMs?: number;
};

type ExecuteGeneration = (
  params: { shopId: number; generationId: string },
  deps?: ExecutorDeps
) => Promise<unknown>;

function requireExecutor(): ExecuteGeneration {
  const present = ['.ts', '.js'].some((extension) =>
    fs.existsSync(`${EXECUTOR_SOURCE}${extension}`)
  );

  if (!present) {
    throw new Error(E02_RED_GATE);
  }

  // Computed runtime path: no static import, so this suite compiles while the
  // future module is absent.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loaded = require(EXECUTOR_SOURCE);
  const candidate = loaded?.executeOpeningInventoryCutoverGeneration;

  if (typeof candidate !== 'function') {
    throw new Error(
      `${E02_RED_GATE} (executeOpeningInventoryCutoverGeneration export missing)`
    );
  }

  return candidate as ExecuteGeneration;
}

// ─── environment / independent coordinator ──────────────────────────────────

const originalApiVersion = process.env.SHOPIFY_API_VERSION;

let coord: Knex;
let coordPid = 0;

beforeAll(async () => {
  process.env.SHOPIFY_API_VERSION = FROZEN_API_VERSION;

  const testDb = String(process.env.PGDATABASE);
  expect(testDb).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  // Independent connection under the restricted runtime role: observes only
  // COMMITTED state and the executor's backends in pg_stat_activity.
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

  const who = await coord.raw(
    'SELECT current_database() AS db, pg_backend_pid() AS pid'
  );

  expect(who.rows[0].db).toBe(testDb);
  coordPid = Number(who.rows[0].pid);
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
  // Provider access is injected only; the default client is never reached.
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

// TEST-ONLY: bounded poll that OBSERVES state; it never gates transactions on
// elapsed time (R14_CONCURRENT / D25 pattern).
async function waitFor<T>(
  probe: () => Promise<T> | T,
  label: string,
  { tries = 400, intervalMs = 25 } = {}
): Promise<NonNullable<T>> {
  for (let i = 0; i < tries; i += 1) {
    const value = await probe();

    if (value) {
      return value as NonNullable<T>;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`[GH1179_E03A_TEST] waitFor timed out: ${label}`);
}

type Settled =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown };

function track(promise: Promise<unknown>) {
  const state: { settled: Settled | null } = { settled: null };

  const done: Promise<Settled> = promise.then(
    (value) => (state.settled = { ok: true, value }),
    (error) => (state.settled = { ok: false, error })
  );

  return { state, done };
}

function describeOutcome(settled: Settled | null): string {
  if (!settled) return 'unsettled';
  if (!('error' in settled)) return JSON.stringify(settled.value ?? null);

  const error = settled.error as any;
  return String(error?.message ?? error);
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

// ─── injected Shopify provider ──────────────────────────────────────────────

type ProviderCall = {
  document: string;
  options: ShopifyRequestOptions;
  settled: boolean;
};

type ProviderHandler = (call: ProviderCall) => Promise<unknown>;

function fakeShopify(label: string, handlers: ProviderHandler[] = []) {
  const calls: ProviderCall[] = [];
  const clients: ShopifyClientArgs[] = [];
  const concurrency = { inFlight: 0, max: 0 };

  const createShopifyGraphQLClient = (
    args: ShopifyClientArgs
  ): InjectedShopifyClient => {
    clients.push(args);

    return {
      request: async (document, options = {}) => {
        const handler = handlers[calls.length];
        const call: ProviderCall = { document, options, settled: false };

        calls.push(call);
        concurrency.inFlight += 1;
        concurrency.max = Math.max(concurrency.max, concurrency.inFlight);

        try {
          if (!handler) {
            throw new Error(
              `[GH1179_E03A_TEST] unexpected provider call #${calls.length} on ${label}`
            );
          }

          return await handler(call);
        } finally {
          concurrency.inFlight -= 1;
          call.settled = true;
        }
      },
    };
  };

  return { calls, clients, concurrency, createShopifyGraphQLClient };
}

// The SDK's own classification when no HTTP response exists.
function noResponseError(): Error {
  return new HttpRequestError(
    'Http request error, no response available: [GH1179_E03A_TEST] simulated lost response'
  );
}

// ─── Slice-C/D fixture (patterned after the Slice-D generation suite) ───────

type Fixture = {
  shopId: number;
  ownerId: number;
  operatorId: number;
  warehouseId: string;
  rootCode: string;
  a1: string;
  a2: string;
  locationRaw: string;
  locationGid: string;
  variantId: string;
  itemGid: string;
  variantGid: string;
  shopGid: string;
  shopDomain: string;
  accessToken: string;
};

type ProviderLevel = {
  itemGid: string;
  variantGid?: string | null;
  onHand: number;
};

async function createFixture(): Promise<Fixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1179e02-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const warehouseId = crypto.randomUUID();
  const rootCode = `E02-${unique}-ROOT`;
  const a1 = `E02-${unique}-A1`;
  const a2 = `E02-${unique}-A2`;

  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  const locationRaw = `20${shopId}`;
  const inventoryItemRaw = `${shopId}001`;
  const variantRaw = `${shopId}101`;

  const itemGid = `gid://shopify/InventoryItem/${inventoryItemRaw}`;
  const variantGid = `gid://shopify/ProductVariant/${variantRaw}`;
  const shopGid = `gid://shopify/Shop/${shopId}`;
  const shopDomain = `gh1179e02-${unique}.myshopify.com`;
  const accessToken = `e02-offline-token-${unique}`;

  let ownerId = 0;
  let operatorId = 0;

  await withTenant(shopId, async (trx) => {
    const users = await trx('users')
      .insert([
        {
          shop_id: shopId,
          email: `e02-owner-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'owner',
        },
        {
          shop_id: shopId,
          email: `e02-operator-${unique}@example.com`,
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
      name: `Slice E02 warehouse ${unique}`,
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
      title: 'Slice E02 product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `E02-${unique}`,
      title: 'Slice E02 variant',
      unit_cost: '1.00',
      status: 'active',
    });

    await trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: shopId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${shopId}01`,
      external_variant_id: variantGid,
      external_inventory_item_id: inventoryItemRaw,
      external_sku: `E02-${unique}`,
    });

    // Encrypted like a real offline token: the executor resolves credentials
    // exactly as production would; transport is injected.
    await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: shopDomain,
      shop_gid: shopGid,
      access_token: encrypt(accessToken),
      scopes: 'read_products,write_inventory',
    });
  });

  return {
    shopId,
    ownerId,
    operatorId,
    warehouseId,
    rootCode,
    a1,
    a2,
    locationRaw,
    locationGid: `gid://shopify/Location/${locationRaw}`,
    variantId,
    itemGid,
    variantGid,
    shopGid,
    shopDomain,
    accessToken,
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
    completeOpeningInventoryBin(
      trx,
      fixture.shopId,
      recountTaskId,
      fixture.operatorId
    )
  );
}

async function seedTruth(
  fixture: Fixture,
  params: { locationCode?: string; quantity: number }
): Promise<void> {
  const now = new Date();

  await withTenant(fixture.shopId, (trx) =>
    trx('inventory_truth')
      .insert({
        shop_id: fixture.shopId,
        lasyncro_variant_id: fixture.variantId,
        location_code: params.locationCode ?? fixture.a1,
        on_hand_quantity: params.quantity,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: Math.max(0, params.quantity),
        last_evaluated_at: now,
      })
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
      .merge({
        on_hand_quantity: params.quantity,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: Math.max(0, params.quantity),
        last_evaluated_at: now,
        updated_at: now,
      })
  );
}

async function makeCountedReady(
  fixture: Fixture,
  targetQuantity: number
): Promise<void> {
  const startReader: OpeningInventoryLocationPageReader = async ({
    variables,
  }) => ({
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
    {
      shopId: fixture.shopId,
      createdBy: fixture.ownerId,
      assignedTo: fixture.operatorId,
    },
    { readLocationPage: startReader }
  );

  const first = started.bins.find((row) => row.location_code === fixture.a1);
  const second = started.bins.find((row) => row.location_code === fixture.a2);

  if (!first || !second) {
    throw new Error('[GH1179_E03A_TEST] opening cohort bins missing');
  }

  await countOpeningBin(fixture, first.recount_task_id, targetQuantity);
  await countOpeningBin(fixture, second.recount_task_id, null);

  // Slice C derives TARGET only from CURRENT inventory_truth.
  await seedTruth(fixture, { quantity: targetQuantity });
}

type ExtraTarget = { variantId: string; itemGid: string; variantGid: string };

async function seedAdditionalTargets(
  fixture: Fixture,
  count: number,
  quantity: number
): Promise<ExtraTarget[]> {
  return withTenant(fixture.shopId, async (trx) => {
    const baseVariant = await trx('variants')
      .where({ shop_id: fixture.shopId, lasyncro_variant_id: fixture.variantId })
      .select('lasyncro_product_id')
      .first();

    if (!baseVariant?.lasyncro_product_id) {
      throw new Error('[GH1179_E03A_TEST] fixture product missing');
    }

    const now = new Date();
    const result: ExtraTarget[] = [];
    const variants: any[] = [];
    const identities: any[] = [];
    const truthRows: any[] = [];

    for (let index = 0; index < count; index += 1) {
      const variantId = crypto.randomUUID();
      const itemRaw = `${fixture.shopId}${String(index + 5000).padStart(7, '0')}`;
      const variantRaw = `${fixture.shopId}${String(index + 8000).padStart(7, '0')}`;
      const productRaw = `${fixture.shopId}${String(index + 9000).padStart(7, '0')}`;

      const itemGid = `gid://shopify/InventoryItem/${itemRaw}`;
      const variantGid = `gid://shopify/ProductVariant/${variantRaw}`;

      result.push({ variantId, itemGid, variantGid });

      variants.push({
        lasyncro_variant_id: variantId,
        lasyncro_product_id: baseVariant.lasyncro_product_id,
        shop_id: fixture.shopId,
        sku: `E02-BULK-${index}-${variantId.slice(0, 8)}`,
        title: `Slice E02 bulk variant ${index}`,
        unit_cost: '1.00',
        status: 'active',
      });

      identities.push({
        id: crypto.randomUUID(),
        lasyncro_variant_id: variantId,
        shop_id: fixture.shopId,
        platform: 'shopify',
        external_product_id: `gid://shopify/Product/${productRaw}`,
        external_variant_id: variantGid,
        external_inventory_item_id: itemRaw,
        external_sku: `E02-BULK-${index}`,
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

function providerPage(fixture: Fixture, levels: ProviderLevel[]) {
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
            item: {
              id: level.itemGid,
              tracked: true,
              variant:
                level.variantGid === null
                  ? null
                  : { id: level.variantGid ?? fixture.variantGid },
            },
            quantities: [{ name: 'on_hand', quantity: level.onHand }],
          })),
        },
      },
    },
    headers: { 'X-Shopify-API-Version': [FROZEN_API_VERSION] },
  };
}

type SliceDState = {
  generations: any[];
  entries: any[];
  batches: any[];
  sha256: string;
};

async function sliceDState(shopId: number): Promise<SliceDState> {
  return coordTenant(shopId, async (trx) => {
    const generations = await trx(GENERATIONS)
      .where({ shop_id: shopId })
      .orderBy('generation_sequence', 'asc');

    const entries = await trx(ENTRIES)
      .where({ shop_id: shopId })
      .orderBy([
        { column: 'generation_id' },
        { column: 'ordinal' },
      ]);

    const batches = await trx(BATCHES)
      .where({ shop_id: shopId })
      .orderBy([
        { column: 'generation_id' },
        { column: 'batch_index' },
      ]);

    const sha256 = crypto
      .createHash('sha256')
      .update(JSON.stringify({ generations, entries, batches }))
      .digest('hex');

    return { generations, entries, batches, sha256 };
  });
}

type FrozenShape = 'one_batch' | 'zero_target' | 'two_lines' | 'two_batches' | 'zero_write';

type Frozen = {
  fixture: Fixture;
  generationId: string;
  generation: any;
  batches: any[];
  entries: any[];
  sliceD: SliceDState;
};

// Real Slice-D path: CURRENT Slice-C target frozen against injected fresh
// Shopify on_hand. No generation row is ever written by hand.
async function freezeGeneration(shape: FrozenShape): Promise<Frozen> {
  const fixture = await createFixture();

  let levels: ProviderLevel[];
  let expectedBatches: number;

  if (shape === 'one_batch' || shape === 'zero_target') {
    // target 3, Shopify on_hand 8 → one write, one batch.
    await makeCountedReady(fixture, shape === 'zero_target' ? 0 : 3);
    levels = [{ itemGid: fixture.itemGid, variantGid: fixture.variantGid, onHand: 8 }];
    expectedBatches = 1;
  } else if (shape === 'zero_write') {
    // target 3, Shopify on_hand 3 → no-op entry, zero batches.
    await makeCountedReady(fixture, 3);
    levels = [{ itemGid: fixture.itemGid, variantGid: fixture.variantGid, onHand: 3 }];
    expectedBatches = 0;
  } else {
    // 251 writes → immutable batches 250 + 1 (Slice-D D20 precedent).
    await makeCountedReady(fixture, 1);
    const extras = await seedAdditionalTargets(fixture, shape === 'two_lines' ? 1 : 250, 1);
    levels = [
      { itemGid: fixture.itemGid, variantGid: fixture.variantGid, onHand: 0 },
      ...extras.map((extra) => ({
        itemGid: extra.itemGid,
        variantGid: extra.variantGid,
        onHand: 0,
      })),
    ];
    expectedBatches = shape === 'two_lines' ? 1 : 2;
  }

  let served = false;

  await createOpeningInventoryCutoverGeneration(
    {
      shopId: fixture.shopId,
      actingUserId: fixture.ownerId,
      acceptPhysicalTruth: true,
    },
    {
      readLocationPage: async () => {
        if (served) {
          throw new Error('[GH1179_E03A_TEST] generation reader exhausted');
        }

        served = true;
        return providerPage(fixture, levels);
      },
    }
  );

  const sliceD = await sliceDState(fixture.shopId);

  expect(sliceD.generations).toHaveLength(1);

  const generation = sliceD.generations[0];

  expect(generation.status).toBe('frozen');
  expect(generation.requested_api_version).toBe(FROZEN_API_VERSION);
  expect(generation.served_api_version).toBe(FROZEN_API_VERSION);
  expect(Number(generation.batch_count)).toBe(expectedBatches);
  expect(sliceD.batches).toHaveLength(expectedBatches);

  return {
    fixture,
    generationId: String(generation.generation_id),
    generation,
    batches: sliceD.batches,
    entries: sliceD.entries,
    sliceD,
  };
}

// ─── observation helpers (independent connection, committed state only) ────

async function executionState(shopId: number, generationId: string) {
  return coordTenant(shopId, async (trx) => ({
    executions: await trx(EXECUTIONS).where({ shop_id: shopId }),

    batchExecutions: await trx(BATCH_EXECUTIONS)
      .where({ shop_id: shopId, generation_id: generationId })
      .orderBy('batch_index', 'asc'),

    attempts: await trx(ATTEMPTS)
      .where({ shop_id: shopId, generation_id: generationId })
      .orderBy([
        { column: 'batch_index' },
        { column: 'attempt_number' },
      ]),

    dbNow: (await trx.raw('SELECT clock_timestamp() AS now')).rows[0]
      .now as Date,
  }));
}

async function expectSliceDUnchanged(frozen: Frozen): Promise<void> {
  const after = await sliceDState(frozen.fixture.shopId);

  expect(after.generations).toEqual(frozen.sliceD.generations);
  expect(after.entries).toEqual(frozen.sliceD.entries);
  expect(after.batches).toEqual(frozen.sliceD.batches);
  expect(after.sha256).toBe(frozen.sliceD.sha256);
}

async function expectCompletionMarkerNull(shopId: number): Promise<void> {
  const row = await coordTenant(shopId, (trx) =>
    trx('shop_wms_settings')
      .where({ shop_id: shopId })
      .first('opening_inventory_shopify_synced_at')
  );

  expect(row).toBeDefined();
  expect(row.opening_inventory_shopify_synced_at).toBeNull();
}

function expectNoLease(execution: any): void {
  expect(execution.lease_token).toBeNull();
  expect(execution.lease_expires_at).toBeNull();
}

async function waitForProviderCalls(
  provider: { calls: ProviderCall[] },
  count: number,
  run: { state: { settled: Settled | null } },
  label: string
): Promise<void> {
  await waitFor(() => {
    if (provider.calls.length >= count) return true;

    if (run.state.settled) {
      throw new Error(
        `[GH1179_E03A_TEST] executor settled before ${label}: ${describeOutcome(
          run.state.settled
        )}`
      );
    }

    return null;
  }, label);
}

async function waitForLeaseExpiry(
  shopId: number,
  executionId: string
): Promise<void> {
  await waitFor(
    async () => {
      const result = await coordTenant(shopId, (trx) =>
        trx.raw(
          `SELECT lease_expires_at <= clock_timestamp() AS expired
             FROM ${EXECUTIONS}
            WHERE execution_id = ?`,
          [executionId]
        )
      );

      return result.rows[0]?.expired === true;
    },
    'owner A lease expired',
    { tries: 800, intervalMs: 25 }
  );
}


const VERIFICATIONS = 'opening_inventory_cutover_verifications';
const VERIFICATION_LINES = 'opening_inventory_cutover_verification_lines';
const E03A_RED_GATE = '[E03A_RED_GATE] opening inventory ambiguity recovery not implemented';
const RECOVERY_SOURCE = path.resolve(__dirname,
  '../../../apps/backend/src/services/wms/openingInventoryCutoverAmbiguityRecovery.service');
type Recover = (params: { shopId: number; generationId: string; batchIndex: number },
  deps?: ExecutorDeps) => Promise<unknown>;

function requireRecovery(): Recover {
  if (!['.ts', '.js'].some(ext => fs.existsSync(`${RECOVERY_SOURCE}${ext}`))) {
    throw new Error(E03A_RED_GATE);
  }
  // Computed runtime import permits RED without a TypeScript resolution error.
  const loaded = require(RECOVERY_SOURCE);
  if (typeof loaded?.recoverOpeningInventoryCutoverBatch !== 'function') {
    throw new Error(`${E03A_RED_GATE} (recoverOpeningInventoryCutoverBatch export missing)`);
  }
  return loaded.recoverOpeningInventoryCutoverBatch as Recover;
}

type Ambiguous = Frozen & { baseline: Awaited<ReturnType<typeof executionState>> };
let observed: Ambiguous[] = [];
let recoveryProviders: ReturnType<typeof fakeShopify>[] = [];
beforeEach(() => { observed = []; recoveryProviders = []; });

async function evidence(f: Frozen) {
  return coordTenant(f.fixture.shopId, async trx => {
    const headers = await trx(VERIFICATIONS).where({ shop_id: f.fixture.shopId,
      generation_id: f.generationId }).orderBy('read_started_at');
    const lines = headers.length ? await trx(VERIFICATION_LINES)
      .where({ shop_id: f.fixture.shopId }).whereIn('verification_id',
        headers.map(h => h.verification_id)).orderBy('shopify_inventory_item_gid') : [];
    return { headers, lines };
  });
}

afterEach(async () => {
  for (const provider of recoveryProviders) {
    expect(provider.calls.every(c => !/\bmutation\b|inventorySetQuantities|inventoryAdjustQuantities/.test(c.document))).toBe(true);
    for (const call of provider.calls) expect(call.options.retries).toBe(0);
  }
  for (const f of observed) {
    await expectSliceDUnchanged(f); // includes exact generation count: no N+1
    await expectCompletionMarkerNull(f.fixture.shopId);
    const state = await executionState(f.fixture.shopId, f.generationId);
    expect(state.attempts).toEqual(f.baseline.attempts);
    expect(state.batchExecutions.map(b => b.attempt_count))
      .toEqual(f.baseline.batchExecutions.map(b => b.attempt_count));
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0].status).not.toBe('converged');
    const proof = await evidence(f);
    expect(proof.headers.some(h => h.purpose === 'final_convergence')).toBe(false);
    for (const h of proof.headers.filter(h => h.status === 'complete')) {
      expect(h.finalized_by_lease_token).not.toBeNull();
      expect(h.read_completed_at).not.toBeNull();
      const own = proof.lines.filter(l => l.verification_id === h.verification_id);
      const writes = f.entries.filter(e => e.disposition === 'write' &&
        Number(e.batch_index) === Number(h.batch_index));
      expect(writes.length).toBeGreaterThan(0);
      for (const entry of writes) {
        expect(own.filter(l => l.shopify_inventory_item_gid === entry.shopify_inventory_item_gid)).toHaveLength(1);
      }
      if (h.verdict === 'applied') {
        expect(state.batchExecutions.find(b => Number(b.batch_index) === Number(h.batch_index))?.status).toBe('succeeded');
      }
    }
    for (const batch of state.batchExecutions.filter(b => b.status === 'succeeded')) {
      expect(proof.headers.some(h => h.status === 'complete' && h.verdict === 'applied' &&
        Number(h.batch_index) === Number(batch.batch_index))).toBe(true);
    }
  }
});

async function ambiguousFixture(shape: FrozenShape = 'one_batch'): Promise<Ambiguous> {
  const f = await freezeGeneration(shape);
  const provider = fakeShopify('fixture-original-ambiguous-dispatch', [async () => { throw noResponseError(); }]);
  const output = await requireExecutor()({ shopId: f.fixture.shopId, generationId: f.generationId },
    { createShopifyGraphQLClient: provider.createShopifyGraphQLClient });
  expect(output).toMatchObject({ outcome: 'ambiguous' });
  expect(provider.calls).toHaveLength(1);
  const baseline = await executionState(f.fixture.shopId, f.generationId);
  expect(baseline.batchExecutions[0].status).toBe('ambiguous');
  expect(baseline.attempts).toHaveLength(1);
  expect(baseline.attempts[0].outcome).toBe('no_response');
  expect(baseline.attempts[0].finalized_at).not.toBeNull();
  // Authorized disposable fixture state: allow the recovery caller to reclaim
  // the otherwise live E02 lease. Never alter request/business quantities.
  await withTenant(f.fixture.shopId, trx => trx(EXECUTIONS)
    .where({ execution_id: baseline.executions[0].execution_id })
    .update({ lease_expires_at: trx.raw("now() - interval '1 second'") }));
  const result = { ...f, baseline };
  observed.push(result);
  expect(await evidence(f)).toEqual({ headers: [], lines: [] });
  await expectSliceDUnchanged(f);
  return result;
}

function readLevels(f: Frozen, mode: 'target' | 'old' = 'target'): ProviderLevel[] {
  return f.entries.filter(e => e.disposition !== 'provider_only_zero').map(e => ({
    itemGid: e.shopify_inventory_item_gid, variantGid: e.shopify_variant_gid,
    onHand: Number(mode === 'target' ? e.target_quantity : e.observed_on_hand_quantity),
  }));
}
function reader(f: Frozen, handlers?: ProviderHandler[]) {
  const p = fakeShopify('recovery-readback', handlers ?? [async () => providerPage(f.fixture, readLevels(f))]);
  recoveryProviders.push(p);
  return p;
}
function params(f: Frozen, batchIndex = 1) {
  return { shopId: f.fixture.shopId, generationId: f.generationId, batchIndex };
}
async function recover(f: Frozen, p: ReturnType<typeof reader>, batchIndex = 1,
  leaseDurationMs?: number) {
  return requireRecovery()(params(f, batchIndex), {
    createShopifyGraphQLClient: p.createShopifyGraphQLClient, leaseDurationMs,
  });
}
function successful(settled: Settled) {
  if ('error' in settled) throw settled.error;
  return settled.value;
}
async function expectVerdict(f: Frozen, verdict: string, lineVerdicts: string[]) {
  const proof = await evidence(f);
  expect(proof.headers).toHaveLength(1);
  const h = proof.headers[0];
  expect(h).toMatchObject({ purpose: 'ambiguity_inspection', batch_index: 1,
    status: 'complete', verdict, shop_gid: f.fixture.shopGid,
    location_gid: f.fixture.locationGid, requested_api_version: FROZEN_API_VERSION,
    served_api_version: FROZEN_API_VERSION, readiness_passed: true,
    target_fingerprint: f.generation.target_fingerprint,
    identity_fingerprint: f.generation.identity_fingerprint });
  expect(h.page_count).toBeGreaterThan(0);
  expect(h.finalized_by_lease_token).toBe(h.started_by_lease_token);
  expect(h.read_completed_at).not.toBeNull();
  const own = proof.lines.filter(l => f.entries.some(e => e.disposition === 'write' &&
    Number(e.batch_index) === 1 && e.shopify_inventory_item_gid === l.shopify_inventory_item_gid));
  expect(own.map(l => l.line_verdict).sort()).toEqual([...lineVerdicts].sort());
  for (const line of own) {
    const entry = f.entries.find(e => e.shopify_inventory_item_gid === line.shopify_inventory_item_gid);
    expect(line.expected_target).toBe(entry.target_quantity);
    expect(line.frozen_change_from).toBe(entry.observed_on_hand_quantity);
  }
  const state = await executionState(f.fixture.shopId, f.generationId);
  const batch = state.batchExecutions[0];
  expect(batch.status).toBe(verdict === 'applied' ? 'succeeded' : 'ambiguous');
  expect(batch.shopify_adjustment_group_id).toBeNull();
  if (verdict === 'applied') expect(batch.succeeded_at).not.toBeNull();
  else expect(batch.succeeded_at).toBeNull();
  expect(state.executions[0].status).toBe(verdict === 'mixed' ? 'blocked' : 'executing');
  if (verdict === 'mixed') {
    expectNoLease(state.executions[0]);
    expect(state.executions[0].blocked_at).not.toBeNull();
    expect(state.executions[0].blocked_reason).toMatch(/RECOVER|AMBIGU/i);
  }
  return proof;
}
async function expectFailedRead(f: Frozen) {
  const proof = await evidence(f);
  expect(proof.headers).toHaveLength(1);
  expect(proof.headers[0]).toMatchObject({ status: 'failed', verdict: null });
  expect(proof.headers[0].finalized_by_lease_token).not.toBeNull();
  expect(proof.headers[0].read_completed_at).not.toBeNull();
  const state = await executionState(f.fixture.shopId, f.generationId);
  expect(state.executions[0].status).toBe('executing');
  expect(state.batchExecutions[0].status).toBe('ambiguous');
}

// Authority mutations are explicit disposable fixture stimuli, never fixes.
type DriftKind = 'installation' | 'shop_gid' | 'scope' | 'mapping' | 'readiness' | 'target' | 'identity';
async function changeAuthority(f: Frozen, kind: DriftKind) {
  const fixture = f.fixture;
  if (kind === 'target') return seedTruth(fixture, { quantity: 5 });
  if (kind === 'readiness') return seedTruth(fixture, { locationCode: fixture.rootCode, quantity: 1 });
  return withTenant(fixture.shopId, async trx => {
    let count = 0;
    if (kind === 'installation') count = await trx('shopify_app_installations')
      .where({ shop_id: fixture.shopId }).whereNull('uninstalled_at').update({ uninstalled_at: trx.fn.now() });
    if (kind === 'shop_gid') count = await trx('shopify_app_installations')
      .where({ shop_id: fixture.shopId }).whereNull('uninstalled_at')
      .update({ shop_gid: `gid://shopify/Shop/${fixture.shopId}999` });
    if (kind === 'scope') {
      // Completed snapshots are immutable. Remove the opening cohort's
      // current authority through permitted fixture task purpose drift.
      count = await trx('inventory_recount_tasks')
        .where({ shop_id: fixture.shopId, purpose: 'opening_inventory' })
        .update({ purpose: 'cycle_count' });
      expect(count).toBeGreaterThan(0);
      return;
    }
    if (kind === 'mapping') count = await trx('warehouses').where({ warehouse_id: fixture.warehouseId })
      .update({ external_location_id: `30${fixture.shopId}` });
    if (kind === 'identity') count = await trx('external_product_identity_map')
      .where({ shop_id: fixture.shopId, lasyncro_variant_id: fixture.variantId, platform: 'shopify' })
      .update({ external_inventory_item_id: `${fixture.shopId}777` });
    expect(count).toBe(1);
  });
}
async function expectRegeneration(f: Frozen) {
  const s = await executionState(f.fixture.shopId, f.generationId);
  expect(s.executions[0].status).toBe('requires_regeneration');
  expect(s.executions[0].terminal_at).not.toBeNull();
  expectNoLease(s.executions[0]);
  expect(s.batchExecutions[0].status).toBe('ambiguous');
}

// No test catches the controlled RED gate: expected RED must be a real failure.
describe('GH-1179 E03A — one ambiguous immutable batch recovery (RED)', () => {
  it('A01 target reread => applied/succeeded; no fabricated mutation identity', async () => {
    const f = await ambiguousFixture();
    await recover(f, reader(f));
    await expectVerdict(f, 'applied', ['match']);
  });
  it('A02 old reread => not_applied; still ambiguous; never pending/resend', async () => {
    const f = await ambiguousFixture();
    await recover(f, reader(f, [async () => providerPage(f.fixture, readLevels(f, 'old'))]));
    await expectVerdict(f, 'not_applied', ['old_state']);
  });
  it('A02b zero old quantity is evidence, not missing/falsey', async () => {
    const f = await ambiguousFixture('two_lines');
    await recover(f, reader(f, [async () => providerPage(f.fixture, readLevels(f, 'old'))]));
    const proof = await expectVerdict(f, 'not_applied', ['old_state', 'old_state']);
    expect(proof.lines.filter(l => l.line_verdict === 'old_state').every(l => l.observed_on_hand === 0)).toBe(true);
  });
  it('A03 neither target nor old => mixed/blocked', async () => {
    const f = await ambiguousFixture();
    await recover(f, reader(f, [async () => providerPage(f.fixture,
      [{ itemGid: f.fixture.itemGid, onHand: 5 }])]));
    await expectVerdict(f, 'mixed', ['mismatch']);
  });
  it('A04 target+old within the same batch => mixed, no partial retry', async () => {
    const f = await ambiguousFixture('two_lines');
    const levels = readLevels(f);
    levels[1].onHand = Number(f.entries.find(e => e.shopify_inventory_item_gid === levels[1].itemGid).observed_on_hand_quantity);
    await recover(f, reader(f, [async () => providerPage(f.fixture, levels)]));
    await expectVerdict(f, 'mixed', ['match', 'old_state']);
  });
  for (const kind of ['inactive', 'untracked', 'missing', 'unknown_active', 'unknown_tracked'] as const) {
    it(`A05 ${kind} cannot certify target equality`, async () => {
      const f = await ambiguousFixture(kind === 'missing' ? 'zero_target' : 'one_batch');
      const page: any = providerPage(f.fixture, readLevels(f));
      const node = page.data.location.inventoryLevels.nodes[0];
      if (kind === 'inactive') node.isActive = false;
      if (kind === 'untracked') node.item.tracked = false;
      if (kind === 'missing') page.data.location.inventoryLevels.nodes = [];
      if (kind === 'unknown_active') node.isActive = null;
      if (kind === 'unknown_tracked') node.item.tracked = null;
      await recover(f, reader(f, [async () => page]));
      const expected = kind === 'inactive' || kind === 'untracked' ? kind : 'mismatch';
      const proof = await expectVerdict(f, 'mixed', [expected]);
      const line = proof.lines.find(l => l.shopify_inventory_item_gid === f.fixture.itemGid);
      if (kind === 'missing') expect(line).toMatchObject({ level_present: false, observed_on_hand: null });
      if (kind === 'unknown_active') expect(line.active).toBeNull();
      if (kind === 'unknown_tracked') expect(line.tracked).toBeNull();
    });
  }
  for (const quantity of [0, 7]) {
    it(`A06 unknown extra on_hand=${quantity} is durable contextual/scope evidence`, async () => {
      const f = await ambiguousFixture();
      const extra = `gid://shopify/InventoryItem/${f.fixture.shopId}9999`;
      await recover(f, reader(f, [async () => providerPage(f.fixture,
        [...readLevels(f), { itemGid: extra, variantGid: null, onHand: quantity }])]));
      const proof = await expectVerdict(f, quantity === 0 ? 'applied' : 'mixed', ['match']);
      expect(proof.lines.find(l => l.shopify_inventory_item_gid === extra)).toMatchObject({
        line_verdict: 'unknown_item', observed_on_hand: quantity, expected_target: null,
        frozen_change_from: null, level_present: true });
    });
  }
  it('A07 complete 3-page read for 251 writes; recover first batch only', async () => {
    const f = await ambiguousFixture('two_batches');
    const levels = readLevels(f);
    const p = reader(f, [0, 100, 200].map((offset, index) => async call => {
      expect(call.options.variables).toEqual({ locationId: f.fixture.locationGid,
        first: 100, after: index === 0 ? null : `cursor-${index}` });
      expect(call.document).toMatch(/includeInactive:\s*true/);
      expect(call.document).toMatch(/quantities\(names:\s*\["on_hand"\]\)/);
      expect(call.document).not.toMatch(/inventoryQuantity|\bproducts\s*\(|\bproductVariants\s*\(/);
      const page = providerPage(f.fixture, levels.slice(offset, offset + 100));
      page.data.location.inventoryLevels.pageInfo = { hasNextPage: index < 2,
        endCursor: index < 2 ? `cursor-${index + 1}` : null };
      return page;
    }));
    await recover(f, p);
    const proof = await expectVerdict(f, 'applied', Array(250).fill('match'));
    expect(proof.headers[0].page_count).toBe(3);
    expect(p.calls).toHaveLength(3);
    const state = await executionState(f.fixture.shopId, f.generationId);
    expect(state.batchExecutions[1]).toEqual(f.baseline.batchExecutions[1]);
    expect(proof.lines.find(l => l.shopify_inventory_item_gid === levels[250].itemGid)?.line_verdict).not.toBe('unknown_item');
  });
  it('A08 frozen API version overrides changed environment, retries=0', async () => {
    const f = await ambiguousFixture();
    process.env.SHOPIFY_API_VERSION = DIFFERENT_API_VERSION;
    const p = reader(f);
    await recover(f, p);
    expect(p.clients).toHaveLength(1);
    expect(p.clients[0]).toMatchObject({ shopId: f.fixture.shopId,
      platformShopName: f.fixture.shopDomain, apiVersion: FROZEN_API_VERSION });
    expect(p.calls[0].options.retries).toBe(0);
    await expectVerdict(f, 'applied', ['match']);
  });
  for (const fault of ['missing_version', 'wrong_version', 'changing_version',
    'wrong_location', 'missing_location', 'inactive_location', 'graphql',
    'transport', 'missing_quantity', 'malformed', 'stalled_cursor', 'duplicate', 'page2_failure']) {
    it(`A09 ${fault} fails closed with NULL verdict`, async () => {
      const f = await ambiguousFixture();
      const first: any = providerPage(f.fixture, readLevels(f));
      const second: any = providerPage(f.fixture, []);
      if (fault === 'missing_version') first.headers = {};
      if (fault === 'wrong_version') first.headers = { 'X-Shopify-API-Version': [DIFFERENT_API_VERSION] };
      if (fault === 'wrong_location') first.data.location.id = `gid://shopify/Location/${f.fixture.shopId}999`;
      if (fault === 'missing_location') first.data.location = null;
      if (fault === 'inactive_location') first.data.location.isActive = false;
      if (fault === 'graphql') first.errors = [{ message: 'synthetic read error' }];
      if (fault === 'missing_quantity') first.data.location.inventoryLevels.nodes[0].quantities = [];
      if (fault === 'malformed') first.data.location.inventoryLevels.pageInfo = {};
      if (fault === 'duplicate') first.data.location.inventoryLevels.nodes.push(first.data.location.inventoryLevels.nodes[0]);
      const multipage = ['changing_version', 'stalled_cursor', 'page2_failure'].includes(fault);
      if (multipage) first.data.location.inventoryLevels.pageInfo = { hasNextPage: true, endCursor: 'cursor-1' };
      if (fault === 'changing_version') second.headers = { 'X-Shopify-API-Version': [DIFFERENT_API_VERSION] };
      if (fault === 'stalled_cursor') second.data.location.inventoryLevels.pageInfo = { hasNextPage: true, endCursor: 'cursor-1' };
      const p = reader(f, [async () => { if (fault === 'transport') throw noResponseError(); return first; },
        async () => { if (fault === 'page2_failure') throw noResponseError(); return second; }]);
      await recover(f, p);
      await expectFailedRead(f);
      expect(p.calls).toHaveLength(multipage ? 2 : 1);
    });
  }
  const driftKinds: DriftKind[] = ['installation', 'shop_gid', 'scope', 'mapping', 'readiness', 'target', 'identity'];
  for (const kind of driftKinds) {
    it(`A10 pre-read ${kind} drift => regeneration, zero reads`, async () => {
      const f = await ambiguousFixture();
      await changeAuthority(f, kind);
      const p = reader(f);
      await recover(f, p);
      expect(p.calls).toHaveLength(0);
      await expectRegeneration(f);
      expect((await evidence(f)).headers).toHaveLength(0);
    });
    it(`A11 post-read ${kind} drift rejects otherwise matching targets`, async () => {
      const f = await ambiguousFixture();
      const gate = deferred<unknown>();
      const p = reader(f, [() => gate.promise]);
      const recovery = requireRecovery();
      const run = track(recovery(params(f), { createShopifyGraphQLClient: p.createShopifyGraphQLClient }));
      try {
        await waitForProviderCalls(p, 1, run, 'post-read drift hold');
        await changeAuthority(f, kind);
        gate.resolve(providerPage(f.fixture, readLevels(f)));
        successful(await run.done);
        await expectRegeneration(f);
        const proof = await evidence(f);
        expect(proof.headers).toHaveLength(1);
        expect(proof.headers[0]).toMatchObject({ status: 'failed', verdict: null });
        expect(proof.lines.find(l => l.shopify_inventory_item_gid === f.fixture.itemGid))
          .toMatchObject({ observed_on_hand: 3, expected_target: 3, frozen_change_from: 8 });
      } finally { gate.resolve(providerPage(f.fixture, readLevels(f))); await run.done; }
    });
  }
  it('A12 pre-read RR retains one snapshot; post-read snapshot catches concurrent truth commit', async () => {
    const f = await ambiguousFixture();
    const recovery = requireRecovery();
    const p = reader(f);
    const release = deferred<void>();
    const locked = deferred<number>();
    const blocker = withTenant(f.fixture.shopId, async trx => {
      await trx.raw('LOCK TABLE inventory_truth IN ACCESS EXCLUSIVE MODE');
      locked.resolve(Number((await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid));
      await release.promise;
      const changed = await trx('inventory_truth').where({ shop_id: f.fixture.shopId,
        lasyncro_variant_id: f.fixture.variantId, location_code: f.fixture.a1 })
        .update({ on_hand_quantity: 4, available_quantity: 4, updated_at: trx.fn.now() });
      expect(changed).toBe(1);
    });
    let run: ReturnType<typeof track> | undefined;
    try {
      const blockerPid = await locked.promise;
      run = track(recovery(params(f), { createShopifyGraphQLClient: p.createShopifyGraphQLClient }));
      await waitFor(async () => {
        if (run!.state.settled) throw new Error(`recovery settled before RR wait: ${describeOutcome(run!.state.settled)}`);
        const parked = await coord.raw(`SELECT backend_xmin IS NOT NULL AS has_snapshot
          FROM pg_stat_activity WHERE datname=current_database() AND pid NOT IN (?, ?)
          AND ? = ANY(pg_blocking_pids(pid))`, [blockerPid, coordPid, blockerPid]);
        return parked.rows.find((r: any) => r.has_snapshot);
      }, 'RR snapshot waiting on truth');
      expect(p.calls).toHaveLength(0);
      release.resolve(); await blocker;
      successful(await run.done);
      expect(p.calls).toHaveLength(1); // pre-read RR saw frozen 3, not newly committed 4
      await expectRegeneration(f); // fresh post-read snapshot sees 4
      expect((await evidence(f)).headers[0]).toMatchObject({ status: 'failed', verdict: null });
    } finally { release.resolve(); await blocker; if (run) await run.done; }
  });
  it('A13 collecting header committed before provider wait; no DB transaction across I/O', async () => {
    const f = await ambiguousFixture();
    const recovery = requireRecovery();
    const gate = deferred<unknown>();
    const p = reader(f, [() => gate.promise]);
    const run = track(recovery(params(f), { createShopifyGraphQLClient: p.createShopifyGraphQLClient }));
    try {
      await waitForProviderCalls(p, 1, run, 'committed collecting evidence');
      const proof = await evidence(f);
      expect(proof.headers).toHaveLength(1);
      expect(proof.headers[0]).toMatchObject({ status: 'collecting', verdict: null,
        purpose: 'ambiguity_inspection', batch_index: 1, finalized_by_lease_token: null });
      expect(proof.lines).toHaveLength(0);
      const active = await coord.raw(`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>? AND xact_start IS NOT NULL
        AND state='idle in transaction'`, [coordPid]);
      expect(active.rows).toHaveLength(0);
      expect((await executionState(f.fixture.shopId, f.generationId)).batchExecutions[0].status).toBe('ambiguous');
      gate.resolve(providerPage(f.fixture, readLevels(f)));
      successful(await run.done);
      await expectVerdict(f, 'applied', ['match']);
    } finally { gate.resolve(providerPage(f.fixture, readLevels(f))); await run.done; }
  });
  it('A14 overlapping recovery callers yield one owner/read/verification', async () => {
    const f = await ambiguousFixture();
    const recovery = requireRecovery();
    const gate = deferred<unknown>();
    const a = reader(f, [() => gate.promise]);
    const b = reader(f);
    const run = track(recovery(params(f), { createShopifyGraphQLClient: a.createShopifyGraphQLClient }));
    try {
      await waitForProviderCalls(a, 1, run, 'owner A recovery');
      const competitor = await recovery(params(f), { createShopifyGraphQLClient: b.createShopifyGraphQLClient });
      expect(competitor).toMatchObject({ outcome: 'busy' });
      expect(b.calls).toHaveLength(0);
      expect(run.state.settled).toBeNull();
      expect((await evidence(f)).headers).toHaveLength(1);
      gate.resolve(providerPage(f.fixture, readLevels(f)));
      successful(await run.done);
      await expectVerdict(f, 'applied', ['match']);
    } finally { gate.resolve(providerPage(f.fixture, readLevels(f))); await run.done; }
  });
  for (const staleResult of ['target', 'old', 'mixed', 'authority_drift'] as const) {
    it(`A15 reclaimed owner cannot finalize late ${staleResult} read`, async () => {
      const f = await ambiguousFixture();
      const recovery = requireRecovery();
      const gate = deferred<unknown>();
      const a = reader(f, [() => gate.promise]);
      const b = reader(f, [async () => providerPage(f.fixture,
        readLevels(f, staleResult === 'authority_drift' ? 'old' : 'target'))]);
      const run = track(recovery(params(f), { createShopifyGraphQLClient: a.createShopifyGraphQLClient,
        leaseDurationMs: OWNER_A_LEASE_MS }));
      try {
        await waitForProviderCalls(a, 1, run, 'owner A stale read');
        const oldProof = await evidence(f);
        const state = await executionState(f.fixture.shopId, f.generationId);
        await waitForLeaseExpiry(f.fixture.shopId, state.executions[0].execution_id);
        await recovery(params(f), { createShopifyGraphQLClient: b.createShopifyGraphQLClient });
        const accepted = await evidence(f);
        const acceptedState = await executionState(f.fixture.shopId, f.generationId);
        expect(accepted.headers).toHaveLength(2);
        const abandoned = accepted.headers.find(h => h.verification_id === oldProof.headers[0].verification_id);
        expect(abandoned).toMatchObject({ status: 'abandoned', verdict: null });
        expect(abandoned.finalized_by_lease_token).not.toBe(abandoned.started_by_lease_token);
        expect(accepted.lines.some(l => l.verification_id === abandoned.verification_id)).toBe(false);
        expect(b.calls).toHaveLength(1);
        if (staleResult === 'authority_drift') await changeAuthority(f, 'target');
        const levels = readLevels(f, staleResult === 'old' ? 'old' : 'target');
        if (staleResult === 'mixed') levels[0].onHand = 5;
        gate.resolve(providerPage(f.fixture, levels));
        expect(describeOutcome(await run.done)).toMatch(STALE_CLAIM);
        expect(await evidence(f)).toEqual(accepted);
        expect(await executionState(f.fixture.shopId, f.generationId).then(s => s.batchExecutions))
          .toEqual(acceptedState.batchExecutions);
        const after = await executionState(f.fixture.shopId, f.generationId);
        expect(after.executions[0].status).toBe('executing');
        expect(after.executions[0].lease_token).toBe(acceptedState.executions[0].lease_token);
      } finally { gate.resolve(providerPage(f.fixture, readLevels(f))); await run.done; }
    });
  }
  it('A16 lease expiry without reclaim prevents authoritative finalization', async () => {
    const f = await ambiguousFixture();
    const recovery = requireRecovery();
    const gate = deferred<unknown>();
    const p = reader(f, [() => gate.promise]);
    const run = track(recovery(params(f), { createShopifyGraphQLClient: p.createShopifyGraphQLClient,
      leaseDurationMs: OWNER_A_LEASE_MS }));
    try {
      await waitForProviderCalls(p, 1, run, 'expiry read hold');
      const before = await evidence(f);
      const s = await executionState(f.fixture.shopId, f.generationId);
      await waitForLeaseExpiry(f.fixture.shopId, s.executions[0].execution_id);
      gate.resolve(providerPage(f.fixture, readLevels(f)));
      expect(describeOutcome(await run.done)).toMatch(STALE_CLAIM);
      expect(await evidence(f)).toEqual(before);
      expect((await executionState(f.fixture.shopId, f.generationId)).batchExecutions[0].status).toBe('ambiguous');
    } finally { gate.resolve(providerPage(f.fixture, readLevels(f))); await run.done; }
  });
  it('A17a repeat applied recovery preserves terminal evidence with zero reread', async () => {
    const f = await ambiguousFixture();
    await recover(f, reader(f));
    await expectVerdict(f, 'applied', ['match']);
    const before = await evidence(f);
    const batches = (await executionState(f.fixture.shopId, f.generationId)).batchExecutions;
    const second = reader(f);
    await recover(f, second);
    expect(second.calls).toHaveLength(0);
    expect(await evidence(f)).toEqual(before);
    expect((await executionState(f.fixture.shopId, f.generationId)).batchExecutions).toEqual(batches);
  });
  it('A17b repeat not_applied uses a new read, never resends or overwrites evidence', async () => {
    const f = await ambiguousFixture();
    await recover(f, reader(f, [async () => providerPage(f.fixture, readLevels(f, 'old'))]));
    await expectVerdict(f, 'not_applied', ['old_state']);
    const first = await evidence(f);
    // Make the next caller eligible to reclaim without changing evidence.
    await withTenant(f.fixture.shopId, trx => trx(EXECUTIONS)
      .where({ generation_id: f.generationId })
      .update({ lease_expires_at: trx.raw("now() - interval '1 second'") }));
    const second = reader(f, [async () => providerPage(f.fixture, readLevels(f, 'old'))]);
    await recover(f, second);
    expect(second.calls).toHaveLength(1);
    const after = await evidence(f);
    expect(after.headers).toHaveLength(2);
    expect(after.headers.find(h => h.verification_id === first.headers[0].verification_id)).toEqual(first.headers[0]);
    expect(after.lines.filter(l => l.verification_id === first.headers[0].verification_id)).toEqual(first.lines);
    expect(after.headers.every(h => h.status === 'complete' && h.verdict === 'not_applied')).toBe(true);
    expect((await executionState(f.fixture.shopId, f.generationId)).batchExecutions[0].status).toBe('ambiguous');
  });
  it('A18a wrong tenant cannot read/finalize another tenant batch', async () => {
    const f = await ambiguousFixture();
    const other = await ambiguousFixture();
    const recovery = requireRecovery();
    const before = await evidence(f);
    const state = await executionState(f.fixture.shopId, f.generationId);
    const p = reader(other);
    await track(recovery({ ...params(f), shopId: other.fixture.shopId },
      { createShopifyGraphQLClient: p.createShopifyGraphQLClient })).done;
    expect(p.calls).toHaveLength(0);
    expect(await evidence(f)).toEqual(before);
    const after = await executionState(f.fixture.shopId, f.generationId);
    expect(after.executions).toEqual(state.executions);
    expect(after.batchExecutions).toEqual(state.batchExecutions);
    expect(await evidence(other)).toEqual({ headers: [], lines: [] });
  });
  for (const index of [2, 999]) {
    it(`A18b batch ${index} is pending/nonexistent, not eligible for ambiguity recovery`, async () => {
      const f = await ambiguousFixture('two_batches');
      const recovery = requireRecovery();
      const before = await evidence(f);
      const batches = (await executionState(f.fixture.shopId, f.generationId)).batchExecutions;
      const p = reader(f);
      await track(recovery(params(f, index), { createShopifyGraphQLClient: p.createShopifyGraphQLClient })).done;
      expect(p.calls).toHaveLength(0);
      expect(await evidence(f)).toEqual(before);
      expect((await executionState(f.fixture.shopId, f.generationId)).batchExecutions).toEqual(batches);
    });
  }
});
