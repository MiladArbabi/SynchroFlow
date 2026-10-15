/**
 * GH-1262 — A1 CATALOG IDENTITY AND LIFECYCLE (RED contracts).
 *
 * PO → Receive eligibility will rely on the persisted Shopify product parent of
 * each variant (variants.lasyncro_product_id → products.status). These
 * contracts pin what catalog ingestion must guarantee about that parent before
 * any eligibility filter is allowed to trust it:
 *
 *   R1  initial sync + identical resync never creates another parent
 *   R2  DRAFT → ACTIVE → ARCHIVED → ACTIVE reaches the parents existing
 *       variants actually use
 *   R3  a variant added later reuses the canonical existing parent
 *   R4  historical split-parent state: every product / variant / mapping id is
 *       preserved, linked parents get one consistent status, no new orphan
 *   R5  replaying identical syncs changes no identity, mapping or LSP barcode
 *   R6  order ingestion for an archived product is unchanged
 *   R7  a REST payload with no cost never zeroes a persisted valid unit cost
 *   R8  zero-variant / partial payloads: the identity map resolves the product;
 *       no product identity is invented and payload completeness is never
 *       inferred (absent variants are left untouched)
 *
 * Drives the real persistence paths — syncProducts (GraphQL edge shape, the
 * initial-sync writer) and handleProductCreated / handleProductUpdated (REST
 * webhook shape) — against a disposable synchroflow_test_* database
 * (`npm run test:integration`). Order ingestion runs through the real
 * projection engine, as in order-intake-classification.test.ts.
 *
 * PROVIDER BOUNDARY: no Shopify / email / billing / other provider call is
 * legitimate anywhere in these contracts. The Shopify GraphQL client, axios,
 * fetch and node http(s) are trapped below; every attempt is recorded and the
 * final ISOLATION case asserts there were none.
 */

// ── provider traps (module scope; `mock` prefix required by jest.mock hoisting) ──
const mockProviderAttempts: string[] = [];

jest.mock('axios', () => {
  const refuse = (kind: string) =>
    jest.fn(async (...args: unknown[]) => {
      mockProviderAttempts.push(`axios.${kind}:${String(args[0])}`);
      throw new Error(`GH1262_PROVIDER_FORBIDDEN axios.${kind}`);
    });
  const inst: Record<string, unknown> = {
    get: refuse('get'),
    post: refuse('post'),
    put: refuse('put'),
    patch: refuse('patch'),
    delete: refuse('delete'),
    request: refuse('request'),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  const callable = refuse('call');
  Object.assign(callable, inst, {
    create: jest.fn(() => inst),
    isAxiosError: (p: unknown) =>
      !!(p && typeof p === 'object' && (p as { isAxiosError?: unknown }).isAxiosError === true),
  });
  return { __esModule: true, default: callable };
});

// Email: the FT2 provisioning ladder (R6 fixture) emits lifecycle emails
// (email.service.ts sendSyncCompletedEmail). Delivery is mocked at the SDK
// boundary and recorded; it is not a catalog contract, so it is not asserted.
const mockEmailDeliveries: string[] = [];
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn(async (msg: { subject?: string }) => {
        mockEmailDeliveries.push(String(msg?.subject ?? ''));
        return { data: { id: 'gh1262-mock-email' }, error: null };
      }),
    },
  })),
}));

// Billing: any Stripe SDK method CALL is a forbidden provider attempt
// (property access during module-scope construction is not).
jest.mock('stripe', () => {
  const callRecorder = (path: string): any =>
    new Proxy(function () {}, {
      get: (_t, prop) => (prop === 'then' ? undefined : callRecorder(`${path}.${String(prop)}`)),
      apply: () => {
        mockProviderAttempts.push(`stripe${path}()`);
        throw new Error(`GH1262_PROVIDER_FORBIDDEN stripe${path}`);
      },
    });
  const StripeMock = jest.fn().mockImplementation(() => callRecorder(''));
  return { __esModule: true, default: StripeMock, Stripe: StripeMock };
});

jest.mock('api-src/services/shopify/shopifyClient.service', () => {
  const actual = jest.requireActual('api-src/services/shopify/shopifyClient.service');
  return {
    ...actual,
    createShopifyGraphQLClient: jest.fn(() => {
      mockProviderAttempts.push('shopify.createShopifyGraphQLClient');
      throw new Error('GH1262_PROVIDER_FORBIDDEN shopify graphql client');
    }),
  };
});

import crypto from 'crypto';
import http from 'http';
import https from 'https';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { handleProductCreated } from 'api-src/api/shopify/handlers/handleProductCreated';
import { handleProductUpdated } from 'api-src/api/shopify/handlers/handleProductUpdated';
import type { WebhookEnvelope } from 'api-src/api/webhooks/types';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(180000);

const LSP_PATTERN = /^LSP-[A-Z2-9]{8}$/;

// ── network traps: loopback (supertest's in-process server) only ────────────

