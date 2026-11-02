// S4-5 I4 — recovery credit inclusion at opening cutover (CB1 / CB2) and the
// durable Shopify recovery sync dispatch, on the REAL Slice-D generation and
// REAL Slice-E execution / final convergence.
//
// Fixture note: the cutover fixture (createTenantShop, patterned after the
// final-convergence suite) cannot run the Receive flow, so a recovery credit
// is seeded with I3's exact ledger + truth shape (inbound_purchase +1,
// reference_type inventory_unit, triggered_by receive_recovery, truth +1, one
// transaction). CB1 / CB2 / the 0228 triggers read only that ledger shape.
// Discovery from real I3 recovery events is covered by the receive-flow suite
// (tests/integration/wms/shopify-recovery-inventory-sync-i4.discovery.test.ts),
// so sync rows here are registered from the real classifier, not discovery.
//
//   CB1-A  credit before freeze → captured; target includes it; converged →
//          skipped_included; zero adjustment calls.
//   CB1-B  credit commits after the freeze snapshot, before freeze commit →
//          neither captured nor in the target; later drift → regeneration.
//   CB1-X  capture rows cannot be appended to a frozen generation.
//   CB2-C  post-freeze credit, no offset → convergence → requires_regeneration.
//   T4-NET post-freeze credit +1 and a -1 correction before convergence →
//          fingerprint equal, CB2 drift RECOVERY_CREDITS_CHANGED →
//          requires_regeneration, marker NULL, credit HOLDs; N+1 captures it →
//          converged → skipped_included; Σ recovery adjustments = 0.
//   D1     post-convergence credit → exactly one +1 (correction / available /
//          frozen key + URI / mapped item + location); re-run idle.
//   D2     thrown transport error → ambiguous → identical retry → succeeded.
//   D3     applied but acknowledgement lost → identical retry deduplicated
//          by key at the provider → applied once.
//   D4     userErrors → rejected, never retried.
//   D5     lease expiry mid-dispatch → ambiguous; the stale owner is fenced;
//          the retry carries the identical key.
//   D6     23 h cutoff → held_expired, zero calls; trigger refuses late retry
//          and runtime-role reconciliation.
//   D7     missing mapping → blocked_mapping, zero calls; mapping restored →
//          one +1.
//   D8     credential not READY → no call, credit kept.
//   D9     two concurrent dispatchers → one provider call.
//   H1     legacy marker without converged generation → held_legacy_baseline.
//   H2     converged generation without capture header → held_no_capture.
//   G1     0228 refuses a push of an included credit, a skip of an excluded
//          one, and a decision without a converged baseline.
//   TI     another tenant sees and dispatches nothing of this shop.

const mockShopifyRequest = jest.fn(async (..._args: unknown[]) => {
  throw new Error('[S45_I4_TEST] default Shopify transport must not be reached');
});
const mockCreateShopifyGraphQLClient = jest.fn((..._args: unknown[]) => ({
  request: mockShopifyRequest,
}));
jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  createShopifyGraphQLClient: (...args: unknown[]) => mockCreateShopifyGraphQLClient(...args),
}));

import crypto from 'crypto';
import { knex as knexFactory, type Knex } from 'knex';

import { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import { encrypt } from 'api-src/security/encryption.service';
import {
  SHOPIFY_REQUIRED_SCOPE_STRING,
  normalizeAndValidateShopifyGrantedScopes,
} from 'api-src/services/shopify/shopifyScopes';
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
import { createOpeningInventoryCutoverGeneration } from 'api-src/services/wms/openingInventoryCutoverGeneration.service';
import * as executionModule from 'api-src/services/wms/openingInventoryCutoverExecution.service';
import {
  RECOVERY_INVENTORY_ADJUST_MUTATION,
  classifyRecoveryCredit,
  dispatchNextRecoveryCredit,
  recoverySyncIdentity,
} from 'api-src/services/wms/shopifyRecoveryInventorySync.service';

jest.setTimeout(180000);

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';
const EXECUTIONS = 'opening_inventory_cutover_executions';
const HEADERS = 'opening_inventory_recovery_capture_headers';
const CAPTURED = 'opening_inventory_recovery_capture_credits';
const SYNCS = 'shopify_recovery_inventory_syncs';

const FROZEN_API_VERSION = '2026-04';
const FIXTURE_LEASE_MS = 2000;

type Entrypoint = (
  params: { shopId: number; generationId: string },
  deps?: { createShopifyGraphQLClient?: (args: any) => any; leaseDurationMs?: number }
) => Promise<any>;

const executeGeneration = executionModule.executeOpeningInventoryCutoverGeneration as unknown as Entrypoint;
const convergeGeneration = (executionModule as any).verifyOpeningInventoryCutoverConvergence as Entrypoint;

const originalApiVersion = process.env.SHOPIFY_API_VERSION;
let coord: Knex;
let admin: Knex;

beforeAll(async () => {
  process.env.SHOPIFY_API_VERSION = FROZEN_API_VERSION;
  const testDb = String(process.env.PGDATABASE);
  expect(testDb).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  expect(typeof convergeGeneration).toBe('function');

  const connection = {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    database: testDb,
  };
  // Restricted runtime role: independent committed-state observer.
  coord = knexFactory({
    client: 'pg',
    connection: { ...connection, user: process.env.PGUSER, password: String(process.env.PGPASSWORD || '') },
    pool: { min: 1, max: 3 },
  });
  // Maintenance role: used ONLY to model a pre-0228 generation (H2).
  admin = knexFactory({
    client: 'pg',
    connection: {
      ...connection,
      user: process.env.PGMIGRATION_USER,
      password: String(process.env.PGMIGRATION_PASSWORD || ''),
    },
    pool: { min: 1, max: 1 },
  });

  const who = await coord.raw(
    `SELECT current_user AS role, r.rolsuper, r.rolbypassrls
       FROM pg_roles r WHERE r.rolname = current_user`
  );
  expect(who.rows[0]).toEqual(expect.objectContaining({ rolsuper: false, rolbypassrls: false }));
});

afterAll(async () => {
  if (originalApiVersion === undefined) delete process.env.SHOPIFY_API_VERSION;
  else process.env.SHOPIFY_API_VERSION = originalApiVersion;
  await coord?.destroy();
  await admin?.destroy();
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

async function coordTenant<T>(shopId: number, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return coord.transaction(async (trx) => {
    await trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [String(shopId)]);
    return fn(trx);
  });
}

async function waitFor<T>(probe: () => Promise<T> | T, label: string, tries = 400): Promise<NonNullable<T>> {
  for (let i = 0; i < tries; i += 1) {
    const value = await probe();
    if (value) return value as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`[S45_I4_TEST] waitFor timed out: ${label}`);
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ─── fixture (final-convergence suite pattern) ──────────────────────────────

type Fixture = {
  shopId: number;
  ownerId: number;
  operatorId: number;
  warehouseId: string;
  a1: string;
  a2: string;
  locationRaw: string;
  inventoryItemRaw: string;
  locationGid: string;
  variantId: string;
  itemGid: string;
  variantGid: string;
};

async function createFixture(): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `s45i4-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const warehouseId = crypto.randomUUID();
  const rootCode = `I4-${unique}-ROOT`;
  const a1 = `I4-${unique}-A1`;
  const a2 = `I4-${unique}-A2`;
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const locationRaw = `30${shopId}`;
  const inventoryItemRaw = `${shopId}401`;
  const variantRaw = `${shopId}501`;
  const shopDomain = `s45i4-${unique}.myshopify.com`;
  let ownerId = 0;
  let operatorId = 0;

  await withTenant(shopId, async (trx) => {
    const users = await trx('users')
      .insert([
        { shop_id: shopId, email: `i4-owner-${unique}@example.com`, password_hash: 'test-hash', role: 'owner' },
        { shop_id: shopId, email: `i4-operator-${unique}@example.com`, password_hash: 'test-hash', role: 'operator' },
      ])
      .returning(['id', 'role']);
    ownerId = Number(users.find((row: any) => row.role === 'owner')!.id);
    operatorId = Number(users.find((row: any) => row.role === 'operator')!.id);
    await trx('shop_memberships').insert([
      { shop_id: shopId, user_id: ownerId, role: 'owner' },
      { shop_id: shopId, user_id: operatorId, role: 'operator' },
    ]);
    await trx('shop_wms_settings').insert({ shop_id: shopId, bootstrap_model: 'reconcile_opening_expectation_v2' });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: `S4-5 I4 warehouse ${unique}`,
      root_location_code: rootCode,
      is_default: true,
      active: true,
      external_location_id: locationRaw,
    });
    await trx('warehouse_locations').insert([
      { shop_id: shopId, warehouse_id: warehouseId, location_code: rootCode, type: 'warehouse', parent_location_code: null, active: true, zone_type: null },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: a1, type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' },
      { shop_id: shopId, warehouse_id: warehouseId, location_code: a2, type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'storage' },
    ]);
    await trx('products').insert({
      lasyncro_product_id: productId, shop_id: shopId, title: 'S4-5 I4 product', status: 'active', product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shopId,
      sku: `I4-${unique}`, title: 'S4-5 I4 variant', unit_cost: '1.00', status: 'active',
    });
    await trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      lasyncro_variant_id: variantId,
      shop_id: shopId,
      platform: 'shopify',
      external_product_id: `gid://shopify/Product/${shopId}41`,
      external_variant_id: `gid://shopify/ProductVariant/${variantRaw}`,
      external_inventory_item_id: inventoryItemRaw,
      external_sku: `I4-${unique}`,
    });
    const [installation] = await trx('shopify_app_installations')
      .insert({ shop_id: shopId, shop_domain: shopDomain, shop_gid: `gid://shopify/Shop/${shopId}`, scopes: 'read_products,write_inventory' })
      .returning('id');
    await trx('shopify_admin_credentials').insert({
      shop_id: shopId,
      installation_id: installation.id,
      access_token_encrypted: encrypt(`i4-offline-token-${unique}`),
      refresh_token_encrypted: encrypt('i4-canonical-refresh-no-network-call'),
      access_expires_at: new Date(Date.now() + 86400000),
      refresh_expires_at: new Date(Date.now() + 2592000000),
      granted_scopes: normalizeAndValidateShopifyGrantedScopes(SHOPIFY_REQUIRED_SCOPE_STRING),
      credential_state: 'ACTIVE',
      credential_generation: '1',
    });
  });

  return {
    shopId, ownerId, operatorId, warehouseId, a1, a2, locationRaw, inventoryItemRaw,
    locationGid: `gid://shopify/Location/${locationRaw}`,
    variantId,
    itemGid: `gid://shopify/InventoryItem/${inventoryItemRaw}`,
    variantGid: `gid://shopify/ProductVariant/${variantRaw}`,
  };
}

async function seedTruth(fixture: Fixture, quantity: number): Promise<void> {
  const now = new Date();
  await withTenant(fixture.shopId, (trx) =>
    trx('inventory_truth')
      .insert({
        shop_id: fixture.shopId, lasyncro_variant_id: fixture.variantId, location_code: fixture.a1,
        on_hand_quantity: quantity, reserved_quantity: 0, committed_quantity: 0,
        available_quantity: Math.max(0, quantity), last_evaluated_at: now,
      })
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
      .merge({
        on_hand_quantity: quantity, reserved_quantity: 0, committed_quantity: 0,
        available_quantity: Math.max(0, quantity), last_evaluated_at: now, updated_at: now,
      })
  );
}

async function countOpeningBin(fixture: Fixture, recountTaskId: string, quantity: number | null) {
  await withTenant(fixture.shopId, (trx) => claimRecountTask(trx, fixture.shopId, recountTaskId, fixture.operatorId));
  if (quantity !== null) {
    const line = await withTenant(fixture.shopId, (trx) =>
      addOpeningInventoryRecountLine(trx, {
        shopId: fixture.shopId, recountTaskId, lasyncroVariantId: fixture.variantId, addedBy: fixture.operatorId,
      })
    );
    await withTenant(fixture.shopId, (trx) =>
      recordCount(trx, {
        shopId: fixture.shopId, recountTaskId, recountLineId: line.recount_line_id,
        countedQuantity: quantity, countMethod: 'bin_quantity', countedBy: fixture.operatorId,
      })
    );
  }
  await withTenant(fixture.shopId, (trx) =>
    completeOpeningInventoryBin(trx, fixture.shopId, recountTaskId, fixture.operatorId)
  );
}

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
              id: `gid://shopify/InventoryLevel/1?inventory_item_id=${fixture.inventoryItemRaw}`,
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

