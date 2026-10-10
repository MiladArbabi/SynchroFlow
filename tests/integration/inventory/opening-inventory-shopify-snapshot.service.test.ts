// tests/integration/inventory/opening-inventory-shopify-snapshot.service.test.ts
//
// GH-1179 Slice B — Opening Inventory start captures an immutable,
// location-scoped Shopify on_hand snapshot:
//
//   T1 reserve scope (short shop_wms_settings lock, collecting header + lease)
//   → Shopify Location.inventoryLevels pagination OUTSIDE any transaction
//   → T2 atomically persist complete snapshot + cohort + started_at.
//
// Driven through the real start route (createApp + supertest, real auth,
// FT2, capability and RBAC middleware, real Postgres). Only the Shopify
// GraphQL client boundary is stubbed. The stub serves the provider contract:
//
//   { data: { location: { id, isActive, inventoryLevels: {
//       pageInfo: { hasNextPage, endCursor },
//       nodes|edges: [{ isActive, item: { id, tracked, variant: { id } },
//                       quantities: [{ name: 'on_hand', quantity }] }] } } } }
//
// Snapshot tables are read through a to_regclass guard so a missing schema is
// reported as a diagnostic value instead of crashing the suite.

const mockShopifyRequest = jest.fn();

const mockCreateShopifyGraphQLClient = jest.fn(() => ({
  request: mockShopifyRequest,
}));

jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  createShopifyGraphQLClient: (...args: any[]) =>
    mockCreateShopifyGraphQLClient(...args),
}));

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { encrypt } from 'api-src/security/encryption.service';
import { SHOPIFY_REQUIRED_SCOPE_STRING, normalizeAndValidateShopifyGrantedScopes } from 'api-src/services/shopify/shopifyScopes';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(90000);

const app = createApp();

const SNAPSHOTS = 'opening_inventory_shopify_snapshots';
const LINES = 'opening_inventory_shopify_snapshot_lines';
const PAGE_SIZE = 100;
const WAIT_MS = 4000;

// ─── provider stub ──────────────────────────────────────────────────────────

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T = unknown>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A page released at teardown is never awaited by a collector.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

type Level = {
  itemGid: string;
  variantGid?: string | null;
  onHand?: number;
  quantities?: Array<{ name: string; quantity: number }>;
  active?: boolean;
  tracked?: boolean;
};

function levelsPage(params: {
  locationGid: string;
  levels: Level[];
  hasNextPage: boolean;
  endCursor: string | null;
  locationActive?: boolean;
}) {
  const nodes = params.levels.map((level, index) => ({
    id: `gid://shopify/InventoryLevel/${index}?inventory_item_id=${level.itemGid.split('/').pop()}`,
    isActive: level.active ?? true,
    item: {
      id: level.itemGid,
      tracked: level.tracked ?? true,
      variant: level.variantGid ? { id: level.variantGid } : null,
    },
    quantities:
      level.quantities ?? [{ name: 'on_hand', quantity: level.onHand ?? 0 }],
  }));

  return {
    data: {
      location: {
        id: params.locationGid,
        isActive: params.locationActive ?? true,
        inventoryLevels: {
          pageInfo: {
            hasNextPage: params.hasNextPage,
            endCursor: params.endCursor,
          },
          nodes,
          edges: nodes.map((node, index) => ({
            cursor: `${params.endCursor ?? 'end'}:${index}`,
            node,
          })),
        },
      },
    },
  };
}

type ProviderStep = unknown;

let levelSteps: ProviderStep[] = [];
let providerRequests: Array<{ kind: 'levels' | 'location-node' | 'other'; text: string }> = [];
const pendingDeferreds: Array<Deferred<unknown>> = [];

function isDeferred(value: unknown): value is Deferred<unknown> {
  return Boolean(value && typeof value === 'object' && 'promise' in (value as any) && 'resolve' in (value as any));
}