function isLoopback(host: unknown): boolean {
  const h = String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  return h === '' || h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/** First application frame that issued the call — makes an ISOLATION failure diagnosable. */
function origin(): string {
  const frame = (new Error().stack ?? '').split('\n')
    .find((l) => /apps\/backend\/src|packages\/backend-core\/(src|dist)/.test(l));
  return frame ? frame.trim().replace(/^at /, '').replace(/.*\/(apps|packages)\//, '$1/') : 'unknown-origin';
}

function hostOf(args: unknown[]): string {
  const [a, b] = args as [unknown, unknown];
  if (typeof a === 'string' || a instanceof URL) return new URL(String(a)).hostname;
  const opts = (a && typeof a === 'object' ? a : b) as { hostname?: string; host?: string } | undefined;
  return String(opts?.hostname ?? opts?.host ?? '');
}

const realFetch = globalThis.fetch;
const restorers: Array<() => void> = [];

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';

  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : (input as { url: string }).url;
    if (!isLoopback(new URL(url).hostname)) {
      mockProviderAttempts.push(`fetch:${new URL(url).hostname} <- ${origin()}`);
      throw new Error(`GH1262_PROVIDER_FORBIDDEN fetch ${new URL(url).hostname}`);
    }
    return realFetch(input as any, init as any);
  }) as typeof fetch;
  restorers.push(() => { globalThis.fetch = realFetch; });

  for (const [name, mod] of [['http', http], ['https', https]] as const) {
    for (const fn of ['request', 'get'] as const) {
      const original = (mod as any)[fn];
      jest.spyOn(mod as any, fn).mockImplementation((...args: unknown[]) => {
        const host = hostOf(args);
        if (!isLoopback(host)) {
          mockProviderAttempts.push(`${name}.${fn}:${host} <- ${origin()}`);
          throw new Error(`GH1262_PROVIDER_FORBIDDEN ${name}.${fn} ${host}`);
        }
        return original.apply(mod, args);
      });
    }
  }
});

afterAll(() => {
  restorers.forEach((restore) => restore());
  jest.restoreAllMocks();
});

// ── provisioning (pattern: order-intake-classification.test.ts) ─────────────

async function hmacInstall(shopDomain: string): Promise<{ shopId: number; userId: number }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params).sort()
    .map((k) => `${k}=${params[k as keyof typeof params]}`).join('&');
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(message).digest('hex');
  const install = await request(app)
    .get('/api/v1/integrations/shopify/install').query({ ...params, hmac }).redirects(0);
  expect(install.status).toBe(302);
  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value',
      [`shopify-install+${shopDomain}@lasyncro.internal`]));
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

/**
 * The product webhook handlers resolve the tenant through
 * shopify_app_installations.shop_domain. HMAC install does not write that row
 * (the OAuth callback does), so the fixture supplies the minimal installation
 * — same shape as shopify-install-provisions-wms-settings.test.ts.
 */
async function ensureInstallation(shopId: number, shopDomain: string): Promise<void> {
  await withTenant(shopId, async (trx) => {
    const existing = await trx('shopify_app_installations').where({ shop_domain: shopDomain }).first('shop_id');
    if (!existing) {
      await trx('shopify_app_installations').insert({ shop_id: shopId, shop_domain: shopDomain, scopes: 'read_products' });
    }
  });
  const row = await withTenant(shopId, (trx) =>
    trx('shopify_app_installations').where({ shop_domain: shopDomain }).first('shop_id'));
  expect(row?.shop_id).toBe(shopId);
}

async function provisionCatalogShop(label: string) {
  const shopDomain = `cat1262-${label}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.myshopify.com`;
  const { shopId } = await hmacInstall(shopDomain);
  await ensureInstallation(shopId, shopDomain);
  return { shopId, shopDomain };
}

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).andWhere('id', '>', afterId)
      .orderBy('id', 'asc').select('id'));
  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }
  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

