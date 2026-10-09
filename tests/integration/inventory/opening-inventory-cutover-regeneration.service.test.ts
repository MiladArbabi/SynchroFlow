// GH-1179 Slice E / E05 — Opening Inventory cutover N+1 REGENERATION AUTHORITY.
//
// RED contract only. createOpeningInventoryCutoverGeneration already exists;
// these cases fail only where CURRENT behaviour violates the E05 contract (no
// synthetic gate, no mocked generation logic, real PostgreSQL).
//
// Locked by this suite:
// - the LATEST frozen generation N and its execution decide, under the
//   generation advisory lock: no execution / executing / verifying /
//   converged → replay N with zero provider reads; blocked → never N+1;
//   requires_regeneration → a FRESH Slice-D generation N+1;
// - N+1 re-runs T1 → fresh Shopify Location read → T2 and never clones N:
//   new generation_id, sequence N+1, fresh evidence, fresh fingerprints and
//   idempotency keys; N stays byte-identical (never "superseded");
// - a completion marker with no Slice-E converged execution refuses new
//   generation work before any provider read; a converged execution's marker
//   is completion (replay);
// - physical-truth acceptance is per fresh approval: N's acceptance never
//   authorizes N+1;
// - concurrent creators (N+1 and initial) resolve to ONE generation, both
//   callers succeed, no unique-violation surfaces.
//
// Generation is READ-only against Shopify: its provider boundary is the
// injected Location page reader. E02/E04 are used only to reach real
// execution states, through routed providers that count mutations.

