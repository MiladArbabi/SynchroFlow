// GH-1179 Slice E / E03 — Opening Inventory cutover AMBIGUITY RECOVERY.
//
// RED contract only. The executor module exists (E02); the new export
// recoverOpeningInventoryCutoverAmbiguity does not. A runtime lookup turns its
// absence into [E03_RED_GATE]. Every behaviour case first builds a REAL
// ambiguous batch through the committed E02 executor, so RED proves fixtures.
//
// Locked by this suite:
// - a fresh READ-ONLY Shopify Location read judges whether a frozen batch that
//   MAY have executed appears applied; nothing is ever resent;
// - all frozen targets → applied → batch succeeded; all frozen old values →
//   not_applied; anything else → mixed; both → requires_regeneration;
// - structural evidence failures → failed + requires_regeneration;
//   transient/protocol read failures → failed, execution stays live;
// - collecting verification committed BEFORE the read; lease CAS on every
//   write; reclaim abandons collecting verifications; stale readers persist
//   nothing; onPage checks lease liveness without extending it;
// - an applied recovery may continue through normal E02 revalidation/dispatch;
// - never converges, never writes opening_inventory_shopify_synced_at, never
//   mutates Slice-D rows.
//
// Shopify is dependency-injected only and routed by GraphQL document, so read
// calls and economic mutation calls are counted separately. The real client
// module is mocked fail-closed.

const mockShopifyRequest = jest.fn(async (..._args: unknown[]) => {
  throw new Error(
    '[GH1179_E03_TEST] default Shopify transport must not be reached'
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

import {
  identityFingerprint,
  normalizeShopifyGid,
  selectShopifyIdentityRows,
} from 'api-src/services/wms/shopifyOpeningInventorySnapshot.service';

import {
  buildOpeningInventoryPhysicalTarget,
  resolveOpeningInventoryParticipatingWarehouse,
} from 'api-src/services/wms/openingInventoryPhysicalTarget.service';

import { createOpeningInventoryCutoverGeneration } from
  'api-src/services/wms/openingInventoryCutoverGeneration.service';

import { generationFingerprint } from
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

// E02 fixture owner lease: long enough to claim + dispatch + record ambiguity,
// short enough to expire for real (DB time) before recovery reclaims.
const FIXTURE_LEASE_MS = 2000;

// Recovery owner A lease in the reclaim / liveness cases.
const OWNER_A_LEASE_MS = 2500;

const STALE_CLAIM = /STALE|LEASE|CLAIM/i;
const BUSY_OR_STALE = /BUSY|STALE|LEASE|CLAIM|OWN/i;

// ─── controlled runtime lookup (E03-R01 RED gate) ───────────────────────────

const E03_RED_GATE =
  '[E03_RED_GATE] opening inventory cutover ambiguity recovery not implemented';

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

type RecoverAmbiguity = (
  params: { shopId: number; generationId: string },
  deps?: ExecutorDeps
) => Promise<unknown>;

type ExecuteGeneration = RecoverAmbiguity;

function requireRecovery(): RecoverAmbiguity {
  // Runtime lookup on the existing module: no static import of the missing
  // export, so this suite compiles before E03 exists.
  const candidate = (executionModule as Record<string, unknown>)
    .recoverOpeningInventoryCutoverAmbiguity;

  if (typeof candidate !== 'function') {
    throw new Error(E03_RED_GATE);
  }

  return candidate as RecoverAmbiguity;
}

const executeGeneration =
  executionModule.executeOpeningInventoryCutoverGeneration as unknown as ExecuteGeneration;

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

  throw new Error(`[GH1179_E03_TEST] waitFor timed out: ${label}`);
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

function routedShopify(
  label: string,
  params: {
    mutationDocuments: Set<string>;
    reads?: ProviderHandler[];
    mutations?: ProviderHandler[];
  }
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
        } else if (params.mutationDocuments.has(document)) {
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
              `[GH1179_E03_TEST] unexpected ${kind} provider call on ${label}`
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
      'X-Request-Id': [options.requestId ?? `e03-${crypto.randomUUID()}`],
    },
  };
}

function noResponseError(): Error {
  return new HttpRequestError(
    'Http request error, no response available: [GH1179_E03_TEST] simulated lost response'
  );
}

function namedError(name: 'AbortError' | 'TimeoutError'): Error {
  const error = new Error(`[GH1179_E03_TEST] simulated ${name}`);
  error.name = name;
  return error;
}

function internalServerError(): Error {
  return new HttpInternalError({
    message: '[GH1179_E03_TEST] Shopify internal server error',
    code: 503,
    statusText: 'Service Unavailable',
    body: {},
    headers: { 'X-Request-Id': ['e03-5xx'] },
  });
}

function topLevelGraphqlError(): Error {
  const message = '[GH1179_E03_TEST] synthetic top-level read failure';

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

// ─── Slice-C/D fixture (patterned after the E02 / Slice-D suites) ───────────

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
    const id = await createTenantShop(trx, `gh1179e03-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const warehouseId = crypto.randomUUID();
  const rootCode = `E03-${unique}-ROOT`;
  const a1 = `E03-${unique}-A1`;
  const a2 = `E03-${unique}-A2`;

  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  const locationRaw = `20${shopId}`;
  const inventoryItemRaw = `${shopId}001`;
  const variantRaw = `${shopId}101`;

  const shopDomain = `gh1179e03-${unique}.myshopify.com`;
  const accessToken = `e03-offline-token-${unique}`;

  let ownerId = 0;
  let operatorId = 0;

  await withTenant(shopId, async (trx) => {
    const users = await trx('users')
      .insert([
        {
          shop_id: shopId,
          email: `e03-owner-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'owner',
        },
        {
          shop_id: shopId,
          email: `e03-operator-${unique}@example.com`,
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
      name: `Slice E03 warehouse ${unique}`,
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
      title: 'Slice E03 product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `E03-${unique}`,
      title: 'Slice E03 variant',
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
      external_sku: `E03-${unique}`,
    });

    await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: shopDomain,
      shop_gid: `gid://shopify/Shop/${shopId}`,
      access_token: encrypt(accessToken),
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
    throw new Error('[GH1179_E03_TEST] opening cohort bins missing');
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
      throw new Error('[GH1179_E03_TEST] fixture product missing');
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
        sku: `E03-BULK-${index}-${variantId.slice(0, 8)}`,
        title: `Slice E03 bulk variant ${index}`,
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
        external_sku: `E03-BULK-${index}`,
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

// ─── Shopify Location page (generation read AND E03 readback) ───────────────

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
  } = {}
) {
  const served =
    options.served === undefined ? FROZEN_API_VERSION : options.served;

  return {
    data: {
      location: {
        id: fixture.locationGid,
        isActive: true,
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
    headers: served === null ? {} : { 'X-Shopify-API-Version': [served] },
  };
}

// ─── Slice-D generation + REAL E02 ambiguity fixture ────────────────────────

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

// one_batch:           main write (target 3, frozen on_hand 8).
// two_items:           main write (3 ← 8) + extra write (5 ← 9), same batch.
// one_batch_with_noop: main write (3 ← 8) + mapped extra no_op (4 = 4).
// two_batches:         251 writes (target 1 ← 0) → batches 250 + 1.
type FrozenShape = 'one_batch' | 'two_items' | 'one_batch_with_noop' | 'two_batches';

type Frozen = {
  fixture: Fixture;
  extras: ExtraTarget[];
  generationId: string;
  generation: any;
  batches: any[];
  entries: any[];
  mutationDocuments: Set<string>;
};

async function freezeGeneration(shape: FrozenShape): Promise<Frozen> {
  const fixture = await createFixture();

  let extras: ExtraTarget[] = [];
  let levels: LocationLevel[];
  let expectedBatches: number;
  let expectedWrites: number;

  const main = (onHand: number): LocationLevel => ({
    itemGid: fixture.itemGid,
    variantGid: fixture.variantGid,
    onHand,
  });

  if (shape === 'two_batches') {
    await makeCountedReady(fixture, 1);
    extras = await seedAdditionalTargets(fixture, 250, 1);
    levels = [
      main(0),
      ...extras.map((extra) => ({
        itemGid: extra.itemGid,
        variantGid: extra.variantGid,
        onHand: 0,
      })),
    ];
    expectedBatches = 2;
    expectedWrites = 251;
  } else {
    await makeCountedReady(fixture, 3);

    if (shape === 'one_batch') {
      levels = [main(8)];
      expectedWrites = 1;
    } else if (shape === 'two_items') {
      extras = await seedAdditionalTargets(fixture, 1, 5);
      levels = [
        main(8),
        { itemGid: extras[0].itemGid, variantGid: extras[0].variantGid, onHand: 9 },
      ];
      expectedWrites = 2;
    } else {
      extras = await seedAdditionalTargets(fixture, 1, 4);
      levels = [
        main(8),
        { itemGid: extras[0].itemGid, variantGid: extras[0].variantGid, onHand: 4 },
      ];
      expectedWrites = 1;
    }

    expectedBatches = 1;
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
          throw new Error('[GH1179_E03_TEST] generation reader exhausted');
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
  expect(Number(generation.batch_count)).toBe(expectedBatches);
  expect(Number(generation.write_count)).toBe(expectedWrites);
  expect(sliceD.batches).toHaveLength(expectedBatches);

  return {
    fixture,
    extras,
    generationId: String(generation.generation_id),
    generation,
    batches: sliceD.batches,
    entries: sliceD.entries,
    mutationDocuments: new Set(
      sliceD.batches.map((batch: any) => String(batch.graphql_document))
    ),
  };
}

async function e03State(shopId: number, generationId: string) {
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

    dbNow: (await trx.raw('SELECT clock_timestamp() AS now')).rows[0]
      .now as Date,
  }));
}