/** Install + seed + drive the ladder to FT2 (orders project as in production). */
async function provisionFt2Shop(label: string) {
  const shopDomain = `cat1262-${label}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
      sync_status: 'COMPLETED', updated_at: new Date(),
    }));
  let c = 0;
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  const atFt1 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt1?.phase).toBe('FT1');
  const token = issueTestToken({ userId, shopId });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);
  await ensureInstallation(shopId, shopDomain);
  return { shopId, shopDomain };
}

// ── Shopify payload fixtures ────────────────────────────────────────────────

type ShopifyStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
type VariantSpec = { variantId: string; sku?: string | null; cost?: string | null };

/** Synthetic numeric Shopify id, unique per call. */
function numericId(): string {
  return String(1262_000_000_000 + Math.floor(Math.random() * 999_999_999));
}

const productGid = (id: string) => `gid://shopify/Product/${id}`;
const variantGid = (id: string) => `gid://shopify/ProductVariant/${id}`;

/** GraphQL edge — the shape the initial sync passes to syncProducts. */
function graphqlEdge(productId: string, status: ShopifyStatus, variants: VariantSpec[]) {
  return {
    node: {
      id: productGid(productId),
      title: `GH1262 product ${productId}`,
      status,
      productType: 'Widgets',
      featuredImage: null,
      variants: {
        edges: variants.map((v) => ({
          node: {
            id: variantGid(v.variantId),
            title: `Variant ${v.variantId}`,
            sku: v.sku ?? null,
            barcode: null,
            image: null,
            inventoryItem: {
              id: `gid://shopify/InventoryItem/${v.variantId}`,
              unitCost: v.cost ? { amount: v.cost } : null,
            },
          },
        })),
      },
    },
  };
}

/** REST products/* webhook payload — carries no unit cost. */
function restProduct(productId: string, status: 'active' | 'draft' | 'archived', variants: VariantSpec[]) {
  return {
    id: Number(productId),
    title: `GH1262 product ${productId}`,
    status,
    product_type: 'Widgets',
    image: null,
    variants: variants.map((v) => ({
      id: Number(v.variantId),
      title: `Variant ${v.variantId}`,
      sku: v.sku ?? null,
      barcode: null,
      inventory_item_id: Number(v.variantId),
    })),
  };
}

function envelope(shopDomain: string, eventType: string, rawPayload: unknown): WebhookEnvelope {
  return {
    integration: 'shopify',
    eventId: crypto.randomUUID(),
    eventType,
    verified: true,
    receivedAt: new Date(),
    rawPayload,
    shopDomain,
  };
}

const initialSync = (shopId: number, edges: unknown[]) =>
  withTenant(shopId, (trx) => syncProducts(trx, shopId, edges as any[]));

const productsUpdateWebhook = (shopId: number, shopDomain: string, payload: unknown) =>
  withTenant(shopId, (trx) => handleProductUpdated(envelope(shopDomain, 'products/update', payload), trx));

const productsCreateWebhook = (shopId: number, shopDomain: string, payload: unknown) =>
  withTenant(shopId, (trx) => handleProductCreated(envelope(shopDomain, 'products/create', payload), trx));

// ── state readers ───────────────────────────────────────────────────────────

/** Everything persisted for ONE Shopify product, resolved through the identity map. */
async function catalogState(shopId: number, shopifyProductId: string) {
  return withTenant(shopId, async (trx) => {
    const mappings = await trx('external_product_identity_map')
      .where({ shop_id: shopId, platform: 'shopify', external_product_id: productGid(shopifyProductId) })
      .orderBy('external_variant_id')
      .select('id', 'lasyncro_variant_id', 'external_variant_id');

    const variants = mappings.length
      ? await trx('variants')
          .whereIn('lasyncro_variant_id', mappings.map((m: any) => m.lasyncro_variant_id))
          .select('lasyncro_variant_id', 'lasyncro_product_id', 'status', 'unit_cost', 'lasyncro_barcode')
      : [];

    const byExternal = new Map<string, any>();
    for (const m of mappings) {
      byExternal.set(m.external_variant_id, variants.find((v: any) => v.lasyncro_variant_id === m.lasyncro_variant_id));
    }

    const parentIds = [...new Set(variants.map((v: any) => v.lasyncro_product_id as string))].sort();
    const parents = parentIds.length
      ? await trx('products').whereIn('lasyncro_product_id', parentIds)
          .orderBy('lasyncro_product_id').select('lasyncro_product_id', 'status')
      : [];

    return { mappings, variants, byExternal, parentIds, parents };
  });
}

/** Shop-wide parent rows and parent rows that no variant references. */
async function productCounts(shopId: number) {
  return withTenant(shopId, async (trx) => {
    const total = await trx('products').where({ shop_id: shopId }).count('* as c').first();
    const orphans = await trx('products as p')
      .where('p.shop_id', shopId)
      .whereNotExists(trx('variants as v').whereRaw('v.lasyncro_product_id = p.lasyncro_product_id'))
      .count('* as c').first();
    return { total: Number(total?.c ?? 0), orphans: Number(orphans?.c ?? 0) };
  });
}

/** Identity-only snapshot (no mutable fields). */
function identitySnapshot(state: Awaited<ReturnType<typeof catalogState>>) {
  return state.mappings.map((m: any) => {
    const v = state.byExternal.get(m.external_variant_id);
    return {
      mapping_id: m.id,
      external_variant_id: m.external_variant_id,
      lasyncro_variant_id: m.lasyncro_variant_id,
      lasyncro_product_id: v?.lasyncro_product_id,
      lasyncro_barcode: v?.lasyncro_barcode,
    };
  });
}

// ── R1 ──────────────────────────────────────────────────────────────────────

it('R1 — initial sync and identical resync of the same Shopify product never create another parent', async () => {
  const { shopId, shopDomain } = await provisionCatalogShop('r1');
  const productId = numericId();
  const variants: VariantSpec[] = [{ variantId: numericId(), sku: null, cost: '5.00' }, { variantId: numericId(), sku: null, cost: '6.00' }];
  const before = await productCounts(shopId);

  await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', variants)]);
  const first = await catalogState(shopId, productId);
  expect(first.mappings).toHaveLength(2);
  expect(first.parentIds).toHaveLength(1);
  expect((await productCounts(shopId)).total - before.total).toBe(1);

  // Identical full resync (GraphQL writer).
  await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', variants)]);
  const afterResync = await productCounts(shopId);
  expect(afterResync.total - before.total).toBe(1);
  expect(afterResync.orphans - before.orphans).toBe(0);

  // Identical products/update webhook (REST writer).
  await productsUpdateWebhook(shopId, shopDomain, restProduct(productId, 'active', variants));
  const afterWebhook = await productCounts(shopId);
  expect(afterWebhook.total - before.total).toBe(1);
  expect(afterWebhook.orphans - before.orphans).toBe(0);

  expect((await catalogState(shopId, productId)).parentIds).toEqual(first.parentIds);
});

// ── R2 ──────────────────────────────────────────────────────────────────────

it('R2 — DRAFT → ACTIVE → ARCHIVED → ACTIVE updates the persisted parents existing variants use', async () => {
  const { shopId, shopDomain } = await provisionCatalogShop('r2');
  const productId = numericId();
  const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }, { variantId: numericId(), cost: '6.00' }];

  await initialSync(shopId, [graphqlEdge(productId, 'DRAFT', variants)]);
  const initial = await catalogState(shopId, productId);
  expect(initial.parents.map((p: any) => p.status)).toEqual(['draft']);
  const variantParents = initial.variants.map((v: any) => [v.lasyncro_variant_id, v.lasyncro_product_id]).sort();

  for (const target of ['active', 'archived', 'active'] as const) {
    await productsUpdateWebhook(shopId, shopDomain, restProduct(productId, target, variants));
    const state = await catalogState(shopId, productId);

    // The parents the variants actually reference are the ones eligibility reads.
    expect(state.variants.map((v: any) => [v.lasyncro_variant_id, v.lasyncro_product_id]).sort()).toEqual(variantParents);
    expect({ transition: target, parentStatuses: state.parents.map((p: any) => p.status) })
      .toEqual({ transition: target, parentStatuses: state.parentIds.map(() => target) });
  }
});