const mockShopifyRequest = jest.fn(async (..._args: unknown[]) => {
  throw new Error(
    '[GH1179_E05_TEST] default Shopify transport must not be reached'
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
import { normalizeAndValidateShopifyGrantedScopes, SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';

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
  createOpeningInventoryCutoverGeneration,
  generationFingerprint,
} from 'api-src/services/wms/openingInventoryCutoverGeneration.service';

import {
  executeOpeningInventoryCutoverGeneration,
  verifyOpeningInventoryCutoverConvergence,
} from 'api-src/services/wms/openingInventoryCutoverExecution.service';

jest.setTimeout(120000);

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';
const EXECUTIONS = 'opening_inventory_cutover_executions';
const VERIFICATIONS = 'opening_inventory_cutover_verifications';

const FROZEN_API_VERSION = '2026-04';

// E02/E04 fixture owner lease: expires for real (DB time) when needed.
const FIXTURE_LEASE_MS = 2000;

const CONVERGED_REASON = 'OPENING_CUTOVER_CONVERGED';
const DRIFT_REASON =
  'OPENING_CUTOVER_EXECUTION_REVALIDATION_FAILED:PHYSICAL_TARGET_CHANGED';
const LEGACY_MARKER = '2026-01-02 03:04:05.123456+00';

// N: physical target 3, Shopify on_hand 8 → write 3 ← 8.
const N_TARGET = 3;
const N_PROVIDER = 8;

// After drift: physical target 5; fresh Shopify on_hand 6 → write 5 ← 6.
const FRESH_TARGET = 5;
const FRESH_PROVIDER = 6;

// ─── environment / independent coordinator ──────────────────────────────────

const originalApiVersion = process.env.SHOPIFY_API_VERSION;

let coord: Knex;
let coordPid = 0;

beforeAll(async () => {
  process.env.SHOPIFY_API_VERSION = FROZEN_API_VERSION;

  const testDb = String(process.env.PGDATABASE);
  expect(testDb).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  // Independent restricted-role connection: COMMITTED state and catalog only.
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
// elapsed time (D25 / E04-R38 pattern).
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

  throw new Error(`[GH1179_E05_TEST] waitFor timed out: ${label}`);
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

type Settled =
  | { ok: true; value: any }
  | { ok: false; error: unknown };

async function settle(promise: Promise<unknown>): Promise<Settled> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

function describeSettled(settled: Settled) {
  if (!('error' in settled)) {
    return { ok: true, generationId: String(settled.value?.generation_id ?? '') };
  }

  const error = settled.error as any;

  return {
    ok: false,
    code: error?.code ?? null,
    message: String(error?.message ?? error),
  };
}

// ─── generation provider boundary (read-only Location reader) ───────────────

type LocationLevel = {
  itemGid: string;
  variantGid?: string | null;
  onHand: number;
};

type ReaderCall = { shopId: number; variables: any };

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
    extensions: {},
    headers: { 'X-Shopify-API-Version': [FROZEN_API_VERSION] },
  };
}

function mainLevel(fixture: Fixture, onHand: number): LocationLevel {
  return { itemGid: fixture.itemGid, variantGid: fixture.variantGid, onHand };
}

// Counts every fresh Shopify read; an optional gate holds the read open.
function generationReader(
  fixture: Fixture,
  onHand: number,
  options: { gate?: Promise<unknown> } = {}
) {
  const calls: ReaderCall[] = [];

  const readLocationPage: OpeningInventoryLocationPageReader = async ({
    shopId,
    variables,
  }) => {
    calls.push({ shopId, variables });

    if (options.gate) {
      await options.gate;
    }

    return locationPage(fixture, [mainLevel(fixture, onHand)]);
  };

  return { calls, readLocationPage };
}

function expectReadsPinned(fixture: Fixture, calls: ReaderCall[]): void {
  for (const call of calls) {
    expect(call.shopId).toBe(fixture.shopId);
    expect(call.variables?.locationId).toBe(fixture.locationGid);
  }
}

async function createGeneration(
  fixture: Fixture,
  reader: ReturnType<typeof generationReader>,
  acceptPhysicalTruth = true
) {
  return createOpeningInventoryCutoverGeneration(
    {
      shopId: fixture.shopId,
      actingUserId: fixture.ownerId,
      acceptPhysicalTruth,
    },
    { readLocationPage: reader.readLocationPage }
  );
}

// ─── E02/E04 provider boundary, routed by GraphQL document ──────────────────

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

  const readCalls: ProviderCall[] = [];
  const mutationCalls: ProviderCall[] = [];
  const unknownCalls: ProviderCall[] = [];

  const createShopifyGraphQLClient = (_args: unknown) => ({
    request: async (document: string, options: any = {}) => {
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
        throw new Error(`[GH1179_E05_TEST] unexpected provider call on ${label}`);
      }

      return handler(call);
    },
  });

  return { readCalls, mutationCalls, unknownCalls, createShopifyGraphQLClient };
}

function mutationSuccess(shopId: number) {
  return {
    data: {
      inventorySetQuantities: {
        inventoryAdjustmentGroup: {
          id: `gid://shopify/InventoryAdjustmentGroup/${shopId}0101`,
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
            message: '[GH1179_E05_TEST] synthetic rejection',
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
    'Http request error, no response available: [GH1179_E05_TEST] simulated lost response'
  );
}

// ─── Slice-C fixture (patterned after the E02 / E04 suites) ─────────────────

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
    const id = await createTenantShop(trx, `gh1179e05-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const warehouseId = crypto.randomUUID();
  const rootCode = `E05-${unique}-ROOT`;
  const a1 = `E05-${unique}-A1`;
  const a2 = `E05-${unique}-A2`;

  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  const locationRaw = `20${shopId}`;
  const inventoryItemRaw = `${shopId}001`;
  const variantRaw = `${shopId}101`;

  const shopDomain = `gh1179e05-${unique}.myshopify.com`;
  const accessToken = `e05-offline-token-${unique}`;

  let ownerId = 0;
  let operatorId = 0;

  await withTenant(shopId, async (trx) => {
    const users = await trx('users')
      .insert([
        {
          shop_id: shopId,
          email: `e05-owner-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'owner',
        },
        {
          shop_id: shopId,
          email: `e05-operator-${unique}@example.com`,
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
      name: `Slice E05 warehouse ${unique}`,
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
      title: 'Slice E05 product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `E05-${unique}`,
      title: 'Slice E05 variant',
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
      external_sku: `E05-${unique}`,
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
      refresh_token_encrypted: encrypt('e05-canonical-refresh-no-network-call'),
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

// Opening snapshot expects 11, the count observes 3: the CURRENT progress is
// review_required, so every approval needs explicit physical-truth acceptance.
async function makeCountedReady(fixture: Fixture): Promise<void> {
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
    throw new Error('[GH1179_E05_TEST] opening cohort bins missing');
  }

  await countOpeningBin(fixture, first.recount_task_id, N_TARGET);
  await countOpeningBin(fixture, second.recount_task_id, null);

  // Slice C derives TARGET only from CURRENT inventory_truth.
  await seedTruth(fixture, N_TARGET);
}

// ─── persisted state probes ─────────────────────────────────────────────────

type GenerationAuthority = {
  generation: any;
  entries: any[];
  batches: any[];
  sha256: string;
};

async function generationAuthority(
  shopId: number,
  generationId: string
): Promise<GenerationAuthority> {
  return coordTenant(shopId, async (trx) => {
    const generation = await trx(GENERATIONS)
      .where({ shop_id: shopId, generation_id: generationId })
      .first();

    const entries = await trx(ENTRIES)
      .where({ shop_id: shopId, generation_id: generationId })
      .orderBy('ordinal', 'asc');

    const batches = await trx(BATCHES)
      .where({ shop_id: shopId, generation_id: generationId })
      .orderBy('batch_index', 'asc');

    const sha256 = crypto
      .createHash('sha256')
      .update(JSON.stringify({ generation, entries, batches }))
      .digest('hex');

    return { generation, entries, batches, sha256 };
  });
}

async function shopState(shopId: number) {
  return coordTenant(shopId, async (trx) => ({
    generations: await trx(GENERATIONS)
      .where({ shop_id: shopId })
      .orderBy('generation_sequence', 'asc'),

    entryCount: Number(
      (await trx(ENTRIES).where({ shop_id: shopId }).count('* as count').first())
        ?.count ?? 0
    ),

    batchCount: Number(
      (await trx(BATCHES).where({ shop_id: shopId }).count('* as count').first())
        ?.count ?? 0
    ),

    executions: await trx(EXECUTIONS)
      .where({ shop_id: shopId })
      .orderBy('started_at', 'asc'),

    verifications: await trx(VERIFICATIONS).where({ shop_id: shopId }),

    // Text form keeps full microsecond precision for exact preservation.
    marker: (
      await trx.raw(
        `SELECT opening_inventory_shopify_synced_at::text AS synced_at
           FROM shop_wms_settings
          WHERE shop_id = ?`,
        [shopId]
      )
    ).rows[0]?.synced_at as string | null | undefined,
  }));
}

async function waitForLeaseExpiry(
  shopId: number,
  executionId: string
): Promise<void> {
  await waitFor(async () => {
    const result = await coordTenant(shopId, (trx) =>
      trx.raw(
        `SELECT lease_expires_at <= clock_timestamp() AS expired
           FROM ${EXECUTIONS}
          WHERE execution_id = ?`,
        [executionId]
      )
    );

    return result.rows[0]?.expired === true;
  }, 'execution lease expired');
}

// ─── frozen generation N + real execution states ────────────────────────────

type FrozenN = {
  fixture: Fixture;
  generationId: string;
  n: GenerationAuthority;
};

// Real Slice-D generation N with one write batch (3 ← 8).
async function freezeN(fixture?: Fixture): Promise<FrozenN> {
  const shop = fixture ?? (await createFixture());

  if (!fixture) {
    await makeCountedReady(shop);
  }

  const reader = generationReader(shop, N_PROVIDER);
  const created = await createGeneration(shop, reader);

  expect(reader.calls).toHaveLength(1);
  expect(created.status).toBe('frozen');
  expect(Number(created.generation_sequence)).toBe(1);
  expect(Number(created.batch_count)).toBe(1);
  expect(created.physical_truth_accepted_at).not.toBeNull();

  const generationId = String(created.generation_id);

  return {
    fixture: shop,
    generationId,
    n: await generationAuthority(shop.shopId, generationId),
  };
}

async function runE02(
  frozen: FrozenN,
  provider: ReturnType<typeof routedShopify>,
  leaseDurationMs?: number
) {
  return executeOpeningInventoryCutoverGeneration(
    { shopId: frozen.fixture.shopId, generationId: frozen.generationId },
    {
      createShopifyGraphQLClient: provider.createShopifyGraphQLClient,
      leaseDurationMs,
    }
  );
}

// REAL requires_regeneration: physical truth drifts after the freeze, so E02
// revalidation refuses dispatch. Zero provider calls of any kind.
async function prepareRequiresRegeneration(): Promise<FrozenN> {
  const frozen = await freezeN();

  await seedTruth(frozen.fixture, FRESH_TARGET);

  const provider = routedShopify('e05-requires-regeneration');
  const outcome = await runE02(frozen, provider, FIXTURE_LEASE_MS);

  expect(outcome).toMatchObject({ outcome: 'requires_regeneration' });
  expect(provider.mutationCalls).toHaveLength(0);
  expect(provider.readCalls).toHaveLength(0);
  expect(provider.unknownCalls).toHaveLength(0);

  const state = await shopState(frozen.fixture.shopId);

  expect(state.executions).toHaveLength(1);
  expect(state.executions[0]).toMatchObject({
    generation_id: frozen.generationId,
    status: 'requires_regeneration',
    terminal_reason: DRIFT_REASON,
    lease_token: null,
  });
  expect(state.marker).toBeNull();

  return frozen;
}

async function prepareExecutionStatus(
  status: 'executing' | 'verifying' | 'blocked'
): Promise<{ frozen: FrozenN; mutations: number }> {
  const frozen = await freezeN();
  const { shopId } = frozen.fixture;

  const provider = routedShopify(`e05-${status}`, {
    mutations: [
      status === 'executing'
        ? async () => {
            throw noResponseError();
          }
        : status === 'blocked'
          ? async () => mutationUserErrors()
          : async () => mutationSuccess(shopId),
    ],
  });

  await runE02(frozen, provider);

  expect(provider.mutationCalls).toHaveLength(1);
  expect(provider.readCalls).toHaveLength(0);

  const state = await shopState(shopId);

  expect(state.executions).toHaveLength(1);
  expect(state.executions[0].status).toBe(status);

  return { frozen, mutations: provider.mutationCalls.length };
}

// Legitimate Slice-E completion through the REAL E04 entrypoint.
async function prepareConvergedByE04(): Promise<FrozenN> {
  const frozen = await freezeN();
  const { shopId } = frozen.fixture;

  const e02 = routedShopify('e05-converged-e02', {
    mutations: [async () => mutationSuccess(shopId)],
  });

  expect(await runE02(frozen, e02, FIXTURE_LEASE_MS)).toMatchObject({
    outcome: 'verifying',
  });

  const verifying = await shopState(shopId);
  await waitForLeaseExpiry(shopId, String(verifying.executions[0].execution_id));

  const e04 = routedShopify('e05-converged-e04', {
    reads: [async () => locationPage(frozen.fixture, [mainLevel(frozen.fixture, N_TARGET)])],
  });

  expect(
    await verifyOpeningInventoryCutoverConvergence(
      { shopId, generationId: frozen.generationId },
      { createShopifyGraphQLClient: e04.createShopifyGraphQLClient }
    )
  ).toMatchObject({ outcome: 'converged' });

  expect(e02.mutationCalls).toHaveLength(1);
  expect(e04.mutationCalls).toHaveLength(0);

  const state = await shopState(shopId);

  expect(state.executions[0].status).toBe('converged');
  expect(state.marker).not.toBeNull();

  return frozen;
}

async function expectNUnchanged(frozen: FrozenN): Promise<void> {
  const after = await generationAuthority(frozen.fixture.shopId, frozen.generationId);

  expect(after.generation).toEqual(frozen.n.generation);
  expect(after.entries).toEqual(frozen.n.entries);
  expect(after.batches).toEqual(frozen.n.batches);
  expect(after.sha256).toBe(frozen.n.sha256);
}

// A call whose only acceptable result is replay of N: same N row, no reads.
async function expectReplayOfN(frozen: FrozenN, label: string) {
  const { shopId } = frozen.fixture;
  const before = await shopState(shopId);
  const reader = generationReader(frozen.fixture, FRESH_PROVIDER);

  const settled = await settle(createGeneration(frozen.fixture, reader));

  expect(describeSettled(settled)).toEqual({ ok: true, generationId: frozen.generationId });
  expect(reader.calls).toHaveLength(0);

  const after = await shopState(shopId);

  expect(after.generations.map((row: any) => row.generation_id)).toEqual([
    frozen.generationId,
  ]);
  expect(after.entryCount).toBe(before.entryCount);
  expect(after.batchCount).toBe(before.batchCount);
  expect(after.executions).toEqual(before.executions);
  expect(after.marker).toBe(before.marker);

  await expectNUnchanged(frozen);

  return { label, after };
}

// The single eligible N → N+1 attempt shared by R01–R03 / R14.
async function regenerate(frozen: FrozenN) {
  const reader = generationReader(frozen.fixture, FRESH_PROVIDER);
  const settled = await settle(createGeneration(frozen.fixture, reader));
  const state = await shopState(frozen.fixture.shopId);

  return { reader, settled, state };
}

function nPlusOneOf(state: Awaited<ReturnType<typeof shopState>>, frozen: FrozenN) {
  return state.generations.find(
    (row: any) => row.generation_id !== frozen.generationId
  );
}

describe('GH-1179 Slice E / E05 — N+1 regeneration authority', () => {
  it('E05-R01 — N requires_regeneration → a NEW generation N+1 (sequence N+1) from a fresh provider read; N unchanged', async () => {
    const frozen = await prepareRequiresRegeneration();
    const { reader, settled, state } = await regenerate(frozen);

    expect(describeSettled(settled).ok).toBe(true);

    const returnedId = String((settled as any).value?.generation_id);

    expect(returnedId).not.toBe(frozen.generationId);
    expect(reader.calls).toHaveLength(1);
    expectReadsPinned(frozen.fixture, reader.calls);

    expect(state.generations.map((row: any) => Number(row.generation_sequence))).toEqual([
      Number(frozen.n.generation.generation_sequence),
      Number(frozen.n.generation.generation_sequence) + 1,
    ]);

    const next = nPlusOneOf(state, frozen);

    expect(next?.generation_id).toBe(returnedId);
    expect(next?.status).toBe('frozen');

    // No execution is created by generation; N's terminal execution stays.
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0].status).toBe('requires_regeneration');
    expect(state.marker).toBeNull();

    await expectNUnchanged(frozen);
  });

  it('E05-R02 — N+1 persists FRESH provider/target evidence (5 ← 6), never N\'s (3 ← 8)', async () => {
    const frozen = await prepareRequiresRegeneration();
    const { reader, state } = await regenerate(frozen);

    expect(reader.calls).toHaveLength(1);

    const next = nPlusOneOf(state, frozen);

    expect(next).toBeDefined();

    const fresh = await generationAuthority(frozen.fixture.shopId, next.generation_id);

    expect(fresh.entries.map((entry: any) => ({
      item: entry.shopify_inventory_item_gid,
      target: Number(entry.target_quantity),
      observed: Number(entry.observed_on_hand_quantity),
      disposition: entry.disposition,
    }))).toEqual([
      {
        item: frozen.fixture.itemGid,
        target: FRESH_TARGET,
        observed: FRESH_PROVIDER,
        disposition: 'write',
      },
    ]);

    const variables = JSON.parse(String(fresh.batches[0].canonical_variables));

    expect(variables.input.quantities).toEqual([
      {
        inventoryItemId: frozen.fixture.itemGid,
        locationId: frozen.fixture.locationGid,
        quantity: FRESH_TARGET,
        changeFromQuantity: FRESH_PROVIDER,
      },
    ]);

    expect(fresh.generation.requested_api_version).toBe(FROZEN_API_VERSION);
    expect(fresh.generation.served_api_version).toBe(FROZEN_API_VERSION);
    expect(Number(fresh.generation.provider_page_count)).toBe(1);
    expect(new Date(fresh.generation.provider_read_started_at).getTime()).toBeGreaterThan(
      new Date(frozen.n.generation.provider_read_completed_at).getTime()
    );

    await expectNUnchanged(frozen);
  });

  it('E05-R03 — N+1 has fresh identity: new generation_id, sequence, idempotency keys, fingerprints and absolute request', async () => {
    const frozen = await prepareRequiresRegeneration();
    const { state } = await regenerate(frozen);
    const next = nPlusOneOf(state, frozen);

    expect(next).toBeDefined();

    const fresh = await generationAuthority(frozen.fixture.shopId, next.generation_id);
    const n = frozen.n;

    expect(fresh.generation.generation_id).not.toBe(n.generation.generation_id);
    expect(Number(fresh.generation.generation_sequence)).toBe(
      Number(n.generation.generation_sequence) + 1
    );

    // Unchanged authority stays equal; changed authority is recomputed.
    expect(fresh.generation.shopify_shop_gid).toBe(n.generation.shopify_shop_gid);
    expect(fresh.generation.shopify_location_gid).toBe(n.generation.shopify_location_gid);
    expect(fresh.generation.identity_fingerprint).toBe(n.generation.identity_fingerprint);

    expect(fresh.generation.target_fingerprint).toBe(
      generationFingerprint([
        { lasyncroVariantId: frozen.fixture.variantId, targetQuantity: FRESH_TARGET },
      ])
    );
    expect(fresh.generation.target_fingerprint).not.toBe(n.generation.target_fingerprint);
    expect(fresh.generation.provider_read_fingerprint).not.toBe(
      n.generation.provider_read_fingerprint
    );
    expect(fresh.generation.generation_fingerprint).not.toBe(
      n.generation.generation_fingerprint
    );

    expect(fresh.batches).toHaveLength(1);
    expect(fresh.batches[0].idempotency_key).not.toBe(n.batches[0].idempotency_key);
    expect(fresh.batches[0].request_sha256).not.toBe(n.batches[0].request_sha256);

    const variables = JSON.parse(String(fresh.batches[0].canonical_variables));

    expect(variables.idempotencyKey).toBe(fresh.batches[0].idempotency_key);
    expect(variables.input).toMatchObject({ name: 'on_hand', reason: 'correction' });
    expect(String(variables.input.referenceDocumentUri)).toContain(
      `generation-${fresh.generation.generation_id}`
    );

    await expectNUnchanged(frozen);
  });

  it('E05-R04 — frozen N with NO execution: replay N, zero provider reads, one generation', async () => {
    const frozen = await freezeN();

    await expectReplayOfN(frozen, 'no-execution');
  });

  it('E05-R05 — N executing (live E02 lease after an ambiguous dispatch): replay N, zero reads', async () => {
    const { frozen } = await prepareExecutionStatus('executing');

    await expectReplayOfN(frozen, 'executing');
  });

  it('E05-R06 — N verifying through real E02: replay N, zero reads', async () => {
    const { frozen } = await prepareExecutionStatus('verifying');

    await expectReplayOfN(frozen, 'verifying');
  });

  it('E05-R07 — N converged through real E04: replay N, zero reads, no N+1, marker unchanged', async () => {
    const frozen = await prepareConvergedByE04();

    await expectReplayOfN(frozen, 'converged');
  });

  it('E05-R08 — N blocked by a definite Shopify userError: never N+1, zero reads, N unchanged', async () => {
    const { frozen } = await prepareExecutionStatus('blocked');
    const { shopId } = frozen.fixture;
    const before = await shopState(shopId);
    const reader = generationReader(frozen.fixture, FRESH_PROVIDER);

    // Replay of N or an existing typed rejection are both acceptable.
    const settled = await settle(createGeneration(frozen.fixture, reader));

    if (settled.ok) {
      expect(String(settled.value?.generation_id)).toBe(frozen.generationId);
    }

    expect(reader.calls).toHaveLength(0);

    const after = await shopState(shopId);

    expect(after.generations.map((row: any) => row.generation_id)).toEqual([
      frozen.generationId,
    ]);
    expect(after.entryCount).toBe(before.entryCount);
    expect(after.batchCount).toBe(before.batchCount);
    expect(after.executions).toEqual(before.executions);

    await expectNUnchanged(frozen);
  });

  it('E05-R09 — legacy completion marker with no Slice-E converged execution: no provider read, no generation, marker preserved', async () => {
    const fixture = await createFixture();
    await makeCountedReady(fixture);

    const marked = await withTenant(fixture.shopId, (trx) =>
      trx('shop_wms_settings')
        .where({ shop_id: fixture.shopId })
        .update({
          opening_inventory_shopify_synced_at: trx.raw('?::timestamptz', [LEGACY_MARKER]),
        })
    );

    expect(marked).toBe(1);

    const before = await shopState(fixture.shopId);
    const reader = generationReader(fixture, N_PROVIDER);

    // Refusal shape is not pinned (E06 owns public mapping).
    await settle(createGeneration(fixture, reader));

    expect(reader.calls).toHaveLength(0);

    const after = await shopState(fixture.shopId);

    expect(after.generations).toHaveLength(0);
    expect(after.entryCount).toBe(0);
    expect(after.batchCount).toBe(0);
    expect(after.marker).toBe(before.marker);

    const preserved = await coordTenant(fixture.shopId, async (trx) =>
      (
        await trx.raw(
          `SELECT opening_inventory_shopify_synced_at = ?::timestamptz AS preserved
             FROM shop_wms_settings WHERE shop_id = ?`,
          [LEGACY_MARKER, fixture.shopId]
        )
      ).rows[0]
    );

    expect(preserved).toEqual({ preserved: true });
  });

  it('E05-R10 — legitimate converged marker: replay N, zero reads, no N+1, exact marker unchanged', async () => {
    const { frozen } = await prepareExecutionStatus('verifying');
    const { shopId } = frozen.fixture;

    // No helper beyond E04 produces converged with a FIXED marker value: the
    // 0203-legal verifying → converged transition and marker in one
    // transaction (E04-R31 precedent).
    await withTenant(shopId, async (trx) => {
      const converged = await trx(EXECUTIONS)
        .where({ shop_id: shopId, generation_id: frozen.generationId, status: 'verifying' })
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
        .update({
          opening_inventory_shopify_synced_at: trx.raw('?::timestamptz', [LEGACY_MARKER]),
        });

      expect(marked).toBe(1);
    });

    const { after } = await expectReplayOfN(frozen, 'converged-marker');

    expect(after.executions[0].status).toBe('converged');

    const preserved = await coordTenant(shopId, async (trx) =>
      (
        await trx.raw(
          `SELECT opening_inventory_shopify_synced_at = ?::timestamptz AS preserved
             FROM shop_wms_settings WHERE shop_id = ?`,
          [LEGACY_MARKER, shopId]
        )
      ).rows[0]
    );

    expect(preserved).toEqual({ preserved: true });
  });

  it('E05-R11 — N\'s physical-truth acceptance never authorizes N+1: no fresh acceptance is refused before any read; fresh acceptance proceeds', async () => {
    const frozen = await prepareRequiresRegeneration();
    const { shopId } = frozen.fixture;

    // N was accepted; CURRENT progress is still review_required.
    expect(frozen.n.generation.physical_truth_accepted_at).not.toBeNull();

    const unaccepted = generationReader(frozen.fixture, FRESH_PROVIDER);
    const refused = await settle(createGeneration(frozen.fixture, unaccepted, false));

    expect(describeSettled(refused)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^\[OPENING_CUTOVER_ACCEPTANCE_REQUIRED\]/),
    });
    expect(unaccepted.calls).toHaveLength(0);
    expect((await shopState(shopId)).generations).toHaveLength(1);

    const accepted = generationReader(frozen.fixture, FRESH_PROVIDER);
    const created = await settle(createGeneration(frozen.fixture, accepted, true));

    expect(describeSettled(created).ok).toBe(true);
    expect(accepted.calls).toHaveLength(1);

    const state = await shopState(shopId);
    const next = nPlusOneOf(state, frozen);

    expect(state.generations).toHaveLength(2);
    expect(next?.physical_truth_accepted_at).not.toBeNull();
    expect(new Date(next.physical_truth_accepted_at).getTime()).toBeGreaterThan(
      new Date(frozen.n.generation.physical_truth_accepted_at).getTime()
    );

    await expectNUnchanged(frozen);
  });

  // ─── concurrency: two creators overlapping at T2 ──────────────────────────

  // Both callers finish T1 and hold their Shopify read open; an independent
  // backend then takes the generation advisory lock, the reads are released,
  // and BOTH T2 transactions are observed queued behind that lock before it is
  // released. Whatever T2 does under the lock, both callers must agree on one
  // generation.
  async function raceCreators(fixture: Fixture, onHand: number) {
    const readGate = deferred<void>();

    const readers = [
      generationReader(fixture, onHand, { gate: readGate.promise }),
      generationReader(fixture, onHand, { gate: readGate.promise }),
    ];

    let releaseBlocker: () => void = () => undefined;
    const blockerReleased = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    let markBlockerLocked: (pid: number) => void = () => undefined;
    const blockerLocked = new Promise<number>((resolve) => {
      markBlockerLocked = resolve;
    });

    let blocker: Promise<void> | null = null;
    let waiting: any[] = [];

    const runs = readers.map((reader) =>
      settle(createGeneration(fixture, reader))
    );

    let settledCount = 0;
    runs.forEach((run) => run.then(() => { settledCount += 1; }));

    try {
      await waitFor(() => {
        if (readers.every((reader) => reader.calls.length >= 1)) return true;

        if (settledCount > 0) {
          throw new Error(
            '[GH1179_E05_TEST] a creator settled before both fresh provider reads were in flight ' +
              `(reads: ${readers.map((reader) => reader.calls.length).join('/')})`
          );
        }

        return null;
      }, 'both creators reading Shopify');

      blocker = withTenant(fixture.shopId, async (trx) => {
        const pid = await trx.raw('SELECT pg_backend_pid() AS pid');

        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [
          'opening_inventory_cutover',
          fixture.shopId,
        ]);

        markBlockerLocked(Number(pid.rows[0].pid));
        await blockerReleased;
      });

      const blockerPid = await Promise.race([
        blockerLocked,
        blocker.then(() => {
          throw new Error('[GH1179_E05_TEST] blocker ended before locking');
        }),
      ]);

      readGate.resolve();

      waiting = await waitFor(async () => {
        if (settledCount > 0) {
          throw new Error(
            '[GH1179_E05_TEST] a creator settled before both T2 transactions queued on the advisory lock'
          );
        }

        const result = await coord.raw(
          `SELECT a.pid,
                  a.wait_event_type,
                  a.backend_xmin IS NOT NULL AS has_snapshot
             FROM pg_stat_activity a
            WHERE a.datname = current_database()
              AND a.backend_type = 'client backend'
              AND a.pid NOT IN (?, ?)
              AND ? = ANY(pg_blocking_pids(a.pid))`,
          [blockerPid, coordPid, blockerPid]
        );

        return result.rows.length >= 2 ? result.rows : null;
      }, 'both T2 transactions queued behind the advisory lock');

      // Evidence only: whether each queued T2 already holds an RR snapshot.
      console.info('[GH1179_E05_T2_RACE_EVIDENCE]', JSON.stringify(waiting));

      releaseBlocker();
      await blocker;
    } finally {
      readGate.resolve();
      releaseBlocker();

      if (blocker) {
        await blocker.catch(() => undefined);
      }
    }

    const outcomes = await Promise.all(runs);

    return { readers, waiting, outcomes };
  }

  it('E05-R12 — two concurrent N+1 creators: exactly one N+1, both callers succeed with the SAME N+1, no unique violation', async () => {
    const frozen = await prepareRequiresRegeneration();
    const { shopId } = frozen.fixture;

    const { waiting, outcomes } = await raceCreators(frozen.fixture, FRESH_PROVIDER);

    expect(waiting.length).toBeGreaterThanOrEqual(2);
    expect(waiting.every((row: any) => row.wait_event_type === 'Lock')).toBe(true);

    const described = outcomes.map(describeSettled);

    expect(described.filter((outcome) => !outcome.ok)).toEqual([]);

    const state = await shopState(shopId);

    expect(state.generations.map((row: any) => Number(row.generation_sequence))).toEqual([1, 2]);

    const next = nPlusOneOf(state, frozen);

    expect(described.map((outcome) => outcome.generationId)).toEqual([
      next?.generation_id,
      next?.generation_id,
    ]);
    expect(state.batchCount).toBe(2);
    expect(state.executions).toHaveLength(1);

    await expectNUnchanged(frozen);
  });

  it('E05-R13 — two concurrent INITIAL creators: exactly one generation 1, both callers succeed with it, no unique violation', async () => {
    const fixture = await createFixture();
    await makeCountedReady(fixture);

    const { waiting, outcomes } = await raceCreators(fixture, N_PROVIDER);

    expect(waiting.length).toBeGreaterThanOrEqual(2);
    expect(waiting.every((row: any) => row.wait_event_type === 'Lock')).toBe(true);

    const described = outcomes.map(describeSettled);

    expect(described.filter((outcome) => !outcome.ok)).toEqual([]);

    const state = await shopState(fixture.shopId);

    expect(state.generations.map((row: any) => Number(row.generation_sequence))).toEqual([1]);
    expect(described.map((outcome) => outcome.generationId)).toEqual([
      state.generations[0].generation_id,
      state.generations[0].generation_id,
    ]);
    expect(state.batchCount).toBe(1);
    expect(state.entryCount).toBe(1);
  });

  it('E05-R14 — once N+1 exists with no execution, the next call replays N+1: zero reads, no N+2', async () => {
    const frozen = await prepareRequiresRegeneration();
    const { shopId } = frozen.fixture;

    const first = await regenerate(frozen);
    const next = nPlusOneOf(first.state, frozen);

    expect(next).toBeDefined();
    expect(Number(next.generation_sequence)).toBe(2);

    const nPlusOne = await generationAuthority(shopId, next.generation_id);
    const retry = generationReader(frozen.fixture, FRESH_PROVIDER);
    const settled = await settle(createGeneration(frozen.fixture, retry));

    expect(describeSettled(settled)).toEqual({ ok: true, generationId: next.generation_id });
    expect(retry.calls).toHaveLength(0);

    const state = await shopState(shopId);

    expect(state.generations.map((row: any) => Number(row.generation_sequence))).toEqual([1, 2]);
    expect(await generationAuthority(shopId, next.generation_id)).toEqual(nPlusOne);

    await expectNUnchanged(frozen);
  });
});