type E03State = Awaited<ReturnType<typeof e03State>>;

type Ambiguous = Frozen & {
  sliceD: SliceDState;
  executionId: string;
  fixtureLease: string;
  before: E03State;
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

// REAL ambiguity through the committed E02 executor: batch 1 mutation result
// is lost (no response) or arrives under a different served API version. The
// E02 owner keeps its lease; unless `keepLive`, the test waits for it to
// expire in DB time so recovery must reclaim.
async function prepareAmbiguous(
  shape: FrozenShape,
  options: {
    ambiguity?: 'no_response' | 'served_version_mismatch';
    keepLive?: boolean;
  } = {}
): Promise<Ambiguous> {
  const frozen = await freezeGeneration(shape);
  const { shopId } = frozen.fixture;

  const mutationHandler: ProviderHandler =
    options.ambiguity === 'served_version_mismatch'
      ? async () =>
          mutationSuccess(adjustmentGroupGid(shopId, 900), {
            served: DIFFERENT_API_VERSION,
          })
      : async () => {
          throw noResponseError();
        };

  const fixtureProvider = routedShopify('e02-fixture', {
    mutationDocuments: frozen.mutationDocuments,
    mutations: [mutationHandler],
  });

  await executeGeneration(
    { shopId, generationId: frozen.generationId },
    {
      createShopifyGraphQLClient: fixtureProvider.createShopifyGraphQLClient,
      leaseDurationMs: options.keepLive ? undefined : FIXTURE_LEASE_MS,
    }
  );

  expect(fixtureProvider.mutationCalls).toHaveLength(1);
  expect(fixtureProvider.readCalls).toHaveLength(0);

  const prepared = await e03State(shopId, frozen.generationId);

  expect(prepared.executions).toHaveLength(1);
  expect(prepared.executions[0].status).toBe('executing');
  expect(prepared.batchExecutions[0].status).toBe('ambiguous');
  expect(prepared.attempts).toHaveLength(1);
  expect(prepared.attempts[0].finalized_at).not.toBeNull();
  expect(prepared.verifications).toHaveLength(0);

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
    before: await e03State(shopId, frozen.generationId),
  };
}

// ─── E03-R28 corruption-at-rest fixture (frozen request ≠ frozen entries) ───
//
// 0201 never cross-validates batch canonical_variables against the entries
// (only length > 0), and 0203 checks attempt request_sha256 against the batch
// row only. This fixture uses the E01 direct-persistence precedent: assembling
// header + children inserted, then the single assembling → frozen transition,
// in ONE transaction. Nothing frozen is ever UPDATEd; no trigger or constraint
// is disabled.
//
// Everything is otherwise legitimate: header scope and target/identity
// fingerprints come from the same exported helpers E02 revalidates with, and
// request_sha256 is the Slice-D hash of the canonical_variables actually
// stored. The ONLY inconsistency: the entry freezes target_quantity 3 while
// the batch request freezes quantity 4 (changeFromQuantity, item set and
// locationId agree).

// Verbatim Slice-D mutation document (not exported by the generation service).
const SLICE_D_SET_QUANTITIES_MUTATION = `
# Each quantity carries changeFromQuantity optimistic concurrency evidence.
mutation OpeningInventorySetQuantities(
  $input: InventorySetQuantitiesInput!
  $idempotencyKey: String!
) {
  inventorySetQuantities(input: $input)
    @idempotent(key: $idempotencyKey) {
    inventoryAdjustmentGroup {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}
`.trim();

const R28_ENTRY_TARGET = 3;
const R28_ENTRY_OBSERVED = 8;
const R28_REQUEST_QUANTITY = 4;