// ── R3 ──────────────────────────────────────────────────────────────────────

it('R3 — a variant added later in Shopify reuses the canonical existing product parent', async () => {
  const { shopId, shopDomain } = await provisionCatalogShop('r3');
  const productId = numericId();
  const original: VariantSpec = { variantId: numericId(), cost: '5.00' };
  const added: VariantSpec = { variantId: numericId() };
  const before = await productCounts(shopId);

  await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', [original])]);
  const initial = await catalogState(shopId, productId);
  const canonicalParent = initial.byExternal.get(variantGid(original.variantId)).lasyncro_product_id;

  await productsUpdateWebhook(shopId, shopDomain, restProduct(productId, 'active', [original, added]));
  const after = await catalogState(shopId, productId);

  expect(after.mappings).toHaveLength(2);
  expect(after.byExternal.get(variantGid(original.variantId)).lasyncro_product_id).toBe(canonicalParent);
  expect(after.byExternal.get(variantGid(added.variantId)).lasyncro_product_id).toBe(canonicalParent);
  expect((await productCounts(shopId)).total - before.total).toBe(1);
});

// ── R4 ──────────────────────────────────────────────────────────────────────

it('R4 — historical split-parent state keeps every id, gets one consistent parent status, and gains no orphan parent', async () => {
  const { shopId, shopDomain } = await provisionCatalogShop('r4');
  const productId = numericId();
  const v1: VariantSpec = { variantId: numericId() };
  const v2: VariantSpec = { variantId: numericId() };

  // Legacy shape left by earlier ingestion: two variants of ONE Shopify product
  // persisted under two different parents. Disposable-DB fixture only.
  const parent1 = crypto.randomUUID();
  const parent2 = crypto.randomUUID();
  const variant1 = crypto.randomUUID();
  const variant2 = crypto.randomUUID();
  await withTenant(shopId, async (trx) => {
    await trx('products').insert([
      { lasyncro_product_id: parent1, shop_id: shopId, title: `GH1262 product ${productId}`, status: 'active', product_type: 'physical' },
      { lasyncro_product_id: parent2, shop_id: shopId, title: `GH1262 product ${productId}`, status: 'active', product_type: 'physical' },
    ]);
    await trx('variants').insert([
      { lasyncro_variant_id: variant1, lasyncro_product_id: parent1, shop_id: shopId, sku: null, title: 'V1', unit_cost: 3.5, status: 'active' },
      { lasyncro_variant_id: variant2, lasyncro_product_id: parent2, shop_id: shopId, sku: null, title: 'V2', unit_cost: 4.5, status: 'active' },
    ]);
    await trx('external_product_identity_map').insert([v1, v2].map((v, i) => ({
      id: crypto.randomUUID(),
      shop_id: shopId,
      lasyncro_variant_id: i === 0 ? variant1 : variant2,
      platform: 'shopify',
      external_product_id: productGid(productId),
      external_variant_id: variantGid(v.variantId),
      external_inventory_item_id: `gid://shopify/InventoryItem/${v.variantId}`,
    })));
  });

  const fixture = await catalogState(shopId, productId);
  expect(fixture.parentIds).toEqual([parent1, parent2].sort());
  const mappingIds = fixture.mappings.map((m: any) => m.id).sort();
  const before = await productCounts(shopId);

  await productsUpdateWebhook(shopId, shopDomain, restProduct(productId, 'archived', [v1, v2]));
  const after = await catalogState(shopId, productId);

  // Identity preserved — no repointing, no new mapping rows.
  expect(after.mappings.map((m: any) => m.id).sort()).toEqual(mappingIds);
  expect(after.byExternal.get(variantGid(v1.variantId))).toMatchObject({ lasyncro_variant_id: variant1, lasyncro_product_id: parent1 });
  expect(after.byExternal.get(variantGid(v2.variantId))).toMatchObject({ lasyncro_variant_id: variant2, lasyncro_product_id: parent2 });

  // Every linked parent carries the same, current status.
  expect(after.parents.map((p: any) => [p.lasyncro_product_id, p.status]))
    .toEqual([parent1, parent2].sort().map((id) => [id, 'archived']));

  // No additional parent row, orphan or otherwise.
  const counts = await productCounts(shopId);
  expect(counts.total - before.total).toBe(0);
  expect(counts.orphans - before.orphans).toBe(0);

  // R4 extension: the oldest mapped parent must win even when its UUID
  // sorts AFTER the newer parent's UUID.
  const oldestParent = [parent1, parent2].sort()[1];
  const newerParent = [parent1, parent2].sort()[0];

  await withTenant(shopId, async (trx) => {
    await trx('products')
      .where({ shop_id: shopId, lasyncro_product_id: oldestParent })
      .update({ created_at: new Date('2024-01-01T00:00:00.000Z') });

    await trx('products')
      .where({ shop_id: shopId, lasyncro_product_id: newerParent })
      .update({ created_at: new Date('2024-02-01T00:00:00.000Z') });
  });

  const historicalIdentity = identitySnapshot(
    await catalogState(shopId, productId)
  );

  const added: VariantSpec = { variantId: numericId(), cost: '7.00' };

  await productsUpdateWebhook(
    shopId,
    shopDomain,
    restProduct(productId, 'archived', [v1, v2, added])
  );

  const finalState = await catalogState(shopId, productId);
  const addedVariant = finalState.byExternal.get(variantGid(added.variantId));

  expect(addedVariant).toBeTruthy();
  expect(addedVariant.lasyncro_product_id).toBe(oldestParent);

  expect(
    identitySnapshot(finalState).filter(
      row => row.external_variant_id !== variantGid(added.variantId)
    )
  ).toEqual(historicalIdentity);

  expect(finalState.parentIds).toEqual([parent1, parent2].sort());
  expect(finalState.parents.map((p: any) => p.status))
    .toEqual(['archived', 'archived']);

  const finalCounts = await productCounts(shopId);
  expect(finalCounts.total).toBe(counts.total);
  expect(finalCounts.orphans).toBe(counts.orphans);

  console.info('R4_OLDEST_PARENT=VERIFIED');
});

