// GH-1179 Slice E / E06 — Opening Inventory cutover MODERN ROUTE + READ MODEL.
//
// RED contract only. Drives the REAL Express app (createApp) through the real
// authenticateToken → requireFt2 → requireCapability('inventory.core') →
// requireAction chain (GRILL-05 precedent) against real PostgreSQL.
//
// The production route has no dependency injection: generation, execution
// and convergence reach Shopify only through
// shopifyClient.service.createShopifyGraphQLClient. That module is replaced
// here by a document-routed fail-closed provider:
//   - the Opening Inventory Location query → scripted read pages;
//   - inventorySetQuantities (Slice-D absolute on_hand CAS) → scripted results;
//   - the legacy inventoryAdjustQuantities (available / delta) or any other
//     document → recorded and rejected immediately.
//
// Locked by this suite:
// - POST /opening-inventory/cutover runs the Slice-D/E safe path, never the
//   legacy delta executor, and converges in ONE request on the happy path;
// - only E04 writes the completion marker on the active route; no legacy
//   opening_inventory_cutovers authority row is created;
// - GET /opening-inventory/progress composes Slice-E state into the existing
//   shape and vocabulary (prepared | executing | failed | complete), and keeps
//   the legacy read model when no Slice-E generation exists;
// - the request contract ({ accept_physical_truth?: boolean }) is unchanged;
// - a requires_regeneration generation is followed by a fresh N+1 only on a
//   NEW request, never inside the request that discovered the drift.

const mockProvider = {
  reads: [] as Array<(call: any) => Promise<unknown>>,
  mutations: [] as Array<(call: any) => Promise<unknown>>,
  readCalls: [] as any[],
  setQuantitiesCalls: [] as any[],
  legacyAdjustCalls: [] as any[],
  unknownCalls: [] as any[],
  clients: [] as any[],
};

function mockResetProvider(): void {
  mockProvider.reads = [];
  mockProvider.mutations = [];
  mockProvider.readCalls = [];
  mockProvider.setQuantitiesCalls = [];
  mockProvider.legacyAdjustCalls = [];
  mockProvider.unknownCalls = [];
  mockProvider.clients = [];
}

function mockRoutedClient(args: unknown) {
  mockProvider.clients.push(args);

  return {
    request: async (document: string, options: any = {}) => {
      const call = { document, options };

      if (/\binventoryLevels\b/.test(document) && !/\bmutation\b/.test(document)) {
        const handler = mockProvider.reads[mockProvider.readCalls.length];
        mockProvider.readCalls.push(call);

        if (!handler) {
          throw new Error('[GH1179_E06_ROUTE_TEST] unexpected Shopify Location read');
        }

        return handler(call);
      }

      if (/\binventorySetQuantities\b/.test(document)) {
        const handler = mockProvider.mutations[mockProvider.setQuantitiesCalls.length];
        mockProvider.setQuantitiesCalls.push(call);

        if (!handler) {
          throw new Error('[GH1179_E06_ROUTE_TEST] unexpected inventorySetQuantities');
        }

        return handler(call);
      }

      if (/\binventoryAdjustQuantities\b/.test(document)) {
        mockProvider.legacyAdjustCalls.push(call);
        throw new Error(
          '[GH1179_E06_ROUTE_TEST] legacy inventoryAdjustQuantities reached through the active route'
        );
      }

      mockProvider.unknownCalls.push(call);
      throw new Error('[GH1179_E06_ROUTE_TEST] unknown Shopify document reached');
    },
  };
}

jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  createShopifyGraphQLClient: (args: unknown) => mockRoutedClient(args),
}));

import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { knex as knexFactory, type Knex } from 'knex';

import { createApp } from 'api-src/bootstrap/express';
import { encrypt } from 'api-src/security/encryption.service';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { issueTestToken } from '../../unit/helpers/auth';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';

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

import {
  executeOpeningInventoryCutoverGeneration,
  verifyOpeningInventoryCutoverConvergence,
} from 'api-src/services/wms/openingInventoryCutoverExecution.service';

import { prepareOpeningInventoryCutover } from
  'api-src/services/wms/openingInventoryCutover.service';

jest.setTimeout(120000);