async function freezeRequestEntryMismatch(): Promise<Frozen> {
  const fixture = await createFixture();
  const { shopId } = fixture;

  await makeCountedReady(fixture, R28_ENTRY_TARGET);

  const generationId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const operationName = 'OpeningInventorySetQuantities';
  const servedApiVersion = '2026-04';
  const casMode = 'change_from_quantity';
  const referenceDocumentUri =
    `gid://lasyncro/OpeningInventoryCutover/` +
    `shop-${shopId}-generation-${generationId}-batch-1`;

  await withTenant(shopId, async (trx) => {
    const scope = await resolveOpeningInventoryParticipatingWarehouse(
      trx,
      shopId
    );
    const locationGid = normalizeShopifyGid('Location', scope.shopifyLocationId);

    expect(locationGid).toBe(fixture.locationGid);
    expect(scope.warehouseId).toBe(fixture.warehouseId);

    const target = await buildOpeningInventoryPhysicalTarget(
      trx,
      shopId,
      scope.warehouseId
    );

    expect(target).toEqual([
      { lasyncroVariantId: fixture.variantId, targetQuantity: R28_ENTRY_TARGET },
    ]);

    const identityRows = await selectShopifyIdentityRows(trx, shopId);

    const installation = await trx('shopify_app_installations')
      .where({ shop_id: shopId })
      .first('shop_domain', 'shop_gid');

    const entry = {
      generation_id: generationId,
      shop_id: shopId,
      ordinal: 1,
      lasyncro_variant_id: fixture.variantId,
      shopify_inventory_item_gid: fixture.itemGid,
      shopify_variant_gid: fixture.variantGid,
      target_quantity: R28_ENTRY_TARGET,
      observed_on_hand_quantity: R28_ENTRY_OBSERVED,
      inventory_level_present: true,
      inventory_level_active: true,
      tracked: true,
      disposition: 'write',
      batch_index: 1,
      batch_position: 1,
    };

    // Keys in canonical (sorted) order, as Slice D serializes them.
    const canonicalVariables = JSON.stringify({
      idempotencyKey,
      input: {
        name: 'on_hand',
        quantities: [
          {
            changeFromQuantity: R28_ENTRY_OBSERVED,
            inventoryItemId: fixture.itemGid,
            locationId: locationGid,
            // THE controlled discrepancy: entry target_quantity is 3.
            quantity: R28_REQUEST_QUANTITY,
          },
        ],
        reason: 'correction',
        referenceDocumentUri,
      },
    });

    const requestSha256 = generationFingerprint({
      operationName,
      graphqlDocument: SLICE_D_SET_QUANTITIES_MUTATION,
      requestedApiVersion: FROZEN_API_VERSION,
      servedApiVersion,
      casMode,
      canonicalVariables,
    });

    const targetFingerprint = generationFingerprint(
      target.map((row) => ({
        lasyncroVariantId: row.lasyncroVariantId,
        targetQuantity: row.targetQuantity,
      }))
    );

    const providerReadFingerprint = generationFingerprint([
      {
        shopifyInventoryItemGid: fixture.itemGid,
        shopifyVariantGid: fixture.variantGid,
        lasyncroVariantId: fixture.variantId,
        inventoryLevelPresent: true,
        inventoryLevelActive: true,
        tracked: true,
        onHandQuantity: R28_ENTRY_OBSERVED,
      },
    ]);

    const now = new Date();

    const header = {
      generation_id: generationId,
      shop_id: shopId,
      generation_sequence: 1,
      opening_snapshot_id: scope.snapshotId,
      warehouse_id: scope.warehouseId,
      shopify_location_gid: locationGid,
      shopify_shop_domain: installation.shop_domain,
      shopify_shop_gid: installation.shop_gid,
      requested_api_version: FROZEN_API_VERSION,
      served_api_version: servedApiVersion,
      cas_mode: casMode,
      quantity_name: 'on_hand',
      reason: 'correction',
      approved_by_actor_type: 'user',
      approved_by_actor_id: String(fixture.ownerId),
      approved_by_role: 'owner',
      approved_at: now,
      physical_truth_accepted_at: now,
      identity_fingerprint: identityFingerprint(identityRows),
      target_fingerprint: targetFingerprint,
      provider_read_fingerprint: providerReadFingerprint,
      generation_fingerprint: generationFingerprint({
        snapshotId: scope.snapshotId,
        warehouseId: scope.warehouseId,
        locationGid,
        shopDomain: installation.shop_domain,
        shopGid: installation.shop_gid,
        requestedApiVersion: FROZEN_API_VERSION,
        servedApiVersion,
        casMode,
        quantityName: 'on_hand',
        reason: 'correction',
        identityFingerprint: identityFingerprint(identityRows),
        targetFingerprint,
        providerReadFingerprint,
        entries: [
          {
            lasyncroVariantId: entry.lasyncro_variant_id,
            shopifyInventoryItemGid: entry.shopify_inventory_item_gid,
            targetQuantity: entry.target_quantity,
            observedOnHandQuantity: entry.observed_on_hand_quantity,
            disposition: entry.disposition,
            batchIndex: entry.batch_index,
            batchPosition: entry.batch_position,
          },
        ],
      }),
      canonicalization_version: 'opening-inventory-generation-v1',
      batching_version: 'shopify-max-250-v1',
      batch_size: 250,
      provider_read_started_at: new Date(now.getTime() - 1000),
      provider_read_completed_at: now,
      provider_page_count: 1,
      target_item_count: 1,
      provider_only_item_count: 0,
      write_count: 1,
      batch_count: 1,
      status: 'assembling',
      frozen_at: null,
    };

    await trx(GENERATIONS).insert(header);
    await trx(ENTRIES).insert(entry);

    await trx(BATCHES).insert({
      generation_id: generationId,
      shop_id: shopId,
      batch_index: 1,
      requested_api_version: FROZEN_API_VERSION,
      served_api_version: servedApiVersion,
      cas_mode: casMode,
      operation_name: operationName,
      graphql_document: SLICE_D_SET_QUANTITIES_MUTATION,
      canonical_variables: canonicalVariables,
      reference_document_uri: referenceDocumentUri,
      idempotency_key: idempotencyKey,
      request_sha256: requestSha256,
      entry_count: 1,
    });

    // The one legitimate assembling → frozen transition (freeze guard runs).
    await trx(GENERATIONS)
      .where({ shop_id: shopId, generation_id: generationId })
      .update({ status: 'frozen', frozen_at: new Date() });
  });

  const sliceD = await sliceDState(shopId);

  expect(sliceD.generations).toHaveLength(1);
  expect(sliceD.entries).toHaveLength(1);
  expect(sliceD.batches).toHaveLength(1);

  const generation = sliceD.generations[0];
  const [storedEntry] = sliceD.entries;
  const [storedBatch] = sliceD.batches;

  expect(generation.status).toBe('frozen');

  // Durable proof of the single intended inconsistency.
  const storedVariables = JSON.parse(storedBatch.canonical_variables);
  const [storedQuantity] = storedVariables.input.quantities;

  expect(Number(storedEntry.target_quantity)).toBe(R28_ENTRY_TARGET);
  expect(storedQuantity.quantity).toBe(R28_REQUEST_QUANTITY);
  expect(storedQuantity.changeFromQuantity).toBe(
    Number(storedEntry.observed_on_hand_quantity)
  );
  expect(storedQuantity.inventoryItemId).toBe(
    storedEntry.shopify_inventory_item_gid
  );
  expect(storedQuantity.locationId).toBe(generation.shopify_location_gid);
  expect(storedVariables.idempotencyKey).toBe(storedBatch.idempotency_key);

  // request_sha256 is honest for the stored request.
  expect(storedBatch.request_sha256).toBe(
    generationFingerprint({
      operationName: storedBatch.operation_name,
      graphqlDocument: storedBatch.graphql_document,
      requestedApiVersion: storedBatch.requested_api_version,
      servedApiVersion: storedBatch.served_api_version,
      casMode: storedBatch.cas_mode,
      canonicalVariables: storedBatch.canonical_variables,
    })
  );

  return {
    fixture,
    extras: [],
    generationId,
    generation,
    batches: sliceD.batches,
    entries: sliceD.entries,
    mutationDocuments: new Set([String(storedBatch.graphql_document)]),
  };
}

// REAL E02 ambiguity over the corrupted generation: E02 revalidates current
// authority, dispatches the stored request verbatim, loses the response.
async function prepareRequestEntryMismatchAmbiguous(): Promise<Ambiguous> {
  const frozen = await freezeRequestEntryMismatch();
  const { shopId } = frozen.fixture;

  const fixtureProvider = routedShopify('e02-r28-fixture', {
    mutationDocuments: frozen.mutationDocuments,
    mutations: [
      async () => {
        throw noResponseError();
      },
    ],
  });

  await executeGeneration(
    { shopId, generationId: frozen.generationId },
    {
      createShopifyGraphQLClient: fixtureProvider.createShopifyGraphQLClient,
      leaseDurationMs: FIXTURE_LEASE_MS,
    }
  );

  expect(fixtureProvider.mutationCalls).toHaveLength(1);
  expect(fixtureProvider.readCalls).toHaveLength(0);
  expect(fixtureProvider.mutationCalls[0].options.variables).toEqual(
    JSON.parse(frozen.batches[0].canonical_variables)
  );

  const prepared = await e03State(shopId, frozen.generationId);

  expect(prepared.executions).toHaveLength(1);
  expect(prepared.executions[0].status).toBe('executing');
  expect(prepared.batchExecutions[0].status).toBe('ambiguous');
  expect(prepared.attempts).toHaveLength(1);
  expect(prepared.attempts[0].finalized_at).not.toBeNull();
  expect(prepared.verifications).toHaveLength(0);

  const executionId = String(prepared.executions[0].execution_id);
  const fixtureLease = String(prepared.executions[0].lease_token);

  await waitForLeaseExpiry(shopId, executionId);

  return {
    ...frozen,
    sliceD: await sliceDState(shopId),
    executionId,
    fixtureLease,
    before: await e03State(shopId, frozen.generationId),
  };
}

// ─── readback evidence builders ─────────────────────────────────────────────

function writeEntries(frozen: Frozen, batchIndex: number): any[] {
  return frozen.entries
    .filter(
      (entry: any) =>
        entry.disposition === 'write' &&
        Number(entry.batch_index) === batchIndex
    )
    .sort(
      (left: any, right: any) =>
        Number(left.batch_position) - Number(right.batch_position)
    );
}

// Every frozen write entry of the generation at the requested state.
function frozenLevels(
  frozen: Frozen,
  stateByBatch: Record<number, 'target' | 'old'>
): LocationLevel[] {
  return frozen.entries
    .filter((entry: any) => entry.disposition === 'write')
    .map((entry: any) => ({
      itemGid: String(entry.shopify_inventory_item_gid),
      variantGid: entry.shopify_variant_gid ?? null,
      onHand:
        stateByBatch[Number(entry.batch_index)] === 'target'
          ? Number(entry.target_quantity)
          : Number(entry.observed_on_hand_quantity),
    }));
}

function mainEntry(frozen: Frozen): any {
  return frozen.entries.find(
    (entry: any) => entry.shopify_inventory_item_gid === frozen.fixture.itemGid
  );
}

function extraEntry(frozen: Frozen): any {
  return frozen.entries.find(
    (entry: any) => entry.shopify_inventory_item_gid === frozen.extras[0].itemGid
  );
}