// ── R5 ──────────────────────────────────────────────────────────────────────

it('R5 — repeated identical syncs change no identities, mappings or LSP barcodes', async () => {
  const { shopId, shopDomain } = await provisionCatalogShop('r5');
  const productId = numericId();
  const variants: VariantSpec[] = [{ variantId: numericId(), sku: null, cost: '5.00' }, { variantId: numericId(), sku: null, cost: '6.00' }];

  await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', variants)]);
  const baseline = identitySnapshot(await catalogState(shopId, productId));
  expect(baseline).toHaveLength(2);
  for (const row of baseline) expect(row.lasyncro_barcode).toMatch(LSP_PATTERN);

  const replays: Array<[string, () => Promise<unknown>]> = [
    ['graphql resync #1', () => initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', variants)])],
    ['graphql resync #2', () => initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', variants)])],
    ['products/update replay #1', () => productsUpdateWebhook(shopId, shopDomain, restProduct(productId, 'active', variants))],
    ['products/update replay #2', () => productsUpdateWebhook(shopId, shopDomain, restProduct(productId, 'active', variants))],
  ];
  for (const [label, replay] of replays) {
    await replay();
    expect({ replay: label, identity: identitySnapshot(await catalogState(shopId, productId)) })
      .toEqual({ replay: label, identity: baseline });
  }
});

// ── R6 ──────────────────────────────────────────────────────────────────────

it('R6 — order ingestion for an archived product is unchanged: the line keeps the mapped variant and its persisted parent', async () => {
  const { shopId, shopDomain } = await provisionFt2Shop('r6');
  const productId = numericId();
  const v: VariantSpec = { variantId: numericId(), sku: `GH1262-R6-${productId}`, cost: '9.00' };

  await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', [v])]);
  await productsUpdateWebhook(shopId, shopDomain, restProduct(productId, 'archived', [v]));
  const catalog = await catalogState(shopId, productId);
  const mapped = catalog.byExternal.get(variantGid(v.variantId));
  expect(mapped).toBeTruthy();

  const externalOrderId = numericId();
  const [event] = await withTenant(shopId, (trx) =>
    trx('domain_events').insert({
      shop_id: shopId,
      event_type: 'orders/create',
      event_payload: {
        id: externalOrderId,
        currency: 'USD',
        total_price: 19,
        subtotal_price: 19,
        total_tax: 0,
        displayFinancialStatus: 'PAID',
        displayFulfillmentStatus: 'UNFULFILLED',
        shipping_address: { address1: '1 Test St', city: 'Testville', zip: '00000', country_code: 'US' },
        line_items: [{ id: `${externalOrderId}1`, variant_id: v.variantId, product_id: productId, sku: v.sku, quantity: 1, price: '19.00' }],
      },
      event_time: new Date(),
      event_version: 1,
      external_event_id: `test:gh1262:r6:${shopId}:${externalOrderId}`,
    }).returning(['id']));
  await runWithTenantContext(shopId, () => processDomainEvent(Number(event.id)));

  // Deterministic order id — same derivation as orders.create.ts / order-intake-classification.test.ts.
  const lasyncroOrderId = crypto.createHash('sha1')
    .update(`6ba7b810-9dad-11d1-80b4-00c04fd430c8:${shopId}:shopify:${externalOrderId}`)
    .digest('hex').slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
  const order = await withTenant(shopId, (trx) => trx('orders').where({ lasyncro_order_id: lasyncroOrderId }).first());
  expect(order).toBeTruthy();

  const lines = await withTenant(shopId, (trx) =>
    trx('order_line_items').where({ lasyncro_order_id: lasyncroOrderId })
      .select('lasyncro_variant_id', 'lasyncro_product_id', 'quantity'));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    lasyncro_variant_id: mapped.lasyncro_variant_id,
    lasyncro_product_id: mapped.lasyncro_product_id,
    quantity: 1,
  });
});

