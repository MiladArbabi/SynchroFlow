// tests/integration/workers/shopify-product-reconciliation.worker.runtime.test.ts
//
// GH-1262 A2.2 — WORKER RUNTIME ACCEPTANCE.
//
// Drives the REAL start/stop exports of
//   api-src/workers/shopifyProductReconciliation.worker
// against real disposable Postgres (FORCE RLS, sf_app). Obligations are created
// through the production equal-timestamp path (syncProducts), never seeded.
//
// Provider boundary only is stubbed: credential resolution and the GraphQL
// client factory (the worker passes no deps, so the service uses these module
// defaults). The reconciliation service itself is real; runProductReconciliationTick
// is wrapped pass-through solely to count polling-loop iterations.
//
// Synchronization is bounded polling on observable state; no fixed sleeps.
// Forced-process crash recovery (killed process, token never released) is
// covered at service level by catalog-lifecycle-gh1262 R21e/R21f; here an
// abandoned short-lease claim is recovered by the worker itself.

const mockProviderAttempts: string[] = [];
const mockTickCalls: Array<Promise<unknown>> = [];
/** Real installation authority seeded per fixture shop (the apply re-verifies it). */
const mockAuthority = new Map<number, { installationId: number; generation: string }>();

type MockRespond = (shopId: number, variables: any, signal?: AbortSignal) => Promise<unknown>;
const mockProvider: { respond: MockRespond } = {
  respond: async (shopId) => { throw new Error(`GH1262_WORKER_UNEXPECTED_FETCH shop=${shopId}`); },
};

jest.mock('api-src/services/shopify/shopifyAdminCredentialConsumer.service', () => ({
  ...jest.requireActual('api-src/services/shopify/shopifyAdminCredentialConsumer.service'),
  resolveShopifyAdminCredentialForConsumer: jest.fn(async ({ shopId }: { shopId: number }) => {
    const authority = mockAuthority.get(shopId);
    if (!authority) throw new Error(`GH1262_WORKER_NO_AUTHORITY shop=${shopId}`);
    return {
      kind: 'READY', accessToken: 'gh1262-worker-test-token', shopDomain: `w1262-${shopId}.myshopify.com`,
      installationId: authority.installationId, generation: authority.generation,
    };
  }),
}));

jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  ...jest.requireActual('api-src/services/shopify/shopifyClient.service'),
  createShopifyGraphQLClient: jest.fn(({ shopId }: { shopId: number }) => ({
    request: async (_query: string, opts?: any) => mockProvider.respond(shopId, opts?.variables ?? {}, opts?.signal),
  })),
}));

jest.mock('api-src/services/shopify/shopifyProductReconciliation.service', () => {
  const actual = jest.requireActual('api-src/services/shopify/shopifyProductReconciliation.service');
  return {
    ...actual,
    runProductReconciliationTick: jest.fn((...args: unknown[]) => {
      const tick = actual.runProductReconciliationTick(...args);
      mockTickCalls.push(tick);
      return tick;
    }),
  };
});

import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { persistShopifyAdminCredentials } from 'api-src/services/shopify/shopifyAdminCredential.repository';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';
import {
  PRODUCT_RECONCILIATION_FETCH_DEADLINE_MS,
  claimProductReconciliation,
  listProductReconciliationTenants,
  processProductReconciliationClaim,
  readProductReconciliationState,
  runProductReconciliationTick,
} from 'api-src/services/shopify/shopifyProductReconciliation.service';
import { PROCESS_SHUTDOWN_DEADLINE_MS } from 'api-src/bootstrap/processShutdown';
import {
  startShopifyProductReconciliationWorker,
  stopShopifyProductReconciliationWorker,
} from 'api-src/workers/shopifyProductReconciliation.worker';

jest.setTimeout(60_000);

const APPLICATION_SHUTDOWN_BUDGET_MS = 15_000; // fly.toml kill_timeout
const CLAIM_CONCURRENCY = 4; // worker constant: lanes per tick
const T1 = '2026-09-01T10:00:00Z';

// ── isolation: non-loopback network is a forbidden provider attempt ─────────
const realFetch = globalThis.fetch;
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
const isLoopback = (host: unknown) =>
  ['', 'localhost', '127.0.0.1', '::1'].includes(String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase());