/** Opening cohort counted, physical truth = target at A1. */
async function makeCountedReady(fixture: Fixture, target: number): Promise<void> {
  const startReader: OpeningInventoryLocationPageReader = async () => locationPage(fixture, 11) as any;
  const started = await startShopOpeningInventory(
    { shopId: fixture.shopId, createdBy: fixture.ownerId, assignedTo: fixture.operatorId },
    { readLocationPage: startReader }
  );
  const first = started.bins.find((row) => row.location_code === fixture.a1);
  const second = started.bins.find((row) => row.location_code === fixture.a2);
  if (!first || !second) throw new Error('[S45_I4_TEST] opening cohort bins missing');
  await countOpeningBin(fixture, first.recount_task_id, target);
  await countOpeningBin(fixture, second.recount_task_id, null);
  await seedTruth(fixture, target);
}

/** I3's exact credit shape: one +1 inbound_purchase and truth +1, one transaction. */
async function commitRecoveryCredit(
  fixture: Fixture,
  options: { locationCode?: string; variantId?: string; trx?: Knex.Transaction } = {}
) {
  const credit = {
    creditMovementId: crypto.randomUUID(),
    deviceEventId: crypto.randomUUID(),
    unitRowId: crypto.randomUUID(),
    lasyncroUnitId: `LSU-${crypto.randomBytes(4).toString('hex')}`,
    lasyncroVariantId: options.variantId ?? fixture.variantId,
    locationCode: options.locationCode ?? fixture.a1,
  };
  const write = async (trx: Knex.Transaction) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    const now = new Date();
    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: credit.creditMovementId,
      lasyncro_variant_id: credit.lasyncroVariantId,
      shop_id: fixture.shopId,
      movement_type: 'inbound_purchase',
      quantity_delta: 1,
      location_code: credit.locationCode,
      reference_type: 'inventory_unit',
      reference_id: credit.unitRowId,
      platform: 'wms',
      occurred_at: now,
      device_event_id: credit.deviceEventId,
      triggered_by: 'receive_recovery',
    });
    await trx('inventory_truth')
      .insert({
        shop_id: fixture.shopId, lasyncro_variant_id: credit.lasyncroVariantId, location_code: credit.locationCode,
        on_hand_quantity: 1, reserved_quantity: 0, committed_quantity: 0, available_quantity: 1, last_evaluated_at: now,
      })
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
      .merge({
        on_hand_quantity: trx.raw('inventory_truth.on_hand_quantity + 1'),
        available_quantity: trx.raw('inventory_truth.available_quantity + 1'),
        last_evaluated_at: now,
        updated_at: now,
      });
  };
  if (options.trx) await write(options.trx);
  else await withTenant(fixture.shopId, write);
  return credit;
}

/** An unsynchronised -1 correction (recount shape) at A1. */
async function commitNegativeCorrection(fixture: Fixture): Promise<void> {
  await withTenant(fixture.shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    const now = new Date();
    await trx('inventory_movements').insert({
      lasyncro_inventory_movement_id: crypto.randomUUID(),
      lasyncro_variant_id: fixture.variantId,
      shop_id: fixture.shopId,
      movement_type: 'reconciliation_correction',
      quantity_delta: -1,
      location_code: fixture.a1,
      reference_type: 'recount_line',
      reference_id: crypto.randomUUID(),
      platform: 'wms',
      occurred_at: now,
      device_event_id: crypto.randomUUID(),
      triggered_by: 'inventory_recount',
    });
    await trx('inventory_truth')
      .where({ shop_id: fixture.shopId, lasyncro_variant_id: fixture.variantId, location_code: fixture.a1 })
      .update({
        on_hand_quantity: trx.raw('on_hand_quantity - 1'),
        available_quantity: trx.raw('available_quantity - 1'),
        updated_at: now,
      });
  });
}

// ─── injected Shopify ───────────────────────────────────────────────────────

type Handler = (call: { document: string; variables: any }) => Promise<unknown>;

/** Cutover documents (set / read) and recovery adjustments are routed apart. */
function provider(params: { reads?: Handler[]; sets?: Handler[]; adjusts?: Handler[] } = {}) {
  const reads = params.reads ?? [];
  const sets = params.sets ?? [];
  const adjusts = params.adjusts ?? [];
  const readCalls: any[] = [];
  const setCalls: any[] = [];
  const adjustCalls: any[] = [];
  const createShopifyGraphQLClient = () => ({
    request: async (document: string, options: any = {}) => {
      const call = { document, variables: options.variables };
      if (document === RECOVERY_INVENTORY_ADJUST_MUTATION) {
        const handler = adjusts[adjustCalls.length];
        adjustCalls.push(call);
        if (!handler) throw new Error('[S45_I4_TEST] unexpected recovery adjustment');
        return handler(call);
      }
      if (/\bmutation\b/.test(document)) {
        const handler = sets[setCalls.length];
        setCalls.push(call);
        if (!handler) throw new Error('[S45_I4_TEST] unexpected cutover mutation');
        return handler(call);
      }
      const handler = reads[readCalls.length];
      readCalls.push(call);
      if (!handler) throw new Error('[S45_I4_TEST] unexpected read');
      return handler(call);
    },
  });
  return { readCalls, setCalls, adjustCalls, createShopifyGraphQLClient };
}

const setSuccess = (shopId: number) => async () => ({
  data: {
    inventorySetQuantities: {
      inventoryAdjustmentGroup: { id: `gid://shopify/InventoryAdjustmentGroup/${shopId}${Date.now()}` },
      userErrors: [],
    },
  },
  extensions: {},
  headers: { 'X-Shopify-API-Version': [FROZEN_API_VERSION] },
});

/** Shopify-side idempotency model: one application per key. */
function idempotentShopify() {
  const applied = new Map<string, number>();
  const apply = (variables: any) => {
    const key = String(variables.idempotencyKey);
    if (!applied.has(key)) applied.set(key, variables.input.changes[0].delta);
    return {
      data: {
        inventoryAdjustQuantities: {
          inventoryAdjustmentGroup: { id: `gid://shopify/InventoryAdjustmentGroup/${key.length}${applied.size}` },
          userErrors: [],
        },
      },
    };
  };
  return { applied, apply };
}

// ─── cutover lifecycle ──────────────────────────────────────────────────────

async function freeze(fixture: Fixture, shopifyOnHand: number) {
  await createOpeningInventoryCutoverGeneration(
    { shopId: fixture.shopId, actingUserId: fixture.ownerId, acceptPhysicalTruth: true },
    { readLocationPage: async () => locationPage(fixture, shopifyOnHand) as any }
  );
  return latestGeneration(fixture.shopId);
}