// ── R7 ──────────────────────────────────────────────────────────────────────

it('R7 — a REST product payload with no cost never overwrites a persisted valid unit cost with zero', async () => {
  const { shopId, shopDomain } = await provisionCatalogShop('r7');
  const productId = numericId();
  const v: VariantSpec = { variantId: numericId(), cost: '12.50' };

  await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', [v])]);
  const initial = await catalogState(shopId, productId);
  expect(Number(initial.byExternal.get(variantGid(v.variantId)).unit_cost)).toBe(12.5);

  await productsUpdateWebhook(shopId, shopDomain, restProduct(productId, 'active', [v]));
  const after = await catalogState(shopId, productId);
  expect(Number(after.byExternal.get(variantGid(v.variantId)).unit_cost)).toBe(12.5);
});

// ── R9 ──────────────────────────────────────────────────────────────────────

it('R9 — a GraphQL resync with absent unit cost preserves the persisted valid cost', async () => {
  const { shopId } = await provisionCatalogShop('r9');
  const productId = numericId();
  const variantId = numericId();

  await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', [{ variantId, cost: '12.50' }])]);
  expect(Number((await catalogState(shopId, productId)).byExternal.get(variantGid(variantId)).unit_cost)).toBe(12.5);

  await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', [{ variantId, cost: null }])]);
  expect(Number((await catalogState(shopId, productId)).byExternal.get(variantGid(variantId)).unit_cost)).toBe(12.5);
});

// ── R10 ─────────────────────────────────────────────────────────────────────

/**
 * Deterministic overlap: a held FOR UPDATE on the shop row blocks the
 * products → shops foreign-key check (FOR KEY SHARE) every catalog write makes.
 * Both syncs are released only after the database shows two blocked waiters,
 * so the calls genuinely overlap instead of happening to run one after another.
 */
it('R10 — concurrent syncs of the same never-seen Shopify product cannot create separate canonical parents', async () => {
  const { shopId } = await provisionCatalogShop('r10');
  const productId = numericId();
  const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }, { variantId: numericId(), cost: '6.00' }];
  const before = await productCounts(shopId);
  const variantsBefore = await withTenant(shopId, async (trx) =>
    Number((await trx('variants').where({ shop_id: shopId }).count('* as c').first())?.c ?? 0));

  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let locked!: () => void;
  const lockHeld = new Promise<void>((resolve) => { locked = resolve; });
  const holder = withTenant(shopId, async (trx) => {
    await trx('shops').where({ id: shopId }).forUpdate().first('id');
    locked();
    await released;
  });
  await lockHeld;

  const syncs = Promise.allSettled([
    initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', variants)]),
    initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', variants)]),
  ]);

  let waiters = 0;
  for (let i = 0; i < 100 && waiters < 2; i++) {
    await new Promise((r) => setTimeout(r, 50));
    waiters = await withTenant(shopId, async (trx) => {
      const row = await trx.raw('SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted');
      return Number(row.rows[0].n);
    });
  }
  release();
  await holder;
  const results = await syncs;

  expect(waiters).toBeGreaterThanOrEqual(2); // overlap actually happened
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);

  const state = await catalogState(shopId, productId);
  expect(state.mappings).toHaveLength(2);
  expect(state.parentIds).toHaveLength(1);

  const counts = await productCounts(shopId);
  expect(counts.total - before.total).toBe(1);
  expect(counts.orphans - before.orphans).toBe(0);
  const variantsAfter = await withTenant(shopId, async (trx) =>
    Number((await trx('variants').where({ shop_id: shopId }).count('* as c').first())?.c ?? 0));
  expect(variantsAfter - variantsBefore).toBe(2); // no duplicate, unmapped variant rows
});

// ── R11 ─────────────────────────────────────────────────────────────────────