beforeAll(() => {
  process.on('unhandledRejection', onUnhandled);
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : (input as { url: string }).url;
    if (!isLoopback(new URL(url).hostname)) {
      mockProviderAttempts.push(`fetch:${new URL(url).hostname}`);
      throw new Error('GH1262_WORKER_PROVIDER_FORBIDDEN fetch');
    }
    return realFetch(input as any, init as any);
  }) as typeof fetch;
  for (const [name, mod] of [['http', http], ['https', https]] as const) {
    for (const fn of ['request', 'get'] as const) {
      const original = (mod as any)[fn];
      jest.spyOn(mod as any, fn).mockImplementation((...args: unknown[]) => {
        const first = args[0] as any;
        const host = typeof first === 'string' || first instanceof URL ? new URL(String(first)).hostname : first?.hostname ?? first?.host;
        if (!isLoopback(host)) {
          mockProviderAttempts.push(`${name}.${fn}:${host}`);
          throw new Error(`GH1262_WORKER_PROVIDER_FORBIDDEN ${name}.${fn}`);
        }
        return original.apply(mod, args);
      });
    }
  }
});

afterAll(async () => {
  openGates.forEach((release) => release());
  await stopShopifyProductReconciliationWorker();
  process.off('unhandledRejection', onUnhandled);
  globalThis.fetch = realFetch;
  jest.restoreAllMocks();
});

// ── fixtures ────────────────────────────────────────────────────────────────

const numericId = () => String(1262_500_000_000 + Math.floor(Math.random() * 999_999_999));
const productGid = (id: string) => `gid://shopify/Product/${id}`;

function productNode(productId: string, variantId: string, status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED', updatedAt: string) {
  return {
    id: productGid(productId),
    title: `GH1262 worker product ${productId}`,
    status,
    productType: 'Widgets',
    featuredImage: null,
    updatedAt,
    variants: {
      edges: [{
        node: {
          id: `gid://shopify/ProductVariant/${variantId}`,
          title: `Variant ${variantId}`,
          sku: null,
          barcode: null,
          image: null,
          inventoryItem: { id: `gid://shopify/InventoryItem/${variantId}`, unitCost: { amount: '5.00' } },
        },
      }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

type Fixture = { shopId: number; productId: string; variantId: string; gid: string };

/**
 * Active installation + ACTIVE offline credential for the shop's synthetic
 * domain (canonical shopify-sync-authority.fixture pattern; no provider call).
 */
async function seedInstallationAuthority(shopId: number): Promise<void> {
  process.env.ENCRYPTION_KEY ||= 'offline-lifecycle-fixture-encryption-key-2026';
  const authority = await withTenant(shopId, async (trx) => {
    const [installation] = await trx('shopify_app_installations')
      .insert({
        shop_id: shopId,
        shop_domain: `w1262-${shopId}.myshopify.com`,
        shop_gid: `gid://shopify/Shop/${shopId}`,
        scopes: SHOPIFY_REQUIRED_SCOPE_STRING,
        uninstalled_at: null,
      })
      .returning('id');
    const now = Date.now();
    await persistShopifyAdminCredentials(trx, Number(installation.id), shopId, {
      accessToken: 'test-token',
      refreshToken: 'test-refresh-token',
      accessExpiresAt: new Date(now + 86400000),
      refreshExpiresAt: new Date(now + 604800000),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    });
    const credential = await trx('shopify_admin_credentials')
      .where({ shop_id: shopId, installation_id: installation.id })
      .first('credential_generation', 'credential_state');
    expect(credential?.credential_state).toBe('ACTIVE');
    return { installationId: Number(installation.id), generation: String(credential.credential_generation) };
  });
  mockAuthority.set(shopId, authority);
}

/** Tenant shop + ACTIVE@T1 ingest + equal-timestamp ARCHIVED@T1 conflict → one durable obligation. */
async function conflictedShop(label: string): Promise<Fixture> {
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `w1262-${label}-${crypto.randomBytes(4).toString('hex')}`);
    await setTenantContext(trx, id);
    return id;
  });
  await seedInstallationAuthority(shopId);
  const productId = numericId();
  const variantId = numericId();
  const ingest = await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [{ node: productNode(productId, variantId, 'ACTIVE', T1) }]));
  expect(ingest.map((r) => r.outcome)).toEqual(['applied']);
  const conflict = await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [{ node: productNode(productId, variantId, 'ARCHIVED', T1) }]));
  expect(conflict.map((r) => r.outcome)).toEqual(['reconcile_requested']);
  const fixture = { shopId, productId, variantId, gid: productGid(productId) };
  expect(await state(fixture)).toMatchObject({ pending: true, claimed: false, attempts: 0 });
  // The equal-timestamp ARCHIVED input is never applied: the catalog keeps ACTIVE@T1 until a fenced apply.
  expect(await parentStatuses(fixture)).toEqual(['active']);
  return fixture;
}