const REPO = path.resolve(__dirname, '../../..');
const CONTROLLER = 'apps/backend/src/api/wms/openingInventoryCutover.controller.ts';

const PROGRESS_URL = '/api/v1/wms/opening-inventory/progress';
const CUTOVER_URL = '/api/v1/wms/opening-inventory/cutover';

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';
const EXECUTIONS = 'opening_inventory_cutover_executions';
const VERIFICATIONS = 'opening_inventory_cutover_verifications';

const FROZEN_API_VERSION = '2026-04';
const SHORT_LEASE_MS = 2000;
const CUTOVER_STATUSES = ['prepared', 'executing', 'failed', 'complete'];

// ─── environment / independent coordinator ──────────────────────────────────

const originalApiVersion = process.env.SHOPIFY_API_VERSION;

let coord: Knex;
const app = createApp();

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
  mockResetProvider();
});

afterEach(() => {
  // No Shopify document outside the three routed families ever leaves.
  expect(mockProvider.unknownCalls).toHaveLength(0);
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

  throw new Error(`[GH1179_E06_ROUTE_TEST] waitFor timed out: ${label}`);
}

// ─── fixture (E05 precedent) + real HTTP access (GRILL-05 precedent) ────────

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
    const id = await createTenantShop(trx, `gh1179e06r-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const warehouseId = crypto.randomUUID();
  const rootCode = `E06R-${unique}-ROOT`;
  const a1 = `E06R-${unique}-A1`;
  const a2 = `E06R-${unique}-A2`;

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
          email: `e06r-owner-${unique}@example.com`,
          password_hash: 'test-hash',
          role: 'owner',
        },
        {
          shop_id: shopId,
          email: `e06r-operator-${unique}@example.com`,
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
      name: `Slice E06 route warehouse ${unique}`,
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
      title: 'Slice E06 route product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `E06R-${unique}`,
      title: 'Slice E06 route variant',
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
      external_sku: `E06R-${unique}`,
    });

    await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: `gh1179e06r-${unique}.myshopify.com`,
      shop_gid: `gid://shopify/Shop/${shopId}`,
      access_token: encrypt(`e06r-offline-token-${unique}`),
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

// Opening snapshot expects 11, the count observes 3: review_required, so the
// merchant must accept physical truth; physical target 3.
async function makeCountedReady(fixture: Fixture): Promise<void> {
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
    throw new Error('[GH1179_E06_ROUTE_TEST] opening cohort bins missing');
  }

  await countOpeningBin(fixture, first.recount_task_id, 3);
  await countOpeningBin(fixture, second.recount_task_id, null);
  await seedTruth(fixture, 3);
}

async function enableHttpAccess(fixture: Fixture): Promise<string> {
  await withTenant(fixture.shopId, async (trx) => {
    await trx('user_lifecycle_snapshot')
      .where({ shop_id: fixture.shopId, user_id: fixture.ownerId })
      .del();

    await trx('user_lifecycle_snapshot').insert({
      shop_id: fixture.shopId,
      user_id: fixture.ownerId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });
  });

  await withTenant(fixture.shopId, (trx) =>
    transitionShopSubscription(
      {
        shopId: fixture.shopId,
        to: { tier: 'core', status: 'active', billingProvider: 'shopify' },
        source: 'opening_cutover_e06_route_test',
        reason: 'test_core_fixture',
        actorType: 'shopify',
        actingProvider: 'shopify',
      },
      trx
    )
  );

  return issueTestToken({
    userId: fixture.ownerId,
    shopId: fixture.shopId,
    tier: 'core',
    roles: ['owner'],
  });
}

async function readyShop(): Promise<{ fixture: Fixture; token: string }> {
  const fixture = await createFixture();
  await makeCountedReady(fixture);
  return { fixture, token: await enableHttpAccess(fixture) };
}

// ─── provider pages / scripted results ──────────────────────────────────────

function locationPage(fixture: Fixture, onHand: number) {
  return {
    data: {
      location: {
        id: fixture.locationGid,
        isActive: true,
        inventoryLevels: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: `gid://shopify/InventoryLevel/1?inventory_item_id=${fixture.itemGid.split('/').pop()}`,
              isActive: true,
              item: { id: fixture.itemGid, tracked: true, variant: { id: fixture.variantGid } },
              quantities: [{ name: 'on_hand', quantity: onHand }],
            },
          ],
        },
      },
    },
    extensions: {},
    headers: { 'X-Shopify-API-Version': [FROZEN_API_VERSION] },
  };
}

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
            message: '[GH1179_E06_ROUTE_TEST] synthetic rejection',
            code: 'INVALID_QUANTITY',
          },
        ],
      },
    },
    extensions: {},
    headers: { 'X-Shopify-API-Version': [FROZEN_API_VERSION] },
  };
}

