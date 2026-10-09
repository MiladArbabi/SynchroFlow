// GH-1179 Slice E / E02 — Opening Inventory cutover EXECUTOR core.
//
// RED contract only. The executor module does not exist yet; a controlled
// runtime loader turns its absence into [E02_RED_GATE] rather than a static
// module-resolution / TypeScript failure. Every behaviour case builds its full
// real-Postgres fixture BEFORE reaching the gate, so RED also proves fixtures.
//
// Locked by this suite:
// - claim / reclaim under a DB-time lease; stale owners cannot write;
// - pre-dispatch REPEATABLE READ revalidation of current local authority;
// - durable dispatch intent COMMITTED before provider I/O;
// - exactly the persisted Slice-D request, pinned to its requested API version,
//   with no hidden SDK retries;
// - success / userErrors / no-response / abort / 5xx / served-version
//   mismatch / reclaim-abandon persistence;
// - sequential batches: at most one provider call in flight per generation;
// - E02 never converges and never writes opening_inventory_shopify_synced_at;
// - Slice-D generation authority is never mutated.
//
// Shopify is dependency-injected only. The real client module is mocked
// fail-closed so this suite cannot create external provider traffic.

const mockShopifyRequest = jest.fn(async (..._args: unknown[]) => {
  throw new Error(
    '[GH1179_E02_TEST] default Shopify transport must not be reached'
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
import {
  GraphqlQueryError,
  HttpInternalError,
  HttpRequestError,
} from '@shopify/shopify-api';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

import { encrypt } from 'api-src/security/encryption.service';
import { SHOPIFY_REQUIRED_SCOPE_STRING, normalizeAndValidateShopifyGrantedScopes } from 'api-src/services/shopify/shopifyScopes';

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

// Owner A's injected lease. Long enough to claim + revalidate + commit the
// dispatch attempt; short enough that the test can observe real expiry.
const OWNER_A_LEASE_MS = 3000;

const STALE_CLAIM = /STALE|LEASE|CLAIM/i;
const BUSY_OR_STALE = /BUSY|STALE|LEASE|CLAIM|OWN/i;

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

  throw new Error(`[GH1179_E02_TEST] waitFor timed out: ${label}`);
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
              `[GH1179_E02_TEST] unexpected provider call #${calls.length} on ${label}`
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

function mutationSuccess(
  adjustmentGroupId: string,
  options: { served?: string; requestId?: string } = {}
) {
  return {
    data: {
      inventorySetQuantities: {
        inventoryAdjustmentGroup: { id: adjustmentGroupId },
        userErrors: [],
      },
    },
    extensions: {},
    headers: {
      'X-Shopify-API-Version': [options.served ?? FROZEN_API_VERSION],
      'X-Request-Id': [options.requestId ?? `e02-${crypto.randomUUID()}`],
    },
  };
}

function mutationUserErrors(userErrors: unknown[]) {
  return {
    data: {
      inventorySetQuantities: {
        inventoryAdjustmentGroup: null,
        userErrors,
      },
    },
    extensions: {},
    headers: {
      'X-Shopify-API-Version': [FROZEN_API_VERSION],
      'X-Request-Id': ['e02-user-errors'],
    },
  };
}

// The SDK's own classification when no HTTP response exists.
function noResponseError(): Error {
  return new HttpRequestError(
    'Http request error, no response available: [GH1179_E02_TEST] simulated lost response'
  );
}

// Fetch/AbortSignal timeout shape.
function abortError(): Error {
  const error = new Error('[GH1179_E02_TEST] This operation was aborted');
  error.name = 'AbortError';
  return error;
}

// The SDK's own classification of an HTTP 5xx.
function internalServerError(): Error {
  return new HttpInternalError({
    message: '[GH1179_E02_TEST] Shopify internal server error',
    code: 503,
    statusText: 'Service Unavailable',
    body: {},
    headers: { 'X-Request-Id': ['e02-5xx'] },
  });
}

// The SDK's own top-level GraphQL failure (HTTP 200 + body.errors), as thrown
// by throwFailedRequest. Its message deliberately carries no "GraphQL" or
// userError wording and its name is plain "Error": only the error TYPE
// identifies it.
const TOP_LEVEL_ERROR_MESSAGE =
  '[GH1179_E02_TEST] synthetic top-level execution failure';

function topLevelGraphqlError(): Error {
  const headers = {
    'X-Request-Id': ['e02-12b'],
    'X-Shopify-API-Version': [FROZEN_API_VERSION],
  };

  return new GraphqlQueryError({
    message: TOP_LEVEL_ERROR_MESSAGE,
    response: new Response(null, {
      status: 200,
      headers: {
        'X-Request-Id': 'e02-12b',
        'X-Shopify-API-Version': FROZEN_API_VERSION,
      },
    }) as unknown as Record<string, unknown>,
    headers,
    body: {
      errors: {
        message: TOP_LEVEL_ERROR_MESSAGE,
        graphQLErrors: [
          {
            message: TOP_LEVEL_ERROR_MESSAGE,
            path: ['inventorySetQuantities'],
          },
        ],
      },
    },
  });
}

function adjustmentGroupGid(shopId: number, suffix: number): string {
  return `gid://shopify/InventoryAdjustmentGroup/${shopId}${String(
    suffix
  ).padStart(4, '0')}`;
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
    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: shopDomain,
      shop_gid: shopGid,
      scopes: 'read_products,write_inventory',
    }).returning('id');

    await trx('shopify_admin_credentials').insert({
      shop_id: shopId,
      installation_id: installation.id,
      access_token_encrypted: encrypt(accessToken),
      refresh_token_encrypted: encrypt('e02-canonical-refresh-no-network-call'),
      access_expires_at: new Date(Date.now() + 86400000),
      refresh_expires_at: new Date(Date.now() + 2592000000),
      granted_scopes: normalizeAndValidateShopifyGrantedScopes(SHOPIFY_REQUIRED_SCOPE_STRING),
      credential_state: 'ACTIVE',
      credential_generation: '1',
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
    throw new Error('[GH1179_E02_TEST] opening cohort bins missing');
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
      throw new Error('[GH1179_E02_TEST] fixture product missing');
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

type FrozenShape = 'one_batch' | 'two_batches' | 'zero_write';

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

  if (shape === 'one_batch') {
    // target 3, Shopify on_hand 8 → one write, one batch.
    await makeCountedReady(fixture, 3);
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
    const extras = await seedAdditionalTargets(fixture, 250, 1);
    levels = [
      { itemGid: fixture.itemGid, variantGid: fixture.variantGid, onHand: 0 },
      ...extras.map((extra) => ({
        itemGid: extra.itemGid,
        variantGid: extra.variantGid,
        onHand: 0,
      })),
    ];
    expectedBatches = 2;
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
          throw new Error('[GH1179_E02_TEST] generation reader exhausted');
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

function expectLiveLease(execution: any, dbNow: Date): void {
  expect(execution.lease_token).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  expect(execution.lease_expires_at).not.toBeNull();
  expect(new Date(execution.lease_expires_at).getTime()).toBeGreaterThan(
    new Date(dbNow).getTime()
  );
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
        `[GH1179_E02_TEST] executor settled before ${label}: ${describeOutcome(
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

// ─── reclaim scaffolding (E02-14 / E02-15 / E02-16) ─────────────────────────

// Owner A claims with a short injected lease, durably commits its dispatch
// attempt and blocks inside the provider call. The lease then expires for real
// (DB time) while A's provider request is still in flight.
async function startBlockedOwnerA(frozen: Frozen) {
  const execute = requireExecutor();
  const { shopId } = frozen.fixture;

  const gateA = deferred<unknown>();
  const providerA = fakeShopify('owner-A', [() => gateA.promise]);

  const runA = track(
    execute(
      { shopId, generationId: frozen.generationId },
      {
        createShopifyGraphQLClient: providerA.createShopifyGraphQLClient,
        leaseDurationMs: OWNER_A_LEASE_MS,
      }
    )
  );

  await waitForProviderCalls(providerA, 1, runA, 'owner A provider call');

  const inFlight = await executionState(shopId, frozen.generationId);

  expect(inFlight.executions).toHaveLength(1);
  expect(inFlight.attempts).toHaveLength(1);

  const executionId = String(inFlight.executions[0].execution_id);
  const leaseA = String(inFlight.executions[0].lease_token);

  expect(inFlight.attempts[0].finalized_at).toBeNull();
  expect(inFlight.attempts[0].dispatch_lease_token).toBe(leaseA);
  expect(inFlight.batchExecutions[0].status).toBe('dispatching');

  await waitForLeaseExpiry(shopId, executionId);

  // A is still genuinely in flight after its lease expired.
  expect(providerA.calls[0].settled).toBe(false);
  expect(runA.state.settled).toBeNull();

  return { execute, gateA, providerA, runA, executionId, leaseA };
}

async function reclaimAsOwnerB(
  frozen: Frozen,
  execute: ExecuteGeneration
) {
  const providerB = fakeShopify('owner-B');

  const runB = track(
    execute(
      { shopId: frozen.fixture.shopId, generationId: frozen.generationId },
      { createShopifyGraphQLClient: providerB.createShopifyGraphQLClient }
    )
  );

  const settledB = await runB.done;

  return { providerB, settledB };
}

describe('GH-1179 Slice E / E02 — opening inventory cutover executor core', () => {
  it('E02-01 — exposes executeOpeningInventoryCutoverGeneration from the executor service module', () => {
    expect(typeof requireExecutor()).toBe('function');
  });

  it('E02-02 — first claim creates one leased execution and one batch-execution row per immutable batch', async () => {
    const frozen = await freezeGeneration('two_batches');
    const { shopId } = frozen.fixture;
    const execute = requireExecutor();

    const gate = deferred<unknown>();
    const provider = fakeShopify('e02-02', [() => gate.promise]);

    const run = track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    );

    try {
      // Observed while the first provider call is unresolved: authority does
      // not depend on provider success.
      await waitForProviderCalls(provider, 1, run, 'first dispatch');

      const state = await executionState(shopId, frozen.generationId);

      expect(state.executions).toHaveLength(1);

      const execution = state.executions[0];

      expect(Number(execution.shop_id)).toBe(shopId);
      expect(execution.generation_id).toBe(frozen.generationId);
      expect(execution.status).toBe('executing');
      expectLiveLease(execution, state.dbNow);

      expect(
        state.batchExecutions.map((row: any) => ({
          generation_id: row.generation_id,
          shop_id: Number(row.shop_id),
          batch_index: Number(row.batch_index),
          execution_id: row.execution_id,
        }))
      ).toEqual(
        frozen.batches.map((batch: any) => ({
          generation_id: batch.generation_id,
          shop_id: Number(batch.shop_id),
          batch_index: Number(batch.batch_index),
          execution_id: execution.execution_id,
        }))
      );

      expect(state.batchExecutions[0].status).toBe('dispatching');
      expect(state.batchExecutions[1].status).toBe('pending');
      expect(Number(state.batchExecutions[1].attempt_count)).toBe(0);
    } finally {
      gate.reject(noResponseError());
      await run.done;
    }

    // A later call for the same generation never creates a second execution.
    const second = fakeShopify('e02-02-second');

    await track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: second.createShopifyGraphQLClient }
      )
    ).done;

    const after = await executionState(shopId, frozen.generationId);

    expect(after.executions).toHaveLength(1);
    expect(after.batchExecutions).toHaveLength(2);
    expect(second.calls).toHaveLength(0);
    expect(provider.calls).toHaveLength(1);
  });

  it('E02-03 — dispatch attempt is committed and externally visible BEFORE provider I/O resolves', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;
    const execute = requireExecutor();

    const gate = deferred<unknown>();
    const provider = fakeShopify('e02-03', [() => gate.promise]);

    const run = track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    );

    try {
      await waitForProviderCalls(provider, 1, run, 'blocked dispatch');

      // Independent connection: only COMMITTED rows are visible here.
      const state = await executionState(shopId, frozen.generationId);

      expect(state.executions).toHaveLength(1);

      const execution = state.executions[0];

      expect(execution.status).toBe('executing');
      expectLiveLease(execution, state.dbNow);

      expect(state.batchExecutions).toHaveLength(1);
      expect(state.batchExecutions[0].status).toBe('dispatching');
      expect(Number(state.batchExecutions[0].attempt_count)).toBe(1);

      expect(state.attempts).toHaveLength(1);

      const attempt = state.attempts[0];

      expect(attempt.finalized_at).toBeNull();
      expect(attempt.outcome).toBeNull();
      expect(Number(attempt.attempt_number)).toBe(1);
      expect(attempt.request_sha256).toBe(frozen.batches[0].request_sha256);
      expect(attempt.requested_api_version).toBe(
        frozen.batches[0].requested_api_version
      );
      expect(attempt.dispatch_lease_token).toBe(execution.lease_token);

      // No executor transaction is held open across provider I/O.
      const openTransactions = await coord.raw(
        `SELECT pid, state, left(query, 200) AS query
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND state LIKE 'idle in transaction%'`
      );

      expect(openTransactions.rows).toEqual([]);
      expect(provider.calls[0].settled).toBe(false);
      expect(run.state.settled).toBeNull();
    } finally {
      gate.resolve(mutationSuccess(adjustmentGroupGid(shopId, 3)));
      await run.done;
    }
  });

  it('E02-04 — sends exactly the persisted Slice-D document and canonical variables', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;
    const batch = frozen.batches[0];

    // Fixture sanity: absolute target 3 against frozen on_hand evidence 8.
    expect(frozen.entries).toHaveLength(1);
    expect(frozen.entries[0].target_quantity).toBe(3);
    expect(frozen.entries[0].observed_on_hand_quantity).toBe(8);

    const execute = requireExecutor();

    const provider = fakeShopify('e02-04', [
      async () => mutationSuccess(adjustmentGroupGid(shopId, 4)),
    ]);

    await track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    ).done;

    expect(provider.calls).toHaveLength(1);

    const call = provider.calls[0];
    const persistedVariables = JSON.parse(batch.canonical_variables);

    expect(call.document).toBe(batch.graphql_document);
    expect(call.options.variables).toEqual(persistedVariables);
    expect(call.options.variables.idempotencyKey).toBe(batch.idempotency_key);

    expect(call.options.variables.input.name).toBe('on_hand');
    expect(call.options.variables.input.quantities).toEqual([
      {
        inventoryItemId: frozen.fixture.itemGid,
        locationId: frozen.fixture.locationGid,
        quantity: 3,
        changeFromQuantity: 8,
      },
    ]);

    expect(JSON.stringify(call.options.variables)).not.toMatch(
      /"delta"|"available"|"changes"/
    );
  });

  it('E02-05 — client is pinned to the persisted requested_api_version with no hidden SDK retries', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;
    const batch = frozen.batches[0];

    expect(batch.requested_api_version).toBe(FROZEN_API_VERSION);

    const execute = requireExecutor();

    const provider = fakeShopify('e02-05', [
      async () => mutationSuccess(adjustmentGroupGid(shopId, 5)),
    ]);

    // The process-global version moves after freeze; executor authority must
    // come from the frozen batch, not the environment.
    process.env.SHOPIFY_API_VERSION = DIFFERENT_API_VERSION;

    try {
      await track(
        execute(
          { shopId, generationId: frozen.generationId },
          { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
        )
      ).done;
    } finally {
      process.env.SHOPIFY_API_VERSION = FROZEN_API_VERSION;
    }

    expect(provider.calls).toHaveLength(1);
    expect(provider.clients.length).toBeGreaterThanOrEqual(1);

    for (const client of provider.clients) {
      expect(client).toMatchObject({
        apiVersion: batch.requested_api_version,
        shopId,
        platformShopName: frozen.fixture.shopDomain,
        accessToken: frozen.fixture.accessToken,
      });
    }

    // @shopify/admin-api-client + graphql-client default retries = 0; any
    // explicit override must also be 0.
    for (const call of provider.calls) {
      expect(call.options.retries ?? 0).toBe(0);
    }
  });

  describe('E02-06 — pre-dispatch current-authority revalidation', () => {
    async function expectRequiresRegeneration(
      frozen: Frozen,
      label: string
    ): Promise<void> {
      const { shopId } = frozen.fixture;
      const execute = requireExecutor();
      const provider = fakeShopify(label);

      await track(
        execute(
          { shopId, generationId: frozen.generationId },
          { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
        )
      ).done;

      expect(provider.calls).toHaveLength(0);

      const state = await executionState(shopId, frozen.generationId);

      expect(state.executions).toHaveLength(1);
      expect(state.executions[0].generation_id).toBe(frozen.generationId);
      expect(state.executions[0].status).toBe('requires_regeneration');
      expect(state.executions[0].terminal_at).not.toBeNull();
      expectNoLease(state.executions[0]);
      expect(state.attempts).toHaveLength(0);

      await expectSliceDUnchanged(frozen);
      await expectCompletionMarkerNull(shopId);
    }

    it('E02-06a — current physical truth changed after freeze → requires_regeneration, zero provider calls', async () => {
      const frozen = await freezeGeneration('one_batch');

      await seedTruth(frozen.fixture, { quantity: 5 });

      await expectRequiresRegeneration(frozen, 'e02-06a');
    });

    it('E02-06b — active installation stable Shop GID changed → requires_regeneration, zero provider calls', async () => {
      const frozen = await freezeGeneration('one_batch');
      const { shopId } = frozen.fixture;

      const updated = await withTenant(shopId, (trx) =>
        trx('shopify_app_installations')
          .where({ shop_id: shopId })
          .whereNull('uninstalled_at')
          .update({ shop_gid: `gid://shopify/Shop/${shopId}999` })
      );

      expect(updated).toBe(1);

      await expectRequiresRegeneration(frozen, 'e02-06b');
    });

    it('E02-06c — participating warehouse Shopify Location mapping changed → requires_regeneration, zero provider calls', async () => {
      const frozen = await freezeGeneration('one_batch');
      const { shopId } = frozen.fixture;

      const updated = await withTenant(shopId, (trx) =>
        trx('warehouses')
          .where({ shop_id: shopId, warehouse_id: frozen.fixture.warehouseId })
          .update({ external_location_id: `30${shopId}` })
      );

      expect(updated).toBe(1);

      await expectRequiresRegeneration(frozen, 'e02-06c');
    });

    it('E02-06d — Shopify item identity mapping changed → requires_regeneration, zero provider calls', async () => {
      const frozen = await freezeGeneration('one_batch');
      const { shopId } = frozen.fixture;

      const updated = await withTenant(shopId, (trx) =>
        trx('external_product_identity_map')
          .where({
            shop_id: shopId,
            lasyncro_variant_id: frozen.fixture.variantId,
            platform: 'shopify',
          })
          .update({ external_inventory_item_id: `${shopId}777` })
      );

      expect(updated).toBe(1);

      await expectRequiresRegeneration(frozen, 'e02-06d');
    });

    it('E02-06e — revalidation reads one REPEATABLE READ snapshot while physical truth changes concurrently', async () => {
      const frozen = await freezeGeneration('one_batch');
      const { shopId } = frozen.fixture;
      const execute = requireExecutor();

      const provider = fakeShopify('e02-06e', [
        async () => mutationSuccess(adjustmentGroupGid(shopId, 6)),
      ]);

      let releaseBlocker: () => void = () => undefined;
      const blockerReleased = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });

      let markBlockerLocked: (pid: number) => void = () => undefined;
      const blockerLocked = new Promise<number>((resolve) => {
        markBlockerLocked = resolve;
      });

      let blocker: Promise<void> | null = null;
      let run: ReturnType<typeof track> | null = null;

      try {
        // Blocker parks every reader of inventory_truth, then commits a
        // fingerprint-changing truth mutation 3 -> 4 while the executor's
        // revalidation transaction (snapshot already taken by its tenant
        // set_config) is still waiting.
        blocker = withTenant(shopId, async (trx) => {
          const pid = await trx.raw('SELECT pg_backend_pid() AS pid');

          await trx.raw('LOCK TABLE inventory_truth IN ACCESS EXCLUSIVE MODE');

          markBlockerLocked(Number(pid.rows[0].pid));

          await blockerReleased;

          const changed = await trx('inventory_truth')
            .where({
              shop_id: shopId,
              lasyncro_variant_id: frozen.fixture.variantId,
              location_code: frozen.fixture.a1,
            })
            .update({
              on_hand_quantity: 4,
              available_quantity: 4,
              updated_at: new Date(),
            });

          if (changed !== 1) {
            throw new Error('[GH1179_E02_TEST] concurrent truth row not updated');
          }
        });

        const blockerPid = await Promise.race([
          blockerLocked,
          blocker.then(() => {
            throw new Error('[GH1179_E02_TEST] blocker ended before locking');
          }),
        ]);

        run = track(
          execute(
            { shopId, generationId: frozen.generationId },
            { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
          )
        );

        const activeRun = run;

        const parked = await waitFor(async () => {
          if (activeRun.state.settled) {
            throw new Error(
              '[GH1179_E02_TEST] executor settled before revalidation was observed parked: ' +
                describeOutcome(activeRun.state.settled)
            );
          }

          const result = await coord.raw(
            `SELECT a.pid, a.wait_event_type, a.backend_xmin IS NOT NULL AS has_snapshot
               FROM pg_stat_activity a
              WHERE a.datname = current_database()
                AND a.backend_type = 'client backend'
                AND a.pid NOT IN (?, ?)
                AND ? = ANY(pg_blocking_pids(a.pid))
              LIMIT 1`,
            [blockerPid, coordPid, blockerPid]
          );

          return result.rows[0] ?? null;
        }, 'executor revalidation parked on inventory_truth');

        expect(parked.wait_event_type).toBe('Lock');
        expect(provider.calls).toHaveLength(0);

        releaseBlocker();
        await blocker;

        const committed = await coordTenant(shopId, (trx) =>
          trx('inventory_truth')
            .where({
              shop_id: shopId,
              lasyncro_variant_id: frozen.fixture.variantId,
              location_code: frozen.fixture.a1,
            })
            .first('on_hand_quantity')
        );

        expect(Number(committed.on_hand_quantity)).toBe(4);

        await run.done;
      } finally {
        releaseBlocker();

        if (blocker) {
          await blocker.catch(() => undefined);
        }

        if (run) {
          await run.done;
        }
      }

      // The snapshot taken before the concurrent commit still matches the
      // frozen target; a READ COMMITTED re-read would have seen 4 and stopped.
      expect(provider.calls).toHaveLength(1);

      const state = await executionState(shopId, frozen.generationId);

      expect(state.executions).toHaveLength(1);
      expect(state.executions[0].status).not.toBe('requires_regeneration');
      expect(state.batchExecutions[0].status).toBe('succeeded');

      await expectSliceDUnchanged(frozen);
    });
  });

  it('E02-07 / E02-19 / E02-20 — provider success finalizes once, batch succeeds monotonically, execution → verifying, no marker, Slice-D unchanged', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;
    const execute = requireExecutor();

    const groupId = adjustmentGroupGid(shopId, 7);

    const provider = fakeShopify('e02-07', [
      async () =>
        mutationSuccess(groupId, { requestId: 'e02-07-request-id' }),
    ]);

    await track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    ).done;

    expect(provider.calls).toHaveLength(1);

    const state = await executionState(shopId, frozen.generationId);
    const execution = state.executions[0];

    expect(state.attempts).toHaveLength(1);

    const attempt = state.attempts[0];

    expect(attempt.outcome).toBe('succeeded');
    expect(attempt.finalized_at).not.toBeNull();
    expect(attempt.finalized_by_lease_token).toBe(attempt.dispatch_lease_token);
    expect(attempt.served_api_version).toBe(FROZEN_API_VERSION);
    expect(attempt.x_request_id).toBe('e02-07-request-id');
    expect(attempt.shopify_adjustment_group_id).toBe(groupId);
    expect(attempt.user_errors).toBeNull();

    const batch = state.batchExecutions[0];

    expect(batch.status).toBe('succeeded');
    expect(batch.succeeded_at).not.toBeNull();
    expect(batch.shopify_adjustment_group_id).toBe(groupId);
    expect(Number(batch.attempt_count)).toBe(1);

    expect(execution.status).toBe('verifying');
    expectLiveLease(execution, state.dbNow);

    await expectCompletionMarkerNull(shopId);
    await expectSliceDUnchanged(frozen);

    // Monotonic: a later executor call neither resends nor rewrites success.
    const again = fakeShopify('e02-07-again');

    await track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: again.createShopifyGraphQLClient }
      )
    ).done;

    const after = await executionState(shopId, frozen.generationId);

    expect(again.calls).toHaveLength(0);
    expect(after.attempts).toEqual(state.attempts);
    expect(after.batchExecutions).toEqual(state.batchExecutions);
    expect(after.executions[0].status).toBe('verifying');
  });

  it('E02-08 — served API version mismatch never certifies the batch: ambiguous, no resend, recoverable', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;
    const execute = requireExecutor();

    const provider = fakeShopify('e02-08', [
      async () =>
        mutationSuccess(adjustmentGroupGid(shopId, 8), {
          served: DIFFERENT_API_VERSION,
          requestId: 'e02-08-request-id',
        }),
    ]);

    await track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    ).done;

    expect(provider.calls).toHaveLength(1);

    const state = await executionState(shopId, frozen.generationId);

    expect(state.attempts).toHaveLength(1);

    const attempt = state.attempts[0];

    expect(attempt.finalized_at).not.toBeNull();
    expect(attempt.outcome).not.toBeNull();
    expect(attempt.outcome).not.toBe('succeeded');
    expect(attempt.served_api_version).toBe(DIFFERENT_API_VERSION);
    expect(String(attempt.error_class ?? '')).not.toBe('');

    const batch = state.batchExecutions[0];

    expect(batch.status).toBe('ambiguous');
    expect(batch.succeeded_at).toBeNull();

    // Recoverable: still executing (blocked has no outgoing transition).
    expect(state.executions[0].status).toBe('executing');

    await expectCompletionMarkerNull(shopId);
    await expectSliceDUnchanged(frozen);
  });

  it('E02-09 / E02-19 / E02-20 — any mutation userError is definite rejection: batch rejected, execution blocked, lease cleared, next batch never dispatched', async () => {
    const frozen = await freezeGeneration('two_batches');
    const { shopId } = frozen.fixture;
    const execute = requireExecutor();

    // Deliberately unclassified: no userError code is treated as stale CAS.
    const userErrors = [
      {
        field: ['input', 'quantities', '0', 'quantity'],
        message: '[GH1179_E02_TEST] synthetic unclassified user error',
        code: 'E02_UNCLASSIFIED_TEST_CODE',
      },
    ];

    const provider = fakeShopify('e02-09', [
      async () => mutationUserErrors(userErrors),
    ]);

    await track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    ).done;

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].options.variables.idempotencyKey).toBe(
      frozen.batches[0].idempotency_key
    );

    const state = await executionState(shopId, frozen.generationId);

    expect(state.attempts).toHaveLength(1);

    const attempt = state.attempts[0];

    expect(Number(attempt.batch_index)).toBe(1);
    expect(attempt.outcome).toBe('user_errors');
    expect(attempt.finalized_at).not.toBeNull();
    expect(attempt.user_errors).toEqual(userErrors);

    const first = state.batchExecutions.find(
      (row: any) => Number(row.batch_index) === 1
    );

    expect(first.status).toBe('rejected');
    expect(first.succeeded_at).toBeNull();

    const second = state.batchExecutions.find(
      (row: any) => Number(row.batch_index) === 2
    );

    if (second) {
      expect(second.status).toBe('pending');
      expect(Number(second.attempt_count)).toBe(0);
    }

    const execution = state.executions[0];

    expect(execution.status).toBe('blocked');
    expect(execution.blocked_at).not.toBeNull();
    expectNoLease(execution);

    await expectCompletionMarkerNull(shopId);
    await expectSliceDUnchanged(frozen);
  });

  it('E02-10 / E02-19 / E02-20 — no response is ambiguous: no_response, no resend, execution incomplete', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;
    const execute = requireExecutor();

    const provider = fakeShopify('e02-10', [
      async () => {
        throw noResponseError();
      },
    ]);

    await track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    ).done;

    expect(provider.calls).toHaveLength(1);

    const state = await executionState(shopId, frozen.generationId);

    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0].outcome).toBe('no_response');
    expect(state.attempts[0].finalized_at).not.toBeNull();

    expect(state.batchExecutions[0].status).toBe('ambiguous');
    expect(Number(state.batchExecutions[0].attempt_count)).toBe(1);
    expect(state.executions[0].status).toBe('executing');

    await expectCompletionMarkerNull(shopId);
    await expectSliceDUnchanged(frozen);
  });

  it('E02-11 — abort / timeout is ambiguous: aborted, no resend', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;
    const execute = requireExecutor();

    const provider = fakeShopify('e02-11', [
      async () => {
        throw abortError();
      },
    ]);

    await track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    ).done;

    expect(provider.calls).toHaveLength(1);

    const state = await executionState(shopId, frozen.generationId);

    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0].outcome).toBe('aborted');
    expect(state.attempts[0].finalized_at).not.toBeNull();

    expect(state.batchExecutions[0].status).toBe('ambiguous');
    expect(state.executions[0].status).toBe('executing');

    await expectCompletionMarkerNull(shopId);
  });

  it('E02-12 — HTTP 5xx is ambiguous: http_error, no automatic retry', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;
    const execute = requireExecutor();

    const provider = fakeShopify('e02-12', [
      async () => {
        throw internalServerError();
      },
    ]);

    await track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    ).done;

    expect(provider.calls).toHaveLength(1);

    const state = await executionState(shopId, frozen.generationId);

    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0].outcome).toBe('http_error');
    expect(state.attempts[0].http_status).toBe(503);
    expect(state.attempts[0].finalized_at).not.toBeNull();

    expect(state.batchExecutions[0].status).toBe('ambiguous');
    expect(state.executions[0].status).toBe('executing');

    await expectCompletionMarkerNull(shopId);
  });

  it('E02-12b — top-level GraphQL error is ambiguous, not a userErrors rejection: graphql_error, no resend, lease kept', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;

    // Fixture guard: classification must come from the SDK error type.
    const probe = topLevelGraphqlError();

    expect(probe).toBeInstanceOf(GraphqlQueryError);
    expect(probe).not.toBeInstanceOf(HttpRequestError);
    expect(probe).not.toBeInstanceOf(HttpInternalError);
    expect(probe.name).toBe('Error');
    expect(probe.message).not.toMatch(/graphql|user ?errors?/i);

    const execute = requireExecutor();

    const provider = fakeShopify('e02-12b', [
      async () => {
        throw topLevelGraphqlError();
      },
    ]);

    await track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    ).done;

    expect(provider.calls).toHaveLength(1);

    const state = await executionState(shopId, frozen.generationId);

    expect(state.attempts).toHaveLength(1);

    const attempt = state.attempts[0];

    expect(attempt.outcome).toBe('graphql_error');
    expect(attempt.finalized_at).not.toBeNull();
    expect(attempt.finalized_by_lease_token).not.toBeNull();
    expect(String(attempt.error_class ?? '')).not.toBe('');
    expect(attempt.user_errors).toBeNull();

    const batch = state.batchExecutions[0];

    expect(batch.status).toBe('ambiguous');
    expect(batch.succeeded_at).toBeNull();
    expect(batch.shopify_adjustment_group_id).toBeNull();
    expect(Number(batch.attempt_count)).toBe(1);

    const execution = state.executions[0];

    expect(execution.status).toBe('executing');
    expect(execution.blocked_at).toBeNull();
    expectLiveLease(execution, state.dbNow);

    await expectCompletionMarkerNull(shopId);
    await expectSliceDUnchanged(frozen);
  });

  it('E02-13 — two genuinely overlapping executors: one lease owner, one attempt, one provider call', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;
    const execute = requireExecutor();

    const gate = deferred<unknown>();

    // Shared provider: a second dispatch from either executor would surface
    // as an unexpected call.
    const provider = fakeShopify('e02-13', [() => gate.promise]);

    let releaseBlocker: () => void = () => undefined;
    const blockerReleased = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    let markBlockerLocked: (pid: number) => void = () => undefined;
    const blockerLocked = new Promise<number>((resolve) => {
      markBlockerLocked = resolve;
    });

    let blocker: Promise<void> | null = null;
    const runs: Array<ReturnType<typeof track>> = [];

    try {
      // Blocker holds the generation row FOR UPDATE. Every claim must insert
      // an execution row whose FK check takes FOR KEY SHARE on that row, so
      // both claims queue concurrently at the database.
      blocker = withTenant(shopId, async (trx) => {
        const pid = await trx.raw('SELECT pg_backend_pid() AS pid');

        const locked = await trx(GENERATIONS)
          .where({ shop_id: shopId, generation_id: frozen.generationId })
          .forUpdate()
          .select('generation_id');

        if (locked.length !== 1) {
          throw new Error('[GH1179_E02_TEST] generation row not locked');
        }

        markBlockerLocked(Number(pid.rows[0].pid));
        await blockerReleased;
      });

      const blockerPid = await Promise.race([
        blockerLocked,
        blocker.then(() => {
          throw new Error('[GH1179_E02_TEST] blocker ended before locking');
        }),
      ]);

      for (let i = 0; i < 2; i += 1) {
        runs.push(
          track(
            execute(
              { shopId, generationId: frozen.generationId },
              { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
            )
          )
        );
      }

      const contenders = await waitFor(async () => {
        if (runs.every((run) => run.state.settled)) {
          throw new Error(
            '[GH1179_E02_TEST] both executors settled before overlap was observed: ' +
              runs.map((run) => describeOutcome(run.state.settled)).join(' | ')
          );
        }

        const result = await coord.raw(
          `SELECT a.pid, a.wait_event_type, pg_blocking_pids(a.pid) AS blockers
             FROM pg_stat_activity a
            WHERE a.datname = current_database()
              AND a.backend_type = 'client backend'
              AND a.pid NOT IN (?, ?)
              AND cardinality(pg_blocking_pids(a.pid)) > 0`,
          [blockerPid, coordPid]
        );

        return result.rows.length >= 2 ? result.rows : null;
      }, 'both executor claims blocked concurrently');

      expect(
        contenders.some((row: any) =>
          (row.blockers as number[]).map(Number).includes(blockerPid)
        )
      ).toBe(true);
      expect(provider.calls).toHaveLength(0);

      releaseBlocker();
      await blocker;

      // Winner reaches provider I/O; loser settles while the winner is still
      // in flight — it decided without any provider call of its own.
      await waitFor(
        () =>
          provider.calls.length === 1 &&
          runs.filter((run) => run.state.settled).length === 1
            ? true
            : null,
        'winner in flight and loser settled'
      );

      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0].settled).toBe(false);

      const loser = runs.find((run) => run.state.settled)!;

      expect(describeOutcome(loser.state.settled)).toMatch(BUSY_OR_STALE);

      const state = await executionState(shopId, frozen.generationId);

      expect(state.executions).toHaveLength(1);
      expectLiveLease(state.executions[0], state.dbNow);
      expect(state.attempts).toHaveLength(1);
      expect(state.attempts[0].dispatch_lease_token).toBe(
        state.executions[0].lease_token
      );
    } finally {
      releaseBlocker();

      if (blocker) {
        await blocker.catch(() => undefined);
      }

      gate.resolve(mutationSuccess(adjustmentGroupGid(shopId, 13)));
      await Promise.all(runs.map((run) => run.done));
    }

    expect(provider.calls).toHaveLength(1);
    expect(provider.concurrency.max).toBe(1);
  });

  it('E02-14 — expired lease is reclaimed with a new token; stale owner A cannot apply its rejection', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;

    const ownerA = await startBlockedOwnerA(frozen);

    try {
      const { providerB } = await reclaimAsOwnerB(frozen, ownerA.execute);

      expect(providerB.calls).toHaveLength(0);

      const reclaimed = await executionState(shopId, frozen.generationId);

      expect(reclaimed.executions).toHaveLength(1);

      const execution = reclaimed.executions[0];

      expect(String(execution.execution_id)).toBe(ownerA.executionId);
      expect(execution.status).toBe('executing');
      expectLiveLease(execution, reclaimed.dbNow);
      expect(execution.lease_token).not.toBe(ownerA.leaseA);

      const leaseB = String(execution.lease_token);

      // A's provider call now returns a definite rejection under a dead lease.
      ownerA.gateA.resolve(
        mutationUserErrors([
          {
            field: ['input'],
            message: '[GH1179_E02_TEST] stale owner rejection',
            code: 'E02_UNCLASSIFIED_TEST_CODE',
          },
        ])
      );

      const settledA = await ownerA.runA.done;

      expect(describeOutcome(settledA)).toMatch(STALE_CLAIM);

      const after = await executionState(shopId, frozen.generationId);

      expect(after.executions[0].status).toBe('executing');
      expect(after.executions[0].lease_token).toBe(leaseB);
      expect(after.executions[0].blocked_at).toBeNull();
      expect(after.batchExecutions[0].status).not.toBe('rejected');
      expect(after.attempts).toHaveLength(1);
      expect(after.attempts[0].outcome).not.toBe('user_errors');
      expect(after.attempts[0].user_errors).toBeNull();
      expect(after.attempts[0].finalized_by_lease_token).toBe(leaseB);
    } finally {
      ownerA.gateA.reject(noResponseError());
      await ownerA.runA.done;
    }

    expect(ownerA.providerA.calls).toHaveLength(1);
  });

  it('E02-15 — reclaim of an unfinished dispatch abandons it exactly once as ambiguous with zero resend', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;

    const ownerA = await startBlockedOwnerA(frozen);

    try {
      const { providerB } = await reclaimAsOwnerB(frozen, ownerA.execute);

      expect(providerB.calls).toHaveLength(0);

      const state = await executionState(shopId, frozen.generationId);
      const leaseB = String(state.executions[0].lease_token);

      expect(leaseB).not.toBe(ownerA.leaseA);

      expect(state.attempts).toHaveLength(1);

      const attempt = state.attempts[0];

      expect(attempt.outcome).toBe('abandoned');
      expect(attempt.finalized_at).not.toBeNull();
      expect(attempt.finalized_by_lease_token).toBe(leaseB);
      expect(attempt.dispatch_lease_token).toBe(ownerA.leaseA);

      const batch = state.batchExecutions[0];

      expect(batch.status).toBe('ambiguous');
      expect(Number(batch.attempt_count)).toBe(1);

      // Not a pretend failure: verification/recovery is deferred.
      expect(state.executions[0].status).toBe('executing');
      expect(state.executions[0].blocked_at).toBeNull();

      ownerA.gateA.reject(noResponseError());

      const settledA = await ownerA.runA.done;

      expect(describeOutcome(settledA)).toMatch(STALE_CLAIM);

      const after = await executionState(shopId, frozen.generationId);

      expect(after.attempts).toEqual(state.attempts);
      expect(after.batchExecutions[0].status).toBe('ambiguous');
    } finally {
      ownerA.gateA.reject(noResponseError());
      await ownerA.runA.done;
    }

    expect(ownerA.providerA.calls).toHaveLength(1);
    await expectCompletionMarkerNull(shopId);
    await expectSliceDUnchanged(frozen);
  });

  it('E02-16 / E02-20 — stale owner A provider success cannot overwrite B\'s reclaim', async () => {
    const frozen = await freezeGeneration('one_batch');
    const { shopId } = frozen.fixture;

    const ownerA = await startBlockedOwnerA(frozen);

    try {
      const { providerB } = await reclaimAsOwnerB(frozen, ownerA.execute);

      // Genuine overlap: B claimed, abandoned and settled while A's provider
      // request was still unresolved.
      expect(providerB.calls).toHaveLength(0);
      expect(ownerA.providerA.calls[0].settled).toBe(false);
      expect(ownerA.runA.state.settled).toBeNull();

      const reclaimed = await executionState(shopId, frozen.generationId);
      const leaseB = String(reclaimed.executions[0].lease_token);

      expect(leaseB).not.toBe(ownerA.leaseA);
      expect(reclaimed.attempts[0].outcome).toBe('abandoned');
      expect(reclaimed.batchExecutions[0].status).toBe('ambiguous');

      // A's request now returns apparent success under a dead lease.
      ownerA.gateA.resolve(
        mutationSuccess(adjustmentGroupGid(shopId, 16), {
          requestId: 'e02-16-stale-success',
        })
      );

      const settledA = await ownerA.runA.done;

      expect(describeOutcome(settledA)).toMatch(STALE_CLAIM);

      const after = await executionState(shopId, frozen.generationId);

      expect(after.attempts).toEqual(reclaimed.attempts);
      expect(after.attempts[0].outcome).toBe('abandoned');
      expect(after.attempts[0].finalized_by_lease_token).toBe(leaseB);
      expect(after.attempts[0].shopify_adjustment_group_id).toBeNull();

      expect(after.batchExecutions[0].status).toBe('ambiguous');
      expect(after.batchExecutions[0].succeeded_at).toBeNull();
      expect(after.batchExecutions[0].shopify_adjustment_group_id).toBeNull();

      expect(after.executions[0].status).toBe('executing');
      expect(after.executions[0].lease_token).toBe(leaseB);
    } finally {
      ownerA.gateA.reject(noResponseError());
      await ownerA.runA.done;
    }

    expect(ownerA.providerA.calls).toHaveLength(1);
    await expectCompletionMarkerNull(shopId);
    await expectSliceDUnchanged(frozen);
  });

  it('E02-17 / E02-19 / E02-20 — batches dispatch sequentially (max provider concurrency 1); all succeeded → verifying with live lease', async () => {
    const frozen = await freezeGeneration('two_batches');
    const { shopId } = frozen.fixture;
    const execute = requireExecutor();

    const gate = deferred<unknown>();

    const provider = fakeShopify('e02-17', [
      () => gate.promise,
      async () => mutationSuccess(adjustmentGroupGid(shopId, 172)),
    ]);

    const run = track(
      execute(
        { shopId, generationId: frozen.generationId },
        { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
      )
    );

    try {
      await waitForProviderCalls(provider, 1, run, 'batch 1 in flight');

      const inFlight = await executionState(shopId, frozen.generationId);

      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0].options.variables.idempotencyKey).toBe(
        frozen.batches[0].idempotency_key
      );

      const second = inFlight.batchExecutions.find(
        (row: any) => Number(row.batch_index) === 2
      );

      if (second) {
        expect(second.status).toBe('pending');
        expect(Number(second.attempt_count)).toBe(0);
      }

      expect(
        inFlight.attempts.filter((row: any) => Number(row.batch_index) === 2)
      ).toHaveLength(0);
    } finally {
      gate.resolve(mutationSuccess(adjustmentGroupGid(shopId, 171)));
      await run.done;
    }

    expect(provider.calls).toHaveLength(2);
    expect(provider.concurrency.max).toBe(1);
    expect(
      provider.calls.map((call) => call.options.variables.idempotencyKey)
    ).toEqual(frozen.batches.map((batch: any) => batch.idempotency_key));

    const state = await executionState(shopId, frozen.generationId);

    expect(state.batchExecutions.map((row: any) => row.status)).toEqual([
      'succeeded',
      'succeeded',
    ]);
    expect(state.attempts.map((row: any) => row.outcome)).toEqual([
      'succeeded',
      'succeeded',
    ]);

    expect(state.executions[0].status).toBe('verifying');
    expectLiveLease(state.executions[0], state.dbNow);

    await expectCompletionMarkerNull(shopId);
    await expectSliceDUnchanged(frozen);
  });

  describe('E02-18 — zero-write generation', () => {
    it('E02-18a / E02-19 / E02-20 — enters verifying with zero provider calls, attempts or batch executions; not completion', async () => {
      const frozen = await freezeGeneration('zero_write');
      const { shopId } = frozen.fixture;

      expect(Number(frozen.generation.write_count)).toBe(0);

      const execute = requireExecutor();
      const provider = fakeShopify('e02-18a');

      await track(
        execute(
          { shopId, generationId: frozen.generationId },
          { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
        )
      ).done;

      expect(provider.calls).toHaveLength(0);

      const state = await executionState(shopId, frozen.generationId);

      expect(state.executions).toHaveLength(1);
      expect(state.executions[0].generation_id).toBe(frozen.generationId);
      expect(state.executions[0].status).toBe('verifying');
      expectLiveLease(state.executions[0], state.dbNow);
      expect(state.batchExecutions).toHaveLength(0);
      expect(state.attempts).toHaveLength(0);

      await expectCompletionMarkerNull(shopId);
      await expectSliceDUnchanged(frozen);
    });

    it('E02-18b — still revalidates current local authority: truth changed after freeze → requires_regeneration', async () => {
      const frozen = await freezeGeneration('zero_write');
      const { shopId } = frozen.fixture;

      await seedTruth(frozen.fixture, { quantity: 5 });

      const execute = requireExecutor();
      const provider = fakeShopify('e02-18b');

      await track(
        execute(
          { shopId, generationId: frozen.generationId },
          { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
        )
      ).done;

      expect(provider.calls).toHaveLength(0);

      const state = await executionState(shopId, frozen.generationId);

      expect(state.executions).toHaveLength(1);
      expect(state.executions[0].status).toBe('requires_regeneration');
      expectNoLease(state.executions[0]);
      expect(state.attempts).toHaveLength(0);

      await expectCompletionMarkerNull(shopId);
      await expectSliceDUnchanged(frozen);
    });
  });
});
