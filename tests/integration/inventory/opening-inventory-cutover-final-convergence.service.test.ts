// GH-1179 Slice E / E04 — Opening Inventory cutover FINAL CONVERGENCE.
//
// RED contract only. The executor module exists (E02/E03); the new export
// verifyOpeningInventoryCutoverConvergence does not. A runtime lookup turns its
// absence into [E04_RED_GATE]. Every behaviour case first reaches its state
// through the committed E02 executor (a REAL verifying execution unless the
// case is explicitly about a non-verifying state), so RED proves fixtures.
//
// Locked by this suite:
// - claim mode converge: verifying + live lease → busy; expired → reclaim the
//   same row with a fresh token and abandon collecting verifications;
//   executing / blocked / requires_regeneration / converged are not work;
// - a collecting final_convergence header is committed BEFORE provider I/O;
//   V1 (RR, in memory) precedes the read; the read runs outside any
//   transaction; ONE final RR transaction captures V2, compares, and persists
//   lines + header + execution + completion marker atomically;
// - comparison universe = V2 target ∪ ALL frozen entries ∪ provider items;
//   provider_only_zero expects 0 (absent is a match); unknown provider items
//   are never ignored; old_state is never used;
// - local drift (V1 or V2) → failed + requires_regeneration; a successful
//   non-matching read → complete/not_converged + requires_regeneration;
//   transient read failure → failed, verifying + same live lease;
// - a pre-existing legacy completion marker blocks the execution;
// - zero economic mutations; Slice-D never mutated; marker NULL on every
//   non-converged path.
//
// Shopify is dependency-injected only and routed by GraphQL document, so read
// calls and economic mutation calls are counted separately. The real client
// module is mocked fail-closed.