describe('R11 — an absent status never silently reactivates an archived product', () => {
  it('R11a — GraphQL edge without status', async () => {
    const { shopId } = await provisionCatalogShop('r11a');
    const productId = numericId();
    const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }];

    await initialSync(shopId, [graphqlEdge(productId, 'ARCHIVED', variants)]);
    expect((await catalogState(shopId, productId)).parents.map((p: any) => p.status)).toEqual(['archived']);

    const edge = graphqlEdge(productId, 'ARCHIVED', variants);
    delete (edge.node as { status?: unknown }).status;
    await initialSync(shopId, [edge]);

    const after = await catalogState(shopId, productId);
    expect(after.parents.map((p: any) => p.status)).toEqual(after.parentIds.map(() => 'archived'));
  });

  it('R11b — REST products/update payload without status', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('r11b');
    const productId = numericId();
    const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }];

    await initialSync(shopId, [graphqlEdge(productId, 'ARCHIVED', variants)]);
    expect((await catalogState(shopId, productId)).parents.map((p: any) => p.status)).toEqual(['archived']);

    const payload = restProduct(productId, 'archived', variants);
    delete (payload as { status?: unknown }).status;
    await productsUpdateWebhook(shopId, shopDomain, payload);

    const after = await catalogState(shopId, productId);
    expect(after.parents.map((p: any) => p.status)).toEqual(after.parentIds.map(() => 'archived'));
  });
});

// ── R8 ──────────────────────────────────────────────────────────────────────

describe('R8 — zero-variant / partial payload boundary', () => {
  it('R8a — a zero-variant payload for a known product resolves through the identity map and invents no product identity', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('r8a');
    const productId = numericId();
    const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }, { variantId: numericId(), cost: '6.00' }];

    await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', variants)]);
    const known = await catalogState(shopId, productId);
    // The persisted identity map alone resolves this Shopify product to its parent.
    expect(known.mappings).toHaveLength(2);
    expect(known.parentIds).toHaveLength(1);
    const identity = identitySnapshot(known);
    const before = await productCounts(shopId);

    await productsUpdateWebhook(shopId, shopDomain, restProduct(productId, 'active', []));
    const after = await catalogState(shopId, productId);

    // Completeness is not inferred: the variants absent from the payload are untouched.
    expect(identitySnapshot(after)).toEqual(identity);
    expect(after.variants.map((v: any) => v.status)).toEqual(['active', 'active']);

    // No product identity is invented.
    const counts = await productCounts(shopId);
    expect(counts.total - before.total).toBe(0);
    expect(counts.orphans - before.orphans).toBe(0);
  });

  it('R8b — a partial payload leaves absent variants untouched and invents no product identity', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('r8b');
    const productId = numericId();
    const present: VariantSpec = { variantId: numericId(), cost: '5.00' };
    const absent: VariantSpec = { variantId: numericId(), cost: '6.00' };

    await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', [present, absent])]);
    const known = await catalogState(shopId, productId);
    const absentBefore = known.byExternal.get(variantGid(absent.variantId));
    const before = await productCounts(shopId);

    await productsUpdateWebhook(shopId, shopDomain, restProduct(productId, 'active', [present]));
    const after = await catalogState(shopId, productId);

    expect(after.mappings).toHaveLength(2);
    expect(after.byExternal.get(variantGid(absent.variantId))).toEqual(absentBefore);

    const counts = await productCounts(shopId);
    expect(counts.total - before.total).toBe(0);
    expect(counts.orphans - before.orphans).toBe(0);
  });

  it('R8c — a never-seen product delivered with zero variants creates no unresolvable product identity', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('r8c');
    const productId = numericId();
    const before = await productCounts(shopId);

    await productsCreateWebhook(shopId, shopDomain, restProduct(productId, 'active', []));

    // Nothing maps this Shopify product id, so any parent row written here could
    // never be resolved back to Shopify.
    expect((await catalogState(shopId, productId)).mappings).toHaveLength(0);
    expect((await productCounts(shopId)).total - before.total).toBe(0);
  });
});


// ── R12: MISSING PRODUCT TYPE ───────────────────────────

it('R12a — REST missing product_type preserves digital', async () => {
  const { shopId, shopDomain } = await provisionCatalogShop('r12a');
  const productId = numericId();
  const variants: VariantSpec[] = [
    { variantId: numericId(), cost: '12.50' },
  ];

  const first = graphqlEdge(productId, 'ACTIVE', variants);
  first.node.productType = 'digital';
  await initialSync(shopId, [first]);

  const types = async () => {
    const ids = (await catalogState(shopId, productId)).parentIds;
    return withTenant(shopId, trx =>
      trx('products')
        .where({ shop_id: shopId })
        .whereIn('lasyncro_product_id', ids)
        .pluck('product_type')
    );
  };

  expect(await types()).toEqual(['digital']);

  const payload = restProduct(productId, 'active', variants);
  delete (payload as any).product_type;
  await productsUpdateWebhook(shopId, shopDomain, payload);

  expect(await types()).toEqual(['digital']);
});

it('R12b — GraphQL missing productType preserves gift_card', async () => {
  const { shopId } = await provisionCatalogShop('r12b');
  const productId = numericId();
  const variants: VariantSpec[] = [
    { variantId: numericId(), cost: '12.50' },
  ];

  const first = graphqlEdge(productId, 'ACTIVE', variants);
  first.node.productType = 'gift_card';
  await initialSync(shopId, [first]);

  const types = async () => {
    const ids = (await catalogState(shopId, productId)).parentIds;
    return withTenant(shopId, trx =>
      trx('products')
        .where({ shop_id: shopId })
        .whereIn('lasyncro_product_id', ids)
        .pluck('product_type')
    );
  };

  expect(await types()).toEqual(['gift_card']);

  const update = graphqlEdge(productId, 'ACTIVE', variants);
  delete (update.node as { productType?: string }).productType;

  await initialSync(shopId, [update]);

  expect(await types()).toEqual(['gift_card']);
});