async function latestGeneration(shopId: number) {
  return coordTenant(shopId, async (trx) => {
    const generation = await trx(GENERATIONS).where({ shop_id: shopId }).orderBy('generation_sequence', 'desc').first();
    const entries = await trx(ENTRIES).where({ shop_id: shopId, generation_id: generation.generation_id });
    const batches = await trx(BATCHES).where({ shop_id: shopId, generation_id: generation.generation_id });
    const header = await trx(HEADERS).where({ shop_id: shopId, generation_id: generation.generation_id }).first();
    const captured = await trx(CAPTURED)
      .where({ shop_id: shopId, generation_id: generation.generation_id })
      .pluck('credit_movement_id');
    return { generation, entries, batches, header, captured: captured.map(String) };
  });
}

async function waitForLeaseExpiry(shopId: number, generationId: string) {
  await waitFor(async () => {
    const result = await coordTenant(shopId, (trx) =>
      trx.raw(
        `SELECT bool_and(lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp()) AS expired
           FROM ${EXECUTIONS} WHERE shop_id = ? AND generation_id = ?`,
        [shopId, generationId]
      )
    );
    return result.rows[0]?.expired === true;
  }, 'execution lease expired', 800);
}

async function execution(shopId: number, generationId: string) {
  return coordTenant(shopId, (trx) => trx(EXECUTIONS).where({ shop_id: shopId, generation_id: generationId }).first());
}

/** REAL E02 execution of every frozen batch → verifying (lease left to expire). */
async function executeToVerifying(fixture: Fixture, frozen: Awaited<ReturnType<typeof freeze>>) {
  const shopify = provider({ sets: frozen.batches.map(() => setSuccess(fixture.shopId)) });
  await executeGeneration(
    { shopId: fixture.shopId, generationId: frozen.generation.generation_id },
    { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient, leaseDurationMs: FIXTURE_LEASE_MS }
  );
  await waitForLeaseExpiry(fixture.shopId, frozen.generation.generation_id);
  return shopify;
}

async function converge(fixture: Fixture, generationId: string, shopifyOnHand: number) {
  const shopify = provider({ reads: [async () => locationPage(fixture, shopifyOnHand)] });
  const result = await convergeGeneration(
    { shopId: fixture.shopId, generationId },
    { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient }
  );
  return { result, shopify };
}

async function marker(shopId: number) {
  return coordTenant(shopId, async (trx) =>
    (await trx('shop_wms_settings').where({ shop_id: shopId }).first('opening_inventory_shopify_synced_at'))
      ?.opening_inventory_shopify_synced_at ?? null
  );
}

/** Frozen 3 ← 8 at A1, executed and converged at 3. */
async function convergedShop() {
  const fixture = await createFixture();
  await makeCountedReady(fixture, 3);
  const frozen = await freeze(fixture, 8);
  await executeToVerifying(fixture, frozen);
  const { result } = await converge(fixture, frozen.generation.generation_id, 3);
  expect(JSON.stringify(result)).toContain('OPENING_CUTOVER_CONVERGED');
  expect((await execution(fixture.shopId, frozen.generation.generation_id)).status).toBe('converged');
  return { fixture, frozen };
}

// ─── sync helpers ───────────────────────────────────────────────────────────

/** Registers a credit from the REAL classifier (discovery covered elsewhere). */
async function register(fixture: Fixture, credit: Awaited<ReturnType<typeof commitRecoveryCredit>>) {
  return withTenant(
    fixture.shopId,
    async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', ['opening_inventory_cutover', fixture.shopId]);
      const decision = await classifyRecoveryCredit(trx, fixture.shopId, credit);
      const identity = recoverySyncIdentity(fixture.shopId, credit.creditMovementId);
      await trx(SYNCS).insert({
        shop_id: fixture.shopId,
        credit_movement_id: credit.creditMovementId,
        device_event_id: credit.deviceEventId,
        lasyncro_unit_id: credit.lasyncroUnitId,
        lasyncro_variant_id: credit.lasyncroVariantId,
        location_code: credit.locationCode,
        idempotency_key: identity.idempotencyKey,
        reference_document_uri: identity.referenceDocumentUri,
        status: decision.status,
        hold_reason: decision.holdReason,
        baseline_generation_id: decision.baselineGenerationId,
      });
      return decision;
    },
    { isolationLevel: 'repeatable read' }
  );
}

async function syncRow(shopId: number, creditMovementId: string) {
  return coordTenant(shopId, (trx) => trx(SYNCS).where({ shop_id: shopId, credit_movement_id: creditMovementId }).first());
}

/** Test clock: release the retry backoff (attempt timing only). */
async function releaseBackoff(shopId: number, creditMovementId: string) {
  await coordTenant(shopId, (trx) =>
    trx(SYNCS)
      .where({ shop_id: shopId, credit_movement_id: creditMovementId })
      .update({ last_attempt_at: trx.raw(`now() - interval '1 hour'`) })
  );
}

function expectAdjustment(call: any, fixture: Fixture, creditMovementId: string) {
  const identity = recoverySyncIdentity(fixture.shopId, creditMovementId);
  expect(call.variables).toEqual({
    idempotencyKey: identity.idempotencyKey,
    input: {
      reason: 'correction',
      name: 'available',
      referenceDocumentUri: identity.referenceDocumentUri,
      changes: [{ inventoryItemId: fixture.itemGid, locationId: fixture.locationGid, delta: 1, changeFromQuantity: null }],
    },
  });
}

// ─── CB1 ────────────────────────────────────────────────────────────────────