// Service-level (DI) provider for building Slice-E states directly.
function injected(params: {
  reads?: Array<() => Promise<unknown>>;
  mutations?: Array<() => Promise<unknown>>;
}) {
  const reads = params.reads ?? [];
  const mutations = params.mutations ?? [];
  const counts = { reads: 0, mutations: 0 };

  return {
    counts,
    createShopifyGraphQLClient: () => ({
      request: async (document: string) => {
        if (document === OPENING_INVENTORY_SNAPSHOT_QUERY) {
          const handler = reads[counts.reads++];
          if (!handler) throw new Error('[GH1179_E06_ROUTE_TEST] unexpected injected read');
          return handler();
        }

        const handler = mutations[counts.mutations++];
        if (!handler) throw new Error('[GH1179_E06_ROUTE_TEST] unexpected injected mutation');
        return handler();
      },
    }),
  };
}

// Real Slice-D generation N (3 ← 8) through the service, injected reader.
async function freezeN(fixture: Fixture): Promise<string> {
  const generation: any = await createOpeningInventoryCutoverGeneration(
    { shopId: fixture.shopId, actingUserId: fixture.ownerId, acceptPhysicalTruth: true },
    { readLocationPage: async () => locationPage(fixture, 8) }
  );

  return String(generation.generation_id);
}

async function runE02(
  fixture: Fixture,
  generationId: string,
  provider: ReturnType<typeof injected>,
  leaseDurationMs?: number
) {
  return executeOpeningInventoryCutoverGeneration(
    { shopId: fixture.shopId, generationId },
    { createShopifyGraphQLClient: provider.createShopifyGraphQLClient, leaseDurationMs }
  );
}

async function persisted(fixture: Fixture) {
  const { shopId } = fixture;

  return coordTenant(shopId, async (trx) => ({
    generations: await trx(GENERATIONS)
      .where({ shop_id: shopId })
      .orderBy('generation_sequence', 'asc'),
    entries: await trx(ENTRIES).where({ shop_id: shopId }).orderBy('ordinal', 'asc'),
    batches: await trx(BATCHES)
      .where({ shop_id: shopId })
      .orderBy([{ column: 'generation_id' }, { column: 'batch_index' }]),
    executions: await trx(EXECUTIONS).where({ shop_id: shopId }).orderBy('started_at', 'asc'),
    verifications: await trx(VERIFICATIONS).where({ shop_id: shopId }),
    legacyCutovers: await trx('opening_inventory_cutovers').where({ shop_id: shopId }),
    legacyBatches: await trx('opening_inventory_cutover_batches').where({ shop_id: shopId }),
    marker: (
      await trx.raw(
        `SELECT opening_inventory_shopify_synced_at AS synced_at
           FROM shop_wms_settings WHERE shop_id = ?`,
        [shopId]
      )
    ).rows[0]?.synced_at as Date | null,
  }));
}

async function waitForLeaseExpiry(fixture: Fixture, generationId: string): Promise<void> {
  await waitFor(async () => {
    const result = await coordTenant(fixture.shopId, (trx) =>
      trx.raw(
        `SELECT lease_expires_at <= clock_timestamp() AS expired
           FROM ${EXECUTIONS} WHERE shop_id = ? AND generation_id = ?`,
        [fixture.shopId, generationId]
      )
    );

    return result.rows[0]?.expired === true;
  }, 'execution lease expired');
}

async function getProgress(token: string) {
  const response = await request(app)
    .get(PROGRESS_URL)
    .set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(Object.keys(response.body).sort()).toEqual(['cutover', 'progress', 'shopify_synced_at']);

  return response.body;
}

