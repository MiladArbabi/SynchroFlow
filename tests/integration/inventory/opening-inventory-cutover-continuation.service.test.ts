// GH-1179 E03B1 — applied E03 recovery -> explicit E02 continuation.
// Certifies existing source against real PostgreSQL; provider boundaries only
// are injected. No synthetic RED, live provider calls, or production changes.
// Fixture construction follows the existing E02/E03 integration suites.
//
// Authoritative E03 (recoverOpeningInventoryCutoverAmbiguity) continues normal
// E02 execution under its own lease after an `applied` verdict. To certify an
// explicit, separate E02 continuation, the recovery's continuation is
// interrupted at the injected client factory: the factory is invoked once for
// the read-only readback and again for the next pending batch only after
// revalidation and BEFORE its durable dispatch intent. Throwing there leaves
// exactly the durable state of a process that stopped after the recovery
// commit: batch 1 recovered/succeeded, successors pending, live E03 lease.
const mockShopifyRequest = jest.fn(async (..._args: unknown[]) => {
  throw new Error(
    '[GH1179_E03B1_TEST] default Shopify transport must not be reached'
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
  startShopOpeningInventory,
  type OpeningInventoryLocationPageReader,
} from 'api-src/services/wms/shopifyOpeningInventorySnapshot.service';

import { createOpeningInventoryCutoverGeneration } from
  'api-src/services/wms/openingInventoryCutoverGeneration.service';

import {
  executeOpeningInventoryCutoverGeneration,
  recoverOpeningInventoryCutoverAmbiguity,
} from 'api-src/services/wms/openingInventoryCutoverExecution.service';

jest.setTimeout(120000);

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';

const EXECUTIONS = 'opening_inventory_cutover_executions';
const BATCH_EXECUTIONS = 'opening_inventory_cutover_batch_executions';
const ATTEMPTS = 'opening_inventory_cutover_batch_attempts';

const FROZEN_API_VERSION = '2026-04';

const VERIFICATIONS = 'opening_inventory_cutover_verifications';
const VERIFICATION_LINES = 'opening_inventory_cutover_verification_lines';

// Initial E02 owner: expires in real DB time before recovery reclaims.
const INITIAL_LEASE_MS = 3000;

// E03 recovery owner: long enough to remain live across readback +
// revalidation and the immediate busy probe, short enough to expire for real.
const RECOVERY_LEASE_MS = 6000;

const CONTINUATION_INTERRUPTED =
  '[GH1179_E03B1_TEST] recovery continuation interrupted before pending dispatch';

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

const originalApiVersion = process.env.SHOPIFY_API_VERSION;

let coord: Knex;

beforeAll(async () => {
  process.env.SHOPIFY_API_VERSION = FROZEN_API_VERSION;

  const testDb = String(process.env.PGDATABASE);
  expect(testDb).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  // Independent restricted-role connection observes committed state only.
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
  const role = await coord.raw('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  expect(role.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
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

  throw new Error(`[GH1179_E03B1_TEST] waitFor timed out: ${label}`);
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
              `[GH1179_E03B1_TEST] unexpected provider call #${calls.length} on ${label}`
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
    'Http request error, no response available: [GH1179_E03B1_TEST] simulated lost response'
  );
}

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
    throw new Error('[GH1179_E03B1_TEST] opening cohort bins missing');
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
      throw new Error('[GH1179_E03B1_TEST] fixture product missing');
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

type FrozenShape = 'one_batch' | 'two_batches' | 'three_batches';

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
    await makeCountedReady(fixture, 3);
    levels = [{ itemGid: fixture.itemGid, variantGid: fixture.variantGid, onHand: 8 }];
    expectedBatches = 1;
  } else {
    // 251 / 501 writes exercise a recovered prefix and pending successors.
    await makeCountedReady(fixture, 1);
    const extras = await seedAdditionalTargets(fixture, shape === 'three_batches' ? 500 : 250, 1);
    levels = [
      { itemGid: fixture.itemGid, variantGid: fixture.variantGid, onHand: 0 },
      ...extras.map(extra => ({ ...extra, onHand: 0 })),
    ];
    expectedBatches = shape === 'three_batches' ? 3 : 2;
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
          throw new Error('[GH1179_E03B1_TEST] generation reader exhausted');
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


type ExecutionState = Awaited<ReturnType<typeof executionState>>;
type Evidence = Awaited<ReturnType<typeof evidence>>;

type Recovered = Frozen & {
  recoveredState: ExecutionState;
  recoveredEvidence: Evidence;
};

let observed: Recovered[] = [];
beforeEach(() => { observed = []; });

function batchOneAttempts(state: ExecutionState): any[] {
  return state.attempts.filter((attempt: any) => Number(attempt.batch_index) === 1);
}

afterEach(async () => {
  for (const f of observed) {
    await expectSliceDUnchanged(f);
    await expectCompletionMarkerNull(f.fixture.shopId);
    expect(await evidence(f)).toEqual(f.recoveredEvidence);
    expect(f.recoveredEvidence.headers).toHaveLength(1);
    expect(f.recoveredEvidence.headers[0]).toMatchObject({
      purpose: 'ambiguity_inspection', status: 'complete', verdict: 'applied',
    });
    expect(f.recoveredEvidence.headers.some(h => h.purpose === 'final_convergence')).toBe(false);
    const state = await executionState(f.fixture.shopId, f.generationId);
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0].status).not.toBe('converged');
    // The recovered batch is never resent or rewritten.
    expect(state.batchExecutions[0]).toEqual(f.recoveredState.batchExecutions[0]);
    expect(batchOneAttempts(state)).toEqual(batchOneAttempts(f.recoveredState));
  }
});

function executionParams(f: Frozen) {
  return { shopId: f.fixture.shopId, generationId: f.generationId };
}

// Readback evidence: every frozen write at its target → `applied` for batch 1.
function appliedLevels(f: Frozen): ProviderLevel[] {
  return f.entries.filter(e => e.disposition !== 'provider_only_zero').map(e => ({
    itemGid: e.shopify_inventory_item_gid, variantGid: e.shopify_variant_gid,
    onHand: Number(e.target_quantity),
  }));
}

// Real E02 batch-1 ambiguity, then real DB-time lease expiry.
async function ambiguousFixture(shape: FrozenShape) {
  const f = await freezeGeneration(shape);
  const initial = fakeShopify('initial ambiguous batch', [async () => { throw noResponseError(); }]);
  expect(await executeOpeningInventoryCutoverGeneration(executionParams(f), {
    createShopifyGraphQLClient: initial.createShopifyGraphQLClient,
    leaseDurationMs: INITIAL_LEASE_MS,
  })).toMatchObject({ outcome: 'ambiguous' });
  expect(initial.calls).toHaveLength(1);
  const ambiguous = await executionState(f.fixture.shopId, f.generationId);
  expect(ambiguous.batchExecutions[0].status).toBe('ambiguous');
  expect(ambiguous.batchExecutions.slice(1).every(b => b.status === 'pending')).toBe(true);
  expect(ambiguous.attempts).toHaveLength(1);
  expect(ambiguous.attempts[0]).toMatchObject({ outcome: 'no_response' });
  // Real DB-time expiry; no lease is edited by the test.
  await waitForLeaseExpiry(f.fixture.shopId, ambiguous.executions[0].execution_id);
  return { f, ambiguous };
}

function expectReadOnlyReadback(call: ProviderCall, f: Frozen) {
  expect(call.document).not.toMatch(/\bmutation\b|inventorySetQuantities/);
  expect(call.options.retries).toBe(0);
  expect(call.options.variables?.locationId).toBe(f.generation.shopify_location_gid);
}

// Authoritative E03 applies batch 1 and its own continuation is interrupted
// before any pending dispatch (see header). Result: recovered prefix, pending
// successors, live E03 lease.
async function appliedFixture(shape: Exclude<FrozenShape, 'one_batch'>): Promise<Recovered> {
  const { f, ambiguous } = await ambiguousFixture(shape);
  const readback = fakeShopify('E03 applied reread', [async () => providerPage(f.fixture, appliedLevels(f))]);
  let factoryCalls = 0;
  await expect(recoverOpeningInventoryCutoverAmbiguity(executionParams(f), {
    createShopifyGraphQLClient: (args) => {
      factoryCalls += 1;
      if (factoryCalls > 1) throw new Error(CONTINUATION_INTERRUPTED);
      return readback.createShopifyGraphQLClient(args);
    },
    leaseDurationMs: RECOVERY_LEASE_MS,
  })).rejects.toThrow(CONTINUATION_INTERRUPTED);
  // Readback client + exactly one interrupted continuation client.
  expect(factoryCalls).toBe(2);
  expect(readback.calls).toHaveLength(1);
  expectReadOnlyReadback(readback.calls[0], f);
  const recoveredState = await executionState(f.fixture.shopId, f.generationId);
  expect(recoveredState.executions[0].status).toBe('executing');
  expect(recoveredState.executions[0].lease_token).not.toBe(ambiguous.executions[0].lease_token);
  expect(recoveredState.executions[0].lease_expires_at.getTime()).toBeGreaterThan(recoveredState.dbNow.getTime());
  expect(recoveredState.batchExecutions[0].status).toBe('succeeded');
  expect(recoveredState.batchExecutions[0].succeeded_at).not.toBeNull();
  expect(recoveredState.batchExecutions.slice(1).every(b => b.status === 'pending' && b.attempt_count === 0)).toBe(true);
  expect(recoveredState.attempts).toEqual(ambiguous.attempts);
  const recoveredEvidence = await evidence(f);
  expect(recoveredEvidence.headers[0].finalized_by_lease_token).toBe(recoveredState.executions[0].lease_token);
  const result = { ...f, recoveredState, recoveredEvidence };
  observed.push(result);
  return result;
}

async function assertPendingDispatch(f: Recovered, call: ProviderCall, clients: ShopifyClientArgs[]) {
  const batch = f.batches[1];
  expect(call.document).toBe(batch.graphql_document);
  expect(call.options.variables).toEqual(JSON.parse(batch.canonical_variables));
  expect(call.options.variables.idempotencyKey).toBe(batch.idempotency_key);
  expect(call.options.retries).toBe(0);
  expect(clients).toHaveLength(1);
  expect(clients[0]).toMatchObject({
    shopId: f.fixture.shopId, platformShopName: f.fixture.shopDomain,
    accessToken: f.fixture.accessToken, apiVersion: batch.requested_api_version,
  });
  // Independent connection proves durable dispatch intent BEFORE provider I/O returns.
  const state = await executionState(f.fixture.shopId, f.generationId);
  const owner = state.executions[0];
  expect(owner.status).toBe('executing');
  expect(owner.lease_token).not.toBe(f.recoveredState.executions[0].lease_token);
  expect(owner.lease_expires_at.getTime()).toBeGreaterThan(state.dbNow.getTime());
  expect(state.batchExecutions[0]).toEqual(f.recoveredState.batchExecutions[0]);
  expect(state.batchExecutions[1]).toMatchObject({ status: 'dispatching', attempt_count: 1 });
  expect(state.batchExecutions.slice(2).every(b => b.status === 'pending' && b.attempt_count === 0)).toBe(true);
  expect(state.attempts).toHaveLength(2);
  expect(state.attempts[1]).toMatchObject({
    batch_index: 2, attempt_number: 1, outcome: null, finalized_at: null,
    dispatch_lease_token: owner.lease_token, request_sha256: batch.request_sha256,
    requested_api_version: batch.requested_api_version,
  });
  return state;
}

function successResponse() {
  return {
    data: { inventorySetQuantities: {
      userErrors: [], inventoryAdjustmentGroup: { id: 'gid://shopify/InventoryAdjustmentGroup/1179' },
    } },
    headers: { 'X-Shopify-API-Version': [FROZEN_API_VERSION] },
  };
}

describe('GH-1179 E03B1 — applied-recovery continuation certification', () => {
  it('B1-01/B1-02 live recovery lease is busy; expiry reclaims and sends only the first pending frozen batch', async () => {
    const f = await appliedFixture('three_batches');
    let dispatchProof: ReturnType<typeof assertPendingDispatch> | undefined;
    const provider = fakeShopify('continuation', [async call => {
      dispatchProof = assertPendingDispatch(f, call, provider.clients);
      await dispatchProof;
      throw noResponseError(); // inherited E02 classification; blocks later pending successor
    }]);
    expect(await executeOpeningInventoryCutoverGeneration(executionParams(f), {
      createShopifyGraphQLClient: provider.createShopifyGraphQLClient,
    })).toMatchObject({ outcome: 'busy' });
    expect(provider.calls).toHaveLength(0);
    expect(provider.clients).toHaveLength(0);
    const busy = await executionState(f.fixture.shopId, f.generationId);
    expect(busy.executions).toEqual(f.recoveredState.executions);
    expect(busy.batchExecutions).toEqual(f.recoveredState.batchExecutions);
    expect(busy.attempts).toEqual(f.recoveredState.attempts);
    await expectCompletionMarkerNull(f.fixture.shopId);
    expect(await evidence(f)).toEqual(f.recoveredEvidence);

    await waitForLeaseExpiry(f.fixture.shopId, busy.executions[0].execution_id);
    expect(await executeOpeningInventoryCutoverGeneration(executionParams(f), {
      createShopifyGraphQLClient: provider.createShopifyGraphQLClient,
    })).toMatchObject({ outcome: 'ambiguous' });
    expect(provider.calls).toHaveLength(1);
    expect(dispatchProof).toBeDefined();
    // E02 classifies thrown provider failures; keep assertion failures visible.
    await dispatchProof;
    const after = await executionState(f.fixture.shopId, f.generationId);
    expect(after.executions[0].lease_token).not.toBe(busy.executions[0].lease_token);
    expect(after.batchExecutions.map(b => b.status)).toEqual(['succeeded', 'ambiguous', 'pending']);
    expect(after.attempts).toHaveLength(2);
    expect(after.attempts[1].outcome).toBe('no_response');
    expect(after.attempts[1].finalized_at).not.toBeNull();
    expect(after.attempts[1].finalized_by_lease_token).toBe(after.executions[0].lease_token);
  });

  it('B1-03 every remaining batch succeeds: E02 continuation enters verifying, recovered batch never resent, no convergence', async () => {
    const f = await appliedFixture('two_batches');
    await waitForLeaseExpiry(f.fixture.shopId, f.recoveredState.executions[0].execution_id);
    const provider = fakeShopify('continuation to verifying', [async call => {
      await assertPendingDispatch(f, call, provider.clients);
      return successResponse();
    }]);
    expect(await executeOpeningInventoryCutoverGeneration(executionParams(f), {
      createShopifyGraphQLClient: provider.createShopifyGraphQLClient,
    })).toMatchObject({ outcome: 'verifying' });
    // Exactly the one pending batch; no read, no recovered-batch resend.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].document).toBe(f.batches[1].graphql_document);
    const after = await executionState(f.fixture.shopId, f.generationId);
    expect(after.batchExecutions.map(b => b.status)).toEqual(['succeeded', 'succeeded']);
    expect(after.attempts).toHaveLength(2);
    expect(after.attempts[1]).toMatchObject({ batch_index: 2, attempt_number: 1, outcome: 'succeeded' });
    expect(after.executions[0].status).toBe('verifying');
    expect(after.executions[0].lease_token).not.toBe(f.recoveredState.executions[0].lease_token);
    expect(after.executions[0].lease_expires_at.getTime()).toBeGreaterThan(after.dbNow.getTime());
    expect(after.executions[0].lease_heartbeat_at).toBeNull();
    expect(after.executions[0].terminal_at).toBeNull();
  });

  it('B1-04 current authority drift rejects the pending successor before any dispatch', async () => {
    const f = await appliedFixture('two_batches');
    await seedTruth(f.fixture, { quantity: 2 });
    await waitForLeaseExpiry(f.fixture.shopId, f.recoveredState.executions[0].execution_id);
    const provider = fakeShopify('authority drift');
    expect(await executeOpeningInventoryCutoverGeneration(executionParams(f), {
      createShopifyGraphQLClient: provider.createShopifyGraphQLClient,
    })).toMatchObject({ outcome: 'requires_regeneration' });
    expect(provider.calls).toHaveLength(0);
    expect(provider.clients).toHaveLength(0);
    const after = await executionState(f.fixture.shopId, f.generationId);
    expect(after.executions[0]).toMatchObject({
      status: 'requires_regeneration', lease_token: null, lease_expires_at: null,
      terminal_reason: 'OPENING_CUTOVER_EXECUTION_REVALIDATION_FAILED:PHYSICAL_TARGET_CHANGED',
    });
    expect(after.batchExecutions).toEqual(f.recoveredState.batchExecutions);
    expect(after.attempts).toEqual(f.recoveredState.attempts);
  });

  it('B1-05 old E03 token cannot mutate after the E02 reclaim: its late dispatch result is stale and persists nothing', async () => {
    const { f, ambiguous } = await ambiguousFixture('two_batches');
    const held = deferred<unknown>();
    // The E03 owner's own continuation dispatches batch 2 and is held there.
    const e03 = fakeShopify('E03 continuation held in dispatch', [
      async () => providerPage(f.fixture, appliedLevels(f)),
      async call => {
        expect(call.document).toBe(f.batches[1].graphql_document);
        expect(call.options.variables).toEqual(JSON.parse(f.batches[1].canonical_variables));
        return held.promise;
      },
    ]);
    const settledE03: { value: unknown; error: unknown; done: boolean } = { value: null, error: null, done: false };
    const run = recoverOpeningInventoryCutoverAmbiguity(executionParams(f), {
      createShopifyGraphQLClient: e03.createShopifyGraphQLClient,
      leaseDurationMs: RECOVERY_LEASE_MS,
    }).then(
      value => { settledE03.value = value; settledE03.done = true; },
      error => { settledE03.error = error; settledE03.done = true; }
    );

    try {
      await waitFor(() => {
        if (e03.calls.length >= 2) return true;
        if (settledE03.done) {
          throw new Error(`[GH1179_E03B1_TEST] E03 settled before held dispatch: ${
            JSON.stringify(settledE03.value) ?? String(settledE03.error)}`);
        }
        return null;
      }, 'E03 continuation dispatch in flight');

      expectReadOnlyReadback(e03.calls[0], f);

      const recoveredState = await executionState(f.fixture.shopId, f.generationId);
      const recoveredEvidence = await evidence(f);
      const oldToken = recoveredState.executions[0].lease_token;

      expect(oldToken).not.toBe(ambiguous.executions[0].lease_token);
      expect(recoveredEvidence.headers[0].finalized_by_lease_token).toBe(oldToken);
      expect(recoveredState.batchExecutions[0].status).toBe('succeeded');
      expect(recoveredState.batchExecutions[1]).toMatchObject({ status: 'dispatching', attempt_count: 1 });
      expect(recoveredState.attempts[1]).toMatchObject({
        batch_index: 2, outcome: null, finalized_at: null, dispatch_lease_token: oldToken,
      });
      observed.push({ ...f, recoveredState, recoveredEvidence });

      await waitForLeaseExpiry(f.fixture.shopId, recoveredState.executions[0].execution_id);

      // E02 reclaims with a new token. The in-flight batch may have reached
      // Shopify: it becomes ambiguous and is NEVER resent.
      const e02 = fakeShopify('E02 must not dispatch');
      expect(await executeOpeningInventoryCutoverGeneration(executionParams(f), {
        createShopifyGraphQLClient: e02.createShopifyGraphQLClient,
      })).toMatchObject({ outcome: 'ambiguous' });
      expect(e02.calls).toHaveLength(0);
      expect(e02.clients).toHaveLength(0);

      const reclaimed = await executionState(f.fixture.shopId, f.generationId);
      const newToken = reclaimed.executions[0].lease_token;

      expect(reclaimed.executions[0].status).toBe('executing');
      expect(newToken).not.toBe(oldToken);
      expect(reclaimed.batchExecutions.map(b => b.status)).toEqual(['succeeded', 'ambiguous']);
      expect(reclaimed.attempts[1]).toMatchObject({
        outcome: 'abandoned', finalized_by_lease_token: newToken,
        error_class: 'OPENING_CUTOVER_EXECUTION_LEASE_RECLAIMED',
      });

      // The old E03 owner's late SUCCESS cannot finalize, succeed or block.
      held.resolve(successResponse());
      await run;

      expect(settledE03.error).toBeNull();
      expect(settledE03.value).toMatchObject({
        outcome: 'stale_claim', code: 'OPENING_CUTOVER_EXECUTION_STALE_CLAIM',
      });

      const after = await executionState(f.fixture.shopId, f.generationId);

      expect(after.executions).toEqual(reclaimed.executions);
      expect(after.batchExecutions).toEqual(reclaimed.batchExecutions);
      expect(after.attempts).toEqual(reclaimed.attempts);
      expect(await evidence(f)).toEqual(recoveredEvidence);
      // One provider mutation in total: the held E03 dispatch.
      expect(e03.calls).toHaveLength(2);
    } finally {
      held.resolve(successResponse());
      await run;
    }
  });
});