function installProvider(steps: ProviderStep[]): void {
  levelSteps = steps;

  for (const step of steps) {
    if (isDeferred(step)) pendingDeferreds.push(step);
  }

  mockShopifyRequest.mockImplementation(async (query: string, options?: any) => {
    const text = `${query}\n${JSON.stringify(options ?? {})}`;

    if (/inventoryLevels/.test(query)) {
      const index = providerRequests.filter((call) => call.kind === 'levels').length;
      providerRequests.push({ kind: 'levels', text });

      if (index >= levelSteps.length) {
        throw new Error(`[GH1179_TEST] unexpected inventoryLevels request #${index + 1}`);
      }

      const step = levelSteps[index];
      if (isDeferred(step)) return step.promise;
      if (step instanceof Error) throw step;
      return step;
    }

    if (/node\s*\(\s*id/.test(query)) {
      providerRequests.push({ kind: 'location-node', text });
      return {
        data: {
          node: { id: options?.variables?.id, name: 'GH-1179 stub', isActive: true },
        },
      };
    }

    providerRequests.push({ kind: 'other', text });
    throw new Error('[GH1179_TEST] unexpected Shopify query');
  });
}

function levelRequests() {
  return providerRequests.filter((call) => call.kind === 'levels');
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`[GH1179_TEST] timed out waiting for: ${label}`);
}

// ─── fixtures ───────────────────────────────────────────────────────────────

type Item = { variantId: string; itemGid: string; variantGid: string };

type Fixture = {
  shopId: number;
  ownerId: number;
  operatorId: number;
  ownerToken: string;
  warehouseId: string;
  locationId: string;
  locationGid: string;
  items: Item[];
};

async function createFixture(options: { itemCount?: number } = {}): Promise<Fixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);

  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1179b-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const itemCount = options.itemCount ?? 1;
  const warehouseId = crypto.randomUUID();
  const rootCode = `GH1179B-${unique}-ROOT`;
  const locationId = String(crypto.randomInt(10_000_000, 99_999_999));
  const itemBase = crypto.randomInt(100_000_000, 900_000_000);

  return withTenant(shopId, async (trx) => {
    const insertUser = async (label: string, role: 'owner' | 'operator') => {
      const [row] = await trx('users')
        .insert({
          shop_id: shopId,
          email: `gh1179b-${label}-${unique}@test.example`,
          password_hash: 'not_a_real_hash',
          first_name: label,
          role,
        })
        .returning('id');
      const userId = Number((row as any).id ?? row);
      await trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role, revoked_at: null });
      return userId;
    };

    const ownerId = await insertUser('owner', 'owner');
    const operatorId = await insertUser('operator', 'operator');

    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: ownerId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });

    await trx('shop_wms_settings').insert({
      shop_id: shopId,
      bootstrap_model: 'reconcile_opening_expectation_v2',
    });

    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: `gh1179b-${unique}.myshopify.com`,
      scopes: 'read_inventory,write_inventory,read_locations',
    }).returning('id');

    await trx('shopify_admin_credentials').insert({
      shop_id: shopId,
      installation_id: installation.id,
      access_token_encrypted: encrypt('gh1179b-canonical-access-no-network-call'),
      refresh_token_encrypted: encrypt('gh1179b-canonical-refresh-no-network-call'),
      access_expires_at: new Date(Date.now() + 86400000),
      refresh_expires_at: new Date(Date.now() + 2592000000),
      granted_scopes: normalizeAndValidateShopifyGrantedScopes(SHOPIFY_REQUIRED_SCOPE_STRING),
      credential_state: 'ACTIVE',
      credential_generation: '1',
    });

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: `GH1179B warehouse ${unique}`,
      root_location_code: rootCode,
      is_default: true,
      active: true,
      external_location_id: locationId,
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
        location_code: `GH1179B-${unique}-A1`,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    const productId = crypto.randomUUID();
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'GH1179B product',
      status: 'active',
      product_type: 'physical',
    });

    const items: Item[] = Array.from({ length: itemCount }, (_, index) => ({
      variantId: crypto.randomUUID(),
      itemGid: `gid://shopify/InventoryItem/${itemBase + index}`,
      variantGid: `gid://shopify/ProductVariant/${itemBase + index}`,
    }));

    if (items.length > 0) {
      await trx('variants').insert(
        items.map((item, index) => ({
          lasyncro_variant_id: item.variantId,
          lasyncro_product_id: productId,
          shop_id: shopId,
          sku: `GH1179B-${unique}-${index}`,
          title: `GH1179B variant ${index}`,
          unit_cost: '1.00',
          status: 'active',
        }))
      );

      await trx('external_product_identity_map').insert(
        items.map((item) => ({
          id: crypto.randomUUID(),
          shop_id: shopId,
          lasyncro_variant_id: item.variantId,
          platform: 'shopify',
          external_product_id: `gid://shopify/Product/${itemBase}`,
          external_variant_id: item.variantGid,
          external_inventory_item_id: item.itemGid,
        }))
      );
    }

    return {
      shopId,
      ownerId,
      operatorId,
      ownerToken: issueTestToken({ userId: ownerId, shopId, tier: 'core', roles: ['owner'] }),
      warehouseId,
      locationId,
      locationGid: `gid://shopify/Location/${locationId}`,
      items,
    };
  });
}