function expectCutoverShape(cutover: any): void {
  expect(cutover).not.toBeNull();
  expect(Object.keys(cutover).sort()).toEqual([
    'completed_at',
    'error_code',
    'error_message',
    'physical_truth_accepted',
    'status',
  ]);
  expect(CUTOVER_STATUSES).toContain(cutover.status);
}

async function postCutover(token: string, body: Record<string, unknown>) {
  return request(app)
    .post(CUTOVER_URL)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

// Happy POST provider script: fresh generation read (8), one absolute CAS
// mutation (3 ← 8), final convergence read (3).
function scriptHappyPath(fixture: Fixture, target = 3, provider = 8): void {
  mockProvider.reads = [
    async () => locationPage(fixture, provider),
    async () => locationPage(fixture, target),
  ];
  mockProvider.mutations = [async () => mutationSuccess(fixture.shopId, 1)];
}

function expectAbsoluteOnHandMutation(fixture: Fixture, target: number, changeFrom: number): void {
  expect(mockProvider.setQuantitiesCalls).toHaveLength(1);

  const variables = mockProvider.setQuantitiesCalls[0].options.variables;

  expect(variables.input).toMatchObject({ name: 'on_hand', reason: 'correction' });
  expect(variables.input.quantities).toEqual([
    {
      inventoryItemId: fixture.itemGid,
      locationId: fixture.locationGid,
      quantity: target,
      changeFromQuantity: changeFrom,
    },
  ]);
  expect(typeof variables.idempotencyKey).toBe('string');
  expect(mockProvider.setQuantitiesCalls[0].options.retries ?? 0).toBe(0);
}

describe('GH-1179 Slice E / E06 — modern opening cutover route and read model', () => {
  it('E06-R01 — POST /cutover runs the Slice-D/E safe path: a frozen generation, no legacy delta mutation, no legacy cutover row', async () => {
    const { fixture, token } = await readyShop();

    scriptHappyPath(fixture);

    await postCutover(token, { accept_physical_truth: true });

    const after = await persisted(fixture);

    expect(mockProvider.legacyAdjustCalls).toHaveLength(0);
    expect(after.legacyCutovers).toHaveLength(0);
    expect(after.legacyBatches).toHaveLength(0);
    expect(after.generations).toHaveLength(1);
    expect(after.generations[0].status).toBe('frozen');
  });

  it('E06-R02 — happy POST converges in ONE request: absolute on_hand CAS, E04 convergence, marker set, no legacy authority', async () => {
    const { fixture, token } = await readyShop();

    expect((await persisted(fixture)).marker).toBeNull();

    scriptHappyPath(fixture);

    const response = await postCutover(token, { accept_physical_truth: true });

    expect(response.status).toBe(200);
    expect(mockProvider.legacyAdjustCalls).toHaveLength(0);
    expect(mockProvider.readCalls).toHaveLength(2);
    expectAbsoluteOnHandMutation(fixture, 3, 8);

    const after = await persisted(fixture);
    const finals = after.verifications.filter((row: any) => row.purpose === 'final_convergence');

    expect(after.executions).toHaveLength(1);
    expect(after.executions[0].status).toBe('converged');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ status: 'complete', verdict: 'converged' });
    expect(after.marker).not.toBeNull();
    expect(new Date(after.marker as Date).getTime()).toBe(
      new Date(after.executions[0].terminal_at).getTime()
    );
    expect(after.legacyCutovers).toHaveLength(0);

    // Ratified modern POST contract: exactly the Slice-E cutover projection.
    expect(response.body).toEqual({
      status: 'complete',
      physical_truth_accepted:
        after.generations[0].physical_truth_accepted_at != null,
      error_code: null,
      error_message: null,
      completed_at:
        new Date(after.executions[0].terminal_at).toISOString(),
    });

    const view = await getProgress(token);

    expectCutoverShape(view.cutover);
    expect(view.cutover.status).toBe('complete');
    expect(view.shopify_synced_at).not.toBeNull();
  });

  it('E06-R03 — GET: latest generation with no execution → cutover.status prepared, acceptance from the generation', async () => {
    const { fixture, token } = await readyShop();

    await freezeN(fixture);

    const view = await getProgress(token);

    expectCutoverShape(view.cutover);
    expect(view.cutover).toMatchObject({
      status: 'prepared',
      physical_truth_accepted: true,
      error_code: null,
      error_message: null,
      completed_at: null,
    });
    expect(view.shopify_synced_at).toBeNull();
  });

  it('E06-R04 — GET: executing (ambiguous dispatch) and verifying both map to cutover.status executing', async () => {
    const executing = await readyShop();
    const executingN = await freezeN(executing.fixture);

    await runE02(
      executing.fixture,
      executingN,
      injected({
        mutations: [
          async () => {
            throw new Error('[GH1179_E06_ROUTE_TEST] simulated lost response');
          },
        ],
      })
    );

    expect((await persisted(executing.fixture)).executions[0].status).toBe('executing');

    const executingView = await getProgress(executing.token);

    expectCutoverShape(executingView.cutover);
    expect(executingView.cutover.status).toBe('executing');

    const verifying = await readyShop();
    const verifyingN = await freezeN(verifying.fixture);

    await runE02(
      verifying.fixture,
      verifyingN,
      injected({ mutations: [async () => mutationSuccess(verifying.fixture.shopId, 4)] })
    );

    expect((await persisted(verifying.fixture)).executions[0].status).toBe('verifying');

    const verifyingView = await getProgress(verifying.token);

    expectCutoverShape(verifyingView.cutover);
    expect(verifyingView.cutover.status).toBe('executing');
    expect(verifyingView.cutover.completed_at).toBeNull();
  });

  it('E06-R05 — GET: blocked and requires_regeneration map to failed and expose the durable reason', async () => {
    const blocked = await readyShop();
    const blockedN = await freezeN(blocked.fixture);

    await runE02(blocked.fixture, blockedN, injected({ mutations: [async () => mutationUserErrors()] }));

    const blockedExecution = (await persisted(blocked.fixture)).executions[0];

    expect(blockedExecution.status).toBe('blocked');

    const blockedView = await getProgress(blocked.token);

    expectCutoverShape(blockedView.cutover);
    expect(blockedView.cutover.status).toBe('failed');
    expect(typeof blockedView.cutover.error_code).toBe('string');
    expect(
      `${blockedView.cutover.error_code} ${blockedView.cutover.error_message}`
    ).toContain(String(blockedExecution.blocked_reason));

    const regen = await readyShop();
    const regenN = await freezeN(regen.fixture);

    await seedTruth(regen.fixture, 5);
    await runE02(regen.fixture, regenN, injected({}));

    const regenExecution = (await persisted(regen.fixture)).executions[0];

    expect(regenExecution.status).toBe('requires_regeneration');

    const regenView = await getProgress(regen.token);

    expectCutoverShape(regenView.cutover);
    expect(regenView.cutover.status).toBe('failed');
    expect(typeof regenView.cutover.error_code).toBe('string');
    expect(`${regenView.cutover.error_code} ${regenView.cutover.error_message}`).toContain(
      String(regenExecution.terminal_reason)
    );
  });

  it('E06-R06 — GET: converged → complete, completed_at = Slice-E terminal time, shopify_synced_at = canonical marker', async () => {
    const { fixture, token } = await readyShop();
    const generationId = await freezeN(fixture);

    await runE02(
      fixture,
      generationId,
      injected({ mutations: [async () => mutationSuccess(fixture.shopId, 6)] }),
      SHORT_LEASE_MS
    );
    await waitForLeaseExpiry(fixture, generationId);

    expect(
      await verifyOpeningInventoryCutoverConvergence(
        { shopId: fixture.shopId, generationId },
        { createShopifyGraphQLClient: injected({ reads: [async () => locationPage(fixture, 3)] }).createShopifyGraphQLClient }
      )
    ).toMatchObject({ outcome: 'converged' });

    const after = await persisted(fixture);
    const view = await getProgress(token);

    expectCutoverShape(view.cutover);
    expect(view.cutover).toMatchObject({
      status: 'complete',
      physical_truth_accepted: true,
      error_code: null,
      error_message: null,
    });
    expect(new Date(view.cutover.completed_at).getTime()).toBe(
      new Date(after.executions[0].terminal_at).getTime()
    );
    expect(new Date(view.shopify_synced_at).getTime()).toBe(
      new Date(after.marker as Date).getTime()
    );
  });

  it('E06-R07 — GET legacy fallback: no Slice-E generation, historical legacy cutover row keeps the pre-E06 read model', async () => {
    const { fixture, token } = await readyShop();

    // Historical legacy evidence (prepared, accepted); no provider call.
    const legacy = await prepareOpeningInventoryCutover({
      shopId: fixture.shopId,
      actingUserId: fixture.ownerId,
      acceptPhysicalTruth: true,
    });

    expect(legacy.status).toBe('prepared');
    expect((await persisted(fixture)).generations).toHaveLength(0);

    const view = await getProgress(token);

    expect(view.progress.state).toBe('review_required');
    expect(view.cutover).toEqual({
      status: 'prepared',
      physical_truth_accepted: true,
      error_code: null,
      error_message: null,
      completed_at: null,
    });
    expect(view.shopify_synced_at).toBeNull();
    expect(mockProvider.readCalls).toHaveLength(0);
  });

  it('E06-R08 — invalid non-boolean accept_physical_truth keeps the existing 400 {code,error} contract with zero side effects', async () => {
    const { fixture, token } = await readyShop();

    const response = await postCutover(token, { accept_physical_truth: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 'OPENING_CUTOVER_INVALID_REQUEST',
      error: 'accept_physical_truth must be a boolean when provided',
    });

    const after = await persisted(fixture);

    expect(after.generations).toHaveLength(0);
    expect(after.legacyCutovers).toHaveLength(0);
    expect(mockProvider.readCalls).toHaveLength(0);
  });

  it('E06-R09 — the active cutover controller no longer imports or calls approveAndRunOpeningInventoryCutover', () => {
    const source = fs
      .readFileSync(path.join(REPO, CONTROLLER), 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    expect(source).not.toMatch(/\bapproveAndRunOpeningInventoryCutover\b/);
    expect(source).not.toMatch(/\bexecuteOpeningInventoryCutover\b(?!Generation)/);
  });

  it('E06-R10 — drift discovered by a POST does not regenerate in that request; a NEW POST creates N+1 and converges it, N unchanged', async () => {
    const { fixture, token } = await readyShop();
    const nId = await freezeN(fixture);

    await seedTruth(fixture, 5);

    // POST #1: replays N, E02 revalidation finds drift → requires_regeneration.
    // HTTP status of this request is the implementation's inherited mapping;
    // only its durable effects are frozen here.
    await postCutover(token, { accept_physical_truth: true });

    const afterFirst = await persisted(fixture);

    expect(mockProvider.legacyAdjustCalls).toHaveLength(0);
    expect(mockProvider.setQuantitiesCalls).toHaveLength(0);
    expect(afterFirst.generations.map((row: any) => row.generation_id)).toEqual([nId]);
    expect(afterFirst.executions).toHaveLength(1);
    expect(afterFirst.executions[0].status).toBe('requires_regeneration');
    expect(afterFirst.marker).toBeNull();

    const nRows = {
      generation: afterFirst.generations[0],
      entries: afterFirst.entries,
      batches: afterFirst.batches,
    };

    // POST #2: fresh approval → E05 N+1 (5 ← 6) → E06 converges N+1.
    mockResetProvider();
    scriptHappyPath(fixture, 5, 6);

    const second = await postCutover(token, { accept_physical_truth: true });

    expect(second.status).toBe(200);
    expect(mockProvider.legacyAdjustCalls).toHaveLength(0);
    expectAbsoluteOnHandMutation(fixture, 5, 6);

    const after = await persisted(fixture);

    expect(after.generations.map((row: any) => Number(row.generation_sequence))).toEqual([1, 2]);
    expect(after.generations[0]).toEqual(nRows.generation);
    expect(after.entries.filter((row: any) => row.generation_id === nId)).toEqual(nRows.entries);
    expect(after.batches.filter((row: any) => row.generation_id === nId)).toEqual(nRows.batches);

    const nPlusOne = after.generations[1];
    const nPlusOneExecution = after.executions.find(
      (row: any) => row.generation_id === nPlusOne.generation_id
    );

    expect(after.executions.find((row: any) => row.generation_id === nId).status).toBe(
      'requires_regeneration'
    );
    expect(nPlusOneExecution?.status).toBe('converged');
    expect(after.marker).not.toBeNull();
    expect(after.legacyCutovers).toHaveLength(0);
  });
});