describe('CB1 — per-credit capture in the freeze snapshot', () => {
  it('CB1-A captures a credit committed before freeze; converged → skipped_included, no adjustment', async () => {
    const fixture = await createFixture();
    await makeCountedReady(fixture, 3);
    const credit = await commitRecoveryCredit(fixture);

    const frozen = await freeze(fixture, 8);
    expect(frozen.header).toEqual(expect.objectContaining({ credit_count: 1, source: 'freeze', warehouse_id: fixture.warehouseId }));
    expect(frozen.captured).toEqual([credit.creditMovementId]);
    expect(Number(frozen.entries[0].target_quantity)).toBe(4);

    await executeToVerifying(fixture, frozen);
    const { result } = await converge(fixture, frozen.generation.generation_id, 4);
    expect(JSON.stringify(result)).toContain('OPENING_CUTOVER_CONVERGED');

    const decision = await register(fixture, credit);
    expect(decision).toEqual({ status: 'skipped_included', holdReason: null, baselineGenerationId: frozen.generation.generation_id });

    const shopify = provider();
    expect(await dispatchNextRecoveryCredit(fixture.shopId, { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient }))
      .toEqual({ kind: 'IDLE' });
    expect(shopify.adjustCalls).toHaveLength(0);
  });

  it('CB1-B a credit committed after the freeze snapshot is in neither the capture nor the target', async () => {
    const fixture = await createFixture();
    await makeCountedReady(fixture, 3);

    // Hold the cutover lock from the reader (runs between T1 and T2): T2 takes
    // its REPEATABLE READ snapshot, then waits on the lock.
    const lockHeld = deferred<void>();
    const release = deferred<void>();
    let blocker: Promise<void> | null = null;

    const generation = createOpeningInventoryCutoverGeneration(
      { shopId: fixture.shopId, actingUserId: fixture.ownerId, acceptPhysicalTruth: true },
      {
        readLocationPage: async () => {
          blocker = coord.transaction(async (trx) => {
            await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', ['opening_inventory_cutover', fixture.shopId]);
            lockHeld.resolve();
            await release.promise;
          });
          await lockHeld.promise;
          return locationPage(fixture, 8) as any;
        },
      }
    );

    await waitFor(async () => {
      const waiting = await coord.raw(
        `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`
      );
      return waiting.rows[0].n >= 1;
    }, 'freeze transaction waiting on the cutover lock');

    const credit = await commitRecoveryCredit(fixture);
    release.resolve();
    await blocker;
    await generation;

    const frozen = await latestGeneration(fixture.shopId);
    expect(frozen.generation.status).toBe('frozen');
    expect(frozen.header).toEqual(expect.objectContaining({ credit_count: 0, source: 'freeze' }));
    expect(frozen.captured).not.toContain(credit.creditMovementId);
    expect(Number(frozen.entries[0].target_quantity)).toBe(3);

    // Truth now 4 ≠ frozen 3: the existing E02 revalidation refuses dispatch.
    const shopify = provider();
    await executeGeneration(
      { shopId: fixture.shopId, generationId: frozen.generation.generation_id },
      { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient, leaseDurationMs: FIXTURE_LEASE_MS }
    );
    expect(shopify.setCalls).toHaveLength(0);
    expect((await execution(fixture.shopId, frozen.generation.generation_id)).status).toBe('requires_regeneration');
  });

  it('CB1-X capture evidence cannot be appended to a frozen generation', async () => {
    const fixture = await createFixture();
    await makeCountedReady(fixture, 3);
    const frozen = await freeze(fixture, 8);
    const credit = await commitRecoveryCredit(fixture);

    await expect(
      coordTenant(fixture.shopId, (trx) =>
        trx(CAPTURED).insert({
          shop_id: fixture.shopId,
          generation_id: frozen.generation.generation_id,
          credit_movement_id: credit.creditMovementId,
          location_code: fixture.a1,
        })
      )
    ).rejects.toThrow(/RECOVERY_CAPTURE_GENERATION_NOT_ASSEMBLING/);
    await expect(
      coordTenant(fixture.shopId, (trx) => trx(HEADERS).where({ shop_id: fixture.shopId }).del())
    ).rejects.toThrow(/permission denied for table opening_inventory_recovery_capture_headers/);
  });
});

// ─── CB2 ────────────────────────────────────────────────────────────────────

describe('CB2 — recovery-credit drift at convergence', () => {
  it('CB2-C a post-freeze credit forces regeneration', async () => {
    const fixture = await createFixture();
    await makeCountedReady(fixture, 3);
    const frozen = await freeze(fixture, 8);
    await executeToVerifying(fixture, frozen);
    await commitRecoveryCredit(fixture);

    const { result } = await converge(fixture, frozen.generation.generation_id, 3);
    expect(JSON.stringify(result)).not.toContain('OPENING_CUTOVER_CONVERGED');
    expect((await execution(fixture.shopId, frozen.generation.generation_id)).status).toBe('requires_regeneration');
    expect(await marker(fixture.shopId)).toBeNull();
  });

  it('T4-NET recovery +1 offset by a -1 correction → RECOVERY_CREDITS_CHANGED; N+1 includes it; no adjustment', async () => {
    const fixture = await createFixture();
    await makeCountedReady(fixture, 3);
    const n = await freeze(fixture, 8);
    await executeToVerifying(fixture, n);

    const credit = await commitRecoveryCredit(fixture);
    await commitNegativeCorrection(fixture);
    const truth = await coordTenant(fixture.shopId, (trx) =>
      trx('inventory_truth').where({ shop_id: fixture.shopId, lasyncro_variant_id: fixture.variantId, location_code: fixture.a1 }).first('on_hand_quantity')
    );
    expect(Number(truth.on_hand_quantity)).toBe(3); // fingerprint-equal to the frozen target

    const { result } = await converge(fixture, n.generation.generation_id, 3);
    expect(JSON.stringify(result)).not.toContain('OPENING_CUTOVER_CONVERGED');
    const failed = await execution(fixture.shopId, n.generation.generation_id);
    expect(failed.status).toBe('requires_regeneration');
    expect(failed.terminal_reason).toContain('RECOVERY_CREDITS_CHANGED');
    expect(failed.terminal_reason).not.toContain('PHYSICAL_TARGET_CHANGED');
    expect(await marker(fixture.shopId)).toBeNull();

    expect(await register(fixture, credit)).toEqual(
      expect.objectContaining({ status: 'held_no_baseline', holdReason: 'NO_CONVERGED_CUTOVER' })
    );

    // Regeneration N+1: Shopify is already at 3 after N's set; truth 3.
    const next = await freeze(fixture, 3);
    expect(next.generation.generation_id).not.toBe(n.generation.generation_id);
    expect(next.captured).toEqual([credit.creditMovementId]);
    await executeToVerifying(fixture, next);
    const converged = await converge(fixture, next.generation.generation_id, 3);
    expect(JSON.stringify(converged.result)).toContain('OPENING_CUTOVER_CONVERGED');

    // The held row stays held (only a sweep re-classifies it); nothing is claimable.
    const shopify = provider();
    expect(await dispatchNextRecoveryCredit(fixture.shopId, { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient }))
      .toEqual({ kind: 'IDLE' });
    const decision = await withTenant(fixture.shopId, (trx) => classifyRecoveryCredit(trx, fixture.shopId, credit), {
      isolationLevel: 'repeatable read',
    });
    expect(decision).toEqual({ status: 'skipped_included', holdReason: null, baselineGenerationId: next.generation.generation_id });
    expect(shopify.adjustCalls).toHaveLength(0);
  });
});