function knownLevels(fixture: Fixture, onHand = 1): Level[] {
  return fixture.items.map((item) => ({
    itemGid: item.itemGid,
    variantGid: item.variantGid,
    onHand,
  }));
}

function singlePage(fixture: Fixture, levels: Level[] = knownLevels(fixture)) {
  return levelsPage({
    locationGid: fixture.locationGid,
    levels,
    hasNextPage: false,
    endCursor: 'cursor-final',
  });
}

function postStart(fixture: Fixture) {
  return request(app)
    .post('/api/v1/wms/opening-inventory/start')
    .set('Authorization', `Bearer ${fixture.ownerToken}`)
    .send({ assigned_to: fixture.operatorId });
}

function track(test: request.Test) {
  const state: { settled: boolean; response: request.Response | null; promise: Promise<request.Response> } = {
    settled: false,
    response: null,
    promise: null as any,
  };
  state.promise = test.then((response) => {
    state.settled = true;
    state.response = response;
    return response;
  });
  return state;
}

async function startState(fixture: Fixture) {
  return withTenant(fixture.shopId, async (trx) => {
    const tasks = await trx('inventory_recount_tasks')
      .where({ shop_id: fixture.shopId, purpose: 'opening_inventory' })
      .orderBy('recount_task_id', 'asc')
      .select('recount_task_id');
    const settings = await trx('shop_wms_settings')
      .where({ shop_id: fixture.shopId })
      .first('opening_inventory_reconciliation_started_at');
    const warehouse = await trx('warehouses')
      .where({ shop_id: fixture.shopId, warehouse_id: fixture.warehouseId })
      .first('external_location_id');

    return {
      taskIds: tasks.map((task: any) => String(task.recount_task_id)),
      startedAt: settings?.opening_inventory_reconciliation_started_at ?? null,
      mapping: warehouse?.external_location_id ?? null,
    };
  });
}

async function snapshotState(fixture: Fixture) {
  return withTenant(fixture.shopId, async (trx) => {
    const { rows } = await trx.raw(
      `SELECT to_regclass(?) AS header, to_regclass(?) AS lines`,
      [`public.${SNAPSHOTS}`, `public.${LINES}`]
    );

    if (!rows[0].header || !rows[0].lines) {
      return { schema: 'missing' as const, headers: [] as any[], lines: [] as any[] };
    }

    const headers = await trx(SNAPSHOTS)
      .where({ shop_id: fixture.shopId })
      .orderBy('attempt_number', 'asc');
    const lines = await trx(LINES)
      .where({ shop_id: fixture.shopId })
      .orderBy('shopify_inventory_item_id', 'asc');

    return { schema: 'present' as const, headers, lines };
  });
}

function expectRejected(response: request.Response) {
  expect(response.status).toBeGreaterThanOrEqual(400);
}