// ── R13: EXPLICIT ZERO VS ABSENT COST ──────────────────

it('R13 — explicit zero cost updates; absent cost preserves', async () => {
  const { shopId } = await provisionCatalogShop('r13');
  const productId = numericId();
  const variantId = numericId();

  const sync = async (cost: string | null) =>
    initialSync(shopId, [
      graphqlEdge(productId, 'ACTIVE', [{ variantId, cost }]),
    ]);

  const storedCost = async () =>
    Number(
      (await catalogState(shopId, productId))
        .byExternal.get(variantGid(variantId)).unit_cost
    );

  await sync('12.50');
  expect(await storedCost()).toBe(12.5);

  await sync('0.00');
  expect(await storedCost()).toBe(0);

  await sync('12.50');
  expect(await storedCost()).toBe(12.5);

  const numericZero = graphqlEdge(productId, 'ACTIVE', [
    { variantId, cost: '0.00' },
  ]);

  (numericZero.node.variants.edges[0].node.inventoryItem as any)
    .unitCost = { amount: 0 };

  await initialSync(shopId, [numericZero]);
  expect(await storedCost()).toBe(0);

  await sync(null);
  expect(await storedCost()).toBe(0);
});


// ── R14: MULTI-PRODUCT LOCK ORDER ─────────────────────────────────────

it('R14 — reversed concurrent multi-product syncs do not deadlock', async () => {
  const { shopId } = await provisionCatalogShop('r14');

  const productA = numericId();
  const productB = numericId();

  // Ensure distinct Shopify identities.
  expect(productA).not.toBe(productB);

  const variantA = numericId();
  const variantB = numericId();

  const edgeA = graphqlEdge(productA, 'ACTIVE', [
    { variantId: variantA, cost: '5.00' },
  ]);

  const edgeB = graphqlEdge(productB, 'ACTIVE', [
    { variantId: variantB, cost: '6.00' },
  ]);

  const before = await productCounts(shopId);

  let firstLocksAcquired = 0;
  let gateOpened = false;
  let releaseGate!: () => void;

  const gate = new Promise<void>(resolve => {
    releaseGate = resolve;
  });

  const openGate = () => {
    if (!gateOpened) {
      gateOpened = true;
      releaseGate();
    }
  };

  // Instrument only this test's transactions. Pause immediately after
  // the first product advisory lock is acquired.
  //
  // Original code:
  //   Transaction A holds lock A
  //   Transaction B holds lock B
  //   Both proceed to request the other's lock -> PostgreSQL deadlock.
  //
  // Corrected code:
  //   Both request locks in the same deterministic order.
  //   One waits before acquiring its first lock.
  //
  // The bounded gate also lets the corrected serial order complete.
  const importOrder = (edges: any[]) =>
    withTenant(shopId, async (trx) => {
      await trx.raw("SET LOCAL statement_timeout = '8000ms'");

      let firstSeen = false;

      // Proxy a separate callable target: Knex trx.raw is read-only.
      const instrumentedTrx = new Proxy(
        (...args: any[]) => (trx as any)(...args),
        {
          apply(_target, _thisArg, args) {
            return (trx as any)(...args);
          },
          get(_target, prop) {
            if (prop === 'raw') {
              return async (...args: any[]) => {
                const result = await (trx.raw as any)(...args);

                if (
                  typeof args[0] === 'string' &&
                  args[0].includes('pg_advisory_xact_lock') &&
                  !firstSeen
                ) {
                  firstSeen = true;
                  firstLocksAcquired += 1;

                  if (firstLocksAcquired === 2) openGate();
                  await gate;
                }

                return result;
              };
            }

            const value = (trx as any)[prop];
            return typeof value === 'function'
              ? value.bind(trx)
              : value;
          },
        }
      ) as typeof trx;

      return syncProducts(instrumentedTrx, shopId, edges);
    });

  const timer = setTimeout(openGate, 1500);

  let results: PromiseSettledResult<unknown>[];

  try {
    results = await Promise.allSettled([
      importOrder([edgeA, edgeB]),
      importOrder([edgeB, edgeA]),
    ]);
  } finally {
    clearTimeout(timer);
    openGate();
  }

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => {
      const error = r.reason as { code?: string; message?: string };
      return error.code ?? error.message ?? String(r.reason);
    });

  console.info('R14_CONCURRENT_RESULT', {
    firstLocksAcquired,
    errors,
  });

  expect(firstLocksAcquired).toBe(2);
  expect(errors).toEqual([]);

  for (const [productId, variantId] of [
    [productA, variantA],
    [productB, variantB],
  ]) {
    const state = await catalogState(shopId, productId);

    expect(state.mappings).toHaveLength(1);
    expect(state.parentIds).toHaveLength(1);
    expect(
      state.byExternal.get(variantGid(variantId)).lasyncro_product_id
    ).toBe(state.parentIds[0]);
  }

  const after = await productCounts(shopId);

  expect(after.total - before.total).toBe(2);
  expect(after.orphans - before.orphans).toBe(0);
});

// ── ISOLATION ───────────────────────────────────────────────────────────────

it('ISOLATION — no provider call was attempted by any contract above', () => {
  expect(mockProviderAttempts).toEqual([]);
});