// ─── dispatch ───────────────────────────────────────────────────────────────

describe('dispatch — exactly one +1 per post-baseline credit', () => {
  it('D1 pushes one frozen +1 and never repeats it', async () => {
    const { fixture } = await convergedShop();
    const credit = await commitRecoveryCredit(fixture);
    expect((await register(fixture, credit)).status).toBe('pending');

    const shopifyState = idempotentShopify();
    const shopify = provider({ adjusts: [async ({ variables }) => shopifyState.apply(variables)] });
    const deps = { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient };

    expect(await dispatchNextRecoveryCredit(fixture.shopId, deps)).toEqual({ kind: 'SUCCEEDED', creditMovementId: credit.creditMovementId });
    expect(await dispatchNextRecoveryCredit(fixture.shopId, deps)).toEqual({ kind: 'IDLE' });
    expect(shopify.adjustCalls).toHaveLength(1);
    expectAdjustment(shopify.adjustCalls[0], fixture, credit.creditMovementId);

    const row = await syncRow(fixture.shopId, credit.creditMovementId);
    expect(row).toEqual(expect.objectContaining({ status: 'succeeded', attempt_count: 1, lease_token: null }));
    expect(row.first_dispatched_at).not.toBeNull();
    expect(row.provider_adjustment_group_gid).toMatch(/^gid:\/\/shopify\/InventoryAdjustmentGroup\//);
  });

  it('D2 thrown transport error → ambiguous → identical retry → succeeded', async () => {
    const { fixture } = await convergedShop();
    const credit = await commitRecoveryCredit(fixture);
    await register(fixture, credit);

    const shopifyState = idempotentShopify();
    const shopify = provider({
      adjusts: [
        async () => {
          throw new Error('[S45_I4_TEST] socket hang up');
        },
        async ({ variables }) => shopifyState.apply(variables),
      ],
    });
    const deps = { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient };

    expect((await dispatchNextRecoveryCredit(fixture.shopId, deps)).kind).toBe('AMBIGUOUS');
    const ambiguous = await syncRow(fixture.shopId, credit.creditMovementId);
    expect(ambiguous.status).toBe('ambiguous');

    await releaseBackoff(fixture.shopId, credit.creditMovementId);
    expect((await dispatchNextRecoveryCredit(fixture.shopId, deps)).kind).toBe('SUCCEEDED');
    expect(shopify.adjustCalls).toHaveLength(2);
    expect(shopify.adjustCalls[1].variables).toEqual(shopify.adjustCalls[0].variables);
    expect(shopifyState.applied.size).toBe(1);

    const row = await syncRow(fixture.shopId, credit.creditMovementId);
    expect(row.first_dispatched_at.toISOString()).toBe(ambiguous.first_dispatched_at.toISOString());
    expect(row.attempt_count).toBe(2);
  });

  it('D3 applied but acknowledgement lost → retry deduplicated by key, applied once', async () => {
    const { fixture } = await convergedShop();
    const credit = await commitRecoveryCredit(fixture);
    await register(fixture, credit);

    const shopifyState = idempotentShopify();
    const shopify = provider({
      adjusts: [
        async ({ variables }) => {
          shopifyState.apply(variables);
          const error = new Error('[S45_I4_TEST] response lost after apply');
          error.name = 'TimeoutError';
          throw error;
        },
        async ({ variables }) => shopifyState.apply(variables),
      ],
    });
    const deps = { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient };

    expect((await dispatchNextRecoveryCredit(fixture.shopId, deps)).kind).toBe('AMBIGUOUS');
    await releaseBackoff(fixture.shopId, credit.creditMovementId);
    expect((await dispatchNextRecoveryCredit(fixture.shopId, deps)).kind).toBe('SUCCEEDED');
    expect(shopify.adjustCalls[1].variables).toEqual(shopify.adjustCalls[0].variables);
    expect([...shopifyState.applied.values()]).toEqual([1]);
  });

  it('D4 userErrors → rejected and never retried', async () => {
    const { fixture } = await convergedShop();
    const credit = await commitRecoveryCredit(fixture);
    await register(fixture, credit);

    const shopify = provider({
      adjusts: [
        async () => ({
          data: {
            inventoryAdjustQuantities: {
              inventoryAdjustmentGroup: null,
              userErrors: [{ field: ['input'], message: '[S45_I4_TEST] synthetic rejection', code: 'INVALID' }],
            },
          },
        }),
      ],
    });
    const deps = { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient };

    expect((await dispatchNextRecoveryCredit(fixture.shopId, deps)).kind).toBe('REJECTED');
    await releaseBackoff(fixture.shopId, credit.creditMovementId);
    expect(await dispatchNextRecoveryCredit(fixture.shopId, deps)).toEqual({ kind: 'IDLE' });
    expect(shopify.adjustCalls).toHaveLength(1);
    expect((await syncRow(fixture.shopId, credit.creditMovementId)).status).toBe('rejected');
  });

  it('D5 lease expiry mid-dispatch → ambiguous; stale owner fenced; retry uses the identical key', async () => {
    const { fixture } = await convergedShop();
    const credit = await commitRecoveryCredit(fixture);
    await register(fixture, credit);

    const shopifyState = idempotentShopify();
    const gate = deferred<void>();
    const reached = deferred<void>();
    const shopify = provider({
      adjusts: [
        async ({ variables }) => {
          reached.resolve();
          await gate.promise;
          return shopifyState.apply(variables);
        },
        async ({ variables }) => shopifyState.apply(variables),
      ],
    });
    const deps = { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient };

    const first = dispatchNextRecoveryCredit(fixture.shopId, deps);
    await reached.promise;
    expect((await syncRow(fixture.shopId, credit.creditMovementId)).status).toBe('dispatching');

    // Simulated crash: the claim lease runs out while the request is in flight.
    await coordTenant(fixture.shopId, (trx) =>
      trx(SYNCS)
        .where({ shop_id: fixture.shopId, credit_movement_id: credit.creditMovementId })
        .update({ lease_expires_at: trx.raw(`now() - interval '1 second'`) })
    );
    expect(await dispatchNextRecoveryCredit(fixture.shopId, deps)).toEqual({ kind: 'IDLE' });
    expect((await syncRow(fixture.shopId, credit.creditMovementId)).status).toBe('ambiguous');

    gate.resolve();
    expect((await first).kind).toBe('FENCED');
    expect((await syncRow(fixture.shopId, credit.creditMovementId)).status).toBe('ambiguous');

    await releaseBackoff(fixture.shopId, credit.creditMovementId);
    expect((await dispatchNextRecoveryCredit(fixture.shopId, deps)).kind).toBe('SUCCEEDED');
    expect(shopify.adjustCalls[1].variables).toEqual(shopify.adjustCalls[0].variables);
    expect(shopifyState.applied.size).toBe(1);
  });

  it('D6 23-hour cutoff → held_expired with zero calls; late retry and runtime reconciliation refused', async () => {
    const { fixture } = await convergedShop();
    const credit = await commitRecoveryCredit(fixture);
    await register(fixture, credit);

    // First dispatch 24 h ago, outcome unknown (state reached through allowed transitions).
    const shopify = provider();
    const deps = { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient };
    await coordTenant(fixture.shopId, async (trx) => {
      const where = { shop_id: fixture.shopId, credit_movement_id: credit.creditMovementId };
      const sha = (await import('api-src/services/wms/shopifyRecoveryInventorySync.service')).requestSha256;
      const identity = recoverySyncIdentity(fixture.shopId, credit.creditMovementId);
      const request = {
        idempotencyKey: identity.idempotencyKey,
        input: {
          reason: 'correction' as const,
          name: 'available' as const,
          referenceDocumentUri: identity.referenceDocumentUri,
          changes: [{ inventoryItemId: fixture.itemGid, locationId: fixture.locationGid, delta: 1 as const, changeFromQuantity: null }],
        },
      };
      await trx(SYNCS).where(where).update({
        status: 'dispatching',
        request_inventory_item_gid: fixture.itemGid,
        request_location_gid: fixture.locationGid,
        request_payload_sha256: sha(request),
        request_frozen_at: trx.raw(`now() - interval '24 hours'`),
        first_dispatched_at: trx.raw(`now() - interval '24 hours'`),
        attempt_count: 1,
        last_attempt_at: trx.raw(`now() - interval '24 hours'`),
        lease_token: crypto.randomUUID(),
        lease_expires_at: trx.raw(`now() - interval '23 hours'`),
      });
    });

    expect(await dispatchNextRecoveryCredit(fixture.shopId, deps)).toEqual({ kind: 'IDLE' });
    expect(shopify.adjustCalls).toHaveLength(0);
    expect(await syncRow(fixture.shopId, credit.creditMovementId)).toEqual(
      expect.objectContaining({ status: 'held_expired', hold_reason: 'RETRY_WINDOW_EXPIRED' })
    );

    await expect(
      coordTenant(fixture.shopId, (trx) =>
        trx(SYNCS)
          .where({ shop_id: fixture.shopId, credit_movement_id: credit.creditMovementId })
          .update({ status: 'succeeded' })
      )
    ).rejects.toThrow(/RECOVERY_SYNC_TRANSITION_INVALID/);
  });

  it('D6b the trigger refuses an ambiguous retry beyond 23 hours', async () => {
    const { fixture } = await convergedShop();
    const credit = await commitRecoveryCredit(fixture);
    await register(fixture, credit);
    const where = { shop_id: fixture.shopId, credit_movement_id: credit.creditMovementId };

    await coordTenant(fixture.shopId, (trx) =>
      trx(SYNCS).where(where).update({
        status: 'dispatching',
        request_inventory_item_gid: fixture.itemGid,
        request_location_gid: fixture.locationGid,
        request_payload_sha256: 'a'.repeat(64),
        request_frozen_at: trx.raw(`now() - interval '24 hours'`),
        first_dispatched_at: trx.raw(`now() - interval '24 hours'`),
        lease_token: crypto.randomUUID(),
        lease_expires_at: trx.raw(`now() + interval '1 minute'`),
      })
    );
    await coordTenant(fixture.shopId, (trx) => trx(SYNCS).where(where).update({ status: 'ambiguous' }));
    await expect(
      coordTenant(fixture.shopId, (trx) => trx(SYNCS).where(where).update({ status: 'dispatching' }))
    ).rejects.toThrow(/RECOVERY_SYNC_RETRY_WINDOW_EXPIRED/);
    await expect(
      coordTenant(fixture.shopId, (trx) => trx(SYNCS).where(where).update({ request_payload_sha256: 'b'.repeat(64) }))
    ).rejects.toThrow(/RECOVERY_SYNC_REQUEST_FROZEN/);
  });

  it('D7 missing mapping → blocked_mapping with zero calls; restored mapping → one +1', async () => {
    const { fixture } = await convergedShop();
    const productId = crypto.randomUUID();
    const unmappedVariant = crypto.randomUUID();
    await withTenant(fixture.shopId, async (trx) => {
      await trx('products').insert({ lasyncro_product_id: productId, shop_id: fixture.shopId, title: 'I4 unmapped', status: 'active', product_type: 'physical' });
      await trx('variants').insert({
        lasyncro_variant_id: unmappedVariant, lasyncro_product_id: productId, shop_id: fixture.shopId,
        sku: `I4-UNMAPPED-${fixture.shopId}`, title: 'I4 unmapped variant', unit_cost: '1.00', status: 'active',
      });
    });
    const credit = await commitRecoveryCredit(fixture, { variantId: unmappedVariant });
    expect((await register(fixture, credit)).status).toBe('pending');

    const shopifyState = idempotentShopify();
    const shopify = provider({ adjusts: [async ({ variables }) => shopifyState.apply(variables)] });
    const deps = { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient };

    expect((await dispatchNextRecoveryCredit(fixture.shopId, deps)).kind).toBe('BLOCKED_MAPPING');
    expect(shopify.adjustCalls).toHaveLength(0);
    expect(await syncRow(fixture.shopId, credit.creditMovementId)).toEqual(
      expect.objectContaining({ status: 'blocked_mapping', last_error: 'INVENTORY_ITEM_MAPPING_MISSING', request_payload_sha256: null })
    );

    await withTenant(fixture.shopId, (trx) =>
      trx('external_product_identity_map').insert({
        id: crypto.randomUUID(),
        lasyncro_variant_id: unmappedVariant,
        shop_id: fixture.shopId,
        platform: 'shopify',
        external_product_id: `gid://shopify/Product/${fixture.shopId}49`,
        external_variant_id: `gid://shopify/ProductVariant/${fixture.shopId}599`,
        external_inventory_item_id: `${fixture.shopId}499`,
        external_sku: `I4-UNMAPPED-${fixture.shopId}`,
      })
    );
    await releaseBackoff(fixture.shopId, credit.creditMovementId);
    expect((await dispatchNextRecoveryCredit(fixture.shopId, deps)).kind).toBe('SUCCEEDED');
    expect(shopify.adjustCalls).toHaveLength(1);
    expect(shopify.adjustCalls[0].variables.input.changes[0].inventoryItemId).toBe(`gid://shopify/InventoryItem/${fixture.shopId}499`);
  });

  it('D8 credential not READY → no call; the credit stays durable', async () => {
    const { fixture } = await convergedShop();
    const credit = await commitRecoveryCredit(fixture);
    await register(fixture, credit);
    await withTenant(fixture.shopId, (trx) =>
      trx('shopify_app_installations').where({ shop_id: fixture.shopId }).update({ uninstalled_at: new Date() })
    );

    const shopify = provider();
    const outcome = await dispatchNextRecoveryCredit(fixture.shopId, { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient });
    expect(['BLOCKED_CREDENTIAL', 'CREDENTIAL_RETRY']).toContain(outcome.kind);
    expect(shopify.adjustCalls).toHaveLength(0);
    const row = await syncRow(fixture.shopId, credit.creditMovementId);
    expect(['pending', 'blocked_credential']).toContain(row.status);
    expect(row.first_dispatched_at).toBeNull();
    expect(row.lease_token).toBeNull();
  });

  it('D9 two concurrent dispatchers → one provider call', async () => {
    const { fixture } = await convergedShop();
    const credit = await commitRecoveryCredit(fixture);
    await register(fixture, credit);

    const shopifyState = idempotentShopify();
    const gate = deferred<void>();
    const shopify = provider({
      adjusts: [
        async ({ variables }) => {
          await gate.promise;
          return shopifyState.apply(variables);
        },
      ],
    });
    const deps = { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient };

    const runs = Promise.all([dispatchNextRecoveryCredit(fixture.shopId, deps), dispatchNextRecoveryCredit(fixture.shopId, deps)]);
    await waitFor(() => shopify.adjustCalls.length >= 1, 'one adjustment in flight');
    gate.resolve();
    const outcomes = (await runs).map((o) => o.kind).sort();
    expect(outcomes).toEqual(['IDLE', 'SUCCEEDED']);
    expect(shopify.adjustCalls).toHaveLength(1);
  });
});

// ─── historical baselines, trigger guards, tenancy ──────────────────────────

describe('baseline proof', () => {
  it('H1 marker without a converged generation → held_legacy_baseline', async () => {
    const fixture = await createFixture();
    await withTenant(fixture.shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: fixture.shopId }).update({ opening_inventory_shopify_synced_at: new Date() })
    );
    const credit = await commitRecoveryCredit(fixture);
    expect(await register(fixture, credit)).toEqual(
      expect.objectContaining({ status: 'held_legacy_baseline', baselineGenerationId: null })
    );
  });

  it('H2 converged generation without capture evidence → held_no_capture', async () => {
    const { fixture, frozen } = await convergedShop();
    // Model a generation frozen before 0228 (maintenance role only).
    await admin.transaction(async (trx) => {
      await trx.raw(`SET LOCAL row_security = off`);
      await trx(HEADERS).where({ shop_id: fixture.shopId, generation_id: frozen.generation.generation_id }).del();
    });
    const credit = await commitRecoveryCredit(fixture);
    expect(await register(fixture, credit)).toEqual(
      expect.objectContaining({ status: 'held_no_capture', holdReason: 'BASELINE_WITHOUT_RECOVERY_CAPTURE' })
    );
  });

  it('G1 0228 refuses a push of an included credit, a skip of an excluded one, and an unproven baseline', async () => {
    const fixture = await createFixture();
    await makeCountedReady(fixture, 3);
    const included = await commitRecoveryCredit(fixture);
    const frozen = await freeze(fixture, 8);
    const generationId = frozen.generation.generation_id;

    const insertAs = (credit: typeof included, status: string) =>
      coordTenant(fixture.shopId, (trx) => {
        const identity = recoverySyncIdentity(fixture.shopId, credit.creditMovementId);
        return trx(SYNCS).insert({
          shop_id: fixture.shopId, credit_movement_id: credit.creditMovementId, device_event_id: credit.deviceEventId,
          lasyncro_unit_id: credit.lasyncroUnitId, lasyncro_variant_id: credit.lasyncroVariantId, location_code: credit.locationCode,
          idempotency_key: identity.idempotencyKey, reference_document_uri: identity.referenceDocumentUri,
          status, baseline_generation_id: generationId,
        });
      });

    // Not converged yet.
    await expect(insertAs(included, 'skipped_included')).rejects.toThrow(/RECOVERY_SYNC_BASELINE_UNPROVEN/);

    await executeToVerifying(fixture, frozen);
    await converge(fixture, generationId, 4);
    const excluded = await commitRecoveryCredit(fixture);

    await expect(insertAs(included, 'pending')).rejects.toThrow(/RECOVERY_SYNC_PUSH_OF_INCLUDED_CREDIT/);
    await expect(insertAs(excluded, 'skipped_included')).rejects.toThrow(/RECOVERY_SYNC_SKIP_WITHOUT_INCLUSION/);
    await expect(insertAs(excluded, 'succeeded')).rejects.toThrow(/RECOVERY_SYNC_INITIAL_STATUS_INVALID/);
  });

  it('TI another tenant sees and dispatches nothing of this shop', async () => {
    const { fixture } = await convergedShop();
    const credit = await commitRecoveryCredit(fixture);
    await register(fixture, credit);
    const other = await createFixture();

    const visible = await coordTenant(other.shopId, async (trx) => ({
      syncs: await trx(SYNCS).where({ credit_movement_id: credit.creditMovementId }),
      headers: await trx(HEADERS).where({ shop_id: fixture.shopId }),
    }));
    expect(visible).toEqual({ syncs: [], headers: [] });

    const shopify = provider();
    expect(await dispatchNextRecoveryCredit(other.shopId, { createShopifyGraphQLClient: shopify.createShopifyGraphQLClient }))
      .toEqual({ kind: 'IDLE' });
    expect(shopify.adjustCalls).toHaveLength(0);
    expect((await syncRow(fixture.shopId, credit.creditMovementId)).status).toBe('pending');
  });
});