function expectedLine(
  entry: any,
  observed: {
    observed_on_hand: number | null;
    level_present: boolean;
    active: boolean | null;
    tracked: boolean | null;
    line_verdict: string;
  }
) {
  return {
    shopify_inventory_item_gid: String(entry.shopify_inventory_item_gid),
    expected_target: Number(entry.target_quantity),
    frozen_change_from: Number(entry.observed_on_hand_quantity),
    ...observed,
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

function linesOf(state: E03State, verificationId: string) {
  return state.lines
    .filter((line: any) => line.verification_id === verificationId)
    .map(lineShape)
    .sort((left: any, right: any) =>
      left.shopify_inventory_item_gid < right.shopify_inventory_item_gid
        ? -1
        : left.shopify_inventory_item_gid > right.shopify_inventory_item_gid
          ? 1
          : 0
    );
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

// ─── shared assertions ──────────────────────────────────────────────────────

async function runRecovery(
  ambiguous: Ambiguous,
  provider: RoutedShopify,
  leaseDurationMs?: number
) {
  const recover = requireRecovery();

  return track(
    recover(
      {
        shopId: ambiguous.fixture.shopId,
        generationId: ambiguous.generationId,
      },
      {
        createShopifyGraphQLClient: provider.createShopifyGraphQLClient,
        leaseDurationMs,
      }
    )
  );
}

function expectInspectionHeader(
  ambiguous: Ambiguous,
  verification: any,
  batchIndex: number
): void {
  expect(verification.purpose).toBe('ambiguity_inspection');
  expect(Number(verification.batch_index)).toBe(batchIndex);
  expect(Number(verification.shop_id)).toBe(ambiguous.fixture.shopId);
  expect(String(verification.execution_id)).toBe(ambiguous.executionId);
  expect(verification.generation_id).toBe(ambiguous.generationId);
  expect(verification.requested_api_version).toBe(
    ambiguous.generation.requested_api_version
  );
  expect(verification.shop_gid).toBe(ambiguous.generation.shopify_shop_gid);
  expect(verification.location_gid).toBe(
    ambiguous.generation.shopify_location_gid
  );
  expect(verification.started_by_lease_token).not.toBeNull();
  expect(verification.started_by_lease_token).not.toBe(ambiguous.fixtureLease);

  // Final-convergence fields are never repurposed for ambiguity inspection.
  expect(verification.readiness_passed).toBeNull();
  expect(verification.target_fingerprint).toBeNull();
  expect(verification.identity_fingerprint).toBeNull();
}

function expectFinalized(verification: any): void {
  expect(verification.read_completed_at).not.toBeNull();
  expect(verification.finalized_by_lease_token).not.toBeNull();
  expect(verification.finalized_by_lease_token).toBe(
    verification.started_by_lease_token
  );
}

// No economic resend: zero mutation documents, no unknown documents, and the
// ambiguous batch's attempt rows are exactly the E02 fixture's.
function expectNoAmbiguousResend(
  ambiguous: Ambiguous,
  provider: RoutedShopify,
  state: E03State,
  batchIndex = 1
): void {
  expect(provider.unknownCalls).toHaveLength(0);

  const ambiguousKey = ambiguous.batches.find(
    (batch: any) => Number(batch.batch_index) === batchIndex
  ).idempotency_key;

  expect(
    provider.mutationCalls.filter(
      (call) => call.options.variables?.idempotencyKey === ambiguousKey
    )
  ).toHaveLength(0);

  expect(
    state.attempts.filter((row: any) => Number(row.batch_index) === batchIndex)
  ).toEqual(
    ambiguous.before.attempts.filter(
      (row: any) => Number(row.batch_index) === batchIndex
    )
  );
}

function expectReadRequestsPinned(
  ambiguous: Ambiguous,
  provider: RoutedShopify
): void {
  for (const client of provider.clients) {
    expect(client).toMatchObject({
      apiVersion: ambiguous.generation.requested_api_version,
      shopId: ambiguous.fixture.shopId,
      platformShopName: ambiguous.fixture.shopDomain,
      accessToken: ambiguous.fixture.accessToken,
    });
  }

  for (const call of provider.readCalls) {
    expect(call.options.retries ?? 0).toBe(0);
    expect(call.options.variables?.locationId).toBe(
      ambiguous.generation.shopify_location_gid
    );
  }
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

async function expectSliceDUnchanged(ambiguous: Ambiguous): Promise<void> {
  const after = await sliceDState(ambiguous.fixture.shopId);

  expect(after.generations).toEqual(ambiguous.sliceD.generations);
  expect(after.entries).toEqual(ambiguous.sliceD.entries);
  expect(after.batches).toEqual(ambiguous.sliceD.batches);
  expect(after.sha256).toBe(ambiguous.sliceD.sha256);
}

function expectLiveLease(execution: any, dbNow: Date): void {
  expect(execution.lease_token).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  expect(new Date(execution.lease_expires_at).getTime()).toBeGreaterThan(
    new Date(dbNow).getTime()
  );
}

function expectRequiresRegeneration(execution: any): void {
  expect(execution.status).toBe('requires_regeneration');
  expect(execution.terminal_at).not.toBeNull();
  expect(String(execution.terminal_reason ?? '')).not.toBe('');
  expect(execution.lease_token).toBeNull();
  expect(execution.lease_expires_at).toBeNull();
  expect(execution.lease_heartbeat_at).toBeNull();
}

async function expectAlwaysInvariants(
  ambiguous: Ambiguous,
  provider: RoutedShopify,
  state: E03State
): Promise<void> {
  expectNoAmbiguousResend(ambiguous, provider, state);
  expectReadRequestsPinned(ambiguous, provider);
  await expectCompletionMarkerNull(ambiguous.fixture.shopId);
  await expectSliceDUnchanged(ambiguous);
}

// Single completed inspection that ends the execution in requires_regeneration.
async function expectCompletedNotRecovered(
  ambiguous: Ambiguous,
  provider: RoutedShopify,
  verdict: 'not_applied' | 'mixed',
  expectedLines: ReturnType<typeof expectedLine>[]
): Promise<void> {
  const state = await e03State(ambiguous.fixture.shopId, ambiguous.generationId);

  expect(state.verifications).toHaveLength(1);

  const verification = state.verifications[0];

  expectInspectionHeader(ambiguous, verification, 1);
  expectFinalized(verification);
  expect(verification.status).toBe('complete');
  expect(verification.verdict).toBe(verdict);
  expect(verification.served_api_version).toBe(FROZEN_API_VERSION);

  expect(linesOf(state, verification.verification_id)).toEqual(
    sortLines(expectedLines)
  );

  expect(state.batchExecutions[0].status).toBe('ambiguous');
  expect(state.batchExecutions[0].succeeded_at).toBeNull();
  expectRequiresRegeneration(state.executions[0]);

  expect(provider.mutationCalls).toHaveLength(0);
  await expectAlwaysInvariants(ambiguous, provider, state);
}

// Single failed read whose evidence is STRUCTURAL drift.
async function expectStructuralFailure(
  ambiguous: Ambiguous,
  provider: RoutedShopify
): Promise<void> {
  const state = await e03State(ambiguous.fixture.shopId, ambiguous.generationId);

  expect(state.verifications).toHaveLength(1);

  const verification = state.verifications[0];

  expectInspectionHeader(ambiguous, verification, 1);
  expectFinalized(verification);
  expect(verification.status).toBe('failed');
  expect(verification.verdict).toBeNull();
  expect(linesOf(state, verification.verification_id)).toEqual([]);

  expect(state.batchExecutions[0].status).toBe('ambiguous');
  expectRequiresRegeneration(state.executions[0]);

  expect(provider.mutationCalls).toHaveLength(0);
  await expectAlwaysInvariants(ambiguous, provider, state);
}

// Single failed read that proves nothing: the execution stays live.
async function expectTransientFailure(
  ambiguous: Ambiguous,
  provider: RoutedShopify
): Promise<E03State> {
  const state = await e03State(ambiguous.fixture.shopId, ambiguous.generationId);

  expect(state.verifications).toHaveLength(1);

  const verification = state.verifications[0];

  expectInspectionHeader(ambiguous, verification, 1);
  expectFinalized(verification);
  expect(verification.status).toBe('failed');
  expect(verification.verdict).toBeNull();
  expect(linesOf(state, verification.verification_id)).toEqual([]);

  expect(state.batchExecutions[0].status).toBe('ambiguous');
  expect(state.batchExecutions[0].succeeded_at).toBeNull();

  const execution = state.executions[0];

  expect(execution.status).toBe('executing');
  expectLiveLease(execution, state.dbNow);
  expect(execution.lease_token).toBe(verification.started_by_lease_token);

  expect(provider.mutationCalls).toHaveLength(0);
  await expectAlwaysInvariants(ambiguous, provider, state);

  return state;
}

async function recoverWithReads(
  ambiguous: Ambiguous,
  label: string,
  reads: ProviderHandler[],
  leaseDurationMs?: number
) {
  const provider = routedShopify(label, {
    mutationDocuments: ambiguous.mutationDocuments,
    reads,
  });

  const run = await runRecovery(ambiguous, provider, leaseDurationMs);
  const settled = await run.done;

  return { provider, settled };
}

// Recovery owner A with a short lease, blocked inside its Shopify read.
async function startBlockedRecoveryA(ambiguous: Ambiguous) {
  const readGate = deferred<unknown>();

  const providerA = routedShopify('recovery-A', {
    mutationDocuments: ambiguous.mutationDocuments,
    reads: [() => readGate.promise],
  });

  const runA = await runRecovery(ambiguous, providerA, OWNER_A_LEASE_MS);

  await waitFor(() => {
    if (providerA.readCalls.length >= 1) return true;

    if (runA.state.settled) {
      throw new Error(
        `[GH1179_E03_TEST] recovery A settled before reading: ${describeOutcome(
          runA.state.settled
        )}`
      );
    }

    return null;
  }, 'recovery A read in flight');

  const inFlight = await e03State(
    ambiguous.fixture.shopId,
    ambiguous.generationId
  );

  expect(inFlight.verifications).toHaveLength(1);
  expect(inFlight.verifications[0].status).toBe('collecting');

  const leaseA = String(inFlight.executions[0].lease_token);

  expect(inFlight.verifications[0].started_by_lease_token).toBe(leaseA);

  return {
    readGate,
    providerA,
    runA,
    leaseA,
    verificationA: inFlight.verifications[0],
  };
}

describe('GH-1179 Slice E / E03 — opening inventory cutover ambiguity recovery', () => {
  it('E03-R01 — exposes recoverOpeningInventoryCutoverAmbiguity from the executor service module', () => {
    expect(typeof requireRecovery()).toBe('function');
  });

  it('E03-R02 — a LIVE E02 lease makes recovery busy: zero reads, zero mutations, zero verification rows', async () => {
    const ambiguous = await prepareAmbiguous('one_batch', { keepLive: true });
    const { shopId } = ambiguous.fixture;

    expectLiveLease(ambiguous.before.executions[0], ambiguous.before.dbNow);

    const provider = routedShopify('e03-r02', {
      mutationDocuments: ambiguous.mutationDocuments,
    });

    const run = await runRecovery(ambiguous, provider);
    const settled = await run.done;

    expect(describeOutcome(settled)).toMatch(/BUSY/i);
    expect(provider.readCalls).toHaveLength(0);
    expect(provider.mutationCalls).toHaveLength(0);
    expect(provider.unknownCalls).toHaveLength(0);

    const state = await e03State(shopId, ambiguous.generationId);

    expect(state.verifications).toHaveLength(0);
    expect(state.lines).toHaveLength(0);
    expect(state.executions).toEqual(ambiguous.before.executions);
    expect(state.batchExecutions).toEqual(ambiguous.before.batchExecutions);
    expect(state.attempts).toEqual(ambiguous.before.attempts);

    await expectCompletionMarkerNull(shopId);
    await expectSliceDUnchanged(ambiguous);
  });

  it('E03-R03 — after reclaim the collecting verification is committed and visible BEFORE the Shopify read resolves', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');
    const { shopId } = ambiguous.fixture;

    const readGate = deferred<unknown>();

    const provider = routedShopify('e03-r03', {
      mutationDocuments: ambiguous.mutationDocuments,
      reads: [() => readGate.promise],
    });

    const run = await runRecovery(ambiguous, provider);

    try {
      await waitFor(() => {
        if (provider.readCalls.length >= 1) return true;

        if (run.state.settled) {
          throw new Error(
            `[GH1179_E03_TEST] recovery settled before reading: ${describeOutcome(
              run.state.settled
            )}`
          );
        }

        return null;
      }, 'blocked readback');

      // Independent connection: only COMMITTED rows are visible here.
      const state = await e03State(shopId, ambiguous.generationId);

      expect(state.verifications).toHaveLength(1);

      const verification = state.verifications[0];

      expectInspectionHeader(ambiguous, verification, 1);
      expect(verification.status).toBe('collecting');
      expect(verification.read_completed_at).toBeNull();
      expect(verification.finalized_by_lease_token).toBeNull();
      expect(verification.verdict).toBeNull();
      expect(state.lines).toHaveLength(0);

      const execution = state.executions[0];

      expect(execution.status).toBe('executing');
      expectLiveLease(execution, state.dbNow);
      expect(execution.lease_token).not.toBe(ambiguous.fixtureLease);
      expect(verification.started_by_lease_token).toBe(execution.lease_token);

      expect(state.batchExecutions[0].status).toBe('ambiguous');

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
      readGate.resolve(
        locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'target' }))
      );
      await run.done;
    }

    expect(provider.mutationCalls).toHaveLength(0);
  });

  it('E03-R04 — all frozen targets observed → complete/applied, lines match, batch succeeded without a fabricated or copied adjustment group', async () => {
    // The E02 attempt captured a group id under a mismatched served version.
    const ambiguous = await prepareAmbiguous('one_batch', {
      ambiguity: 'served_version_mismatch',
    });
    const { shopId } = ambiguous.fixture;

    expect(ambiguous.before.attempts[0].outcome).toBe('graphql_error');
    expect(ambiguous.before.attempts[0].shopify_adjustment_group_id).not.toBeNull();

    // Readback must pin the frozen requested version, not the process value.
    process.env.SHOPIFY_API_VERSION = DIFFERENT_API_VERSION;

    let provider: RoutedShopify;

    try {
      ({ provider } = await recoverWithReads(ambiguous, 'e03-r04', [
        async () =>
          locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'target' })),
      ]));
    } finally {
      process.env.SHOPIFY_API_VERSION = FROZEN_API_VERSION;
    }

    expect(provider.readCalls).toHaveLength(1);
    expect(provider.clients.length).toBeGreaterThanOrEqual(1);

    const state = await e03State(shopId, ambiguous.generationId);
    const entry = mainEntry(ambiguous);

    expect(state.verifications).toHaveLength(1);

    const verification = state.verifications[0];

    expectInspectionHeader(ambiguous, verification, 1);
    expectFinalized(verification);
    expect(verification.status).toBe('complete');
    expect(verification.verdict).toBe('applied');
    expect(verification.served_api_version).toBe(FROZEN_API_VERSION);
    expect(Number(verification.page_count)).toBe(1);

    expect(linesOf(state, verification.verification_id)).toEqual([
      expectedLine(entry, {
        observed_on_hand: 3,
        level_present: true,
        active: true,
        tracked: true,
        line_verdict: 'match',
      }),
    ]);

    const batch = state.batchExecutions[0];

    expect(batch.status).toBe('succeeded');
    expect(batch.succeeded_at).not.toBeNull();
    expect(batch.shopify_adjustment_group_id).toBeNull();

    // The attempt's group id stays immutable attempt evidence only.
    expect(state.attempts).toEqual(ambiguous.before.attempts);

    expect(provider.mutationCalls).toHaveLength(0);
    await expectAlwaysInvariants(ambiguous, provider, state);
  });

  it('E03-R05 — all frozen OLD values observed → complete/not_applied, lines old_state, requires_regeneration, NEVER resent', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r05', [
      async () =>
        locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'old' })),
    ]);

    await expectCompletedNotRecovered(ambiguous, provider, 'not_applied', [
      expectedLine(mainEntry(ambiguous), {
        observed_on_hand: 8,
        level_present: true,
        active: true,
        tracked: true,
        line_verdict: 'old_state',
      }),
    ]);
  });

  it('E03-R06 — one target + one old value in the same batch → mixed → requires_regeneration', async () => {
    const ambiguous = await prepareAmbiguous('two_items');
    const main = mainEntry(ambiguous);
    const extra = extraEntry(ambiguous);

    expect(Number(main.batch_index)).toBe(1);
    expect(Number(extra.batch_index)).toBe(1);

    const { provider } = await recoverWithReads(ambiguous, 'e03-r06', [
      async () =>
        locationPage(ambiguous.fixture, [
          { itemGid: ambiguous.fixture.itemGid, onHand: 3 },
          {
            itemGid: ambiguous.extras[0].itemGid,
            variantGid: ambiguous.extras[0].variantGid,
            onHand: 9,
          },
        ]),
    ]);

    await expectCompletedNotRecovered(ambiguous, provider, 'mixed', [
      expectedLine(main, {
        observed_on_hand: 3,
        level_present: true,
        active: true,
        tracked: true,
        line_verdict: 'match',
      }),
      expectedLine(extra, {
        observed_on_hand: 9,
        level_present: true,
        active: true,
        tracked: true,
        line_verdict: 'old_state',
      }),
    ]);
  });

  it('E03-R07 — a third numeric value → mismatch line → mixed → requires_regeneration', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r07', [
      async () =>
        locationPage(ambiguous.fixture, [
          { itemGid: ambiguous.fixture.itemGid, onHand: 6 },
        ]),
    ]);

    await expectCompletedNotRecovered(ambiguous, provider, 'mixed', [
      expectedLine(mainEntry(ambiguous), {
        observed_on_hand: 6,
        level_present: true,
        active: true,
        tracked: true,
        line_verdict: 'mismatch',
      }),
    ]);
  });

  it('E03-R08 — frozen item absent from the Location → level_present=false, observed NULL, mismatch → mixed → requires_regeneration', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r08', [
      async () => locationPage(ambiguous.fixture, []),
    ]);

    await expectCompletedNotRecovered(ambiguous, provider, 'mixed', [
      expectedLine(mainEntry(ambiguous), {
        observed_on_hand: null,
        level_present: false,
        active: null,
        tracked: null,
        line_verdict: 'mismatch',
      }),
    ]);
  });

  it('E03-R09 — inactive frozen item → inactive line → mixed → requires_regeneration', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r09', [
      async () =>
        locationPage(ambiguous.fixture, [
          { itemGid: ambiguous.fixture.itemGid, onHand: 3, active: false },
        ]),
    ]);

    await expectCompletedNotRecovered(ambiguous, provider, 'mixed', [
      expectedLine(mainEntry(ambiguous), {
        observed_on_hand: 3,
        level_present: true,
        active: false,
        tracked: true,
        line_verdict: 'inactive',
      }),
    ]);
  });

  it('E03-R10 — untracked frozen item → untracked line → mixed → requires_regeneration', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r10', [
      async () =>
        locationPage(ambiguous.fixture, [
          { itemGid: ambiguous.fixture.itemGid, onHand: 3, tracked: false },
        ]),
    ]);

    await expectCompletedNotRecovered(ambiguous, provider, 'mixed', [
      expectedLine(mainEntry(ambiguous), {
        observed_on_hand: 3,
        level_present: true,
        active: true,
        tracked: false,
        line_verdict: 'untracked',
      }),
    ]);
  });

  it('E03-R11 — a known/mapped extra Location item is ignored: no line for it, frozen batch still applied', async () => {
    const ambiguous = await prepareAmbiguous('one_batch_with_noop');
    const { shopId } = ambiguous.fixture;

    expect(extraEntry(ambiguous).disposition).toBe('no_op');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r11', [
      async () =>
        locationPage(ambiguous.fixture, [
          { itemGid: ambiguous.fixture.itemGid, onHand: 3 },
          // Mapped, outside the frozen batch, and no longer at its frozen value.
          {
            itemGid: ambiguous.extras[0].itemGid,
            variantGid: ambiguous.extras[0].variantGid,
            onHand: 6,
          },
        ]),
    ]);

    const state = await e03State(shopId, ambiguous.generationId);
    const verification = state.verifications[0];

    expect(state.verifications).toHaveLength(1);
    expect(verification.status).toBe('complete');
    expect(verification.verdict).toBe('applied');

    expect(linesOf(state, verification.verification_id)).toEqual([
      expectedLine(mainEntry(ambiguous), {
        observed_on_hand: 3,
        level_present: true,
        active: true,
        tracked: true,
        line_verdict: 'match',
      }),
    ]);

    expect(state.batchExecutions[0].status).toBe('succeeded');
    expect(provider.mutationCalls).toHaveLength(0);
    await expectAlwaysInvariants(ambiguous, provider, state);
  });

  it('E03-R12 — a truly UNMAPPED non-zero Location item is structural drift: failed, requires_regeneration, zero resend', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');
    const { shopId } = ambiguous.fixture;

    const { provider } = await recoverWithReads(ambiguous, 'e03-r12', [
      async () =>
        locationPage(ambiguous.fixture, [
          { itemGid: ambiguous.fixture.itemGid, onHand: 3 },
          {
            itemGid: `gid://shopify/InventoryItem/${shopId}9999999`,
            variantGid: null,
            onHand: 2,
          },
        ]),
    ]);

    await expectStructuralFailure(ambiguous, provider);
  });

  it('E03-R13 — present frozen item with malformed (NULL) active/tracked evidence: failed, requires_regeneration', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r13', [
      async () =>
        locationPage(ambiguous.fixture, [
          { itemGid: ambiguous.fixture.itemGid, onHand: 3, active: null },
        ]),
    ]);

    await expectStructuralFailure(ambiguous, provider);
  });

  it('E03-R13b — present frozen item with tracked = NULL is malformed evidence (not match/old_state/mismatch): failed, requires_regeneration', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    // active = true, numeric on_hand AT THE FROZEN TARGET: ignoring tracked
    // would yield a match/applied; only malformed-evidence handling fails.
    const { provider } = await recoverWithReads(ambiguous, 'e03-r13b', [
      async () =>
        locationPage(ambiguous.fixture, [
          {
            itemGid: ambiguous.fixture.itemGid,
            onHand: 3,
            active: true,
            tracked: null,
          },
        ]),
    ]);

    expect(provider.readCalls).toHaveLength(1);

    // failed / verdict NULL / finalized by the recovery owner / zero lines /
    // batch ambiguous / requires_regeneration / zero mutations / invariants.
    await expectStructuralFailure(ambiguous, provider);
  });

  it('E03-R14 — multi-page readback: exact page_count, one served version, frozen lines persisted once', async () => {
    const ambiguous = await prepareAmbiguous('one_batch_with_noop');
    const { shopId } = ambiguous.fixture;

    const { provider } = await recoverWithReads(ambiguous, 'e03-r14', [
      async () =>
        locationPage(
          ambiguous.fixture,
          [
            {
              itemGid: ambiguous.extras[0].itemGid,
              variantGid: ambiguous.extras[0].variantGid,
              onHand: 4,
            },
          ],
          { hasNextPage: true, endCursor: 'e03-cursor-1' }
        ),
      async () =>
        locationPage(ambiguous.fixture, [
          { itemGid: ambiguous.fixture.itemGid, onHand: 3 },
        ]),
    ]);

    expect(provider.readCalls).toHaveLength(2);
    expect(provider.readCalls[0].options.variables?.after ?? null).toBeNull();
    expect(provider.readCalls[1].options.variables?.after).toBe('e03-cursor-1');

    const state = await e03State(shopId, ambiguous.generationId);
    const verification = state.verifications[0];

    expect(state.verifications).toHaveLength(1);
    expect(verification.status).toBe('complete');
    expect(verification.verdict).toBe('applied');
    expect(Number(verification.page_count)).toBe(2);
    expect(verification.served_api_version).toBe(FROZEN_API_VERSION);
    expect(linesOf(state, verification.verification_id)).toHaveLength(1);
    expect(state.batchExecutions[0].status).toBe('succeeded');

    await expectAlwaysInvariants(ambiguous, provider, state);
  });

  it('E03-R15 — readback served API version mismatch: failed, batch ambiguous, execution executing/live, zero mutations', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r15', [
      async () =>
        locationPage(
          ambiguous.fixture,
          frozenLevels(ambiguous, { 1: 'target' }),
          { served: DIFFERENT_API_VERSION }
        ),
    ]);

    await expectTransientFailure(ambiguous, provider);
  });

  it('E03-R15b — readback with NO served API version: failed, batch ambiguous, execution executing/live', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r15b', [
      async () =>
        locationPage(
          ambiguous.fixture,
          frozenLevels(ambiguous, { 1: 'target' }),
          { served: null }
        ),
    ]);

    await expectTransientFailure(ambiguous, provider);
  });

  it('E03-R16 — readback no-response: failed, batch ambiguous, execution executing/live', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r16', [
      async () => {
        throw noResponseError();
      },
    ]);

    expect(provider.readCalls).toHaveLength(1);
    await expectTransientFailure(ambiguous, provider);
  });

  it('E03-R17a — readback AbortError: failed, batch ambiguous, execution executing/live', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r17a', [
      async () => {
        throw namedError('AbortError');
      },
    ]);

    expect(provider.readCalls).toHaveLength(1);
    await expectTransientFailure(ambiguous, provider);
  });

  it('E03-R17b — readback TimeoutError: failed, batch ambiguous, execution executing/live', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r17b', [
      async () => {
        throw namedError('TimeoutError');
      },
    ]);

    expect(provider.readCalls).toHaveLength(1);
    await expectTransientFailure(ambiguous, provider);
  });

  it('E03-R18 — readback HTTP 5xx: failed, batch ambiguous, execution executing/live', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r18', [
      async () => {
        throw internalServerError();
      },
    ]);

    expect(provider.readCalls).toHaveLength(1);
    await expectTransientFailure(ambiguous, provider);
  });

  it('E03-R19 — readback GraphqlQueryError: failed, batch ambiguous, execution executing/live', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');

    const { provider } = await recoverWithReads(ambiguous, 'e03-r19', [
      async () => {
        throw topLevelGraphqlError();
      },
    ]);

    expect(provider.readCalls).toHaveLength(1);
    await expectTransientFailure(ambiguous, provider);
  });

  it('E03-R20 — a failed read is retried only as a NEW read-only verification after expiry/reclaim; the failed row stays immutable', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');
    const { shopId } = ambiguous.fixture;

    const first = await recoverWithReads(
      ambiguous,
      'e03-r20-first',
      [
        async () => {
          throw noResponseError();
        },
      ],
      OWNER_A_LEASE_MS
    );

    const failed = await expectTransientFailure(ambiguous, first.provider);
    const failedRow = failed.verifications[0];

    await waitForLeaseExpiry(shopId, ambiguous.executionId);

    const second = await recoverWithReads(ambiguous, 'e03-r20-second', [
      async () =>
        locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'target' })),
    ]);

    const state = await e03State(shopId, ambiguous.generationId);

    expect(state.verifications).toHaveLength(2);
    expect(state.verifications[0]).toEqual(failedRow);

    const retried = state.verifications[1];

    expect(retried.verification_id).not.toBe(failedRow.verification_id);
    expect(retried.started_by_lease_token).not.toBe(
      failedRow.started_by_lease_token
    );
    expect(retried.status).toBe('complete');
    expect(retried.verdict).toBe('applied');
    expect(state.batchExecutions[0].status).toBe('succeeded');

    expect(first.provider.mutationCalls).toHaveLength(0);
    expect(second.provider.mutationCalls).toHaveLength(0);
    expect(second.provider.readCalls).toHaveLength(1);

    await expectAlwaysInvariants(ambiguous, second.provider, state);
  });

  it('E03-R21 — two genuinely overlapping recovery callers: one lease owner, one collecting verification, one read flow', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');
    const { shopId } = ambiguous.fixture;
    const recover = requireRecovery();

    const readGate = deferred<unknown>();

    // Shared provider: a second read from either caller would be unexpected.
    const provider = routedShopify('e03-r21', {
      mutationDocuments: ambiguous.mutationDocuments,
      reads: [() => readGate.promise],
    });

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
          .where({ shop_id: shopId, execution_id: ambiguous.executionId })
          .forUpdate()
          .select('execution_id');

        if (locked.length !== 1) {
          throw new Error('[GH1179_E03_TEST] execution row not locked');
        }

        markBlockerLocked(Number(pid.rows[0].pid));
        await blockerReleased;
      });

      const blockerPid = await Promise.race([
        blockerLocked,
        blocker.then(() => {
          throw new Error('[GH1179_E03_TEST] blocker ended before locking');
        }),
      ]);

      for (let i = 0; i < 2; i += 1) {
        runs.push(
          track(
            recover(
              { shopId, generationId: ambiguous.generationId },
              { createShopifyGraphQLClient: provider.createShopifyGraphQLClient }
            )
          )
        );
      }

      const contenders = await waitFor(async () => {
        if (runs.every((run) => run.state.settled)) {
          throw new Error(
            '[GH1179_E03_TEST] both callers settled before overlap was observed: ' +
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
      }, 'both recovery claims blocked concurrently');

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

      const inFlight = await e03State(shopId, ambiguous.generationId);

      expect(inFlight.verifications).toHaveLength(1);
      expect(inFlight.verifications[0].status).toBe('collecting');
      expect(inFlight.verifications[0].started_by_lease_token).toBe(
        inFlight.executions[0].lease_token
      );
    } finally {
      releaseBlocker();

      if (blocker) {
        await blocker.catch(() => undefined);
      }

      readGate.resolve(
        locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'target' }))
      );
      await Promise.all(runs.map((run) => run.done));
    }

    const state = await e03State(shopId, ambiguous.generationId);

    expect(provider.readCalls).toHaveLength(1);
    expect(provider.mutationCalls).toHaveLength(0);
    expect(state.verifications).toHaveLength(1);
    expect(state.verifications[0].verdict).toBe('applied');

    await expectAlwaysInvariants(ambiguous, provider, state);
  });

  it('E03-R22 — lease expires during a blocked read: B reclaims and A\'s collecting verification is abandoned by B', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');
    const { shopId } = ambiguous.fixture;

    const ownerA = await startBlockedRecoveryA(ambiguous);

    try {
      await waitForLeaseExpiry(shopId, ambiguous.executionId);

      const ownerB = await recoverWithReads(ambiguous, 'recovery-B', [
        async () =>
          locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'target' })),
      ]);

      // Genuine overlap: B finished while A's read was still unresolved.
      expect(ownerA.providerA.readCalls[0].settled).toBe(false);
      expect(ownerA.runA.state.settled).toBeNull();

      const state = await e03State(shopId, ambiguous.generationId);
      const leaseB = String(state.executions[0].lease_token);

      expect(leaseB).not.toBe(ownerA.leaseA);
      expect(state.executions[0].status).toBe('verifying');

      expect(state.verifications).toHaveLength(2);

      const abandoned = state.verifications.find(
        (row: any) =>
          row.verification_id === ownerA.verificationA.verification_id
      );

      expect(abandoned.status).toBe('abandoned');
      expect(abandoned.read_completed_at).not.toBeNull();
      expect(abandoned.finalized_by_lease_token).toBe(leaseB);
      expect(abandoned.started_by_lease_token).toBe(ownerA.leaseA);
      expect(abandoned.verdict).toBeNull();
      expect(linesOf(state, abandoned.verification_id)).toEqual([]);

      const fresh = state.verifications.find(
        (row: any) =>
          row.verification_id !== ownerA.verificationA.verification_id
      );

      expect(fresh.started_by_lease_token).toBe(leaseB);
      expect(fresh.status).toBe('complete');
      expect(fresh.verdict).toBe('applied');

      expect(ownerB.provider.mutationCalls).toHaveLength(0);
      await expectAlwaysInvariants(ambiguous, ownerB.provider, state);
    } finally {
      ownerA.readGate.resolve(
        locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'target' }))
      );
      await ownerA.runA.done;
    }

    expect(ownerA.providerA.mutationCalls).toHaveLength(0);
  });

  it('E03-R23 — A\'s late read result after B\'s reclaim cannot add lines, finalize, or change batch/execution', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');
    const { shopId } = ambiguous.fixture;

    const ownerA = await startBlockedRecoveryA(ambiguous);

    try {
      await waitForLeaseExpiry(shopId, ambiguous.executionId);

      // B reads OLD values: a completed not_applied inspection that ends the
      // execution. A's late "applied" evidence must not overturn it.
      const ownerB = await recoverWithReads(ambiguous, 'recovery-B', [
        async () =>
          locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'old' })),
      ]);

      expect(ownerB.provider.mutationCalls).toHaveLength(0);

      const afterB = await e03State(shopId, ambiguous.generationId);

      expectRequiresRegeneration(afterB.executions[0]);
      expect(afterB.batchExecutions[0].status).toBe('ambiguous');

      ownerA.readGate.resolve(
        locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'target' }))
      );

      const settledA = await ownerA.runA.done;

      expect(describeOutcome(settledA)).toMatch(STALE_CLAIM);

      const afterA = await e03State(shopId, ambiguous.generationId);

      expect(afterA.executions).toEqual(afterB.executions);
      expect(afterA.batchExecutions).toEqual(afterB.batchExecutions);
      expect(afterA.verifications).toEqual(afterB.verifications);
      expect(afterA.lines).toEqual(afterB.lines);
      expect(linesOf(afterA, ownerA.verificationA.verification_id)).toEqual([]);

      await expectAlwaysInvariants(ambiguous, ownerB.provider, afterA);
    } finally {
      ownerA.readGate.resolve(
        locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'target' }))
      );
      await ownerA.runA.done;
    }

    expect(ownerA.providerA.mutationCalls).toHaveLength(0);
  });

  it('E03-R24 — two batches: batch 1 recovered applied, normal revalidation, then batch 2 dispatched exactly once', async () => {
    const ambiguous = await prepareAmbiguous('two_batches');
    const { shopId } = ambiguous.fixture;

    const batch2 = ambiguous.batches[1];

    expect(ambiguous.before.batchExecutions[1].status).toBe('pending');
    expect(writeEntries(ambiguous, 1)).toHaveLength(250);

    const provider = routedShopify('e03-r24', {
      mutationDocuments: ambiguous.mutationDocuments,
      reads: [
        async () =>
          locationPage(
            ambiguous.fixture,
            frozenLevels(ambiguous, { 1: 'target', 2: 'old' })
          ),
      ],
      mutations: [
        async () => mutationSuccess(adjustmentGroupGid(shopId, 242)),
      ],
    });

    const run = await runRecovery(ambiguous, provider);
    await run.done;

    expect(provider.readCalls).toHaveLength(1);
    expect(provider.mutationCalls).toHaveLength(1);
    expect(provider.mutationCalls[0].document).toBe(batch2.graphql_document);
    expect(provider.mutationCalls[0].options.variables).toEqual(
      JSON.parse(batch2.canonical_variables)
    );

    const state = await e03State(shopId, ambiguous.generationId);
    const verification = state.verifications[0];

    expect(state.verifications).toHaveLength(1);
    expect(Number(verification.batch_index)).toBe(1);
    expect(verification.verdict).toBe('applied');

    const lines = linesOf(state, verification.verification_id);

    expect(lines).toHaveLength(250);
    expect(lines.every((line: any) => line.line_verdict === 'match')).toBe(true);

    expect(state.batchExecutions.map((row: any) => row.status)).toEqual([
      'succeeded',
      'succeeded',
    ]);
    expect(state.batchExecutions[0].shopify_adjustment_group_id).toBeNull();
    expect(state.batchExecutions[1].shopify_adjustment_group_id).toBe(
      adjustmentGroupGid(shopId, 242)
    );

    expect(state.executions[0].status).toBe('verifying');
    expectLiveLease(state.executions[0], state.dbNow);

    await expectAlwaysInvariants(ambiguous, provider, state);
  });

  it('E03-R25 — local drift before batch 2: batch 1 recovered applied, execution requires_regeneration, batch 2 never dispatched', async () => {
    const ambiguous = await prepareAmbiguous('two_batches');
    const { shopId } = ambiguous.fixture;

    // Committed physical truth change after freeze: the normal E02
    // revalidation before batch 2 must refuse to dispatch.
    await seedTruth(ambiguous.fixture, { quantity: 7 });

    const provider = routedShopify('e03-r25', {
      mutationDocuments: ambiguous.mutationDocuments,
      reads: [
        async () =>
          locationPage(
            ambiguous.fixture,
            frozenLevels(ambiguous, { 1: 'target', 2: 'old' })
          ),
      ],
    });

    const run = await runRecovery(ambiguous, provider);
    await run.done;

    expect(provider.readCalls).toHaveLength(1);
    expect(provider.mutationCalls).toHaveLength(0);

    const state = await e03State(shopId, ambiguous.generationId);

    expect(state.verifications).toHaveLength(1);
    expect(state.verifications[0].verdict).toBe('applied');
    expect(state.batchExecutions[0].status).toBe('succeeded');
    expect(state.batchExecutions[1].status).toBe('pending');
    expect(Number(state.batchExecutions[1].attempt_count)).toBe(0);
    expectRequiresRegeneration(state.executions[0]);

    await expectAlwaysInvariants(ambiguous, provider, state);
  });

  it('E03-R26 — final ambiguous batch recovered applied → verifying with live lease, no final_convergence verification', async () => {
    const ambiguous = await prepareAmbiguous('one_batch');
    const { shopId } = ambiguous.fixture;

    const { provider } = await recoverWithReads(ambiguous, 'e03-r26', [
      async () =>
        locationPage(ambiguous.fixture, frozenLevels(ambiguous, { 1: 'target' })),
    ]);

    const state = await e03State(shopId, ambiguous.generationId);

    expect(state.batchExecutions[0].status).toBe('succeeded');
    expect(state.executions[0].status).toBe('verifying');
    expectLiveLease(state.executions[0], state.dbNow);
    expect(state.executions[0].lease_token).toBe(
      state.verifications[0].finalized_by_lease_token
    );

    expect(
      state.verifications.filter(
        (row: any) => row.purpose === 'final_convergence'
      )
    ).toHaveLength(0);
    expect(state.verifications).toHaveLength(1);

    expect(provider.mutationCalls).toHaveLength(0);
    await expectAlwaysInvariants(ambiguous, provider, state);
  });

  it('E03-R27 — onPage checks lease liveness without extending it: a stale multi-page reader stops and persists nothing', async () => {
    const ambiguous = await prepareAmbiguous('one_batch_with_noop');
    const { shopId } = ambiguous.fixture;

    const pageOneGate = deferred<unknown>();

    const providerA = routedShopify('recovery-A-paged', {
      mutationDocuments: ambiguous.mutationDocuments,
      reads: [
        () => pageOneGate.promise,
        async () =>
          locationPage(ambiguous.fixture, [
            { itemGid: ambiguous.fixture.itemGid, onHand: 3 },
          ]),
      ],
    });

    const runA = await runRecovery(ambiguous, providerA, OWNER_A_LEASE_MS);

    try {
      await waitFor(() => {
        if (providerA.readCalls.length >= 1) return true;

        if (runA.state.settled) {
          throw new Error(
            `[GH1179_E03_TEST] recovery A settled before reading: ${describeOutcome(
              runA.state.settled
            )}`
          );
        }

        return null;
      }, 'paged recovery A read in flight');

      const inFlight = await e03State(shopId, ambiguous.generationId);
      const leaseA = inFlight.executions[0].lease_token;
      const expiresA = inFlight.executions[0].lease_expires_at;

      await waitForLeaseExpiry(shopId, ambiguous.executionId);

      // Page 1 arrives after A's lease expired; more pages remain.
      pageOneGate.resolve(
        locationPage(
          ambiguous.fixture,
          [
            {
              itemGid: ambiguous.extras[0].itemGid,
              variantGid: ambiguous.extras[0].variantGid,
              onHand: 4,
            },
          ],
          { hasNextPage: true, endCursor: 'e03-cursor-1' }
        )
      );

      const settledA = await runA.done;

      expect(describeOutcome(settledA)).toMatch(STALE_CLAIM);
      expect(providerA.readCalls).toHaveLength(1);

      const after = await e03State(shopId, ambiguous.generationId);

      // No heartbeat, no extension, no evidence.
      expect(after.executions[0].lease_token).toBe(leaseA);
      expect(new Date(after.executions[0].lease_expires_at).getTime()).toBe(
        new Date(expiresA).getTime()
      );
      expect(after.verifications).toHaveLength(1);
      expect(after.verifications[0].status).toBe('collecting');
      expect(after.lines).toHaveLength(0);
      expect(after.batchExecutions[0].status).toBe('ambiguous');

      expectNoAmbiguousResend(ambiguous, providerA, after);
      await expectCompletionMarkerNull(shopId);
      await expectSliceDUnchanged(ambiguous);
    } finally {
      pageOneGate.resolve(locationPage(ambiguous.fixture, []));
      await runA.done;
    }

    expect(providerA.mutationCalls).toHaveLength(0);
  });

  it('E03-R28 — batch canonical_variables disagree with frozen entries: fail closed BEFORE any provider read, requires_regeneration, zero resend', async () => {
    const ambiguous = await prepareRequestEntryMismatchAmbiguous();
    const { shopId } = ambiguous.fixture;

    // No read handlers: any provider read is an unexpected call.
    const provider = routedShopify('e03-r28', {
      mutationDocuments: ambiguous.mutationDocuments,
    });

    const run = await runRecovery(ambiguous, provider);
    await run.done;

    // Internal frozen authority is inconsistent: nothing trustworthy to compare.
    expect(provider.readCalls).toHaveLength(0);
    expect(provider.mutationCalls).toHaveLength(0);
    expect(provider.unknownCalls).toHaveLength(0);

    const state = await e03State(shopId, ambiguous.generationId);

    // Ratified ordering: the integrity cross-check precedes the collecting
    // verification header, so no verification row is ever inserted.
    expect(state.verifications).toHaveLength(0);
    expect(state.lines).toHaveLength(0);

    expect(state.batchExecutions[0].status).toBe('ambiguous');
    expect(state.batchExecutions[0].succeeded_at).toBeNull();

    const execution = state.executions[0];

    expectRequiresRegeneration(execution);
    expect(String(execution.terminal_reason)).toMatch(
      /FROZEN_REQUEST_INTEGRITY/
    );

    await expectAlwaysInvariants(ambiguous, provider, state);
  });
});