async function expectNothingStarted(fixture: Fixture) {
  const state = await startState(fixture);
  expect({ openingTasks: state.taskIds.length, startedAt: state.startedAt }).toEqual({
    openingTasks: 0,
    startedAt: null,
  });
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('GH-1179 RED-B — location-scoped Shopify on_hand snapshot at Opening Inventory start', () => {
  beforeEach(() => {
    mockShopifyRequest.mockReset();
    mockCreateShopifyGraphQLClient.mockClear();
    levelSteps = [];
    providerRequests = [];
  });

  afterEach(() => {
    // Never leave a start request hanging on an unresolved provider page.
    while (pendingDeferreds.length > 0) {
      pendingDeferreds.pop()!.reject(new Error('[GH1179_TEST] provider released at teardown'));
    }
  });

  it('B2.1 — paginates every inventory level across 3 pages (>250) via advancing cursors; no first-page truncation', async () => {
    const fixture = await createFixture({ itemCount: 260 });
    const levels = knownLevels(fixture, 2);

    installProvider([
      levelsPage({ locationGid: fixture.locationGid, levels: levels.slice(0, 100), hasNextPage: true, endCursor: 'cursor-1' }),
      levelsPage({ locationGid: fixture.locationGid, levels: levels.slice(100, 200), hasNextPage: true, endCursor: 'cursor-2' }),
      levelsPage({ locationGid: fixture.locationGid, levels: levels.slice(200), hasNextPage: false, endCursor: 'cursor-3' }),
    ]);

    const response = await postStart(fixture);

    expect(levelRequests()).toHaveLength(3);
    expect(levelRequests()[1].text).toContain('cursor-1');
    expect(levelRequests()[2].text).toContain('cursor-2');
    expect(response.status).toBe(200);

    const snapshot = await snapshotState(fixture);
    expect(snapshot.headers.map((header: any) => ({
      status: header.status,
      line_count: Number(header.line_count),
      page_count: Number(header.page_count),
    }))).toEqual([{ status: 'complete', line_count: 260, page_count: 3 }]);
    expect(snapshot.lines.map((line: any) => line.shopify_inventory_item_id).sort()).toEqual(
      fixture.items.map((item) => item.itemGid).sort()
    );
  });

  it('B2.2 — a level with on_hand 0 persists exactly 0', async () => {
    const fixture = await createFixture({ itemCount: 2 });
    installProvider([
      singlePage(fixture, [
        { itemGid: fixture.items[0].itemGid, variantGid: fixture.items[0].variantGid, onHand: 0 },
        { itemGid: fixture.items[1].itemGid, variantGid: fixture.items[1].variantGid, onHand: 4 },
      ]),
    ]);

    const response = await postStart(fixture);

    expect(levelRequests()).toHaveLength(1);
    expect(response.status).toBe(200);

    const snapshot = await snapshotState(fixture);
    const byItem = Object.fromEntries(
      snapshot.lines.map((line: any) => [
        line.shopify_inventory_item_id,
        { present: line.inventory_level_present, on_hand: line.on_hand_quantity },
      ])
    );
    expect(byItem).toEqual({
      [fixture.items[0].itemGid]: { present: true, on_hand: 0 },
      [fixture.items[1].itemGid]: { present: true, on_hand: 4 },
    });
  });

  it('B2.3 — reads only the frozen mapped Location, page size 100, never an aggregate/catalog fallback', async () => {
    const fixture = await createFixture();

    // An active, separately mapped warehouse with no countable bins does not
    // participate; its Shopify Location must never be read.
    const otherLocationId = String(crypto.randomInt(100_000_000, 199_999_999));
    await withTenant(fixture.shopId, async (trx) => {
      const otherWarehouseId = crypto.randomUUID();
      const otherRoot = `GH1179B-OTHER-${otherWarehouseId.slice(0, 8)}`;
      await trx('warehouses').insert({
        warehouse_id: otherWarehouseId,
        shop_id: fixture.shopId,
        name: `GH1179B other ${otherWarehouseId.slice(0, 8)}`,
        root_location_code: otherRoot,
        is_default: false,
        active: true,
        external_location_id: otherLocationId,
      });
      await trx('warehouse_locations').insert({
        shop_id: fixture.shopId,
        warehouse_id: otherWarehouseId,
        location_code: otherRoot,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      });
    });

    installProvider([singlePage(fixture)]);

    const response = await postStart(fixture);

    expect(levelRequests().length).toBeGreaterThan(0);
    for (const call of levelRequests()) {
      expect(call.text).toContain(fixture.locationGid);
      expect(call.text).not.toContain(otherLocationId);
      expect(call.text).toMatch(/"first":\s*100\b|first:\s*100\b/);
      expect(call.text).toMatch(/includeInactive/);
    }
    expect(
      providerRequests.filter((call) =>
        /inventoryQuantity|products\s*\(|productVariants\s*\(/.test(call.text)
      )
    ).toHaveLength(0);
    expect(response.status).toBe(200);

    const snapshot = await snapshotState(fixture);
    expect(snapshot.headers.map((header: any) => ({
      warehouse_id: header.warehouse_id,
      shopify_location_id: header.shopify_location_id,
    }))).toEqual([{ warehouse_id: fixture.warehouseId, shopify_location_id: fixture.locationGid }]);
  });

  it.each([
    ['location is null', (fixture: Fixture) => ({ data: { location: null } })],
    ['location is inactive', (fixture: Fixture) => levelsPage({
      locationGid: fixture.locationGid,
      levels: knownLevels(fixture),
      hasNextPage: false,
      endCursor: 'cursor-final',
      locationActive: false,
    })],
  ])('B2.4 — %s: start fails closed, snapshot terminal, nothing started', async (_label, page) => {
    const fixture = await createFixture();
    installProvider([page(fixture)]);

    const response = await postStart(fixture);

    expectRejected(response);
    await expectNothingStarted(fixture);
    const snapshot = await snapshotState(fixture);
    expect(snapshot.headers.map((header: any) => header.status)).toEqual(['failed']);
    expect(snapshot.lines).toHaveLength(0);
  });

  it('B2.5 — a level without the requested on_hand quantity fails closed and is never coerced to 0', async () => {
    const fixture = await createFixture();
    installProvider([
      singlePage(fixture, [
        {
          itemGid: fixture.items[0].itemGid,
          variantGid: fixture.items[0].variantGid,
          quantities: [{ name: 'available', quantity: 3 }],
        },
      ]),
    ]);

    const response = await postStart(fixture);

    expectRejected(response);
    await expectNothingStarted(fixture);
    const snapshot = await snapshotState(fixture);
    expect(snapshot.headers.map((header: any) => header.status)).toEqual(['failed']);
    expect(snapshot.lines).toHaveLength(0);
  });

  it('B2.6 — hasNextPage with a repeated endCursor fails closed and stops paginating', async () => {
    const fixture = await createFixture();
    const page = levelsPage({
      locationGid: fixture.locationGid,
      levels: knownLevels(fixture),
      hasNextPage: true,
      endCursor: 'cursor-stuck',
    });
    installProvider([page, page, page, page, page]);

    const response = await postStart(fixture);

    expectRejected(response);
    expect(levelRequests()).toHaveLength(2);
    await expectNothingStarted(fixture);
    const snapshot = await snapshotState(fixture);
    expect(snapshot.headers.map((header: any) => header.status)).toEqual(['failed']);
  });

  it('B2.7 — a provider GraphQL error/throttle response fails the snapshot with nothing started', async () => {
    const fixture = await createFixture();
    installProvider([
      {
        data: null,
        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
      },
    ]);

    const response = await postStart(fixture);

    expectRejected(response);
    await expectNothingStarted(fixture);
    const snapshot = await snapshotState(fixture);
    expect(snapshot.headers.map((header: any) => header.status)).toEqual(['failed']);
    expect(snapshot.lines).toHaveLength(0);
  });

  it('B2.8 — failure after page 1 persists no lines and no start; the next start reserves attempt 2', async () => {
    const fixture = await createFixture({ itemCount: 2 });
    const levels = knownLevels(fixture);
    installProvider([
      levelsPage({ locationGid: fixture.locationGid, levels: levels.slice(0, 1), hasNextPage: true, endCursor: 'cursor-1' }),
      new Error('[GH1179_TEST] socket hang up'),
    ]);

    const failed = await postStart(fixture);

    expectRejected(failed);
    expect(levelRequests()).toHaveLength(2);
    await expectNothingStarted(fixture);
    const afterFailure = await snapshotState(fixture);
    expect({
      headers: afterFailure.headers.map((header: any) => header.status),
      lines: afterFailure.lines.length,
    }).toEqual({ headers: ['failed'], lines: 0 });

    providerRequests = [];
    installProvider([singlePage(fixture)]);

    const retried = await postStart(fixture);
    expect(retried.status).toBe(200);

    const afterRetry = await snapshotState(fixture);
    expect(afterRetry.headers.map((header: any) => ({
      attempt_number: Number(header.attempt_number),
      status: header.status,
    }))).toEqual([
      { attempt_number: 1, status: 'failed' },
      { attempt_number: 2, status: 'complete' },
    ]);
    expect(afterRetry.headers[0].collection_token).not.toBe(afterRetry.headers[1].collection_token);
  });

  it('B2.9 — a Shopify level with on_hand != 0 and no LaSyncro identity fails closed with no cohort', async () => {
    const fixture = await createFixture();
    installProvider([
      singlePage(fixture, [
        ...knownLevels(fixture),
        { itemGid: 'gid://shopify/InventoryItem/987654321', variantGid: null, onHand: 5 },
      ]),
    ]);

    const response = await postStart(fixture);

    expect(levelRequests().length).toBeGreaterThan(0);
    expectRejected(response);
    await expectNothingStarted(fixture);
    const snapshot = await snapshotState(fixture);
    expect(snapshot.headers.some((header: any) => header.status === 'complete')).toBe(false);
  });

  it('B2.10 — a Shopify level with on_hand 0 and no LaSyncro identity is retained as evidence and does not block start', async () => {
    const fixture = await createFixture();
    const unknownItemGid = 'gid://shopify/InventoryItem/987654322';
    installProvider([
      singlePage(fixture, [
        ...knownLevels(fixture),
        { itemGid: unknownItemGid, variantGid: null, onHand: 0 },
      ]),
    ]);

    const response = await postStart(fixture);

    expect(levelRequests()).toHaveLength(1);
    expect(response.status).toBe(200);

    const snapshot = await snapshotState(fixture);
    expect(
      snapshot.lines
        .filter((line: any) => line.shopify_inventory_item_id === unknownItemGid)
        .map((line: any) => ({
          lasyncro_variant_id: line.lasyncro_variant_id,
          present: line.inventory_level_present,
          on_hand: line.on_hand_quantity,
        }))
    ).toEqual([{ lasyncro_variant_id: null, present: true, on_hand: 0 }]);
    expect((await startState(fixture)).taskIds.length).toBeGreaterThan(0);
  });

  it('B2.11 — an active physical Shopify variant lacking external_inventory_item_id fails closed', async () => {
    const fixture = await createFixture();

    await withTenant(fixture.shopId, async (trx) => {
      const product = await trx('products')
        .where({ shop_id: fixture.shopId })
        .first('lasyncro_product_id');
      const variantId = crypto.randomUUID();
      await trx('variants').insert({
        lasyncro_variant_id: variantId,
        lasyncro_product_id: product.lasyncro_product_id,
        shop_id: fixture.shopId,
        sku: `GH1179B-NOITEM-${variantId.slice(0, 8)}`,
        title: 'GH1179B variant without inventory item',
        unit_cost: '1.00',
        status: 'active',
      });
      await trx('external_product_identity_map').insert({
        id: crypto.randomUUID(),
        shop_id: fixture.shopId,
        lasyncro_variant_id: variantId,
        platform: 'shopify',
        external_product_id: `gid://shopify/Product/${variantId.slice(0, 8)}`,
        external_variant_id: `gid://shopify/ProductVariant/${crypto.randomInt(1_000_000, 9_999_999)}`,
        external_inventory_item_id: null,
      });
    });

    installProvider([singlePage(fixture)]);

    const response = await postStart(fixture);

    expectRejected(response);
    await expectNothingStarted(fixture);
    const snapshot = await snapshotState(fixture);
    expect(snapshot.headers.some((header: any) => header.status === 'complete')).toBe(false);
  });

  it('B2.12 — success is atomic: while collecting nothing is started; at completion header, lines, cohort and started_at exist together', async () => {
    const fixture = await createFixture({ itemCount: 3 });
    const page = deferred();
    installProvider([page]);

    const start = track(postStart(fixture));
    await waitFor(() => levelRequests().length === 1, 'provider inventoryLevels request');

    const midFlightStart = await startState(fixture);
    const midFlightSnapshot = await snapshotState(fixture);
    expect({
      openingTasks: midFlightStart.taskIds.length,
      startedAt: midFlightStart.startedAt,
      headers: midFlightSnapshot.headers.map((header: any) => header.status),
      lines: midFlightSnapshot.lines.length,
      leaseHeld: midFlightSnapshot.headers.every((header: any) => header.lease_expires_at != null),
    }).toEqual({
      openingTasks: 0,
      startedAt: null,
      headers: ['collecting'],
      lines: 0,
      leaseHeld: true,
    });

    page.resolve(singlePage(fixture));
    const response = await start.promise;
    expect(response.status).toBe(200);

    const doneStart = await startState(fixture);
    const doneSnapshot = await snapshotState(fixture);
    expect({
      headers: doneSnapshot.headers.map((header: any) => ({
        status: header.status,
        line_count: Number(header.line_count),
        page_count: Number(header.page_count),
        completed: header.completed_at != null,
      })),
      lines: doneSnapshot.lines.length,
      openingTasks: doneStart.taskIds.length,
      started: doneStart.startedAt != null,
    }).toEqual({
      headers: [{ status: 'complete', line_count: 3, page_count: 1, completed: true }],
      lines: 3,
      openingTasks: 1,
      started: true,
    });
  });

  it('B2.13 — replay after a completed start returns the same cohort and snapshot with zero additional provider calls', async () => {
    const fixture = await createFixture({ itemCount: 2 });
    installProvider([singlePage(fixture)]);

    const first = await postStart(fixture);
    expect(levelRequests()).toHaveLength(1);
    expect(first.status).toBe(200);

    const startBefore = await startState(fixture);
    const snapshotBefore = await snapshotState(fixture);
    expect(snapshotBefore.headers.map((header: any) => header.status)).toEqual(['complete']);

    providerRequests = [];
    mockShopifyRequest.mockClear();

    const replay = await postStart(fixture);
    expect(replay.status).toBe(200);
    expect(mockShopifyRequest).not.toHaveBeenCalled();

    const startAfter = await startState(fixture);
    const snapshotAfter = await snapshotState(fixture);
    expect(startAfter.taskIds).toEqual(startBefore.taskIds);
    expect(snapshotAfter.headers.map((header: any) => header.snapshot_id)).toEqual(
      snapshotBefore.headers.map((header: any) => header.snapshot_id)
    );
    expect(snapshotAfter.lines).toEqual(snapshotBefore.lines);
  });

  it('B2.14 — a live collecting reservation rejects a second start as in-progress with no second collection', async () => {
    const fixture = await createFixture();
    const page = deferred();
    installProvider([page, singlePage(fixture)]);

    const first = track(postStart(fixture));
    await waitFor(() => levelRequests().length === 1, 'first provider inventoryLevels request');

    const second = await postStart(fixture);
    expect(second.status).toBe(409);
    expect(levelRequests()).toHaveLength(1);
    expect((await snapshotState(fixture)).headers).toHaveLength(1);

    page.resolve(singlePage(fixture));
    expect((await first.promise).status).toBe(200);
    expect((await startState(fixture)).taskIds).toHaveLength(1);
  });

  it('B2.15 — an expired collecting lease is abandoned; a new attempt reserves; the superseded collector cannot finalize', async () => {
    const fixture = await createFixture();
    const pageA = deferred();
    const pageB = deferred();
    installProvider([pageA, pageB]);

    const startA = track(postStart(fixture));
    await waitFor(() => levelRequests().length === 1, 'collector A provider request');

    const [headerA] = (await snapshotState(fixture)).headers;
    expect(headerA?.status).toBe('collecting');

    // Simulate collector A stalling past its lease.
    await withTenant(fixture.shopId, (trx) =>
      trx(SNAPSHOTS)
        .where({ shop_id: fixture.shopId, snapshot_id: headerA.snapshot_id })
        .update({ lease_expires_at: new Date(Date.now() - 60_000) })
    );

    const startB = track(postStart(fixture));
    await waitFor(() => levelRequests().length === 2, 'collector B provider request');

    const reserved = await snapshotState(fixture);
    expect(reserved.headers.map((header: any) => ({
      attempt_number: Number(header.attempt_number),
      status: header.status,
    }))).toEqual([
      { attempt_number: 1, status: 'abandoned' },
      { attempt_number: 2, status: 'collecting' },
    ]);
    expect(reserved.headers[1].collection_token).not.toBe(headerA.collection_token);

    // The superseded collector finishes first and must not finalize.
    pageA.resolve(singlePage(fixture));
    expectRejected(await startA.promise);
    await expectNothingStarted(fixture);

    pageB.resolve(singlePage(fixture));
    expect((await startB.promise).status).toBe(200);

    const final = await snapshotState(fixture);
    expect(final.headers.map((header: any) => header.status)).toEqual(['abandoned', 'complete']);
    expect(final.headers[1].collection_token).toBe(reserved.headers[1].collection_token);
    expect((await startState(fixture)).taskIds).toHaveLength(1);
  });

  it('B2.16 — mapping PATCH during collection is rejected 409 and the snapshot finalizes against the frozen mapping', async () => {
    const fixture = await createFixture();
    const page = deferred();
    installProvider([page]);

    const start = track(postStart(fixture));
    await waitFor(() => levelRequests().length === 1, 'provider inventoryLevels request');

    const patch = await request(app)
      .patch(`/api/v1/settings/shop/warehouses/${fixture.warehouseId}/shopify-location`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .send({ shopify_location_id: String(crypto.randomInt(200_000_000, 299_999_999)) });

    expect(patch.status).toBe(409);
    expect((await startState(fixture)).mapping).toBe(fixture.locationId);

    page.resolve(singlePage(fixture));
    expect((await start.promise).status).toBe(200);

    const snapshot = await snapshotState(fixture);
    expect(snapshot.headers.map((header: any) => ({
      status: header.status,
      shopify_location_id: header.shopify_location_id,
    }))).toEqual([{ status: 'complete', shopify_location_id: fixture.locationGid }]);
    expect((await startState(fixture)).mapping).toBe(fixture.locationId);
  });

  it('B2.17 — two concurrent starts produce one reservation, one collection and exactly one cohort', async () => {
    const fixture = await createFixture();
    const page = deferred();
    const unexpectedSecond = deferred();
    installProvider([page, unexpectedSecond]);

    const startA = track(postStart(fixture));
    const startB = track(postStart(fixture));

    await waitFor(() => levelRequests().length >= 1, 'first provider inventoryLevels request');
    await waitFor(() => startA.settled || startB.settled, 'competing start to be rejected');

    expect(levelRequests()).toHaveLength(1);
    const settled = startA.settled ? startA : startB;
    expect(settled.response?.status).toBe(409);

    page.resolve(singlePage(fixture));
    const statuses = (await Promise.all([startA.promise, startB.promise]))
      .map((response) => response.status)
      .sort();

    expect(statuses).toEqual([200, 409]);
    expect((await snapshotState(fixture)).headers.map((header: any) => header.status)).toEqual(['complete']);
    expect((await startState(fixture)).taskIds).toHaveLength(1);
  });

  it('B2.18 — mapping drift outside the canonical PATCH between T1 and T2 fails finalize closed', async () => {
    const fixture = await createFixture();
    const page = deferred();
    installProvider([page]);

    const start = track(postStart(fixture));
    await waitFor(() => levelRequests().length === 1, 'provider inventoryLevels request');

    await withTenant(fixture.shopId, (trx) =>
      trx('warehouses')
        .where({ shop_id: fixture.shopId, warehouse_id: fixture.warehouseId })
        .update({ external_location_id: String(crypto.randomInt(300_000_000, 399_999_999)) })
    );

    page.resolve(singlePage(fixture));
    expectRejected(await start.promise);

    await expectNothingStarted(fixture);
    const snapshot = await snapshotState(fixture);
    expect(snapshot.headers.some((header: any) => header.status === 'complete')).toBe(false);
  });

  it('B2.19 — identity mapping drift during provider collection fails closed', async () => {
    const fixture = await createFixture();
    const [itemA] = fixture.items;
    const driftedItemGid = `gid://shopify/InventoryItem/${crypto.randomInt(910_000_000, 999_999_999)}`;
    const page = deferred();
    installProvider([page]);

    const start = track(postStart(fixture));
    await waitFor(() => levelRequests().length === 1, 'provider inventoryLevels request');
    expect((await snapshotState(fixture)).headers.map((header: any) => header.status)).toEqual([
      'collecting',
    ]);

    // Product resync merge policy: external_inventory_item_id is rewritten on
    // the existing (shop, platform, product, variant) identity row, so item I
    // no longer resolves to variant A.
    const drifted = await withTenant(fixture.shopId, (trx) =>
      trx('external_product_identity_map')
        .where({
          shop_id: fixture.shopId,
          platform: 'shopify',
          lasyncro_variant_id: itemA.variantId,
          external_inventory_item_id: itemA.itemGid,
        })
        .update({ external_inventory_item_id: driftedItemGid })
    );
    expect(drifted).toBe(1);

    page.resolve(singlePage(fixture));
    const response = await start.promise;

    const startAfter = await startState(fixture);
    const snapshot = await snapshotState(fixture);
    const identityAfter = await withTenant(fixture.shopId, (trx) =>
      trx('external_product_identity_map')
        .where({ shop_id: fixture.shopId, platform: 'shopify' })
        .select('lasyncro_variant_id', 'external_inventory_item_id')
    );

    expect({
      status: response.status,
      code: response.body?.code,
      providerRequests: levelRequests().length,
      headers: snapshot.headers.map((header: any) => ({
        status: header.status,
        failure_code: header.failure_code,
      })),
      lines: snapshot.lines.length,
      openingTasks: startAfter.taskIds.length,
      startedAt: startAfter.startedAt,
      mapping: startAfter.mapping,
    }).toEqual({
      status: 409,
      code: 'OPENING_START_REJECTED',
      providerRequests: 1,
      headers: [{ status: 'failed', failure_code: 'IDENTITY_CHANGED_DURING_COLLECTION' }],
      lines: 0,
      openingTasks: 0,
      startedAt: null,
      mapping: fixture.locationId,
    });
    expect(identityAfter).toEqual([
      { lasyncro_variant_id: itemA.variantId, external_inventory_item_id: driftedItemGid },
    ]);
  });
});