const state = (f: Fixture) => readProductReconciliationState(f.shopId, f.gid);

async function parentStatuses(f: Fixture): Promise<string[]> {
  return withTenant(f.shopId, (trx) =>
    trx('external_product_identity_map as m')
      .join('variants as v', 'v.lasyncro_variant_id', 'm.lasyncro_variant_id')
      .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
      .where({ 'm.shop_id': f.shopId, 'm.platform': 'shopify', 'm.external_product_id': f.gid })
      .distinct('p.lasyncro_product_id', 'p.status')
      .then((rows: Array<{ status: string }>) => rows.map((r) => r.status)));
}

/** Bounded poll of observable state; never a fixed sleep. */
async function waitUntil<T>(probe: () => Promise<T | null | false> | T | null | false, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value as T;
    if (Date.now() >= deadline) throw new Error(`GH1262_WORKER_WAIT_TIMEOUT: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Every gate is released on teardown so a failed case can never leave stop() awaiting a blocked fetch. */
const openGates: Array<() => void> = [];

/** Per-shop gate: the provider fetch blocks until released. */
function gatedProvider(fixtures: Fixture[]) {
  const byShop = new Map(fixtures.map((f) => [f.shopId, f]));
  const entered = new Set<number>();
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  openGates.push(release);
  mockProvider.respond = async (shopId, variables) => {
    const f = byShop.get(shopId);
    if (!f || variables.id !== f.gid) throw new Error(`GH1262_WORKER_UNEXPECTED_FETCH shop=${shopId}`);
    entered.add(shopId);
    await released;
    return { data: { product: productNode(f.productId, f.variantId, 'DRAFT', T1) } };
  };
  return { entered, release };
}

/**
 * A provider request that never answers, but honours its AbortSignal the way
 * fetch does. It rejects with a plain Error (the SDK rewraps abort errors), so
 * the service must classify from signal state, not from the error.
 */
function stallUntilAborted() {
  const requests: Array<{ variables: any; signal: AbortSignal }> = [];
  const request = (variables: any, signal?: AbortSignal) => {
    if (!signal) throw new Error('GH1262_WORKER_REQUEST_WITHOUT_SIGNAL');
    requests.push({ variables, signal });
    return new Promise<never>((_resolve, reject) => {
      const abort = () => reject(new Error('GraphQL Client: request aborted (stub)'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  };
  return { requests, request };
}

const shopVariantCount = (shopId: number) =>
  withTenant(shopId, async (trx) =>
    Number((await trx('variants').where({ shop_id: shopId }).count('* as c').first())?.c ?? 0));

const flushAndRoundTrip = async (f: Fixture) => {
  await new Promise((resolve) => setImmediate(resolve));
  await state(f);
  await new Promise((resolve) => setImmediate(resolve));
};

// ── runtime contract ───────────────────────────────────────────────────────

describe('GH-1262 A2.2 — Shopify product reconciliation worker runtime', () => {
  let fixtures: Fixture[] = [];

  // Discovery is global by design, so obligations left by other suites in a shared
  // disposable DB are discoverable here. They are never modified: each is row-locked
  // in its own tenant transaction, so the worker's FOR UPDATE SKIP LOCKED claim skips
  // them and every lane, claim and outcome below is attributable to this file.
  let releaseForeign: () => void = () => {};
  const foreignHeld: Array<Promise<unknown>> = [];

  beforeAll(async () => {
    for (let i = 0; i < CLAIM_CONCURRENCY + 1; i++) fixtures.push(await conflictedShop(`lane${i}`));
    const discovered = await listProductReconciliationTenants({ limit: 100 });
    const own = new Set(fixtures.map((f) => f.shopId));
    expect(fixtures.every((f) => discovered.includes(f.shopId))).toBe(true);
    const foreign = discovered.filter((shopId) => !own.has(shopId));
    // Bounded by the worker's 20-tenant tick and the default knex pool (10): fail closed, never flake.
    expect({ foreign: foreign.length, withinBudget: foreign.length <= 4 }).toEqual({ foreign: foreign.length, withinBudget: true });

    const released = new Promise<void>((resolve) => { releaseForeign = resolve; });
    for (const shopId of foreign) {
      let markHeld!: () => void;
      const held = new Promise<void>((resolve) => { markHeld = resolve; });
      foreignHeld.push(withTenant(shopId, async (trx) => {
        await trx.raw(
          `SELECT id FROM shopify_product_source_watermarks
            WHERE shop_id = ? AND reconcile_requested_at IS NOT NULL FOR UPDATE`, [shopId]);
        markHeld();
        await released;
      }));
      await held;
    }
    for (const shopId of foreign) expect(await claimProductReconciliation({ shopId })).toBeNull();
  });

  afterAll(async () => {
    openGates.forEach((release) => release());
    await stopShopifyProductReconciliationWorker();
    releaseForeign();
    await Promise.all(foreignHeld);
  });

  it('W1 — duplicate starts run one loop; pending work is claimed per tenant; stop blocks new claims, awaits in-flight work, cancels it before apply and returns within the shutdown budget', async () => {
    const gate = gatedProvider(fixtures);

    await Promise.all([startShopifyProductReconciliationWorker(), startShopifyProductReconciliationWorker()]);
    await startShopifyProductReconciliationWorker();

    // One loop, one tick, four lanes: exactly CLAIM_CONCURRENCY tenants in flight.
    await waitUntil(() => gate.entered.size === CLAIM_CONCURRENCY, 'all lanes in provider fetch');
    expect(mockTickCalls).toHaveLength(1);
    const inFlight = fixtures.filter((f) => gate.entered.has(f.shopId));
    const waiting = fixtures.filter((f) => !gate.entered.has(f.shopId));
    expect({ inFlight: inFlight.length, waiting: waiting.length }).toEqual({ inFlight: CLAIM_CONCURRENCY, waiting: 1 });
    for (const f of inFlight) expect(await state(f)).toMatchObject({ pending: true, claimed: true, attempts: 0 });
    expect(await state(waiting[0])).toMatchObject({ pending: true, claimed: false, attempts: 0 });
    for (const f of fixtures) expect(await parentStatuses(f)).toEqual(['active']);

    // Stop while four claims are mid-fetch: it must not resolve before they drain.
    let stopSettled = false;
    const stopping = stopShopifyProductReconciliationWorker().then(() => { stopSettled = true; });
    await flushAndRoundTrip(waiting[0]);
    expect(stopSettled).toBe(false);

    const releasedAt = Date.now();
    gate.release();
    await stopping;
    const drainMs = Date.now() - releasedAt;
    expect(drainMs).toBeLessThan(APPLICATION_SHUTDOWN_BUDGET_MS);
    console.info('[GH1262_WORKER_RUNTIME] drain after release ms=', drainMs);

    // These gates ignore the abort and answer after stop(): the fetched snapshots arrive, but
    // cancellation is re-checked before the authoritative apply. Every in-flight claim settles
    // as CANCELLED before stop returns: released, uncounted, pending, catalog untouched.
    await expect(mockTickCalls[0]).resolves.toEqual({
      tenants: expect.any(Number), claimed: CLAIM_CONCURRENCY, outcomes: { CANCELLED: CLAIM_CONCURRENCY },
    });
    expect(((await mockTickCalls[0]) as { tenants: number }).tenants).toBeGreaterThanOrEqual(CLAIM_CONCURRENCY + 1);
    for (const f of inFlight) {
      expect(await state(f)).toMatchObject({ pending: true, claimed: false, attempts: 0, lastError: null, generation: 1 });
      expect(await parentStatuses(f)).toEqual(['active']);
    }
    // No claim after stop: the fifth tenant was never claimed, fetched or written.
    expect(gate.entered.has(waiting[0].shopId)).toBe(false);
    expect(await state(waiting[0])).toMatchObject({ pending: true, claimed: false, attempts: 0 });
    expect(await parentStatuses(waiting[0])).toEqual(['active']);
    expect(mockTickCalls).toHaveLength(1);
  });

  it('W2 — the stopped loop has exited: a restart runs exactly one new loop, drains all work left pending (cancelled and unclaimed), and an idle stop wakes the sleep within budget', async () => {
    const leftover = (await Promise.all(fixtures.map(async (f) => ((await state(f))!.pending ? f : null))))
      .filter((f): f is Fixture => f !== null);
    expect(leftover).toHaveLength(CLAIM_CONCURRENCY + 1);
    const gate = gatedProvider(leftover);
    gate.release();

    await startShopifyProductReconciliationWorker();
    expect(mockTickCalls).toHaveLength(2);
    await expect(mockTickCalls[1]).resolves.toEqual({
      tenants: expect.any(Number), claimed: CLAIM_CONCURRENCY + 1, outcomes: { APPLIED: CLAIM_CONCURRENCY + 1 },
    });
    for (const f of leftover) {
      expect(await state(f)).toMatchObject({ pending: false, claimed: false, attempts: 0 });
      expect(await parentStatuses(f)).toEqual(['draft']);
    }

    // The loop is now in its interruptible sleep; stop must wake it, not wait the interval.
    const stopStarted = Date.now();
    await stopShopifyProductReconciliationWorker();
    const idleStopMs = Date.now() - stopStarted;
    expect(idleStopMs).toBeLessThan(APPLICATION_SHUTDOWN_BUDGET_MS);
    console.info('[GH1262_WORKER_RUNTIME] idle stop ms=', idleStopMs);
    expect(mockTickCalls).toHaveLength(2);
  });

  it('W3 — an abandoned claim is recovered by the worker only after lease expiry, under its tenant; the abandoned token can no longer write', async () => {
    const victim = await conflictedShop('abandoned');
    const bystander = await conflictedShop('bystander');

    // An interrupted owner: claimed on a short lease, never processed.
    const abandoned = await claimProductReconciliation({ shopId: victim.shopId, leaseMs: 1_500 });
    expect(abandoned).toMatchObject({ shopId: victim.shopId, externalProductId: victim.gid });
    expect(await state(victim)).toMatchObject({ pending: true, claimed: true });

    // While the lease is live the worker cannot take it; the other tenant is independent.
    const gate = gatedProvider([victim, bystander]);
    gate.release();
    const ticksBefore = mockTickCalls.length;
    await startShopifyProductReconciliationWorker();
    await expect(mockTickCalls[ticksBefore]).resolves.toMatchObject({ claimed: 1, outcomes: { APPLIED: 1 } });
    expect(gate.entered.has(victim.shopId)).toBe(false);
    expect(await state(bystander)).toMatchObject({ pending: false, claimed: false });
    expect(await parentStatuses(victim)).toEqual(['active']);

    // After DB-time expiry the worker reclaims with a new token and applies.
    await waitUntil(async () => !(await state(victim))?.pending, 'worker recovers abandoned claim', 20_000);
    await stopShopifyProductReconciliationWorker();
    expect(gate.entered.has(victim.shopId)).toBe(true);
    expect(await state(victim)).toMatchObject({ pending: false, claimed: false, attempts: 0 });
    expect(await parentStatuses(victim)).toEqual(['draft']);

    // The abandoned token is fenced out: no apply, no completion, no failure.
    mockProvider.respond = async () => ({ data: { product: productNode(victim.productId, victim.variantId, 'ACTIVE', T1) } });
    expect((await processProductReconciliationClaim(abandoned!)).kind).toBe('SUPERSEDED');
    expect(await parentStatuses(victim)).toEqual(['draft']);
    expect(await state(victim)).toMatchObject({ pending: false, claimed: false, attempts: 0, lastError: null });
  });

  it('W4 — a provider failure inside the worker is recorded, sanitized and observable, releases the claim, keeps the loop alive, and stays retryable', async () => {
    const failing = await conflictedShop('provider-down');
    const warn = jest.spyOn(console, 'warn');
    mockProvider.respond = async () => { throw new Error('GH1262_WORKER_PROVIDER_DOWN raw provider detail'); };

    const ticksBefore = mockTickCalls.length;
    await startShopifyProductReconciliationWorker();
    await expect(mockTickCalls[ticksBefore]).resolves.toEqual({ tenants: expect.any(Number), claimed: 1, outcomes: { FAILED: 1 } });
    await stopShopifyProductReconciliationWorker();

    expect(await state(failing)).toMatchObject({
      pending: true, claimed: false, attempts: 1, lastError: 'SHOPIFY_PROVIDER_ERROR', exhausted: false,
    });
    expect(await parentStatuses(failing)).toEqual(['active']);
    expect(warn).toHaveBeenCalledWith('[SHOPIFY_PRODUCT_RECONCILE_FAILED]', expect.objectContaining({
      shopId: failing.shopId, externalProductId: failing.gid, attempts: 1, errorCode: 'SHOPIFY_PROVIDER_ERROR',
    }));
    warn.mockRestore();

    // Retryable: after a (test-shortened) DB-time backoff the same obligation is claimable and resolves.
    const retry = await waitUntil(
      () => claimProductReconciliation({ shopId: failing.shopId, backoffBaseMs: 1_000, backoffCapMs: 1_000 }),
      'retry after backoff');
    mockProvider.respond = async () => ({ data: { product: productNode(failing.productId, failing.variantId, 'DRAFT', T1) } });
    expect((await processProductReconciliationClaim(retry)).kind).toBe('APPLIED');
    expect(await state(failing)).toMatchObject({ pending: false, claimed: false, attempts: 0, lastError: null });
    expect(await parentStatuses(failing)).toEqual(['draft']);
  });

  it('W5 — a stalled first-page GraphQL request is aborted by stop(): bounded stop, claim released uncounted, work preserved, restart reclaims it', async () => {
    expect(PRODUCT_RECONCILIATION_FETCH_DEADLINE_MS).toBe(120_000);
    const f = await conflictedShop('stall-first-page');
    const before = await state(f);
    const stall = stallUntilAborted();
    mockProvider.respond = async (shopId, variables, signal) => {
      if (shopId !== f.shopId) throw new Error(`GH1262_WORKER_UNEXPECTED_FETCH shop=${shopId}`);
      return stall.request(variables, signal);
    };

    const ticksBefore = mockTickCalls.length;
    await startShopifyProductReconciliationWorker();
    await waitUntil(() => stall.requests.length === 1, 'first page in flight');
    expect(stall.requests[0].signal.aborted).toBe(false);
    expect(await state(f)).toMatchObject({ pending: true, claimed: true, attempts: 0 });

    const stopStarted = Date.now();
    await stopShopifyProductReconciliationWorker();
    const stopMs = Date.now() - stopStarted;
    console.info('[GH1262_WORKER_RUNTIME] W5 stalled-request stop ms=', stopMs);
    expect(stopMs).toBeLessThan(PROCESS_SHUTDOWN_DEADLINE_MS);

    // The abort reached the request; no further provider request was started.
    expect(stall.requests[0].signal.aborted).toBe(true);
    expect(stall.requests.map((r) => r.variables)).toEqual([{ id: f.gid }]);
    await expect(mockTickCalls[ticksBefore]).resolves.toEqual({
      tenants: expect.any(Number), claimed: 1, outcomes: { CANCELLED: 1 },
    });
    // Released, uncounted, still pending at the same generation; catalog untouched.
    expect(await state(f)).toEqual(before);
    expect(await parentStatuses(f)).toEqual(['active']);

    // Restart reclaims the preserved work immediately (no attempt, so no backoff) and applies it.
    mockProvider.respond = async () => ({ data: { product: productNode(f.productId, f.variantId, 'DRAFT', T1) } });
    const restartTick = mockTickCalls.length;
    await startShopifyProductReconciliationWorker();
    await expect(mockTickCalls[restartTick]).resolves.toMatchObject({ claimed: 1, outcomes: { APPLIED: 1 } });
    await stopShopifyProductReconciliationWorker();
    expect(await state(f)).toMatchObject({ pending: false, claimed: false, attempts: 0, lastError: null });
    expect(await parentStatuses(f)).toEqual(['draft']);
  });

  it('W6 — one fetch deadline spans every page: a stalled continuation times out, is recorded once and sanitized, writes nothing, and the loop moves on and retries', async () => {
    const stalled = await conflictedShop('stall-continuation');
    const next = await conflictedShop('after-stall');
    const stalledBefore = await state(stalled);
    const variantsBefore = await shopVariantCount(stalled.shopId);
    const newVariantId = numericId();
    const stall = stallUntilAborted();
    const pageSignals: AbortSignal[] = [];

    mockProvider.respond = async (shopId, variables, signal) => {
      if (shopId === next.shopId) {
        return { data: { product: productNode(next.productId, next.variantId, 'DRAFT', T1) } };
      }
      if (shopId !== stalled.shopId) throw new Error(`GH1262_WORKER_UNEXPECTED_FETCH shop=${shopId}`);
      pageSignals.push(signal!);
      if (variables.cursor === undefined) {
        // First page: complete and valid, with a variant never seen before and a next page.
        const node = productNode(stalled.productId, stalled.variantId, 'DRAFT', T1);
        const extra = productNode(stalled.productId, newVariantId, 'DRAFT', T1).variants.edges[0];
        return { data: { product: { ...node, variants: {
          edges: [...node.variants.edges, extra], pageInfo: { hasNextPage: true, endCursor: 'gh1262-w6-c1' } } } } };
      }
      return stall.request(variables, signal);
    };

    // One lane: the follow-up tenant is processed only after the stalled one gives up its lane.
    const result = await runProductReconciliationTick({ limit: 20, concurrency: 1, fetchDeadlineMs: 1_000 });
    expect(result).toEqual({ tenants: expect.any(Number), claimed: 2, outcomes: { FAILED: 1, APPLIED: 1 } });

    // Same signal on both pages (the deadline never restarts); it fired as a timeout, not a shutdown.
    expect(pageSignals).toHaveLength(2);
    expect(pageSignals[1]).toBe(pageSignals[0]);
    expect(stall.requests.map((r) => r.variables)).toEqual([{ id: stalled.gid, cursor: 'gh1262-w6-c1' }]);
    expect(stall.requests[0].signal.aborted).toBe(true);
    expect((stall.requests[0].signal.reason as { name?: string })?.name).toBe('TimeoutError');

    expect(await state(stalled)).toEqual({
      ...stalledBefore, attempts: 1, lastError: 'SHOPIFY_PROVIDER_TIMEOUT', claimed: false, pending: true,
    });
    expect(await parentStatuses(stalled)).toEqual(['active']);
    expect(await shopVariantCount(stalled.shopId)).toBe(variantsBefore);
    expect(await state(next)).toMatchObject({ pending: false, claimed: false });
    expect(await parentStatuses(next)).toEqual(['draft']);

    // Retryable through the real worker loop once the DB-time backoff elapses.
    mockProvider.respond = async (shopId) => {
      if (shopId !== stalled.shopId) throw new Error(`GH1262_WORKER_UNEXPECTED_FETCH shop=${shopId}`);
      return { data: { product: productNode(stalled.productId, stalled.variantId, 'DRAFT', T1) } };
    };
    await startShopifyProductReconciliationWorker();
    await waitUntil(async () => !(await state(stalled))?.pending, 'worker retries after timeout', 20_000);
    await stopShopifyProductReconciliationWorker();
    expect(await state(stalled)).toMatchObject({ pending: false, claimed: false, attempts: 0, lastError: null });
    expect(await parentStatuses(stalled)).toEqual(['draft']);
    expect(await shopVariantCount(stalled.shopId)).toBe(variantsBefore);
  });

  it('ISOLATION — no real provider request and no unhandled rejection', () => {
    expect(mockProviderAttempts).toEqual([]);
    expect(unhandled).toEqual([]);
  });
});