const mockShopifyRequest = jest.fn(async (..._args: unknown[]) => {
  throw new Error(
    '[GH1179_E04_TEST] default Shopify transport must not be reached'
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
const DIFFERENT_API_VERSION = '2026-07';

// E02 fixture owner lease: long enough to claim + dispatch + mark verifying,
// short enough to expire for real (DB time) before convergence reclaims.
const FIXTURE_LEASE_MS = 2000;

// Convergence owner A lease in the reclaim / liveness cases.
const OWNER_A_LEASE_MS = 2500;

const STALE_CLAIM = /STALE|LEASE|CLAIM/i;
const BUSY_OR_STALE = /BUSY|STALE|LEASE|CLAIM|OWN/i;

const CONVERGED_REASON = 'OPENING_CUTOVER_CONVERGED';
const NOT_CONVERGED_REASON = 'OPENING_CUTOVER_FINAL_NOT_CONVERGED';
const LEGACY_MARKER_REASON = 'OPENING_CUTOVER_LEGACY_COMPLETION_MARKER_PRESENT';

// ─── controlled runtime lookup (E04-R01 RED gate) ───────────────────────────

const E04_RED_GATE =
  '[E04_RED_GATE] opening inventory cutover final convergence not implemented';

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

type Entrypoint = (
  params: { shopId: number; generationId: string },
  deps?: ExecutorDeps
) => Promise<unknown>;

function requireConvergence(): Entrypoint {
  // Runtime lookup on the existing module: no static import of the missing
  // export, so this suite compiles before E04 exists.
  const candidate = (executionModule as Record<string, unknown>)
    .verifyOpeningInventoryCutoverConvergence;

  if (typeof candidate !== 'function') {
    throw new Error(E04_RED_GATE);
  }

  return candidate as Entrypoint;
}

const executeGeneration =
  executionModule.executeOpeningInventoryCutoverGeneration as unknown as Entrypoint;

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

  throw new Error(`[GH1179_E04_TEST] waitFor timed out: ${label}`);
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

// ─── injected Shopify provider, routed by GraphQL document ──────────────────

type ProviderCall = {
  document: string;
  options: ShopifyRequestOptions;
  settled: boolean;
};

type ProviderHandler = (call: ProviderCall) => Promise<unknown>;

// Any GraphQL mutation document is economic, whether or not it is one of the
// frozen batch documents (zero-write generations have none).
function isMutationDocument(document: string): boolean {
  return /\bmutation\b/.test(document);
}

function routedShopify(
  label: string,
  params: {
    reads?: ProviderHandler[];
    mutations?: ProviderHandler[];
  } = {}
) {
  const reads = params.reads ?? [];
  const mutations = params.mutations ?? [];

  const clients: ShopifyClientArgs[] = [];
  const readCalls: ProviderCall[] = [];
  const mutationCalls: ProviderCall[] = [];
  const unknownCalls: ProviderCall[] = [];

  const createShopifyGraphQLClient = (
    args: ShopifyClientArgs
  ): InjectedShopifyClient => {
    clients.push(args);

    return {
      request: async (document, options = {}) => {
        const call: ProviderCall = { document, options, settled: false };

        let handler: ProviderHandler | undefined;
        let kind: string;

        if (document === OPENING_INVENTORY_SNAPSHOT_QUERY) {
          handler = reads[readCalls.length];
          readCalls.push(call);
          kind = 'read';
        } else if (isMutationDocument(document)) {
          handler = mutations[mutationCalls.length];
          mutationCalls.push(call);
          kind = 'mutation';
        } else {
          unknownCalls.push(call);
          kind = 'unknown-document';
        }

        try {
          if (!handler) {
            throw new Error(
              `[GH1179_E04_TEST] unexpected ${kind} provider call on ${label}`
            );
          }

          return await handler(call);
        } finally {
          call.settled = true;
        }
      },
    };
  };

  return {
    clients,
    readCalls,
    mutationCalls,
    unknownCalls,
    createShopifyGraphQLClient,
  };
}

type RoutedShopify = ReturnType<typeof routedShopify>;

function mutationSuccess(adjustmentGroupId: string) {
  return {
    data: {
      inventorySetQuantities: {
        inventoryAdjustmentGroup: { id: adjustmentGroupId },
        userErrors: [],
      },
    },
    extensions: {},
    headers: {
      'X-Shopify-API-Version': [FROZEN_API_VERSION],
      'X-Request-Id': [`e04-${crypto.randomUUID()}`],
    },
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
            message: '[GH1179_E04_TEST] synthetic rejection',
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
    'Http request error, no response available: [GH1179_E04_TEST] simulated lost response'
  );
}

function namedError(name: 'AbortError' | 'TimeoutError'): Error {
  const error = new Error(`[GH1179_E04_TEST] simulated ${name}`);
  error.name = name;
  return error;
}

function internalServerError(): Error {
  return new HttpInternalError({
    message: '[GH1179_E04_TEST] Shopify internal server error',
    code: 503,
    statusText: 'Service Unavailable',
    body: {},
    headers: { 'X-Request-Id': ['e04-5xx'] },
  });
}

function topLevelGraphqlError(): Error {
  const message = '[GH1179_E04_TEST] synthetic top-level read failure';

  return new GraphqlQueryError({
    message,
    response: new Response(null, {
      status: 200,
      headers: { 'X-Shopify-API-Version': FROZEN_API_VERSION },
    }) as unknown as Record<string, unknown>,
    headers: { 'X-Shopify-API-Version': [FROZEN_API_VERSION] },
    body: { errors: { message, graphQLErrors: [{ message }] } },
  });
}

function adjustmentGroupGid(shopId: number, suffix: number): string {
  return `gid://shopify/InventoryAdjustmentGroup/${shopId}${String(
    suffix
  ).padStart(4, '0')}`;
}

// ─── Slice-C/D fixture (patterned after the E02 / E03 suites) ───────────────

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
  shopDomain: string;
  accessToken: string;
};

async function createFixture(): Promise<Fixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1179e04-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const warehouseId = crypto.randomUUID();
  const rootCode = `E04-${unique}-ROOT`;
  const a1 = `E04-${unique}-A1`;
  const a2 = `E04-${unique}-A2`;

  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  const locationRaw = `20${shopId}`;
  const inventoryItemRaw = `${shopId}001`;
  const variantRaw = `${shopId}101`;

  const shopDomain = `gh1179e04-${unique}.myshopify.com`;
  const accessToken = `e04-offline-token-${unique}`;

  let ownerId = 0;
  let operatorId = 0;

  await withTenant(shopId, async (trx) => {
    const users = await trx('users')
      .insert([
        {
          shop_id: shopId,
          email: `e04-owner-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'owner',
        },
        {
          shop_id: shopId,
          email: `e04-operator-${unique}@example.com`,
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
      name: `Slice E04 warehouse ${unique}`,
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
      title: 'Slice E04 product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `E04-${unique}`,
      title: 'Slice E04 variant',
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
      external_sku: `E04-${unique}`,
    });

    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: shopDomain,
      shop_gid: `gid://shopify/Shop/${shopId}`,
      scopes: 'read_products,write_inventory',
    }).returning('id');

    await trx('shopify_admin_credentials').insert({
      shop_id: shopId,
      installation_id: installation.id,
      access_token_encrypted: encrypt(accessToken),
      refresh_token_encrypted: encrypt('e04-canonical-refresh-no-network-call'),
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
    a1,
    a2,
    locationGid: `gid://shopify/Location/${locationRaw}`,
    variantId,
    itemGid: `gid://shopify/InventoryItem/${inventoryItemRaw}`,
    variantGid: `gid://shopify/ProductVariant/${variantRaw}`,
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
  params: { quantity: number }
): Promise<void> {
  const now = new Date();

  await withTenant(fixture.shopId, (trx) =>
    trx('inventory_truth')
      .insert({
        shop_id: fixture.shopId,
        lasyncro_variant_id: fixture.variantId,
        location_code: fixture.a1,
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
    throw new Error('[GH1179_E04_TEST] opening cohort bins missing');
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
      throw new Error('[GH1179_E04_TEST] fixture product missing');
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
        sku: `E04-BULK-${index}-${variantId.slice(0, 8)}`,
        title: `Slice E04 bulk variant ${index}`,
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
        external_sku: `E04-BULK-${index}`,
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

// A MAPPED but non-relevant (archived variant) Shopify identity with no
// physical truth: it never enters the physical target, and the collector does
// not treat its provider evidence as unmapped.
async function seedDormantIdentity(fixture: Fixture): Promise<ExtraTarget> {
  return withTenant(fixture.shopId, async (trx) => {
    const baseVariant = await trx('variants')
      .where({ shop_id: fixture.shopId, lasyncro_variant_id: fixture.variantId })
      .select('lasyncro_product_id')
      .first();

    const variantId = crypto.randomUUID();
    const itemRaw = `${fixture.shopId}6001`;
    const variantRaw = `${fixture.shopId}6101`;

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: baseVariant.lasyncro_product_id,
      shop_id: fixture.shopId,
      sku: `E04-DORMANT-${variantId.slice(0, 8)}`,
      title: 'Slice E04 dormant variant',
      unit_cost: '1.00',
      status: 'archived',
    });

    await trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: fixture.shopId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${fixture.shopId}61`,
      external_variant_id: `gid://shopify/ProductVariant/${variantRaw}`,
      external_inventory_item_id: itemRaw,
      external_sku: 'E04-DORMANT',
    });

    return {
      variantId,
      itemGid: `gid://shopify/InventoryItem/${itemRaw}`,
      variantGid: `gid://shopify/ProductVariant/${variantRaw}`,
    };
  });
}

// ─── Shopify Location page (generation read AND E04 readback) ───────────────

type LocationLevel = {
  itemGid: string;
  variantGid?: string | null;
  onHand: number;
  // undefined → true; null → malformed (non-boolean) evidence.
  active?: boolean | null;
  tracked?: boolean | null;
};

function locationPage(
  fixture: Fixture,
  levels: LocationLevel[],
  options: {
    served?: string | null;
    hasNextPage?: boolean;
    endCursor?: string | null;
    location?: 'missing' | 'inactive' | 'mismatch';
  } = {}
) {
  const served =
    options.served === undefined ? FROZEN_API_VERSION : options.served;

  const headers = served === null ? {} : { 'X-Shopify-API-Version': [served] };

  if (options.location === 'missing') {
    return { data: { location: null }, extensions: {}, headers };
  }

  return {
    data: {
      location: {
        id:
          options.location === 'mismatch'
            ? `gid://shopify/Location/99${fixture.shopId}`
            : fixture.locationGid,
        isActive: options.location !== 'inactive',
        inventoryLevels: {
          pageInfo: {
            hasNextPage: options.hasNextPage ?? false,
            endCursor: options.endCursor ?? null,
          },
          nodes: levels.map((level, index) => ({
            id:
              `gid://shopify/InventoryLevel/${index + 1}` +
              `?inventory_item_id=${level.itemGid.split('/').pop()}`,
            isActive: level.active === undefined ? true : level.active,
            item: {
              id: level.itemGid,
              tracked: level.tracked === undefined ? true : level.tracked,
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
    extensions: {},
    headers,
  };
}

// ─── Slice-D generation + REAL E02 verifying fixture ────────────────────────

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
      .orderBy([{ column: 'generation_id' }, { column: 'ordinal' }]);

    const batches = await trx(BATCHES)
      .where({ shop_id: shopId })
      .orderBy([{ column: 'generation_id' }, { column: 'batch_index' }]);

    const sha256 = crypto
      .createHash('sha256')
      .update(JSON.stringify({ generations, entries, batches }))
      .digest('hex');

    return { generations, entries, batches, sha256 };
  });
}

// one_batch:        main write (target 3 ← 8).
// write_noop:       main write (3 ← 8) + mapped extra no_op (4 = 4).
// provider_zero:    main write (3 ← 8) + dormant mapped item at 0 →
//                   provider_only_zero.
// dormant_unlisted: main write (3 ← 8); dormant identity exists but is NOT at
//                   the Location at freeze (no frozen entry).
// zero_write:       main no_op (3 = 3), zero batches.
type FrozenShape =
  | 'one_batch'
  | 'write_noop'
  | 'provider_zero'
  | 'dormant_unlisted'
  | 'zero_write';

type Frozen = {
  fixture: Fixture;
  extra: ExtraTarget | null;
  dormant: ExtraTarget | null;
  generationId: string;
  generation: any;
  batches: any[];
  entries: any[];
};

async function freezeGeneration(shape: FrozenShape): Promise<Frozen> {
  const fixture = await createFixture();

  let extra: ExtraTarget | null = null;
  let dormant: ExtraTarget | null = null;

  const main = (onHand: number): LocationLevel => ({
    itemGid: fixture.itemGid,
    variantGid: fixture.variantGid,
    onHand,
  });

  await makeCountedReady(fixture, 3);

  let levels: LocationLevel[];
  let expectedWrites = 1;
  let expectedBatches = 1;

  if (shape === 'one_batch') {
    levels = [main(8)];
  } else if (shape === 'write_noop') {
    [extra] = await seedAdditionalTargets(fixture, 1, 4);
    levels = [
      main(8),
      { itemGid: extra.itemGid, variantGid: extra.variantGid, onHand: 4 },
    ];
  } else if (shape === 'provider_zero') {
    dormant = await seedDormantIdentity(fixture);
    levels = [
      main(8),
      { itemGid: dormant.itemGid, variantGid: dormant.variantGid, onHand: 0 },
    ];
  } else if (shape === 'dormant_unlisted') {
    dormant = await seedDormantIdentity(fixture);
    levels = [main(8)];
  } else {
    levels = [main(3)];
    expectedWrites = 0;
    expectedBatches = 0;
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
          throw new Error('[GH1179_E04_TEST] generation reader exhausted');
        }

        served = true;
        return locationPage(fixture, levels);
      },
    }
  );

  const sliceD = await sliceDState(fixture.shopId);

  expect(sliceD.generations).toHaveLength(1);

  const generation = sliceD.generations[0];

  expect(generation.status).toBe('frozen');
  expect(generation.requested_api_version).toBe(FROZEN_API_VERSION);
  expect(Number(generation.write_count)).toBe(expectedWrites);
  expect(Number(generation.batch_count)).toBe(expectedBatches);
  expect(sliceD.batches).toHaveLength(expectedBatches);

  const dispositions = sliceD.entries
    .map((entry: any) => entry.disposition)
    .sort();

  const expectedDispositions: Record<FrozenShape, string[]> = {
    one_batch: ['write'],
    write_noop: ['no_op', 'write'],
    provider_zero: ['provider_only_zero', 'write'],
    dormant_unlisted: ['write'],
    zero_write: ['no_op'],
  };

  expect(dispositions).toEqual(expectedDispositions[shape]);

  return {
    fixture,
    extra,
    dormant,
    generationId: String(generation.generation_id),
    generation,
    batches: sliceD.batches,
    entries: sliceD.entries,
  };
}

async function e04State(shopId: number, generationId: string) {
  return coordTenant(shopId, async (trx) => ({
    executions: await trx(EXECUTIONS).where({ shop_id: shopId }),

    batchExecutions: await trx(BATCH_EXECUTIONS)
      .where({ shop_id: shopId, generation_id: generationId })
      .orderBy('batch_index', 'asc'),

    attempts: await trx(ATTEMPTS)
      .where({ shop_id: shopId, generation_id: generationId })
      .orderBy([{ column: 'batch_index' }, { column: 'attempt_number' }]),

    verifications: await trx(VERIFICATIONS)
      .where({ shop_id: shopId })
      .orderBy([{ column: 'read_started_at' }, { column: 'verification_id' }]),

    lines: await trx(VERIFICATION_LINES)
      .where({ shop_id: shopId })
      .orderBy([
        { column: 'verification_id' },
        { column: 'shopify_inventory_item_gid' },
      ]),

    // Text form keeps full microsecond precision for equality checks.
    marker: (
      await trx.raw(
        `SELECT opening_inventory_shopify_synced_at::text AS synced_at
           FROM shop_wms_settings
          WHERE shop_id = ?`,
        [shopId]
      )
    ).rows[0]?.synced_at as string | null | undefined,

    dbNow: (await trx.raw('SELECT clock_timestamp() AS now')).rows[0]
      .now as Date,
  }));
}

type E04State = Awaited<ReturnType<typeof e04State>>;

type Verifying = Frozen & {
  sliceD: SliceDState;
  executionId: string;
  fixtureLease: string;
  before: E04State;
};

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
    'execution lease expired',
    { tries: 800, intervalMs: 25 }
  );
}

// REAL verifying execution through the committed E02 executor: every frozen
// batch succeeds (zero-write: no provider call). Unless `keepLive`, the E02
// owner's lease expires in DB time so convergence must reclaim.
async function prepareVerifying(
  shape: FrozenShape,
  options: { keepLive?: boolean } = {}
): Promise<Verifying> {
  const frozen = await freezeGeneration(shape);
  const { shopId } = frozen.fixture;

  const fixtureProvider = routedShopify('e02-fixture', {
    mutations: frozen.batches.map(
      (_batch: any, index: number) => async () =>
        mutationSuccess(adjustmentGroupGid(shopId, 100 + index))
    ),
  });

  await executeGeneration(
    { shopId, generationId: frozen.generationId },
    {
      createShopifyGraphQLClient: fixtureProvider.createShopifyGraphQLClient,
      leaseDurationMs: options.keepLive ? undefined : FIXTURE_LEASE_MS,
    }
  );

  expect(fixtureProvider.mutationCalls).toHaveLength(frozen.batches.length);
  expect(fixtureProvider.readCalls).toHaveLength(0);

  const prepared = await e04State(shopId, frozen.generationId);

  expect(prepared.executions).toHaveLength(1);
  expect(prepared.executions[0].status).toBe('verifying');
  expect(prepared.executions[0].lease_token).not.toBeNull();
  expect(
    prepared.batchExecutions.every((row: any) => row.status === 'succeeded')
  ).toBe(true);
  expect(prepared.verifications).toHaveLength(0);
  expect(prepared.marker).toBeNull();

  const executionId = String(prepared.executions[0].execution_id);
  const fixtureLease = String(prepared.executions[0].lease_token);

  if (!options.keepLive) {
    await waitForLeaseExpiry(shopId, executionId);
  }

  return {
    ...frozen,
    sliceD: await sliceDState(shopId),
    executionId,
    fixtureLease,
    before: await e04State(shopId, frozen.generationId),
  };
}

// REAL non-verifying executions through the committed E02 executor.
async function prepareNotVerifying(
  status: 'executing' | 'blocked' | 'requires_regeneration'
): Promise<Verifying> {
  const frozen = await freezeGeneration('one_batch');
  const { shopId } = frozen.fixture;

  if (status === 'requires_regeneration') {
    // Physical truth changed after freeze: E02 revalidation refuses dispatch.
    await seedTruth(frozen.fixture, { quantity: 5 });
  }

  const fixtureProvider = routedShopify('e02-fixture', {
    mutations:
      status === 'executing'
        ? [
            async () => {
              throw noResponseError();
            },
          ]
        : status === 'blocked'
          ? [async () => mutationUserErrors()]
          : [],
  });

  await executeGeneration(
    { shopId, generationId: frozen.generationId },
    {
      createShopifyGraphQLClient: fixtureProvider.createShopifyGraphQLClient,
      leaseDurationMs: FIXTURE_LEASE_MS,
    }
  );

  const prepared = await e04State(shopId, frozen.generationId);

  expect(prepared.executions).toHaveLength(1);
  expect(prepared.executions[0].status).toBe(status);

  const executionId = String(prepared.executions[0].execution_id);

  if (status === 'executing') {
    await waitForLeaseExpiry(shopId, executionId);
  }

  return {
    ...frozen,
    sliceD: await sliceDState(shopId),
    executionId,
    fixtureLease: String(prepared.executions[0].lease_token),
    before: await e04State(shopId, frozen.generationId),
  };
}

// ─── readback evidence / expected lines ─────────────────────────────────────

function entryFor(frozen: Frozen, itemGid: string): any {
  const entry = frozen.entries.find(
    (row: any) => row.shopify_inventory_item_gid === itemGid
  );

  if (!entry) {
    throw new Error(`[GH1179_E04_TEST] no frozen entry for ${itemGid}`);
  }

  return entry;
}

function expectedFinalTarget(entry: any): number {
  return entry.disposition === 'provider_only_zero'
    ? 0
    : Number(entry.target_quantity);
}

// Provider evidence that exactly matches the certified universe: every frozen
// write/no_op at its target, every provider_only_zero present at 0.
function matchingLevels(frozen: Frozen): LocationLevel[] {
  return frozen.entries.map((entry: any) => ({
    itemGid: String(entry.shopify_inventory_item_gid),
    variantGid: entry.shopify_variant_gid ?? null,
    onHand: expectedFinalTarget(entry),
  }));
}

function mainLevel(
  frozen: Frozen,
  overrides: Partial<LocationLevel> = {}
): LocationLevel {
  return {
    itemGid: frozen.fixture.itemGid,
    variantGid: frozen.fixture.variantGid,
    onHand: 3,
    ...overrides,
  };
}

function frozenLine(
  frozen: Frozen,
  itemGid: string,
  observed: {
    observed_on_hand: number | null;
    level_present: boolean;
    active: boolean | null;
    tracked: boolean | null;
    line_verdict: string;
  }
) {
  const entry = entryFor(frozen, itemGid);

  return {
    shopify_inventory_item_gid: itemGid,
    expected_target: expectedFinalTarget(entry),
    frozen_change_from: Number(entry.observed_on_hand_quantity),
    ...observed,
  };
}

function presentMatch(frozen: Frozen, itemGid: string) {
  const entry = entryFor(frozen, itemGid);

  return frozenLine(frozen, itemGid, {
    observed_on_hand: expectedFinalTarget(entry),
    level_present: true,
    active: true,
    tracked: true,
    line_verdict: 'match',
  });
}

function unknownLine(
  itemGid: string,
  observed: { observed_on_hand: number }
) {
  return {
    shopify_inventory_item_gid: itemGid,
    expected_target: null,
    frozen_change_from: null,
    observed_on_hand: observed.observed_on_hand,
    level_present: true,
    active: true,
    tracked: true,
    line_verdict: 'unknown_item',
  };
}

function lineShape(line: any) {
  return {
    shopify_inventory_item_gid: line.shopify_inventory_item_gid,
    expected_target: line.expected_target,
    frozen_change_from: line.frozen_change_from,
    observed_on_hand: line.observed_on_hand,
    level_present: line.level_present,
    active: line.active,
    tracked: line.tracked,
    line_verdict: line.line_verdict,
  };
}

function sortLines<T extends { shopify_inventory_item_gid: string }>(
  lines: T[]
): T[] {
  return [...lines].sort((left, right) =>
    left.shopify_inventory_item_gid < right.shopify_inventory_item_gid
      ? -1
      : left.shopify_inventory_item_gid > right.shopify_inventory_item_gid
        ? 1
        : 0
  );
}

function linesOf(state: E04State, verificationId: string) {
  return sortLines(
    state.lines
      .filter((line: any) => line.verification_id === verificationId)
      .map(lineShape)
  );
}

function finalVerifications(state: E04State): any[] {
  return state.verifications.filter(
    (row: any) => row.purpose === 'final_convergence'
  );
}

// ─── shared assertions ──────────────────────────────────────────────────────

async function runConvergence(
  verifying: Verifying,
  provider: RoutedShopify,
  leaseDurationMs?: number
) {
  const converge = requireConvergence();

  return track(
    converge(
      {
        shopId: verifying.fixture.shopId,
        generationId: verifying.generationId,
      },
      {
        createShopifyGraphQLClient: provider.createShopifyGraphQLClient,
        leaseDurationMs,
      }
    )
  );
}

async function convergeWithReads(
  verifying: Verifying,
  label: string,
  reads: ProviderHandler[],
  leaseDurationMs?: number
) {
  const provider = routedShopify(label, { reads });
  const run = await runConvergence(verifying, provider, leaseDurationMs);
  const settled = await run.done;

  return { provider, settled };
}

function expectFinalHeader(verifying: Verifying, verification: any): void {
  expect(verification.purpose).toBe('final_convergence');
  expect(verification.batch_index).toBeNull();
  expect(Number(verification.shop_id)).toBe(verifying.fixture.shopId);
  expect(String(verification.execution_id)).toBe(verifying.executionId);
  expect(verification.generation_id).toBe(verifying.generationId);
  expect(verification.requested_api_version).toBe(
    verifying.generation.requested_api_version
  );
  expect(verification.shop_gid).toBe(verifying.generation.shopify_shop_gid);
  expect(verification.location_gid).toBe(
    verifying.generation.shopify_location_gid
  );
  expect(verification.started_by_lease_token).not.toBeNull();
  expect(verification.started_by_lease_token).not.toBe(verifying.fixtureLease);
}

function expectFinalized(verification: any): void {
  expect(verification.read_completed_at).not.toBeNull();
  expect(verification.finalized_by_lease_token).not.toBeNull();
  expect(verification.finalized_by_lease_token).toBe(
    verification.started_by_lease_token
  );
}

// E04 is certification only: no economic or unknown provider document, and
// E02's attempt / batch evidence is untouched.
function expectNoEconomicMutation(
  verifying: Verifying,
  provider: RoutedShopify,
  state: E04State
): void {
  expect(provider.mutationCalls).toHaveLength(0);
  expect(provider.unknownCalls).toHaveLength(0);
  expect(state.attempts).toEqual(verifying.before.attempts);
  expect(state.batchExecutions).toEqual(verifying.before.batchExecutions);
}

function expectReadRequestsPinned(
  verifying: Verifying,
  provider: RoutedShopify
): void {
  for (const client of provider.clients) {
    expect(client).toMatchObject({
      apiVersion: verifying.generation.requested_api_version,
      shopId: verifying.fixture.shopId,
      platformShopName: verifying.fixture.shopDomain,
      accessToken: verifying.fixture.accessToken,
    });
  }

  for (const call of provider.readCalls) {
    expect(call.options.retries ?? 0).toBe(0);
    expect(call.options.variables?.locationId).toBe(
      verifying.generation.shopify_location_gid
    );
  }
}

async function expectSliceDUnchanged(verifying: Verifying): Promise<void> {
  const after = await sliceDState(verifying.fixture.shopId);

  expect(after.generations).toEqual(verifying.sliceD.generations);
  expect(after.entries).toEqual(verifying.sliceD.entries);
  expect(after.batches).toEqual(verifying.sliceD.batches);
  expect(after.sha256).toBe(verifying.sliceD.sha256);
}

async function expectAlwaysInvariants(
  verifying: Verifying,
  provider: RoutedShopify,
  state: E04State
): Promise<void> {
  expectNoEconomicMutation(verifying, provider, state);
  expectReadRequestsPinned(verifying, provider);
  await expectSliceDUnchanged(verifying);
}

function expectLiveLease(execution: any, dbNow: Date): void {
  expect(execution.lease_token).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  expect(new Date(execution.lease_expires_at).getTime()).toBeGreaterThan(
    new Date(dbNow).getTime()
  );
}

function expectLeaseCleared(execution: any): void {
  expect(execution.lease_token).toBeNull();
  expect(execution.lease_expires_at).toBeNull();
  expect(execution.lease_heartbeat_at).toBeNull();
}

function expectRequiresRegeneration(execution: any): void {
  expect(execution.status).toBe('requires_regeneration');
  expect(execution.terminal_at).not.toBeNull();
  expect(String(execution.terminal_reason ?? '')).not.toBe('');
  expectLeaseCleared(execution);
}

function expectCertifiedAuthority(
  verifying: Verifying,
  verification: any
): void {
  // The certified V2 authority equals the frozen generation authority.
  expect(verification.readiness_passed).toBe(true);
  expect(verification.target_fingerprint).toBe(
    verifying.generation.target_fingerprint
  );
  expect(verification.identity_fingerprint).toBe(
    verifying.generation.identity_fingerprint
  );
}

async function expectTimestampsEqual(
  shopId: number,
  verificationId: string
): Promise<void> {
  const row = await coordTenant(shopId, async (trx) =>
    (
      await trx.raw(
        `SELECT v.read_completed_at = e.terminal_at AS completed_eq_terminal,
                e.terminal_at = s.opening_inventory_shopify_synced_at AS terminal_eq_marker,
                v.read_completed_at IS NOT NULL AS completed_set
           FROM ${VERIFICATIONS} v
           JOIN ${EXECUTIONS} e ON e.execution_id = v.execution_id
           JOIN shop_wms_settings s ON s.shop_id = e.shop_id
          WHERE v.verification_id = ?`,
        [verificationId]
      )
    ).rows[0]
  );

  expect(row).toEqual({
    completed_eq_terminal: true,
    terminal_eq_marker: true,
    completed_set: true,
  });
}

// One complete/converged final verification, converged execution, marker set
// in the same transaction.
async function expectConverged(
  verifying: Verifying,
  provider: RoutedShopify,
  expectedLines: ReturnType<typeof frozenLine>[],
  pageCount = 1
): Promise<E04State> {
  const { shopId } = verifying.fixture;
  const state = await e04State(shopId, verifying.generationId);
  const finals = finalVerifications(state);

  expect(finals).toHaveLength(1);

  const verification = finals[0];

  expectFinalHeader(verifying, verification);
  expectFinalized(verification);
  expect(verification.status).toBe('complete');
  expect(verification.verdict).toBe('converged');
  expect(verification.served_api_version).toBe(FROZEN_API_VERSION);
  expect(Number(verification.page_count)).toBe(pageCount);
  expectCertifiedAuthority(verifying, verification);

  expect(linesOf(state, verification.verification_id)).toEqual(
    sortLines(expectedLines)
  );

  const execution = state.executions[0];

  expect(execution.status).toBe('converged');
  expect(execution.terminal_at).not.toBeNull();
  expect(execution.terminal_reason).toBe(CONVERGED_REASON);
  expect(execution.blocked_at).toBeNull();
  expectLeaseCleared(execution);

  expect(state.marker).not.toBeNull();
  await expectTimestampsEqual(shopId, verification.verification_id);

  expect(provider.readCalls.length).toBeGreaterThanOrEqual(1);
  await expectAlwaysInvariants(verifying, provider, state);

  return state;
}

// Successful structurally-valid read whose lines do not all match.
async function expectNotConverged(
  verifying: Verifying,
  provider: RoutedShopify,
  expectedLines: Array<Record<string, unknown>>
): Promise<void> {
  const state = await e04State(verifying.fixture.shopId, verifying.generationId);
  const finals = finalVerifications(state);

  expect(finals).toHaveLength(1);

  const verification = finals[0];

  expectFinalHeader(verifying, verification);
  expectFinalized(verification);
  expect(verification.status).toBe('complete');
  expect(verification.verdict).toBe('not_converged');
  expect(verification.served_api_version).toBe(FROZEN_API_VERSION);
  expectCertifiedAuthority(verifying, verification);

  const lines = linesOf(state, verification.verification_id);

  expect(lines).toEqual(sortLines(expectedLines as any[]));
  expect(lines.some((line: any) => line.line_verdict === 'old_state')).toBe(
    false
  );

  const execution = state.executions[0];

  expectRequiresRegeneration(execution);
  expect(String(execution.terminal_reason)).toContain(NOT_CONVERGED_REASON);

  expect(state.marker).toBeNull();
  expect(provider.readCalls.length).toBeGreaterThanOrEqual(1);
  await expectAlwaysInvariants(verifying, provider, state);
}

// Deterministic structural / local-authority drift: failed, no lines,
// requires_regeneration, marker NULL.
async function expectStructuralFailure(
  verifying: Verifying,
  provider: RoutedShopify,
  options: { readCalls: number }
): Promise<void> {
  const state = await e04State(verifying.fixture.shopId, verifying.generationId);
  const finals = finalVerifications(state);

  expect(finals).toHaveLength(1);

  const verification = finals[0];

  expectFinalHeader(verifying, verification);
  expectFinalized(verification);
  expect(verification.status).toBe('failed');
  expect(verification.verdict).toBeNull();
  expect(linesOf(state, verification.verification_id)).toEqual([]);

  expectRequiresRegeneration(state.executions[0]);
  expect(state.marker).toBeNull();

  expect(provider.readCalls).toHaveLength(options.readCalls);
  await expectAlwaysInvariants(verifying, provider, state);
}

// Transient / protocol read failure proves nothing: execution stays
// verifying under the same live lease.
async function expectTransientFailure(
  verifying: Verifying,
  provider: RoutedShopify
): Promise<E04State> {
  const state = await e04State(verifying.fixture.shopId, verifying.generationId);
  const finals = finalVerifications(state);

  expect(finals).toHaveLength(1);

  const verification = finals[0];

  expectFinalHeader(verifying, verification);
  expectFinalized(verification);
  expect(verification.status).toBe('failed');
  expect(verification.verdict).toBeNull();
  expect(linesOf(state, verification.verification_id)).toEqual([]);

  const execution = state.executions[0];

  expect(execution.status).toBe('verifying');
  expectLiveLease(execution, state.dbNow);
  expect(execution.lease_token).toBe(verification.started_by_lease_token);

  expect(state.marker).toBeNull();
  expect(provider.readCalls.length).toBeGreaterThanOrEqual(1);
  await expectAlwaysInvariants(verifying, provider, state);

  return state;
}

// Convergence owner A with a short lease, blocked inside its Shopify read.
async function startBlockedConvergenceA(verifying: Verifying) {
  const readGate = deferred<unknown>();

  const providerA = routedShopify('convergence-A', {
    reads: [() => readGate.promise],
  });

  const runA = await runConvergence(verifying, providerA, OWNER_A_LEASE_MS);

  await waitFor(() => {
    if (providerA.readCalls.length >= 1) return true;

    if (runA.state.settled) {
      throw new Error(
        `[GH1179_E04_TEST] convergence A settled before reading: ${describeOutcome(
          runA.state.settled
        )}`
      );
    }

    return null;
  }, 'convergence A read in flight');

  const inFlight = await e04State(
    verifying.fixture.shopId,
    verifying.generationId
  );
  const finals = finalVerifications(inFlight);

  expect(finals).toHaveLength(1);
  expect(finals[0].status).toBe('collecting');

  const leaseA = String(inFlight.executions[0].lease_token);

  expect(finals[0].started_by_lease_token).toBe(leaseA);

  return { readGate, providerA, runA, leaseA, verificationA: finals[0] };
}

// Block the read, commit a local change from an independent connection, then
// answer with evidence that matches the OLD (V1 / frozen) authority.
async function convergeAcrossLocalChange(
  verifying: Verifying,
  label: string,
  change: () => Promise<void>
) {
  const readGate = deferred<unknown>();

  const provider = routedShopify(label, { reads: [() => readGate.promise] });
  const run = await runConvergence(verifying, provider);

  try {
    await waitFor(() => {
      if (provider.readCalls.length >= 1) return true;

      if (run.state.settled) {
        throw new Error(
          `[GH1179_E04_TEST] convergence settled before reading: ${describeOutcome(
            run.state.settled
          )}`
        );
      }

      return null;
    }, 'blocked final readback');

    await change();
  } finally {
    readGate.resolve(locationPage(verifying.fixture, matchingLevels(verifying)));
    await run.done;
  }

  return provider;
}

// Established readiness blocker (physical-target C03 precedent): nonzero truth
// at a location code with no warehouse_locations row. It fails readiness with
// ORPHAN_NONZERO only and never contributes to the physical target, so frozen
// target / identity authority stays unchanged.
async function seedOrphanTruth(fixture: Fixture): Promise<void> {
  const now = new Date();

  await withTenant(fixture.shopId, (trx) =>
    trx('inventory_truth').insert({
      shop_id: fixture.shopId,
      lasyncro_variant_id: fixture.variantId,
      location_code: `E04-GHOST-${fixture.shopId}`,
      on_hand_quantity: 4,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: 4,
      last_evaluated_at: now,
    })
  );
}

describe('GH-1179 Slice E / E04 — opening inventory cutover final convergence', () => {
  it('E04-R01 — exposes verifyOpeningInventoryCutoverConvergence from the executor service module', () => {
    expect(typeof requireConvergence()).toBe('function');
  });

  describe('E04-R02 — an execution that is not verifying is not convergence work', () => {
    for (const status of ['executing', 'blocked', 'requires_regeneration'] as const) {
      it(`E04-R02 (${status}) — zero reads, zero verifications, execution unchanged, marker NULL`, async () => {
        const notVerifying = await prepareNotVerifying(status);
        const { shopId } = notVerifying.fixture;

        const provider = routedShopify(`e04-r02-${status}`);
        const run = await runConvergence(notVerifying, provider);
        await run.done;

        expect(provider.readCalls).toHaveLength(0);
        expect(provider.mutationCalls).toHaveLength(0);
        expect(provider.unknownCalls).toHaveLength(0);

        const state = await e04State(shopId, notVerifying.generationId);

        expect(finalVerifications(state)).toHaveLength(0);
        expect(state.verifications).toEqual(notVerifying.before.verifications);
        expect(state.executions).toEqual(notVerifying.before.executions);
        expect(state.batchExecutions).toEqual(notVerifying.before.batchExecutions);
        expect(state.attempts).toEqual(notVerifying.before.attempts);
        expect(state.marker).toBeNull();

        await expectSliceDUnchanged(notVerifying);
      });
    }
  });

  it('E04-R03 — a LIVE verifying lease makes convergence busy: zero reads, zero verification rows, nothing stolen', async () => {
    const verifying = await prepareVerifying('one_batch', { keepLive: true });
    const { shopId } = verifying.fixture;

    expectLiveLease(verifying.before.executions[0], verifying.before.dbNow);

    const provider = routedShopify('e04-r03');
    const run = await runConvergence(verifying, provider);
    const settled = await run.done;

    expect(describeOutcome(settled)).toMatch(/BUSY/i);
    expect(provider.readCalls).toHaveLength(0);
    expect(provider.mutationCalls).toHaveLength(0);
    expect(provider.unknownCalls).toHaveLength(0);

    const state = await e04State(shopId, verifying.generationId);

    expect(state.verifications).toHaveLength(0);
    expect(state.lines).toHaveLength(0);
    expect(state.executions).toEqual(verifying.before.executions);
    expect(state.marker).toBeNull();

    await expectSliceDUnchanged(verifying);
  });

  it('E04-R04 — after reclaim the collecting final_convergence header is committed and visible BEFORE the read resolves; no idle transaction', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const readGate = deferred<unknown>();
    const provider = routedShopify('e04-r04', { reads: [() => readGate.promise] });
    const run = await runConvergence(verifying, provider);

    try {
      await waitFor(() => {
        if (provider.readCalls.length >= 1) return true;

        if (run.state.settled) {
          throw new Error(
            `[GH1179_E04_TEST] convergence settled before reading: ${describeOutcome(
              run.state.settled
            )}`
          );
        }

        return null;
      }, 'blocked final readback');

      // Independent connection: only COMMITTED rows are visible here.
      const state = await e04State(shopId, verifying.generationId);
      const finals = finalVerifications(state);

      expect(state.verifications).toHaveLength(1);
      expect(finals).toHaveLength(1);

      const verification = finals[0];

      expectFinalHeader(verifying, verification);
      expect(verification.status).toBe('collecting');
      expect(verification.read_completed_at).toBeNull();
      expect(verification.finalized_by_lease_token).toBeNull();
      expect(verification.verdict).toBeNull();
      expect(verification.readiness_passed).toBeNull();
      expect(verification.target_fingerprint).toBeNull();
      expect(verification.identity_fingerprint).toBeNull();
      expect(state.lines).toHaveLength(0);

      const execution = state.executions[0];

      expect(execution.status).toBe('verifying');
      expectLiveLease(execution, state.dbNow);
      expect(execution.lease_token).not.toBe(verifying.fixtureLease);
      expect(verification.started_by_lease_token).toBe(execution.lease_token);
      expect(state.marker).toBeNull();

      const openTransactions = await coord.raw(
        `SELECT pid, state, left(query, 200) AS query
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND state LIKE 'idle in transaction%'`
      );

      expect(openTransactions.rows).toEqual([]);
      expect(provider.readCalls[0].settled).toBe(false);
      expect(provider.mutationCalls).toHaveLength(0);
    } finally {
      readGate.resolve(locationPage(verifying.fixture, matchingLevels(verifying)));
      await run.done;
    }

    expect(provider.mutationCalls).toHaveLength(0);
  });

  it('E04-R05 — stable V1/V2 + exact match (write + no_op): complete/converged, converged execution, marker set atomically, equal timestamps, certified fingerprints', async () => {
    const verifying = await prepareVerifying('write_noop');

    // Readback must pin the frozen requested version, not the process value.
    process.env.SHOPIFY_API_VERSION = DIFFERENT_API_VERSION;

    let provider: RoutedShopify;

    try {
      ({ provider } = await convergeWithReads(verifying, 'e04-r05', [
        async () => locationPage(verifying.fixture, matchingLevels(verifying)),
      ]));
    } finally {
      process.env.SHOPIFY_API_VERSION = FROZEN_API_VERSION;
    }

    expect(provider.readCalls).toHaveLength(1);
    expect(provider.clients.length).toBeGreaterThanOrEqual(1);

    await expectConverged(verifying, provider, [
      presentMatch(verifying, verifying.fixture.itemGid),
      presentMatch(verifying, verifying.extra!.itemGid),
    ]);
  });

  it('E04-R05b — V2 capture and the converged writes share ONE final transaction that already holds the lease row', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const readGate = deferred<unknown>();
    const provider = routedShopify('e04-r05b', { reads: [() => readGate.promise] });
    const run = await runConvergence(verifying, provider);

    let releaseBlocker: () => void = () => undefined;
    const blockerReleased = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    let markBlockerLocked: (pid: number) => void = () => undefined;
    const blockerLocked = new Promise<number>((resolve) => {
      markBlockerLocked = resolve;
    });

    let blocker: Promise<void> | null = null;
    let parkedXactStart = '';

    try {
      await waitFor(() => {
        if (provider.readCalls.length >= 1) return true;

        if (run.state.settled) {
          throw new Error(
            `[GH1179_E04_TEST] convergence settled before reading: ${describeOutcome(
              run.state.settled
            )}`
          );
        }

        return null;
      }, 'blocked final readback');

      // V1 is already captured. Park every later reader of inventory_truth
      // (V2) without changing it.
      blocker = withTenant(shopId, async (trx) => {
        const pid = await trx.raw('SELECT pg_backend_pid() AS pid');

        await trx.raw('LOCK TABLE inventory_truth IN ACCESS EXCLUSIVE MODE');

        markBlockerLocked(Number(pid.rows[0].pid));

        await blockerReleased;
      });

      const blockerPid = await Promise.race([
        blockerLocked,
        blocker.then(() => {
          throw new Error('[GH1179_E04_TEST] blocker ended before locking');
        }),
      ]);

      readGate.resolve(locationPage(verifying.fixture, matchingLevels(verifying)));

      const parked = await waitFor(async () => {
        if (run.state.settled) {
          throw new Error(
            '[GH1179_E04_TEST] convergence settled before V2 was observed parked: ' +
              describeOutcome(run.state.settled)
          );
        }

        const result = await coord.raw(
          `SELECT a.pid, a.wait_event_type, a.xact_start::text AS xact_start
             FROM pg_stat_activity a
            WHERE a.datname = current_database()
              AND a.backend_type = 'client backend'
              AND a.pid NOT IN (?, ?)
              AND ? = ANY(pg_blocking_pids(a.pid))
            LIMIT 1`,
          [blockerPid, coordPid, blockerPid]
        );

        return result.rows[0] ?? null;
      }, 'final V2 parked on inventory_truth');

      expect(parked.wait_event_type).toBe('Lock');
      parkedXactStart = String(parked.xact_start);

      // Nothing is committed while V2 is still being captured.
      const during = await e04State(shopId, verifying.generationId);

      expect(finalVerifications(during)[0].status).toBe('collecting');
      expect(during.lines).toHaveLength(0);
      expect(during.executions[0].status).toBe('verifying');
      expect(during.marker).toBeNull();

      // The transaction capturing V2 already owns the lease row: a separate
      // read-only V2 transaction would not hold it.
      let lockError: any = null;

      try {
        await coordTenant(shopId, (trx) =>
          trx.raw(
            `SELECT execution_id FROM ${EXECUTIONS}
              WHERE execution_id = ? FOR UPDATE NOWAIT`,
            [verifying.executionId]
          )
        );
      } catch (error) {
        lockError = error;
      }

      expect(lockError?.code).toBe('55P03');

      releaseBlocker();
      await blocker;
      await run.done;
    } finally {
      releaseBlocker();

      if (blocker) {
        await blocker.catch(() => undefined);
      }

      readGate.resolve(locationPage(verifying.fixture, matchingLevels(verifying)));
      await run.done;
    }

    const state = await expectConverged(verifying, provider, [
      presentMatch(verifying, verifying.fixture.itemGid),
    ]);

    // transaction now() == the parked transaction's start: V2 capture and the
    // completion writes are the SAME transaction.
    const same = await coordTenant(shopId, async (trx) =>
      (
        await trx.raw(
          `SELECT terminal_at = ?::timestamptz AS same_transaction
             FROM ${EXECUTIONS}
            WHERE execution_id = ?`,
          [parkedXactStart, verifying.executionId]
        )
      ).rows[0]
    );

    expect(same).toEqual({ same_transaction: true });
    expect(finalVerifications(state)).toHaveLength(1);
  });

  it('E04-R06 — physical truth 3 → 7 commits during the blocked read; provider matches OLD V1; V2 sees new truth → failed, requires_regeneration, marker NULL', async () => {
    const verifying = await prepareVerifying('one_batch');

    const provider = await convergeAcrossLocalChange(verifying, 'e04-r06', () =>
      seedTruth(verifying.fixture, { quantity: 7 })
    );

    await expectStructuralFailure(verifying, provider, { readCalls: 1 });
  });

  it('E04-R07 — Shopify identity mapping changes during the blocked read → failed, requires_regeneration, marker NULL', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const provider = await convergeAcrossLocalChange(verifying, 'e04-r07', async () => {
      const updated = await withTenant(shopId, (trx) =>
        trx('external_product_identity_map')
          .where({
            shop_id: shopId,
            lasyncro_variant_id: verifying.fixture.variantId,
            platform: 'shopify',
          })
          .update({ external_inventory_item_id: `${shopId}777` })
      );

      expect(updated).toBe(1);
    });

    await expectStructuralFailure(verifying, provider, { readCalls: 1 });
  });

  it('E04-R08 — warehouse Shopify Location mapping changes during the blocked read → failed, requires_regeneration, marker NULL', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const provider = await convergeAcrossLocalChange(verifying, 'e04-r08', async () => {
      const updated = await withTenant(shopId, (trx) =>
        trx('warehouses')
          .where({ shop_id: shopId, warehouse_id: verifying.fixture.warehouseId })
          .update({ external_location_id: `30${shopId}` })
      );

      expect(updated).toBe(1);
    });

    await expectStructuralFailure(verifying, provider, { readCalls: 1 });
  });

  it('E04-R09 — provider quantity mismatch → complete/not_converged → requires_regeneration, marker NULL', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { itemGid } = verifying.fixture;

    const { provider } = await convergeWithReads(verifying, 'e04-r09', [
      async () => locationPage(verifying.fixture, [mainLevel(verifying, { onHand: 6 })]),
    ]);

    await expectNotConverged(verifying, provider, [
      frozenLine(verifying, itemGid, {
        observed_on_hand: 6,
        level_present: true,
        active: true,
        tracked: true,
        line_verdict: 'mismatch',
      }),
    ]);
  });

  it('E04-R09b — provider still at the frozen OLD value is mismatch, never old_state', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { itemGid } = verifying.fixture;

    const { provider } = await convergeWithReads(verifying, 'e04-r09b', [
      async () => locationPage(verifying.fixture, [mainLevel(verifying, { onHand: 8 })]),
    ]);

    await expectNotConverged(verifying, provider, [
      frozenLine(verifying, itemGid, {
        observed_on_hand: 8,
        level_present: true,
        active: true,
        tracked: true,
        line_verdict: 'mismatch',
      }),
    ]);
  });

  it('E04-R10 — frozen write item absent from the Location → mismatch (observed NULL, level_present false) → not_converged', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { itemGid } = verifying.fixture;

    const { provider } = await convergeWithReads(verifying, 'e04-r10', [
      async () => locationPage(verifying.fixture, []),
    ]);

    await expectNotConverged(verifying, provider, [
      frozenLine(verifying, itemGid, {
        observed_on_hand: null,
        level_present: false,
        active: null,
        tracked: null,
        line_verdict: 'mismatch',
      }),
    ]);
  });

  it('E04-R10b — frozen no_op item absent from the Location → mismatch → not_converged', async () => {
    const verifying = await prepareVerifying('write_noop');
    const extraGid = verifying.extra!.itemGid;

    const { provider } = await convergeWithReads(verifying, 'e04-r10b', [
      async () => locationPage(verifying.fixture, [mainLevel(verifying)]),
    ]);

    await expectNotConverged(verifying, provider, [
      presentMatch(verifying, verifying.fixture.itemGid),
      frozenLine(verifying, extraGid, {
        observed_on_hand: null,
        level_present: false,
        active: null,
        tracked: null,
        line_verdict: 'mismatch',
      }),
    ]);
  });

  it('E04-R11 — inactive frozen write item → inactive line → not_converged', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { itemGid } = verifying.fixture;

    const { provider } = await convergeWithReads(verifying, 'e04-r11', [
      async () =>
        locationPage(verifying.fixture, [mainLevel(verifying, { active: false })]),
    ]);

    await expectNotConverged(verifying, provider, [
      frozenLine(verifying, itemGid, {
        observed_on_hand: 3,
        level_present: true,
        active: false,
        tracked: true,
        line_verdict: 'inactive',
      }),
    ]);
  });

  it('E04-R12 — untracked frozen write item → untracked line → not_converged', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { itemGid } = verifying.fixture;

    const { provider } = await convergeWithReads(verifying, 'e04-r12', [
      async () =>
        locationPage(verifying.fixture, [mainLevel(verifying, { tracked: false })]),
    ]);

    await expectNotConverged(verifying, provider, [
      frozenLine(verifying, itemGid, {
        observed_on_hand: 3,
        level_present: true,
        active: true,
        tracked: false,
        line_verdict: 'untracked',
      }),
    ]);
  });

  for (const malformed of ['active', 'tracked'] as const) {
    it(`E04-R12b (${malformed} = NULL) — present frozen item with malformed eligibility → structural failure, no partial lines`, async () => {
      const verifying = await prepareVerifying('one_batch');

      const { provider } = await convergeWithReads(verifying, `e04-r12b-${malformed}`, [
        async () =>
          locationPage(verifying.fixture, [mainLevel(verifying, { [malformed]: null })]),
      ]);

      await expectStructuralFailure(verifying, provider, { readCalls: 1 });
    });
  }

  it('E04-R13 — known frozen provider_only_zero present at 0 → match (expected_target 0) → converged', async () => {
    const verifying = await prepareVerifying('provider_zero');
    const dormantGid = verifying.dormant!.itemGid;

    expect(entryFor(verifying, dormantGid).disposition).toBe('provider_only_zero');

    const { provider } = await convergeWithReads(verifying, 'e04-r13', [
      async () => locationPage(verifying.fixture, matchingLevels(verifying)),
    ]);

    await expectConverged(verifying, provider, [
      presentMatch(verifying, verifying.fixture.itemGid),
      presentMatch(verifying, dormantGid),
    ]);
  });

  it('E04-R13b — known frozen provider_only_zero with NO Location level → match → converged', async () => {
    const verifying = await prepareVerifying('provider_zero');
    const dormantGid = verifying.dormant!.itemGid;

    const { provider } = await convergeWithReads(verifying, 'e04-r13b', [
      async () => locationPage(verifying.fixture, [mainLevel(verifying)]),
    ]);

    await expectConverged(verifying, provider, [
      presentMatch(verifying, verifying.fixture.itemGid),
      frozenLine(verifying, dormantGid, {
        observed_on_hand: null,
        level_present: false,
        active: null,
        tracked: null,
        line_verdict: 'match',
      }),
    ]);
  });

  for (const flag of ['active', 'tracked'] as const) {
    it(`E04-R13c (${flag} = false) — known frozen provider_only_zero present but ineligible → structural failure`, async () => {
      const verifying = await prepareVerifying('provider_zero');
      const dormant = verifying.dormant!;

      const { provider } = await convergeWithReads(verifying, `e04-r13c-${flag}`, [
        async () =>
          locationPage(verifying.fixture, [
            mainLevel(verifying),
            {
              itemGid: dormant.itemGid,
              variantGid: dormant.variantGid,
              onHand: 0,
              [flag]: false,
            },
          ]),
      ]);

      await expectStructuralFailure(verifying, provider, { readCalls: 1 });
    });
  }

  it('E04-R13d — known frozen provider_only_zero now NONZERO → mismatch → not_converged', async () => {
    const verifying = await prepareVerifying('provider_zero');
    const dormant = verifying.dormant!;

    const { provider } = await convergeWithReads(verifying, 'e04-r13d', [
      async () =>
        locationPage(verifying.fixture, [
          mainLevel(verifying),
          { itemGid: dormant.itemGid, variantGid: dormant.variantGid, onHand: 2 },
        ]),
    ]);

    await expectNotConverged(verifying, provider, [
      presentMatch(verifying, verifying.fixture.itemGid),
      frozenLine(verifying, dormant.itemGid, {
        observed_on_hand: 2,
        level_present: true,
        active: true,
        tracked: true,
        line_verdict: 'mismatch',
      }),
    ]);
  });

  it('E04-R14 — unknown UNMAPPED provider-only NONZERO item → structural failure, requires_regeneration', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const { provider } = await convergeWithReads(verifying, 'e04-r14', [
      async () =>
        locationPage(verifying.fixture, [
          mainLevel(verifying),
          {
            itemGid: `gid://shopify/InventoryItem/${shopId}9999999`,
            variantGid: null,
            onHand: 2,
          },
        ]),
    ]);

    await expectStructuralFailure(verifying, provider, { readCalls: 1 });
  });

  it('E04-R14b — MAPPED provider item outside the frozen/current universe → unknown_item → not_converged', async () => {
    const verifying = await prepareVerifying('dormant_unlisted');
    const dormant = verifying.dormant!;

    expect(
      verifying.entries.some(
        (entry: any) => entry.shopify_inventory_item_gid === dormant.itemGid
      )
    ).toBe(false);

    const { provider } = await convergeWithReads(verifying, 'e04-r14b', [
      async () =>
        locationPage(verifying.fixture, [
          mainLevel(verifying),
          { itemGid: dormant.itemGid, variantGid: dormant.variantGid, onHand: 2 },
        ]),
    ]);

    await expectNotConverged(verifying, provider, [
      presentMatch(verifying, verifying.fixture.itemGid),
      unknownLine(dormant.itemGid, { observed_on_hand: 2 }),
    ]);
  });

  it('E04-R15 — unknown provider-only ZERO item stays untrusted → unknown_item → not_converged', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;
    const unknownGid = `gid://shopify/InventoryItem/${shopId}9999998`;

    const { provider } = await convergeWithReads(verifying, 'e04-r15', [
      async () =>
        locationPage(verifying.fixture, [
          mainLevel(verifying),
          { itemGid: unknownGid, variantGid: null, onHand: 0 },
        ]),
    ]);

    await expectNotConverged(verifying, provider, [
      presentMatch(verifying, verifying.fixture.itemGid),
      unknownLine(unknownGid, { observed_on_hand: 0 }),
    ]);
  });

  it('E04-R16 — current-only physical target item added after freeze → V1 drift: failed BEFORE any read, requires_regeneration', async () => {
    const verifying = await prepareVerifying('one_batch');

    await seedAdditionalTargets(verifying.fixture, 1, 2);

    const { provider } = await convergeWithReads(verifying, 'e04-r16', []);

    await expectStructuralFailure(verifying, provider, { readCalls: 0 });
  });

  it('E04-R17 — frozen write item leaves the current identity universe → V1 drift: failed BEFORE any read, requires_regeneration', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const updated = await withTenant(shopId, (trx) =>
      trx('external_product_identity_map')
        .where({
          shop_id: shopId,
          lasyncro_variant_id: verifying.fixture.variantId,
          platform: 'shopify',
        })
        .update({ external_inventory_item_id: `${shopId}777` })
    );

    expect(updated).toBe(1);

    const { provider } = await convergeWithReads(verifying, 'e04-r17', []);

    await expectStructuralFailure(verifying, provider, { readCalls: 0 });
  });

  it('E04-R17b — frozen write target changed by physical truth after freeze → V1 drift: failed BEFORE any read, requires_regeneration', async () => {
    const verifying = await prepareVerifying('one_batch');

    await seedTruth(verifying.fixture, { quantity: 5 });

    const { provider } = await convergeWithReads(verifying, 'e04-r17b', []);

    await expectStructuralFailure(verifying, provider, { readCalls: 0 });
  });

  it('E04-R18 — multi-page final read: exact page_count, one served version, cursor followed, converged', async () => {
    const verifying = await prepareVerifying('write_noop');
    const extra = verifying.extra!;

    const { provider } = await convergeWithReads(verifying, 'e04-r18', [
      async () =>
        locationPage(
          verifying.fixture,
          [{ itemGid: extra.itemGid, variantGid: extra.variantGid, onHand: 4 }],
          { hasNextPage: true, endCursor: 'e04-cursor-1' }
        ),
      async () => locationPage(verifying.fixture, [mainLevel(verifying)]),
    ]);

    expect(provider.readCalls).toHaveLength(2);
    expect(provider.readCalls[0].options.variables?.after ?? null).toBeNull();
    expect(provider.readCalls[1].options.variables?.after).toBe('e04-cursor-1');

    await expectConverged(
      verifying,
      provider,
      [
        presentMatch(verifying, verifying.fixture.itemGid),
        presentMatch(verifying, extra.itemGid),
      ],
      2
    );
  });

  const transientReads: Array<[string, (verifying: Verifying) => ProviderHandler]> = [
    [
      'E04-R19a — served API version missing',
      (verifying) => async () =>
        locationPage(verifying.fixture, matchingLevels(verifying), { served: null }),
    ],
    [
      'E04-R19b — served API version differs from the frozen served version',
      (verifying) => async () =>
        locationPage(verifying.fixture, matchingLevels(verifying), {
          served: DIFFERENT_API_VERSION,
        }),
    ],
    [
      'E04-R20 — no response',
      () => async () => {
        throw noResponseError();
      },
    ],
    [
      'E04-R21a — AbortError',
      () => async () => {
        throw namedError('AbortError');
      },
    ],
    [
      'E04-R21b — TimeoutError',
      () => async () => {
        throw namedError('TimeoutError');
      },
    ],
    [
      'E04-R22 — HTTP 5xx',
      () => async () => {
        throw internalServerError();
      },
    ],
    [
      'E04-R23 — GraphqlQueryError',
      () => async () => {
        throw topLevelGraphqlError();
      },
    ],
  ];

  for (const [title, read] of transientReads) {
    it(`${title} → failed, execution stays verifying with the same live lease, marker NULL`, async () => {
      const verifying = await prepareVerifying('one_batch');

      const { provider } = await convergeWithReads(verifying, title, [read(verifying)]);

      expect(provider.readCalls).toHaveLength(1);
      await expectTransientFailure(verifying, provider);
    });
  }

  for (const location of ['missing', 'inactive', 'mismatch'] as const) {
    it(`E04-R24 (Location ${location}) — deterministic structural failure → requires_regeneration`, async () => {
      const verifying = await prepareVerifying('one_batch');

      const { provider } = await convergeWithReads(verifying, `e04-r24-${location}`, [
        async () =>
          locationPage(verifying.fixture, matchingLevels(verifying), { location }),
      ]);

      await expectStructuralFailure(verifying, provider, { readCalls: 1 });
    });
  }

  it('E04-R25 — a transient failed final verification stays immutable; after expiry/reclaim a NEW read-only verification converges', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const first = await convergeWithReads(
      verifying,
      'e04-r25-first',
      [
        async () => {
          throw noResponseError();
        },
      ],
      OWNER_A_LEASE_MS
    );

    const failed = await expectTransientFailure(verifying, first.provider);
    const failedRow = finalVerifications(failed)[0];

    await waitForLeaseExpiry(shopId, verifying.executionId);

    const second = await convergeWithReads(verifying, 'e04-r25-second', [
      async () => locationPage(verifying.fixture, matchingLevels(verifying)),
    ]);

    const state = await e04State(shopId, verifying.generationId);
    const finals = finalVerifications(state);

    expect(finals).toHaveLength(2);
    expect(finals[0]).toEqual(failedRow);

    const retried = finals[1];

    expect(retried.verification_id).not.toBe(failedRow.verification_id);
    expect(retried.started_by_lease_token).not.toBe(
      failedRow.started_by_lease_token
    );
    expect(retried.status).toBe('complete');
    expect(retried.verdict).toBe('converged');
    expect(state.executions[0].status).toBe('converged');
    expect(state.marker).not.toBeNull();
    await expectTimestampsEqual(shopId, retried.verification_id);

    expect(first.provider.mutationCalls).toHaveLength(0);
    expect(second.provider.readCalls).toHaveLength(1);
    await expectAlwaysInvariants(verifying, second.provider, state);
  });

  it('E04-R26 — lease expires during A\'s blocked read: B reclaims, abandons A\'s collecting final verification, converges', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const ownerA = await startBlockedConvergenceA(verifying);

    try {
      await waitForLeaseExpiry(shopId, verifying.executionId);

      const ownerB = await convergeWithReads(verifying, 'convergence-B', [
        async () => locationPage(verifying.fixture, matchingLevels(verifying)),
      ]);

      // Genuine overlap: B finished while A's read was still unresolved.
      expect(ownerA.providerA.readCalls[0].settled).toBe(false);
      expect(ownerA.runA.state.settled).toBeNull();

      const state = await e04State(shopId, verifying.generationId);
      const finals = finalVerifications(state);

      expect(finals).toHaveLength(2);

      const abandoned = finals.find(
        (row: any) => row.verification_id === ownerA.verificationA.verification_id
      );
      const fresh = finals.find(
        (row: any) => row.verification_id !== ownerA.verificationA.verification_id
      );

      const leaseB = String(fresh.started_by_lease_token);

      expect(leaseB).not.toBe(ownerA.leaseA);

      expect(abandoned.status).toBe('abandoned');
      expect(abandoned.read_completed_at).not.toBeNull();
      expect(abandoned.finalized_by_lease_token).toBe(leaseB);
      expect(abandoned.started_by_lease_token).toBe(ownerA.leaseA);
      expect(abandoned.verdict).toBeNull();
      expect(linesOf(state, abandoned.verification_id)).toEqual([]);

      expect(fresh.status).toBe('complete');
      expect(fresh.verdict).toBe('converged');
      expect(state.executions[0].status).toBe('converged');
      expect(state.marker).not.toBeNull();

      await expectAlwaysInvariants(verifying, ownerB.provider, state);
    } finally {
      ownerA.readGate.resolve(
        locationPage(verifying.fixture, matchingLevels(verifying))
      );
      await ownerA.runA.done;
    }

    expect(ownerA.providerA.mutationCalls).toHaveLength(0);
  });

  it('E04-R27 — A\'s late MATCHING read after B\'s reclaim cannot add lines, finalize, converge, or set the marker', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const ownerA = await startBlockedConvergenceA(verifying);

    try {
      await waitForLeaseExpiry(shopId, verifying.executionId);

      // B reads a mismatch: a complete not_converged inspection that ends the
      // execution. A's late matching evidence must not overturn it.
      const ownerB = await convergeWithReads(verifying, 'convergence-B', [
        async () => locationPage(verifying.fixture, [mainLevel(verifying, { onHand: 6 })]),
      ]);

      const afterB = await e04State(shopId, verifying.generationId);

      expectRequiresRegeneration(afterB.executions[0]);
      expect(afterB.marker).toBeNull();

      ownerA.readGate.resolve(
        locationPage(verifying.fixture, matchingLevels(verifying))
      );

      const settledA = await ownerA.runA.done;

      expect(describeOutcome(settledA)).toMatch(STALE_CLAIM);

      const afterA = await e04State(shopId, verifying.generationId);

      expect(afterA.executions).toEqual(afterB.executions);
      expect(afterA.verifications).toEqual(afterB.verifications);
      expect(afterA.lines).toEqual(afterB.lines);
      expect(afterA.marker).toBeNull();
      expect(linesOf(afterA, ownerA.verificationA.verification_id)).toEqual([]);

      await expectAlwaysInvariants(verifying, ownerB.provider, afterA);
    } finally {
      ownerA.readGate.resolve(
        locationPage(verifying.fixture, matchingLevels(verifying))
      );
      await ownerA.runA.done;
    }

    expect(ownerA.providerA.mutationCalls).toHaveLength(0);
  });

  it('E04-R28 — onPage checks verifying-lease liveness without extending it: a stale multi-page reader stops and persists nothing', async () => {
    const verifying = await prepareVerifying('write_noop');
    const { shopId } = verifying.fixture;
    const extra = verifying.extra!;

    const pageOneGate = deferred<unknown>();

    const providerA = routedShopify('convergence-A-paged', {
      reads: [
        () => pageOneGate.promise,
        async () => locationPage(verifying.fixture, [mainLevel(verifying)]),
      ],
    });

    const runA = await runConvergence(verifying, providerA, OWNER_A_LEASE_MS);

    try {
      await waitFor(() => {
        if (providerA.readCalls.length >= 1) return true;

        if (runA.state.settled) {
          throw new Error(
            `[GH1179_E04_TEST] convergence A settled before reading: ${describeOutcome(
              runA.state.settled
            )}`
          );
        }

        return null;
      }, 'paged convergence A read in flight');

      const inFlight = await e04State(shopId, verifying.generationId);
      const leaseA = inFlight.executions[0].lease_token;
      const expiresA = inFlight.executions[0].lease_expires_at;

      await waitForLeaseExpiry(shopId, verifying.executionId);

      // Page 1 arrives after A's lease expired; more pages remain.
      pageOneGate.resolve(
        locationPage(
          verifying.fixture,
          [{ itemGid: extra.itemGid, variantGid: extra.variantGid, onHand: 4 }],
          { hasNextPage: true, endCursor: 'e04-cursor-1' }
        )
      );

      const settledA = await runA.done;

      expect(describeOutcome(settledA)).toMatch(STALE_CLAIM);
      expect(providerA.readCalls).toHaveLength(1);

      const after = await e04State(shopId, verifying.generationId);

      // No heartbeat, no extension, no evidence.
      expect(after.executions[0].status).toBe('verifying');
      expect(after.executions[0].lease_token).toBe(leaseA);
      expect(new Date(after.executions[0].lease_expires_at).getTime()).toBe(
        new Date(expiresA).getTime()
      );
      expect(after.executions[0].lease_heartbeat_at).toBeNull();
      expect(finalVerifications(after)).toHaveLength(1);
      expect(finalVerifications(after)[0].status).toBe('collecting');
      expect(after.lines).toHaveLength(0);
      expect(after.marker).toBeNull();

      expectNoEconomicMutation(verifying, providerA, after);
      await expectSliceDUnchanged(verifying);
    } finally {
      pageOneGate.resolve(locationPage(verifying.fixture, []));
      await runA.done;
    }

    expect(providerA.mutationCalls).toHaveLength(0);
  });

  it('E04-R29 — two genuinely overlapping convergence callers: one lease owner, one collecting final verification, one read, one completion', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;
    const converge = requireConvergence();

    const readGate = deferred<unknown>();

    // Shared provider: a second read from either caller would be unexpected.
    const provider = routedShopify('e04-r29', { reads: [() => readGate.promise] });

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
      // Blocker holds the execution row FOR UPDATE: every reclaim must lock
      // that row, so both callers queue concurrently at the database.
      blocker = withTenant(shopId, async (trx) => {
        const pid = await trx.raw('SELECT pg_backend_pid() AS pid');

        const locked = await trx(EXECUTIONS)
          .where({ shop_id: shopId, execution_id: verifying.executionId })
          .forUpdate()
          .select('execution_id');

        if (locked.length !== 1) {
          throw new Error('[GH1179_E04_TEST] execution row not locked');
        }

        markBlockerLocked(Number(pid.rows[0].pid));
        await blockerReleased;
      });

      const blockerPid = await Promise.race([
        blockerLocked,
        blocker.then(() => {
          throw new Error('[GH1179_E04_TEST] blocker ended before locking');
        }),
      ]);

      for (let i = 0; i < 2; i += 1) {
        runs.push(
          track(
            converge(
              { shopId, generationId: verifying.generationId },
              { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
            )
          )
        );
      }

      const contenders = await waitFor(async () => {
        if (runs.every((run) => run.state.settled)) {
          throw new Error(
            '[GH1179_E04_TEST] both callers settled before overlap was observed: ' +
              runs.map((run) => describeOutcome(run.state.settled)).join(' | ')
          );
        }

        const result = await coord.raw(
          `SELECT a.pid, pg_blocking_pids(a.pid) AS blockers
             FROM pg_stat_activity a
            WHERE a.datname = current_database()
              AND a.backend_type = 'client backend'
              AND a.pid NOT IN (?, ?)
              AND cardinality(pg_blocking_pids(a.pid)) > 0`,
          [blockerPid, coordPid]
        );

        return result.rows.length >= 2 ? result.rows : null;
      }, 'both convergence claims blocked concurrently');

      expect(
        contenders.some((row: any) =>
          (row.blockers as number[]).map(Number).includes(blockerPid)
        )
      ).toBe(true);
      expect(provider.readCalls).toHaveLength(0);

      releaseBlocker();
      await blocker;

      await waitFor(
        () =>
          provider.readCalls.length === 1 &&
          runs.filter((run) => run.state.settled).length === 1
            ? true
            : null,
        'winner reading and loser settled'
      );

      const loser = runs.find((run) => run.state.settled)!;

      expect(describeOutcome(loser.state.settled)).toMatch(BUSY_OR_STALE);

      const inFlight = await e04State(shopId, verifying.generationId);
      const finals = finalVerifications(inFlight);

      expect(finals).toHaveLength(1);
      expect(finals[0].status).toBe('collecting');
      expect(finals[0].started_by_lease_token).toBe(
        inFlight.executions[0].lease_token
      );
    } finally {
      releaseBlocker();

      if (blocker) {
        await blocker.catch(() => undefined);
      }

      readGate.resolve(locationPage(verifying.fixture, matchingLevels(verifying)));
      await Promise.all(runs.map((run) => run.done));
    }

    expect(provider.readCalls).toHaveLength(1);

    await expectConverged(verifying, provider, [
      presentMatch(verifying, verifying.fixture.itemGid),
    ]);
  });

  it('E04-R30a — zero-write generation still performs FULL convergence: fresh read, zero mutations, converged + marker', async () => {
    const verifying = await prepareVerifying('zero_write');

    expect(Number(verifying.generation.write_count)).toBe(0);
    expect(verifying.batches).toHaveLength(0);

    const { provider } = await convergeWithReads(verifying, 'e04-r30a', [
      async () => locationPage(verifying.fixture, matchingLevels(verifying)),
    ]);

    expect(provider.readCalls).toHaveLength(1);

    await expectConverged(verifying, provider, [
      presentMatch(verifying, verifying.fixture.itemGid),
    ]);
  });

  it('E04-R30b — zero-write generation with a provider mismatch → not_converged, requires_regeneration, marker NULL', async () => {
    const verifying = await prepareVerifying('zero_write');
    const { itemGid } = verifying.fixture;

    const { provider } = await convergeWithReads(verifying, 'e04-r30b', [
      async () => locationPage(verifying.fixture, [mainLevel(verifying, { onHand: 5 })]),
    ]);

    await expectNotConverged(verifying, provider, [
      frozenLine(verifying, itemGid, {
        observed_on_hand: 5,
        level_present: true,
        active: true,
        tracked: true,
        line_verdict: 'mismatch',
      }),
    ]);
  });

  it('E04-R31 — converged reentry: zero provider I/O, zero new verification, marker unchanged', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    // No committed entrypoint can produce converged yet: the fixture applies
    // the 0203-legal verifying → converged transition and the marker in one
    // transaction (E01 direct-persistence precedent).
    await withTenant(shopId, async (trx) => {
      const converged = await trx(EXECUTIONS)
        .where({ shop_id: shopId, execution_id: verifying.executionId, status: 'verifying' })
        .update({
          status: 'converged',
          terminal_at: trx.fn.now(),
          terminal_reason: CONVERGED_REASON,
          lease_token: null,
          lease_expires_at: null,
          lease_heartbeat_at: null,
          updated_at: trx.fn.now(),
        });

      expect(converged).toBe(1);

      const marked = await trx('shop_wms_settings')
        .where({ shop_id: shopId })
        .whereNull('opening_inventory_shopify_synced_at')
        .update({ opening_inventory_shopify_synced_at: trx.fn.now() });

      expect(marked).toBe(1);
    });

    const before = await e04State(shopId, verifying.generationId);

    expect(before.marker).not.toBeNull();

    const provider = routedShopify('e04-r31');
    const run = await runConvergence(verifying, provider);
    const settled = await run.done;

    expect(describeOutcome(settled)).toMatch(/converged/i);
    expect(provider.readCalls).toHaveLength(0);
    expect(provider.mutationCalls).toHaveLength(0);
    expect(provider.unknownCalls).toHaveLength(0);

    const state = await e04State(shopId, verifying.generationId);

    expect(state.verifications).toEqual(before.verifications);
    expect(state.lines).toEqual(before.lines);
    expect(state.executions).toEqual(before.executions);
    expect(state.marker).toBe(before.marker);

    await expectSliceDUnchanged(verifying);
  });

  it('E04-R32 — legacy completion marker already set while verifying: execution → blocked, marker preserved, zero read, zero final verification', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const legacyMarker = '2026-01-02 03:04:05.123456+00';

    const marked = await withTenant(shopId, (trx) =>
      trx('shop_wms_settings')
        .where({ shop_id: shopId })
        .update({
          opening_inventory_shopify_synced_at: trx.raw('?::timestamptz', [
            legacyMarker,
          ]),
        })
    );

    expect(marked).toBe(1);

    const before = await e04State(shopId, verifying.generationId);

    const provider = routedShopify('e04-r32');
    const run = await runConvergence(verifying, provider);
    await run.done;

    expect(provider.readCalls).toHaveLength(0);
    expect(provider.mutationCalls).toHaveLength(0);
    expect(provider.unknownCalls).toHaveLength(0);

    const state = await e04State(shopId, verifying.generationId);

    expect(finalVerifications(state)).toHaveLength(0);
    expect(state.lines).toHaveLength(0);

    const execution = state.executions[0];

    expect(execution.status).toBe('blocked');
    expect(execution.blocked_at).not.toBeNull();
    expect(String(execution.blocked_reason ?? '')).toContain(LEGACY_MARKER_REASON);
    expect(execution.terminal_at).toBeNull();
    expectLeaseCleared(execution);

    // Exact legacy timestamp preserved (microsecond text comparison).
    expect(state.marker).toBe(before.marker);

    const preserved = await coordTenant(shopId, async (trx) =>
      (
        await trx.raw(
          `SELECT opening_inventory_shopify_synced_at = ?::timestamptz AS preserved
             FROM shop_wms_settings WHERE shop_id = ?`,
          [legacyMarker, shopId]
        )
      ).rows[0]
    );

    expect(preserved).toEqual({ preserved: true });

    expect(state.attempts).toEqual(verifying.before.attempts);
    expect(state.batchExecutions).toEqual(verifying.before.batchExecutions);
    await expectSliceDUnchanged(verifying);
  });

  it('E04-R33 — V1 physical readiness failure (ORPHAN_NONZERO) after the header: failed BEFORE any read, readiness never certified, requires_regeneration', async () => {
    const verifying = await prepareVerifying('one_batch');

    await seedOrphanTruth(verifying.fixture);

    const { provider } = await convergeWithReads(verifying, 'e04-r33', []);

    await expectStructuralFailure(verifying, provider, { readCalls: 0 });

    const state = await e04State(verifying.fixture.shopId, verifying.generationId);

    expect(finalVerifications(state)[0].readiness_passed).not.toBe(true);
  });

  it('E04-R34 — physical readiness blocker committed during the blocked read; provider matches V1; final V2 detects it → failed, requires_regeneration', async () => {
    const verifying = await prepareVerifying('one_batch');

    const provider = await convergeAcrossLocalChange(verifying, 'e04-r34', () =>
      seedOrphanTruth(verifying.fixture)
    );

    await expectStructuralFailure(verifying, provider, { readCalls: 1 });

    const state = await e04State(verifying.fixture.shopId, verifying.generationId);

    expect(finalVerifications(state)[0].readiness_passed).not.toBe(true);
  });

  it('E04-R35 — active installation stable Shop GID changes during the blocked read → final V2 merchant drift: failed, requires_regeneration', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    expect(verifying.generation.shopify_shop_gid).toBe(`gid://shopify/Shop/${shopId}`);

    const provider = await convergeAcrossLocalChange(verifying, 'e04-r35', async () => {
      const updated = await withTenant(shopId, (trx) =>
        trx('shopify_app_installations')
          .where({ shop_id: shopId })
          .whereNull('uninstalled_at')
          .update({ shop_gid: `gid://shopify/Shop/${shopId}999` })
      );

      expect(updated).toBe(1);
    });

    await expectStructuralFailure(verifying, provider, { readCalls: 1 });

    // Generation authority itself is untouched.
    expect((await sliceDState(shopId)).generations[0].shopify_shop_gid).toBe(
      `gid://shopify/Shop/${shopId}`
    );
  });

  it('E04-R36 — provider ProductVariant disagrees with the mapped identity of the frozen item (quantity matches) → structural failure, no partial lines', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const { provider } = await convergeWithReads(verifying, 'e04-r36', [
      async () =>
        locationPage(verifying.fixture, [
          mainLevel(verifying, {
            variantGid: `gid://shopify/ProductVariant/${shopId}999`,
          }),
        ]),
    ]);

    await expectStructuralFailure(verifying, provider, { readCalls: 1 });
  });

  for (const [id, malformed] of [
    ['E04-R37a', { active: null, tracked: true }],
    ['E04-R37b', { active: true, tracked: null }],
  ] as const) {
    it(`${id} — known frozen provider_only_zero present at 0 with ${
      malformed.active === null ? 'active' : 'tracked'
    } = NULL → not a match: structural failure, zero lines`, async () => {
      const verifying = await prepareVerifying('provider_zero');
      const dormant = verifying.dormant!;

      const { provider } = await convergeWithReads(verifying, id, [
        async () =>
          locationPage(verifying.fixture, [
            mainLevel(verifying),
            {
              itemGid: dormant.itemGid,
              variantGid: dormant.variantGid,
              onHand: 0,
              ...malformed,
            },
          ]),
      ]);

      await expectStructuralFailure(verifying, provider, { readCalls: 1 });
    });
  }

  it('E04-R38 — a genuine SQLSTATE 40001 in the final REPEATABLE READ transaction fails closed: no converged execution, no marker, no final lines', async () => {
    const verifying = await prepareVerifying('one_batch');
    const { shopId } = verifying.fixture;

    const readGate = deferred<unknown>();
    const provider = routedShopify('e04-r38', { reads: [() => readGate.promise] });
    const run = await runConvergence(verifying, provider);

    let releaseBlocker: () => void = () => undefined;
    const blockerReleased = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    let markBlockerLocked: (pid: number) => void = () => undefined;
    const blockerLocked = new Promise<number>((resolve) => {
      markBlockerLocked = resolve;
    });

    let blocker: Promise<void> | null = null;
    let leaseE04 = '';

    try {
      await waitFor(() => {
        if (provider.readCalls.length >= 1) return true;

        if (run.state.settled) {
          throw new Error(
            `[GH1179_E04_TEST] convergence settled before reading: ${describeOutcome(
              run.state.settled
            )}`
          );
        }

        return null;
      }, 'blocked final readback');

      // Claim, header and V1 are committed; record E04's live lease.
      const inFlight = await e04State(shopId, verifying.generationId);

      expect(finalVerifications(inFlight)[0].status).toBe('collecting');
      leaseE04 = String(inFlight.executions[0].lease_token);

      // Blocker row-locks the execution BEFORE the final transaction starts,
      // then (once the final transaction's lease CAS is observed waiting on
      // that lock, i.e. after its RR snapshot exists) commits a real UPDATE
      // of the same row. A REPEATABLE READ writer that waited on a row
      // concurrently updated after its snapshot must abort with 40001.
      blocker = withTenant(shopId, async (trx) => {
        const pid = await trx.raw('SELECT pg_backend_pid() AS pid');

        const locked = await trx(EXECUTIONS)
          .where({ shop_id: shopId, execution_id: verifying.executionId })
          .forUpdate()
          .select('execution_id');

        if (locked.length !== 1) {
          throw new Error('[GH1179_E04_TEST] execution row not locked');
        }

        markBlockerLocked(Number(pid.rows[0].pid));
        await blockerReleased;

        // Harmless, lease-preserving row version change.
        const touched = await trx(EXECUTIONS)
          .where({ shop_id: shopId, execution_id: verifying.executionId })
          .update({ updated_at: trx.fn.now() });

        if (touched !== 1) {
          throw new Error('[GH1179_E04_TEST] execution row not touched');
        }
      });

      const blockerPid = await Promise.race([
        blockerLocked,
        blocker.then(() => {
          throw new Error('[GH1179_E04_TEST] blocker ended before locking');
        }),
      ]);

      readGate.resolve(locationPage(verifying.fixture, matchingLevels(verifying)));

      const waiting = await waitFor(async () => {
        if (run.state.settled) {
          throw new Error(
            '[GH1179_E04_TEST] convergence settled before the final transaction was observed waiting: ' +
              describeOutcome(run.state.settled)
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
      }, 'final transaction waiting on the execution row');

      expect(waiting.wait_event_type).toBe('Lock');
      expect(waiting.has_snapshot).toBe(true);

      releaseBlocker();
      await blocker;
      await run.done;
    } finally {
      releaseBlocker();

      if (blocker) {
        await blocker.catch(() => undefined);
      }

      readGate.resolve(locationPage(verifying.fixture, matchingLevels(verifying)));
      await run.done;
    }

    // Classified as stale / retryable / serialization conflict — never success.
    const settled = run.state.settled!;

    expect(describeOutcome(settled)).toMatch(
      /STALE|RETRY|SERIALI[SZ]|CONFLICT|40001/i
    );

    if (settled.ok) {
      expect((settled.value as any)?.outcome).not.toBe('converged');
    }

    const state = await e04State(shopId, verifying.generationId);
    const execution = state.executions[0];

    // No convergence evidence survives the aborted transaction.
    expect(execution.status).toBe('verifying');
    expect(execution.terminal_at).toBeNull();
    expect(execution.lease_token).toBe(leaseE04);
    expect(state.marker).toBeNull();

    const finals = finalVerifications(state);

    expect(finals).toHaveLength(1);
    expect(finals[0].status).not.toBe('complete');
    expect(finals[0].verdict).toBeNull();
    expect(state.lines).toHaveLength(0);

    expect(provider.readCalls).toHaveLength(1);
    await expectAlwaysInvariants(verifying, provider, state);
  });
});
