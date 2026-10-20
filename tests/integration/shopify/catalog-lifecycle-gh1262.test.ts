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
import { persistShopifyAdminCredentials } from 'api-src/services/shopify/shopifyAdminCredential.repository';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';
import { issueTestToken } from '../../unit/helpers/auth';
import fs from 'fs';
import path from 'path';
import knex, { type Knex } from 'knex';
// GH-1101: the latest protected security evolution; 0218 must leave it intact.
import { assertSecurityPostconditions } from
  '../../../apps/backend/migrations/20261019120000_0217_shopify_manual_recovery';

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

// ── R15: products/delete INGRESS (A2.2) ────────────────────────────────────

/**
 * A verified products/delete delivery must be processed — not acknowledged as
 * "ignored" — and must leave the mapped product no longer commercially active,
 * while every internal identity (product / variant ids, mappings, LSP barcodes)
 * is preserved. The tombstone representation is deliberately not prescribed;
 * variant status / warehouse accessibility is deliberately not asserted.
 */
it('R15 — a verified products/delete webhook is processed and leaves the mapped product not commercially active, identity intact', async () => {
  const savedWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  // verifyShopifySignature requires both secrets configured; the delivery is
  // signed with the app secret, as Shopify signs app-registered topics.
  process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret || 'gh1262-test-webhook-secret';
  try {
    const { shopId, shopDomain } = await provisionCatalogShop('r15');
    const productId = numericId();
    const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }, { variantId: numericId(), cost: '6.00' }];

    await initialSync(shopId, [graphqlEdge(productId, 'ACTIVE', variants)]);
    const before = await catalogState(shopId, productId);
    expect(before.mappings).toHaveLength(2);
    expect(before.parents.map((p: any) => p.status)).toEqual(before.parentIds.map(() => 'active'));
    const identity = identitySnapshot(before);
    for (const row of identity) expect(row.lasyncro_barcode).toMatch(LSP_PATTERN);

    // Shopify products/delete payload carries only the product id.
    const webhookId = `gh1262-r15-${crypto.randomUUID()}`;
    const rawBody = JSON.stringify({ id: Number(productId) });
    const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
      .update(Buffer.from(rawBody, 'utf8')).digest('base64');

    const res = await request(app)
      .post('/api/v1/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Topic', 'products/delete')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', webhookId)
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(rawBody);

    const ledger = await withTenant(shopId, (trx) =>
      trx('integration_webhook_events')
        .where({ integration: 'shopify', external_event_id: webhookId })
        .pluck('processing_status'));
    const after = await catalogState(shopId, productId);

    // Processed, not silently acknowledged; parent no longer commercially active.
    expect({
      httpStatus: res.status,
      body: res.body,
      ledger,
      activeParents: after.parents.filter((p: any) => p.status === 'active').map((p: any) => p.lasyncro_product_id),
    }).toEqual({
      httpStatus: 200,
      body: { status: 'ok' },
      ledger: ['processed'],
      activeParents: [],
    });

    // Internal identity is preserved: same parents, variants, mappings, LSP barcodes.
    expect(after.parentIds).toEqual(before.parentIds);
    expect(identitySnapshot(after)).toEqual(identity);
  } finally {
    if (savedWebhookSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret;
  }
});

// ── R16: DELETION TOMBSTONE PERMANENCE (A2.2 RED-2A) ───────────────────────

/**
 * A genuine Shopify deletion is terminal for its original external product id:
 * a delayed products/update or a stale GraphQL full-sync snapshot must never
 * reactivate it. Identity (parents, variants, mappings, LSP barcodes) stays
 * intact and no parent / variant is created. variants.status is not asserted.
 */
describe('R16 — a deleted Shopify product is never reactivated by stale catalog input', () => {
  let savedWebhookSecret: string | undefined;

  beforeAll(() => {
    savedWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret || 'gh1262-test-webhook-secret';
  });

  afterAll(() => {
    if (savedWebhookSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret;
  });

  /** Verified products/delete through the real HTTP endpoint — R15 pattern. */
  async function deliverProductsDelete(shopId: number, shopDomain: string, productId: string) {
    const webhookId = `gh1262-r16-${crypto.randomUUID()}`;
    const rawBody = JSON.stringify({ id: Number(productId) });
    const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
      .update(Buffer.from(rawBody, 'utf8')).digest('base64');
    const res = await request(app)
      .post('/api/v1/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Topic', 'products/delete')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', webhookId)
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(rawBody);
    const ledger = await withTenant(shopId, (trx) =>
      trx('integration_webhook_events')
        .where({ integration: 'shopify', external_event_id: webhookId })
        .pluck('processing_status'));
    expect({ httpStatus: res.status, body: res.body, ledger })
      .toEqual({ httpStatus: 200, body: { status: 'ok' }, ledger: ['processed'] });
  }

  const shopVariantCount = (shopId: number) =>
    withTenant(shopId, async (trx) =>
      Number((await trx('variants').where({ shop_id: shopId }).count('* as c').first())?.c ?? 0));

  /** ACTIVE ingest → identity capture → verified deletion, returning the deleted baseline. */
  async function deletedProduct(label: string) {
    const { shopId, shopDomain } = await provisionCatalogShop(label);
    const productId = numericId();
    const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }, { variantId: numericId(), cost: '6.00' }];
    const activeSnapshot = graphqlEdge(productId, 'ACTIVE', variants);

    await initialSync(shopId, [activeSnapshot]);
    const active = await catalogState(shopId, productId);
    expect(active.mappings).toHaveLength(2);
    expect(active.parents.map((p: any) => p.status)).toEqual(active.parentIds.map(() => 'active'));
    const identity = identitySnapshot(active);
    for (const row of identity) expect(row.lasyncro_barcode).toMatch(LSP_PATTERN);

    await deliverProductsDelete(shopId, shopDomain, productId);
    const deleted = await catalogState(shopId, productId);
    expect(deleted.parents.map((p: any) => p.status)).toEqual(deleted.parentIds.map(() => 'deleted'));
    expect(deleted.parentIds).toEqual(active.parentIds);
    expect(identitySnapshot(deleted)).toEqual(identity);

    return {
      shopId, shopDomain, productId, variants, activeSnapshot,
      parentIds: active.parentIds,
      identity,
      counts: await productCounts(shopId),
      variantCount: await shopVariantCount(shopId),
    };
  }

  async function expectTombstoneIntact(base: Awaited<ReturnType<typeof deletedProduct>>, replay: string) {
    const after = await catalogState(base.shopId, base.productId);
    expect({ replay, parentStatuses: after.parents.map((p: any) => p.status) })
      .toEqual({ replay, parentStatuses: base.parentIds.map(() => 'deleted') });
    expect(after.parentIds).toEqual(base.parentIds);
    expect(identitySnapshot(after)).toEqual(base.identity);

    const counts = await productCounts(base.shopId);
    expect(counts.total - base.counts.total).toBe(0);
    expect(counts.orphans - base.counts.orphans).toBe(0);
    expect((await shopVariantCount(base.shopId)) - base.variantCount).toBe(0);
  }

  it('R16a — a stale products/update carrying the earlier ACTIVE state does not reactivate the deleted product', async () => {
    const base = await deletedProduct('r16a');

    // Distinct event (fresh envelope eventId) with the pre-deletion ACTIVE payload.
    await productsUpdateWebhook(base.shopId, base.shopDomain, restProduct(base.productId, 'active', base.variants));

    await expectTombstoneIntact(base, 'stale products/update');
  });

  it('R16b — a stale ACTIVE GraphQL full-sync snapshot does not reactivate the deleted product', async () => {
    const base = await deletedProduct('r16b');

    // Replay the snapshot captured before deletion through the initial-sync writer.
    await initialSync(base.shopId, [base.activeSnapshot]);

    await expectTombstoneIntact(base, 'stale graphql snapshot');
  });
});

// ── R17: CHRONOLOGICAL FRESHNESS (A2.2 RED-2B) ─────────────────────────────

/**
 * Shopify delivers products/* webhooks at-least-once and out of order, and a
 * full-sync snapshot may be older than a webhook already applied. Catalog input
 * whose Shopify source timestamp (REST updated_at / GraphQL updatedAt) is older
 * than the state already applied must never overwrite it. Identity (parents,
 * variants, mappings, LSP barcodes) stays intact and no parent is created.
 *
 * Source timestamps are fixed literals; persistence time is not mocked. Stale
 * deliveries are only required to be accepted and recorded once — how a stale
 * event is classified in the ledger is deliberately not prescribed.
 */
describe('R17 — out-of-order Shopify product input never overwrites newer lifecycle state', () => {
  const T1 = '2026-09-01T10:00:00Z';
  const T2 = '2026-09-02T10:00:00Z';
  const T3 = '2026-09-03T10:00:00Z';

  let savedWebhookSecret: string | undefined;

  beforeAll(() => {
    savedWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret || 'gh1262-test-webhook-secret';
  });

  afterAll(() => {
    if (savedWebhookSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret;
  });

  /** GraphQL edge carrying the product-level Shopify updatedAt. */
  const graphqlEdgeAt = (productId: string, status: ShopifyStatus, variants: VariantSpec[], updatedAt: string) => {
    const edge = graphqlEdge(productId, status, variants);
    return { node: { ...edge.node, updatedAt } };
  };

  /**
   * Verified products/update through the real HTTP endpoint (R15 pattern) with
   * a distinct Shopify webhook id and the REST source updated_at in the body.
   */
  async function deliverProductsUpdate(
    shopId: number,
    shopDomain: string,
    productId: string,
    status: 'active' | 'draft' | 'archived',
    variants: VariantSpec[],
    updatedAt: string,
  ) {
    const webhookId = `gh1262-r17-${crypto.randomUUID()}`;
    const rawBody = JSON.stringify({ ...restProduct(productId, status, variants), updated_at: updatedAt });
    const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
      .update(Buffer.from(rawBody, 'utf8')).digest('base64');
    const res = await request(app)
      .post('/api/v1/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Topic', 'products/update')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', webhookId)
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(rawBody);
    const ledger = await withTenant(shopId, (trx) =>
      trx('integration_webhook_events')
        .where({ integration: 'shopify', external_event_id: webhookId })
        .pluck('processing_status'));
    expect({ webhook: `${status}@${updatedAt}`, httpStatus: res.status, recorded: ledger.length })
      .toEqual({ webhook: `${status}@${updatedAt}`, httpStatus: 200, recorded: 1 });
    return { ledger };
  }

  /** Mapped product captured after its first ingest, as the stable identity baseline. */
  async function ingested(label: string, status: ShopifyStatus, updatedAt: string) {
    const { shopId, shopDomain } = await provisionCatalogShop(label);
    const productId = numericId();
    const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }, { variantId: numericId(), cost: '6.00' }];
    const snapshot = graphqlEdgeAt(productId, status, variants, updatedAt);

    await initialSync(shopId, [snapshot]);
    const state = await catalogState(shopId, productId);
    expect(state.mappings).toHaveLength(2);
    expect(state.parents.map((p: any) => p.status)).toEqual(state.parentIds.map(() => status.toLowerCase()));
    const identity = identitySnapshot(state);
    for (const row of identity) expect(row.lasyncro_barcode).toMatch(LSP_PATTERN);

    return {
      shopId, shopDomain, productId, variants, snapshot,
      parentIds: state.parentIds,
      identity,
      counts: await productCounts(shopId),
    };
  }

  async function expectAuthoritative(
    base: Awaited<ReturnType<typeof ingested>>,
    replay: string,
    expected: 'active' | 'draft' | 'archived',
  ) {
    const after = await catalogState(base.shopId, base.productId);
    expect({ replay, parentStatuses: after.parents.map((p: any) => p.status) })
      .toEqual({ replay, parentStatuses: base.parentIds.map(() => expected) });
    expect(after.parentIds).toEqual(base.parentIds);
    expect(identitySnapshot(after)).toEqual(base.identity);

    const counts = await productCounts(base.shopId);
    expect(counts.total - base.counts.total).toBe(0);
    expect(counts.orphans - base.counts.orphans).toBe(0);
  }

  it('R17a — an older ACTIVE products/update delivered after a newer ARCHIVED update does not reactivate the product', async () => {
    const base = await ingested('r17a', 'ACTIVE', T1);

    await deliverProductsUpdate(base.shopId, base.shopDomain, base.productId, 'archived', base.variants, T3);
    await expectAuthoritative(base, `archived@${T3} applied`, 'archived');

    // Distinct, delayed delivery carrying an older source timestamp.
    await deliverProductsUpdate(base.shopId, base.shopDomain, base.productId, 'active', base.variants, T2);
    await expectAuthoritative(base, `stale active@${T2} after archived@${T3}`, 'archived');
  });

  it('R17b — a newer ACTIVE update legitimately reactivates an ARCHIVED product and an older DRAFT update cannot displace it', async () => {
    const base = await ingested('r17b', 'ARCHIVED', T1);

    // Legitimate reactivation from ARCHIVED: never confused with a deletion tombstone.
    await deliverProductsUpdate(base.shopId, base.shopDomain, base.productId, 'active', base.variants, T3);
    await expectAuthoritative(base, `active@${T3} reactivates archived@${T1}`, 'active');

    await deliverProductsUpdate(base.shopId, base.shopDomain, base.productId, 'draft', base.variants, T2);
    await expectAuthoritative(base, `stale draft@${T2} after active@${T3}`, 'active');
  });

  it('R17c — an older ACTIVE GraphQL snapshot replayed after a newer ARCHIVED webhook does not reactivate the product', async () => {
    const base = await ingested('r17c', 'ACTIVE', T1);

    await deliverProductsUpdate(base.shopId, base.shopDomain, base.productId, 'archived', base.variants, T3);
    await expectAuthoritative(base, `archived@${T3} applied`, 'archived');

    // Replay the snapshot captured at T1 through the initial-sync writer.
    await initialSync(base.shopId, [base.snapshot]);
    await expectAuthoritative(base, `stale graphql snapshot@${T1} after archived@${T3}`, 'archived');
  });
});

// ── R18: CHRONOLOGICAL ORDERING BOUNDARIES (A2.2 RED-2B) ───────────────────

/**
 * Once a source-timestamped version is applied, input that cannot be proven
 * newer must not overwrite it: a conflicting event carrying the SAME source
 * timestamp, or an update carrying NO source timestamp. A strictly newer
 * update still applies. Identity (parents, variants, mappings, LSP barcodes)
 * stays intact and nothing is created. Timestamp-free R1–R16 contracts, which
 * never follow a timestamped version, are untouched.
 */
describe('R18 — equal or missing source timestamps never overwrite a known newer version', () => {
  const T1 = '2026-09-01T10:00:00Z';
  const T3 = '2026-09-03T10:00:00Z';
  const T3_PLUS_1M = '2026-09-03T10:01:00Z';

  let savedWebhookSecret: string | undefined;

  beforeAll(() => {
    savedWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret || 'gh1262-test-webhook-secret';
  });

  afterAll(() => {
    if (savedWebhookSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret;
  });

  /**
   * Verified products/update through the real HTTP endpoint (R15 pattern),
   * distinct Shopify webhook id per delivery. `updatedAt: null` sends a body
   * with no updated_at key at all.
   */
  async function deliverProductsUpdate(
    shopId: number,
    shopDomain: string,
    productId: string,
    status: 'active' | 'draft' | 'archived',
    variants: VariantSpec[],
    updatedAt: string | null,
  ) {
    const webhookId = `gh1262-r18-${crypto.randomUUID()}`;
    const payload = restProduct(productId, status, variants);
    const rawBody = JSON.stringify(updatedAt === null ? payload : { ...payload, updated_at: updatedAt });
    const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
      .update(Buffer.from(rawBody, 'utf8')).digest('base64');
    const res = await request(app)
      .post('/api/v1/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Topic', 'products/update')
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', webhookId)
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(rawBody);
    const ledger = await withTenant(shopId, (trx) =>
      trx('integration_webhook_events')
        .where({ integration: 'shopify', external_event_id: webhookId })
        .pluck('processing_status'));
    const label = `${status}@${updatedAt ?? 'no-timestamp'}`;
    expect({ webhook: label, httpStatus: res.status, recorded: ledger.length })
      .toEqual({ webhook: label, httpStatus: 200, recorded: 1 });
  }

  const shopVariantCount = (shopId: number) =>
    withTenant(shopId, async (trx) =>
      Number((await trx('variants').where({ shop_id: shopId }).count('* as c').first())?.c ?? 0));

  /** ACTIVE@T1 ingest, then ARCHIVED@T3 applied via verified webhook; returns that baseline. */
  async function archivedAtT3(label: string) {
    const { shopId, shopDomain } = await provisionCatalogShop(label);
    const productId = numericId();
    const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }, { variantId: numericId(), cost: '6.00' }];
    const edge = graphqlEdge(productId, 'ACTIVE', variants);

    await initialSync(shopId, [{ node: { ...edge.node, updatedAt: T1 } }]);
    const active = await catalogState(shopId, productId);
    expect(active.mappings).toHaveLength(2);
    expect(active.parents.map((p: any) => p.status)).toEqual(active.parentIds.map(() => 'active'));
    const identity = identitySnapshot(active);
    for (const row of identity) expect(row.lasyncro_barcode).toMatch(LSP_PATTERN);

    await deliverProductsUpdate(shopId, shopDomain, productId, 'archived', variants, T3);
    const archived = await catalogState(shopId, productId);
    expect(archived.parents.map((p: any) => p.status)).toEqual(archived.parentIds.map(() => 'archived'));
    expect(archived.parentIds).toEqual(active.parentIds);
    expect(identitySnapshot(archived)).toEqual(identity);

    return {
      shopId, shopDomain, productId, variants,
      parentIds: active.parentIds,
      identity,
      counts: await productCounts(shopId),
      variantCount: await shopVariantCount(shopId),
    };
  }

  async function expectAuthoritative(
    base: Awaited<ReturnType<typeof archivedAtT3>>,
    replay: string,
    expected: 'active' | 'draft' | 'archived',
  ) {
    const after = await catalogState(base.shopId, base.productId);
    expect({ replay, parentStatuses: after.parents.map((p: any) => p.status) })
      .toEqual({ replay, parentStatuses: base.parentIds.map(() => expected) });
    expect(after.parentIds).toEqual(base.parentIds);
    expect(identitySnapshot(after)).toEqual(base.identity);

    const counts = await productCounts(base.shopId);
    expect(counts.total - base.counts.total).toBe(0);
    expect(counts.orphans - base.counts.orphans).toBe(0);
    expect((await shopVariantCount(base.shopId)) - base.variantCount).toBe(0);
  }

  it('R18a — a conflicting ACTIVE update with an equal source timestamp does not displace ARCHIVED; a strictly newer ACTIVE does', async () => {
    const base = await archivedAtT3('r18a');

    // Different event (distinct webhook id), same source timestamp, conflicting state.
    await deliverProductsUpdate(base.shopId, base.shopDomain, base.productId, 'active', base.variants, T3);
    await expectAuthoritative(base, `equal-timestamp active@${T3} after archived@${T3}`, 'archived');

    await deliverProductsUpdate(base.shopId, base.shopDomain, base.productId, 'active', base.variants, T3_PLUS_1M);
    await expectAuthoritative(base, `newer active@${T3_PLUS_1M} after archived@${T3}`, 'active');
  });

  it('R18b — a DRAFT update without any source timestamp does not displace a known ARCHIVED@T3 version', async () => {
    const base = await archivedAtT3('r18b');

    await deliverProductsUpdate(base.shopId, base.shopDomain, base.productId, 'draft', base.variants, null);
    await expectAuthoritative(base, `timestamp-free draft after archived@${T3}`, 'archived');
  });
});

// ── R19: TENANT-SCOPED FRESHNESS WATERMARK (A2.2) ──────────────────────────

/**
 * Two independently provisioned tenants carry the SAME external Shopify
 * product id with different source timestamps. One tenant's watermark must
 * neither suppress nor overwrite the other's product state; each tenant sees
 * only its own watermark (forced RLS, restricted runtime role).
 */
it('R19 — a freshness watermark is tenant-scoped: one shop never suppresses or overwrites another shop with the same Shopify product id', async () => {
  const T1 = '2026-09-01T10:00:00Z';
  const T2 = '2026-09-02T10:00:00Z';
  const T3 = '2026-09-03T10:00:00Z';
  const productId = numericId();
  const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }, { variantId: numericId(), cost: '6.00' }];
  const edgeAt = (status: ShopifyStatus, updatedAt: string) => {
    const edge = graphqlEdge(productId, status, variants);
    return { node: { ...edge.node, updatedAt } };
  };
  const shopA = await provisionCatalogShop('r19a');
  const shopB = await provisionCatalogShop('r19b');

  // Shop A holds the newer watermark (T3) for the shared external id.
  await initialSync(shopA.shopId, [edgeAt('ACTIVE', T3)]);
  const aActive = await catalogState(shopA.shopId, productId);
  expect(aActive.parents.map((p: any) => p.status)).toEqual(['active']);

  // Shop B's older T1 ingest is not suppressed by A's T3 watermark.
  await initialSync(shopB.shopId, [edgeAt('ACTIVE', T1)]);
  const bActive = await catalogState(shopB.shopId, productId);
  expect(bActive.mappings).toHaveLength(2);
  expect(bActive.parents.map((p: any) => p.status)).toEqual(['active']);
  expect(bActive.parentIds.filter((id: string) => aActive.parentIds.includes(id))).toEqual([]);

  // B@T2 applies for B (newer than B's own T1); the same T2 is stale for A.
  await productsUpdateWebhook(shopB.shopId, shopB.shopDomain, { ...restProduct(productId, 'archived', variants), updated_at: T2 });
  await productsUpdateWebhook(shopA.shopId, shopA.shopDomain, { ...restProduct(productId, 'archived', variants), updated_at: T2 });

  const aAfter = await catalogState(shopA.shopId, productId);
  const bAfter = await catalogState(shopB.shopId, productId);
  expect({ a: aAfter.parents.map((p: any) => p.status), b: bAfter.parents.map((p: any) => p.status) })
    .toEqual({ a: ['active'], b: ['archived'] });
  expect(identitySnapshot(aAfter)).toEqual(identitySnapshot(aActive));
  expect(identitySnapshot(bAfter)).toEqual(identitySnapshot(bActive));

  // Unfiltered by shop: forced RLS alone scopes each tenant to its own watermark.
  const visibleWatermarks = (shopId: number) =>
    withTenant(shopId, (trx) =>
      trx('shopify_product_source_watermarks')
        .where({ platform: 'shopify', external_product_id: productGid(productId) })
        .select('shop_id', 'source_updated_at'))
      .then((rows: any[]) => rows.map((r) => ({ shop_id: Number(r.shop_id), at: new Date(r.source_updated_at).toISOString() })));

  expect(await visibleWatermarks(shopA.shopId)).toEqual([{ shop_id: shopA.shopId, at: '2026-09-03T10:00:00.000Z' }]);
  expect(await visibleWatermarks(shopB.shopId)).toEqual([{ shop_id: shopB.shopId, at: '2026-09-02T10:00:00.000Z' }]);
});

// ── R20: DELETE-BEFORE-CREATE (A2.2) ───────────────────────────────────────

/**
 * Shopify may deliver products/delete before a delayed products/create for the
 * same product. A verified deletion of a never-ingested external id must still
 * be terminal for that id in its own shop: the later, older create must not
 * invent a commercially active product, nor any variant, mapping, LSP barcode
 * or orphan parent for the deleted identity. The deletion is invisible to
 * another tenant carrying the same external id. The tombstone representation
 * is deliberately not prescribed.
 */
it('R20 — a products/delete delivered before a delayed products/create keeps the never-ingested Shopify product deleted', async () => {
  const T1 = '2026-09-01T10:00:00Z';
  const savedWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret || 'gh1262-test-webhook-secret';
  try {
    /** Verified delivery through the real HTTP endpoint — R15 pattern. */
    const deliver = async (shopId: number, shopDomain: string, topic: string, payload: unknown) => {
      const webhookId = `gh1262-r20-${crypto.randomUUID()}`;
      const rawBody = JSON.stringify(payload);
      const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
        .update(Buffer.from(rawBody, 'utf8')).digest('base64');
      const res = await request(app)
        .post('/api/v1/shopify/webhooks')
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Topic', topic)
        .set('X-Shopify-Shop-Domain', shopDomain)
        .set('X-Shopify-Webhook-Id', webhookId)
        .set('X-Shopify-Hmac-Sha256', hmac)
        .send(rawBody);
      const ledger = await withTenant(shopId, (trx) =>
        trx('integration_webhook_events')
          .where({ integration: 'shopify', external_event_id: webhookId })
          .pluck('processing_status'));
      return { httpStatus: res.status, body: res.body, ledger };
    };

    /** Shop-wide parent / orphan / variant / LSP barcode counts. */
    const shopCounts = async (shopId: number) => {
      const products = await productCounts(shopId);
      return withTenant(shopId, async (trx) => {
        const variants = await trx('variants').where({ shop_id: shopId }).count('* as c').first();
        const barcodes = await trx('variants').where({ shop_id: shopId })
          .whereNotNull('lasyncro_barcode').count('* as c').first();
        return { ...products, variants: Number(variants?.c ?? 0), lspBarcodes: Number(barcodes?.c ?? 0) };
      });
    };

    const shopA = await provisionCatalogShop('r20a');
    const shopB = await provisionCatalogShop('r20b');
    const productId = numericId();
    const variants: VariantSpec[] = [{ variantId: numericId() }, { variantId: numericId() }];
    const delayedCreate = { ...restProduct(productId, 'active', variants), updated_at: T1 };

    // Previously unseen in both tenants.
    expect((await catalogState(shopA.shopId, productId)).mappings).toEqual([]);
    expect((await catalogState(shopB.shopId, productId)).mappings).toEqual([]);
    const baseA = await shopCounts(shopA.shopId);
    const baseB = await shopCounts(shopB.shopId);

    // 1. Verified products/delete for the unseen product: processed, nothing invented.
    const deletion = await deliver(shopA.shopId, shopA.shopDomain, 'products/delete', { id: Number(productId) });
    const afterDelete = await catalogState(shopA.shopId, productId);
    expect({
      deletion,
      mappings: afterDelete.mappings,
      variants: afterDelete.variants,
      parents: afterDelete.parents,
      counts: await shopCounts(shopA.shopId),
    }).toEqual({
      deletion: { httpStatus: 200, body: { status: 'ok' }, ledger: ['processed'] },
      mappings: [],
      variants: [],
      parents: [],
      counts: baseA,
    });

    // 2. Tenant isolation: shop A's deletion does not reach shop B, whose
    //    products/create for the same external id ingests normally.
    const createB = await deliver(shopB.shopId, shopB.shopDomain, 'products/create', delayedCreate);
    const stateB = await catalogState(shopB.shopId, productId);
    expect({
      httpStatus: createB.httpStatus,
      recorded: createB.ledger.length,
      mappings: stateB.mappings.length,
      parentStatuses: stateB.parents.map((p: any) => p.status),
    }).toEqual({ httpStatus: 200, recorded: 1, mappings: 2, parentStatuses: ['active'] });
    for (const v of stateB.variants) expect(v.lasyncro_barcode).toMatch(LSP_PATTERN);
    expect((await shopCounts(shopB.shopId)).orphans - baseB.orphans).toBe(0);

    // 3. Distinct, older, delayed products/create for the deleted id in shop A.
    const createA = await deliver(shopA.shopId, shopA.shopDomain, 'products/create', delayedCreate);
    const stateA = await catalogState(shopA.shopId, productId);
    const countsA = await shopCounts(shopA.shopId);
    expect({
      httpStatus: createA.httpStatus,
      recorded: createA.ledger.length,
      activeParents: stateA.parents.filter((p: any) => p.status === 'active').map((p: any) => p.lasyncro_product_id),
      mappings: stateA.mappings.length,
      lspBarcodes: stateA.variants.map((v: any) => v.lasyncro_barcode).filter(Boolean),
      parentDelta: countsA.total - baseA.total,
      orphanDelta: countsA.orphans - baseA.orphans,
      variantDelta: countsA.variants - baseA.variants,
      lspBarcodeDelta: countsA.lspBarcodes - baseA.lspBarcodes,
    }).toEqual({
      httpStatus: 200,
      recorded: 1,
      activeParents: [],
      mappings: 0,
      lspBarcodes: [],
      parentDelta: 0,
      orphanDelta: 0,
      variantDelta: 0,
      lspBarcodeDelta: 0,
    });
  } finally {
    if (savedWebhookSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret;
  }
});

// ── R21: EQUAL-TIMESTAMP RECONCILIATION (A2.2 B1) ──────────────────────────

/**
 * Two distinct Shopify product states can carry the same source timestamp,
 * and webhook arrival order is not source order. An equal-timestamp conflict
 * must therefore never be applied, and never be silently dropped: it records
 * one durable, coalesced reconciliation obligation for the product. A worker
 * claims it per tenant (unique claim token, generation, DB-time lease),
 * fetches the authoritative current product from Shopify OUTSIDE any catalog
 * transaction, and applies it only while token, generation and live lease all
 * still hold, through the existing freshness / tombstone rules.
 *
 * Ratified service contract (api-src/services/shopify/shopifyProductReconciliation.service):
 *   listProductReconciliationTenants({ limit, ...options })   shop ids only
 *   claimProductReconciliation({ shopId, ...options })         one tenant, FORCE RLS
 *   processProductReconciliationClaim(claim, deps, options)    fetch → fenced apply | fenced failure
 *   readProductReconciliationState(shopId, gid, options)       tenant-scoped observability
 *   PRODUCT_RECONCILIATION_LEASE_MS / _MAX_ATTEMPTS / _BACKOFF_BASE_MS / _BACKOFF_CAP_MS
 * Lease and backoff run on database time. Test-only option values shorten the
 * windows; waits are bounded polls against database state, never mocked time.
 * Provider access is only through injected deps (resolveCredential,
 * createClient); the ISOLATION case proves no real provider call.
 */
type ReconciliationOptions = {
  leaseMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
};
type ReconciliationClaim = {
  shopId: number;
  externalProductId: string;
  generation: number;
  claimToken: string;
  attempts: number;
};
type ReconciliationState = {
  pending: boolean;
  generation: number;
  attempts: number;
  lastError: string | null;
  claimed: boolean;
  exhausted: boolean;
};
type ReconciliationOutcome = {
  kind: 'APPLIED' | 'STALE_SKIPPED' | 'TOMBSTONED' | 'SUPERSEDED' | 'AUTHORITY_LOST' | 'FAILED';
  errorCode?: string;
};
type ShopifyGraphqlStub = { request: (query: string, opts?: any) => Promise<{ data?: any }> };
type ReconciliationDeps = {
  now?: Date;
  resolveCredential: (input: { shopId: number; now: Date }) => Promise<any>;
  createClient: (input: { accessToken: string; shopDomain: string; shopId: number }) => ShopifyGraphqlStub;
};
type ReconciliationService = {
  PRODUCT_RECONCILIATION_LEASE_MS: number;
  PRODUCT_RECONCILIATION_MAX_ATTEMPTS: number;
  PRODUCT_RECONCILIATION_BACKOFF_BASE_MS: number;
  PRODUCT_RECONCILIATION_BACKOFF_CAP_MS: number;
  listProductReconciliationTenants: (input: { limit?: number } & ReconciliationOptions) => Promise<number[]>;
  claimProductReconciliation: (input: { shopId: number } & ReconciliationOptions) => Promise<ReconciliationClaim | null>;
  processProductReconciliationClaim: (
    claim: ReconciliationClaim, deps: ReconciliationDeps, options?: ReconciliationOptions) => Promise<ReconciliationOutcome>;
  readProductReconciliationState: (
    shopId: number, externalProductId: string, options?: ReconciliationOptions) => Promise<ReconciliationState | null>;
};

const RECONCILIATION_SERVICE_MODULE = 'api-src/services/shopify/shopifyProductReconciliation.service';

async function loadReconciliationService(): Promise<ReconciliationService> {
  try {
    return (await import(RECONCILIATION_SERVICE_MODULE)) as ReconciliationService;
  } catch (err) {
    throw new Error(
      `MISSING_PREREQUISITE: ${RECONCILIATION_SERVICE_MODULE} — ${String((err as Error)?.message ?? err).replace(/\s+/g, ' ').trim()}`);
  }
}

describe('R21 — equal-timestamp conflicts are reconciled from an authoritative Shopify snapshot', () => {
  const T1 = '2026-09-01T10:00:00Z';
  const T3 = '2026-09-03T10:00:00Z';
  const T4 = '2026-09-04T10:00:00Z';
  /** Test-only windows (approved): 1s backoff, 1.5s lease for claims meant to expire. */
  const FAST_RETRY: ReconciliationOptions = { backoffBaseMs: 1_000, backoffCapMs: 1_000 };
  const SHORT_LEASE: ReconciliationOptions = { leaseMs: 1_500 };

  let savedWebhookSecret: string | undefined;

  beforeAll(() => {
    savedWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret || 'gh1262-test-webhook-secret';
  });

  afterAll(() => {
    if (savedWebhookSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret;
  });

  /** Verified delivery through the real HTTP endpoint (R15 pattern); webhookId reusable for redelivery. */
  async function deliver(shopId: number, shopDomain: string, topic: string, payload: unknown, webhookId = `gh1262-r21-${crypto.randomUUID()}`) {
    const rawBody = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
      .update(Buffer.from(rawBody, 'utf8')).digest('base64');
    const res = await request(app)
      .post('/api/v1/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Topic', topic)
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', webhookId)
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(rawBody);
    const ledger = await withTenant(shopId, (trx) =>
      trx('integration_webhook_events')
        .where({ integration: 'shopify', external_event_id: webhookId })
        .pluck('processing_status'));
    expect({ topic, httpStatus: res.status, recorded: ledger.length })
      .toEqual({ topic, httpStatus: 200, recorded: 1 });
    return webhookId;
  }

  const productsUpdate = (base: { shopId: number; shopDomain: string; productId: string; variants: VariantSpec[] },
    status: 'active' | 'draft' | 'archived', updatedAt: string, webhookId?: string) =>
    deliver(base.shopId, base.shopDomain, 'products/update',
      { ...restProduct(base.productId, status, base.variants), updated_at: updatedAt }, webhookId);

  const shopVariantCount = (shopId: number) =>
    withTenant(shopId, async (trx) =>
      Number((await trx('variants').where({ shop_id: shopId }).count('* as c').first())?.c ?? 0));

  /** Real installation authority per shop domain (C3: every apply re-verifies it). */
  const authorityByDomain = new Map<string, { installationId: number; generation: string }>();

  /**
   * ACTIVE offline credential for the shop's existing installation (canonical
   * shopify-sync-authority.fixture pattern; synthetic material, no provider call).
   */
  async function seedInstallationAuthority(shopId: number, shopDomain: string) {
    process.env.ENCRYPTION_KEY ||= 'offline-lifecycle-fixture-encryption-key-2026';
    const authority = await withTenant(shopId, async (trx) => {
      const installation = await trx('shopify_app_installations')
        .where({ shop_id: shopId, shop_domain: shopDomain }).first('id');
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
    authorityByDomain.set(shopDomain, authority);
    return authority;
  }

  /** ACTIVE@T1 ingest, then ARCHIVED@T3 applied via verified webhook (R18 baseline shape). */
  async function archivedAtT3(label: string, productId = numericId()) {
    const { shopId, shopDomain } = await provisionCatalogShop(label);
    const authority = await seedInstallationAuthority(shopId, shopDomain);
    const variants: VariantSpec[] = [{ variantId: numericId(), cost: '5.00' }, { variantId: numericId(), cost: '6.00' }];
    const edge = graphqlEdge(productId, 'ACTIVE', variants);
    await initialSync(shopId, [{ node: { ...edge.node, updatedAt: T1 } }]);
    const base = { shopId, shopDomain, productId, variants };
    await productsUpdate(base, 'archived', T3);

    const state = await catalogState(shopId, productId);
    expect(state.parents.map((p: any) => p.status)).toEqual(state.parentIds.map(() => 'archived'));
    const identity = identitySnapshot(state);
    for (const row of identity) expect(row.lasyncro_barcode).toMatch(LSP_PATTERN);
    return {
      ...base,
      authority,
      gid: productGid(productId),
      parentIds: state.parentIds,
      identity,
      counts: await productCounts(shopId),
      variantCount: await shopVariantCount(shopId),
    };
  }
  type Base = Awaited<ReturnType<typeof archivedAtT3>>;

  /** Base with one committed equal-timestamp conflict (ACTIVE@T3 against ARCHIVED@T3). */
  async function conflicted(label: string, productId?: string) {
    const base = await archivedAtT3(label, productId);
    await productsUpdate(base, 'active', T3);
    return base;
  }

  /** Parent statuses + identity + no new parent / orphan / variant. */
  async function expectCatalog(base: Base, step: string, status: 'active' | 'archived' | 'deleted') {
    const after = await catalogState(base.shopId, base.productId);
    expect({ step, parentStatuses: after.parents.map((p: any) => p.status) })
      .toEqual({ step, parentStatuses: base.parentIds.map(() => status) });
    expect(after.parentIds).toEqual(base.parentIds);
    expect(identitySnapshot(after)).toEqual(base.identity);
    const counts = await productCounts(base.shopId);
    expect({ step, parentDelta: counts.total - base.counts.total, orphanDelta: counts.orphans - base.counts.orphans,
      variantDelta: (await shopVariantCount(base.shopId)) - base.variantCount })
      .toEqual({ step, parentDelta: 0, orphanDelta: 0, variantDelta: 0 });
  }

  /** Authoritative GraphQL product node, as Shopify's product(id:) returns it. */
  function snapshotNode(productId: string, status: ShopifyStatus, variants: VariantSpec[], updatedAt: string,
    pageInfo: unknown = { hasNextPage: false, endCursor: null }) {
    const { node } = graphqlEdge(productId, status, variants);
    return { ...node, updatedAt, variants: { ...node.variants, pageInfo } };
  }

  /** Injected Shopify client: records every request; `respond` decides the response. */
  function stubShopify(respond: (variables: any, call: number) => unknown) {
    const calls: any[] = [];
    const client: ShopifyGraphqlStub = {
      request: async (_query: string, opts?: any) => {
        calls.push(opts?.variables ?? {});
        return (await respond(opts?.variables ?? {}, calls.length)) as { data?: any };
      },
    };
    return { calls, client };
  }

  const ready = (shopDomain: string) => async () => {
    const authority = authorityByDomain.get(shopDomain);
    if (!authority) throw new Error(`GH1262_R21_NO_AUTHORITY ${shopDomain}`);
    return {
      kind: 'READY', accessToken: 'gh1262-test-access-token', shopDomain,
      installationId: authority.installationId, generation: authority.generation,
    };
  };

  function deps(shopDomain: string, client: ShopifyGraphqlStub): ReconciliationDeps {
    return { resolveCredential: ready(shopDomain), createClient: () => client };
  }

  /** Bounded poll of database-backed state; never a fixed sleep. */
  async function waitUntil<T>(probe: () => Promise<T | null | false>, label: string, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await probe();
      if (value) return value as T;
      if (Date.now() >= deadline) throw new Error(`GH1262_R21_WAIT_TIMEOUT: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Negative window on database time (proves something does NOT become claimable). */
  const dbSleep = (ms: number) => systemQuery(db.raw('SELECT pg_sleep(?)', [ms / 1000]));

  /** Concurrency barrier: holds the product advisory lock until released. */
  function holdProductLock(shopId: number, gid: string) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let markHeld!: () => void;
    const held = new Promise<void>((resolve) => { markHeld = resolve; });
    const done = withTenant(shopId, async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [
        'shopify_catalog_product', `${shopId}:${gid}`,
      ]);
      markHeld();
      await released;
    });
    return { held, release, done };
  }

  const advisoryWaiters = async () => {
    const result = await systemQuery(db.raw(
      "SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"));
    return Number(result.rows?.[0]?.waiting ?? 0);
  };

  it('R21a — an equal-timestamp conflict records one durable, coalesced obligation without catalog writes; a duplicate delivery adds no work', async () => {
    const base = await archivedAtT3('r21a');

    // Distinct event, same source timestamp, conflicting state: never applied.
    const webhookId = await productsUpdate(base, 'active', T3);
    await expectCatalog(base, `equal-timestamp active@${T3}`, 'archived');

    const svc = await loadReconciliationService();
    const first = await svc.readProductReconciliationState(base.shopId, base.gid);
    expect(first).toMatchObject({ pending: true, attempts: 0, claimed: false, exhausted: false });

    // Shopify redelivery of the SAME webhook id: ledger duplicate, no new work.
    await productsUpdate(base, 'active', T3, webhookId);
    expect(await svc.readProductReconciliationState(base.shopId, base.gid)).toEqual(first);

    // A further distinct equal conflict coalesces into the same obligation.
    await productsUpdate(base, 'draft', T3);
    const coalesced = await svc.readProductReconciliationState(base.shopId, base.gid);
    expect(coalesced).toMatchObject({ pending: true, attempts: 0, claimed: false });
    expect(coalesced!.generation).toBeGreaterThan(first!.generation);
    await expectCatalog(base, `coalesced draft@${T3}`, 'archived');

    // Discovery returns shop ids only, and includes this tenant.
    const tenants = await svc.listProductReconciliationTenants({ limit: 100 });
    expect(tenants.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
    expect(tenants).toContain(base.shopId);

    // Exactly one claimable unit of work for the product.
    const claim = await svc.claimProductReconciliation({ shopId: base.shopId });
    expect(claim).toMatchObject({ shopId: base.shopId, externalProductId: base.gid, generation: coalesced!.generation });
    expect(claim!.claimToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(await svc.claimProductReconciliation({ shopId: base.shopId })).toBeNull();
  });

  it('R21b — an authoritative equal-timestamp Shopify snapshot resolves the conflict without changing product or variant identity', async () => {
    const base = await conflicted('r21b');
    const svc = await loadReconciliationService();
    const claim = await svc.claimProductReconciliation({ shopId: base.shopId });
    expect(claim).not.toBeNull();

    const shopify = stubShopify(() => ({ data: { product: snapshotNode(base.productId, 'ACTIVE', base.variants, T3) } }));
    const outcome = await svc.processProductReconciliationClaim(claim!, deps(base.shopDomain, shopify.client));

    expect(outcome.kind).toBe('APPLIED');
    expect(shopify.calls[0]).toMatchObject({ id: base.gid });
    await expectCatalog(base, `authoritative active@${T3}`, 'active');
    expect(await svc.readProductReconciliationState(base.shopId, base.gid))
      .toMatchObject({ pending: false, claimed: false });
  });

  it('R21c — a snapshot older than a watermark committed during the fetch cannot overwrite the newer state', async () => {
    const base = await conflicted('r21c');
    const svc = await loadReconciliationService();
    const claim = await svc.claimProductReconciliation({ shopId: base.shopId });
    expect(claim).not.toBeNull();

    // A strictly newer ARCHIVED@T4 commits while the provider fetch is in flight
    // (this also requires that no catalog transaction or product lock is held).
    const shopify = stubShopify(async (_v, call) => {
      if (call === 1) await productsUpdate(base, 'archived', T4);
      return { data: { product: snapshotNode(base.productId, 'ACTIVE', base.variants, T3) } };
    });
    const outcome = await svc.processProductReconciliationClaim(claim!, deps(base.shopDomain, shopify.client));

    expect(outcome.kind).toBe('STALE_SKIPPED');
    await expectCatalog(base, `snapshot active@${T3} after archived@${T4}`, 'archived');
    expect(await svc.readProductReconciliationState(base.shopId, base.gid))
      .toMatchObject({ pending: false, claimed: false });
  });

  it('R21d — a deletion tombstone committed during the fetch prevents every reconciliation write', async () => {
    const base = await conflicted('r21d');
    const svc = await loadReconciliationService();
    const claim = await svc.claimProductReconciliation({ shopId: base.shopId });
    expect(claim).not.toBeNull();

    const shopify = stubShopify(async (_v, call) => {
      if (call === 1) await deliver(base.shopId, base.shopDomain, 'products/delete', { id: Number(base.productId) });
      return { data: { product: snapshotNode(base.productId, 'ACTIVE', base.variants, T3) } };
    });
    const outcome = await svc.processProductReconciliationClaim(claim!, deps(base.shopDomain, shopify.client));

    expect(outcome.kind).toBe('TOMBSTONED');
    await expectCatalog(base, `snapshot active@${T3} after products/delete`, 'deleted');
    expect(await svc.readProductReconciliationState(base.shopId, base.gid))
      .toMatchObject({ pending: false, claimed: false });
  });

  it('R21e — a new generation during the fetch invalidates the old claim before any catalog write; lock order holds under real overlap', async () => {
    const base = await conflicted('r21e');
    const svc = await loadReconciliationService();
    const first = await svc.claimProductReconciliation({ shopId: base.shopId });
    expect(first).not.toBeNull();

    // Another equal-timestamp conflict commits while generation N is being fetched.
    const inFlight = stubShopify(async (_v, call) => {
      if (call === 1) await productsUpdate(base, 'draft', T3);
      return { data: { product: snapshotNode(base.productId, 'ACTIVE', base.variants, T3) } };
    });
    expect((await svc.processProductReconciliationClaim(first!, deps(base.shopDomain, inFlight.client))).kind)
      .toBe('SUPERSEDED');

    // The old snapshot was NOT applied; the newer generation stays pending, unclaimed.
    await expectCatalog(base, `superseded generation ${first!.generation}`, 'archived');
    const afterFirst = await svc.readProductReconciliationState(base.shopId, base.gid);
    expect(afterFirst).toMatchObject({ pending: true, claimed: false, attempts: 0 });
    expect(afterFirst!.generation).toBe(first!.generation + 1);

    // Another worker fetches again for the newer generation, with a new token.
    const second = await svc.claimProductReconciliation({ shopId: base.shopId });
    expect(second).toMatchObject({ generation: afterFirst!.generation });
    expect(second!.claimToken).not.toBe(first!.claimToken);
    const latest = stubShopify(() => ({ data: { product: snapshotNode(base.productId, 'ACTIVE', base.variants, T3) } }));
    expect((await svc.processProductReconciliationClaim(second!, deps(base.shopDomain, latest.client))).kind).toBe('APPLIED');
    await expectCatalog(base, `authoritative active@${T3} for generation ${second!.generation}`, 'active');
    expect(await svc.readProductReconciliationState(base.shopId, base.gid))
      .toMatchObject({ pending: false, claimed: false });

    // REAL OVERLAP: an apply and an equal-timestamp webhook for the same product
    // both queue behind a held product lock, then race. Shared lock order means
    // both finish (no 40P01) and the newer generation is never lost.
    await productsUpdate(base, 'archived', T3);
    const third = await svc.claimProductReconciliation({ shopId: base.shopId });
    expect(third).not.toBeNull();
    const barrier = holdProductLock(base.shopId, base.gid);
    await barrier.held;
    const waitersBefore = await advisoryWaiters();
    const racing = Promise.allSettled([
      svc.processProductReconciliationClaim(third!, deps(base.shopDomain,
        stubShopify(() => ({ data: { product: snapshotNode(base.productId, 'ARCHIVED', base.variants, T3) } })).client)),
      productsUpdate(base, 'draft', T3),
    ]);
    await waitUntil(async () => (await advisoryWaiters()) >= waitersBefore + 2, 'apply and webhook both waiting on the product lock');
    barrier.release();
    await barrier.done;
    const [applyResult, webhookResult] = await racing;
    expect({ apply: applyResult.status, webhook: webhookResult.status }).toEqual({ apply: 'fulfilled', webhook: 'fulfilled' });
    expect(['APPLIED', 'SUPERSEDED']).toContain((applyResult as PromiseFulfilledResult<ReconciliationOutcome>).value.kind);
    const raced = await svc.readProductReconciliationState(base.shopId, base.gid);
    expect(raced).toMatchObject({ pending: true, claimed: false, generation: third!.generation + 1 });
    const racedCatalog = await catalogState(base.shopId, base.productId);
    expect(identitySnapshot(racedCatalog)).toEqual(base.identity);
  });

  it('R21f — one winner under concurrent claims; an expired lease is reclaimed with a new token; the old token can neither apply, complete nor fail; newer pending work survives the interruption', async () => {
    const base = await conflicted('r21f');
    const svc = await loadReconciliationService();

    // Four concurrent claims for the same tenant: exactly one owner.
    const contenders = await Promise.all(
      [0, 1, 2, 3].map(() => svc.claimProductReconciliation({ shopId: base.shopId, ...SHORT_LEASE })));
    const winners = contenders.filter((c): c is ReconciliationClaim => c !== null);
    expect(winners).toHaveLength(1);
    const stale = winners[0];
    expect(await svc.claimProductReconciliation({ shopId: base.shopId })).toBeNull();

    // The owner is interrupted (never processes); a newer conflict arrives meanwhile.
    await productsUpdate(base, 'draft', T3);

    // Lease expires on DB time; the work is reclaimed with a NEW token at the NEWER generation.
    await waitUntil(async () => !(await svc.readProductReconciliationState(base.shopId, base.gid))!.claimed,
      'short lease expiry');
    const fresh = await svc.claimProductReconciliation({ shopId: base.shopId });
    expect(fresh).toMatchObject({ shopId: base.shopId, externalProductId: base.gid, generation: stale.generation + 1 });
    expect(fresh!.claimToken).not.toBe(stale.claimToken);
    const owned = await svc.readProductReconciliationState(base.shopId, base.gid);
    expect(owned).toMatchObject({ pending: true, claimed: true, attempts: 0 });

    // The superseded token cannot apply / complete…
    const success = stubShopify(() => ({ data: { product: snapshotNode(base.productId, 'ACTIVE', base.variants, T3) } }));
    expect((await svc.processProductReconciliationClaim(stale, deps(base.shopDomain, success.client))).kind).toBe('SUPERSEDED');
    await expectCatalog(base, 'superseded token apply', 'archived');
    expect(await svc.readProductReconciliationState(base.shopId, base.gid)).toEqual(owned);

    // …nor fail the newer claim through a provider or credential failure.
    const failing = stubShopify(() => { throw new Error('GH1262_R21F_PROVIDER_DOWN'); });
    expect((await svc.processProductReconciliationClaim(stale, deps(base.shopDomain, failing.client))).kind).toBe('SUPERSEDED');
    expect((await svc.processProductReconciliationClaim(stale, {
      resolveCredential: async () => ({ kind: 'RETRYABLE' }), createClient: () => failing.client,
    })).kind).toBe('SUPERSEDED');
    expect(await svc.readProductReconciliationState(base.shopId, base.gid)).toEqual(owned);

    // The current owner completes the newer generation.
    expect((await svc.processProductReconciliationClaim(fresh!, deps(base.shopDomain, success.client))).kind).toBe('APPLIED');
    await expectCatalog(base, 'current owner completion', 'active');
    expect(await svc.readProductReconciliationState(base.shopId, base.gid))
      .toMatchObject({ pending: false, claimed: false });
  });

  it('R21g — provider failure, credential RETRYABLE and a null product stay durable and observable, retry with backoff, and exhaust at the bound without a tombstone', async () => {
    const base = await conflicted('r21g');
    const svc = await loadReconciliationService();
    expect({
      lease: svc.PRODUCT_RECONCILIATION_LEASE_MS,
      max: svc.PRODUCT_RECONCILIATION_MAX_ATTEMPTS,
      base: svc.PRODUCT_RECONCILIATION_BACKOFF_BASE_MS,
      cap: svc.PRODUCT_RECONCILIATION_BACKOFF_CAP_MS,
    }).toEqual({ lease: 300_000, max: 8, base: 5_000, cap: 300_000 });
    const max = svc.PRODUCT_RECONCILIATION_MAX_ATTEMPTS;
    const claimWhenDue = () => waitUntil(
      () => svc.claimProductReconciliation({ shopId: base.shopId, ...FAST_RETRY }), 'claim after backoff');

    // 1. Provider error: durable, sanitized, and not immediately reclaimable.
    const c1 = await svc.claimProductReconciliation({ shopId: base.shopId, ...FAST_RETRY });
    const providerDown = stubShopify(() => { throw new Error('GH1262_R21G_PROVIDER_DOWN secret-ish detail'); });
    expect((await svc.processProductReconciliationClaim(c1!, deps(base.shopDomain, providerDown.client), FAST_RETRY)).kind)
      .toBe('FAILED');
    const s1 = await svc.readProductReconciliationState(base.shopId, base.gid, FAST_RETRY);
    expect(s1).toMatchObject({ pending: true, attempts: 1, claimed: false, exhausted: false, lastError: 'SHOPIFY_PROVIDER_ERROR' });
    expect(await svc.claimProductReconciliation({ shopId: base.shopId, ...FAST_RETRY })).toBeNull();
    expect(await svc.listProductReconciliationTenants({ limit: 100, ...FAST_RETRY })).not.toContain(base.shopId);

    // 2. Credential RETRYABLE: no provider request is attempted.
    const c2 = await claimWhenDue();
    const untouched = stubShopify(() => { throw new Error('GH1262_R21G_MUST_NOT_FETCH'); });
    expect((await svc.processProductReconciliationClaim(c2, {
      resolveCredential: async () => ({ kind: 'RETRYABLE' }), createClient: () => untouched.client,
    }, FAST_RETRY)).kind).toBe('FAILED');
    expect(untouched.calls).toEqual([]);
    expect(await svc.readProductReconciliationState(base.shopId, base.gid, FAST_RETRY))
      .toMatchObject({ pending: true, attempts: 2, lastError: 'SHOPIFY_CREDENTIAL_RETRYABLE', exhausted: false });

    // 3. product(id:) returns null: a bounded failure, never a deletion tombstone.
    const missing = stubShopify(() => ({ data: { product: null } }));
    for (let attempts = 3; attempts <= max; attempts++) {
      const claim = await claimWhenDue();
      expect((await svc.processProductReconciliationClaim(claim, deps(base.shopDomain, missing.client), FAST_RETRY)).kind)
        .toBe('FAILED');
      expect(await svc.readProductReconciliationState(base.shopId, base.gid, FAST_RETRY))
        .toMatchObject({ pending: true, attempts, lastError: 'SHOPIFY_PRODUCT_NOT_FOUND', exhausted: attempts >= max });
    }

    // Exhausted: still pending and visible, never claimable or discoverable again.
    await dbSleep(1_500);
    expect(await svc.claimProductReconciliation({ shopId: base.shopId, ...FAST_RETRY })).toBeNull();
    expect(await svc.listProductReconciliationTenants({ limit: 100, ...FAST_RETRY })).not.toContain(base.shopId);
    expect(await svc.readProductReconciliationState(base.shopId, base.gid, FAST_RETRY))
      .toMatchObject({ pending: true, attempts: max, exhausted: true, claimed: false });

    await expectCatalog(base, 'after bounded failures', 'archived');
    const tombstones = await withTenant(base.shopId, (trx) =>
      trx('shopify_product_source_watermarks')
        .where({ shop_id: base.shopId, platform: 'shopify', external_product_id: base.gid })
        .pluck('is_deleted'));
    expect(tombstones).toEqual([false]);
  });

  it('R21h — one tenant cannot discover, claim, read, complete or fail another tenant\'s reconciliation', async () => {
    const productId = numericId();
    const shopB = await conflicted('r21h-b', productId);
    const shopA = await archivedAtT3('r21h-a', productId);
    const svc = await loadReconciliationService();

    // Only B has work: A's claim and state never see it.
    expect(await svc.claimProductReconciliation({ shopId: shopA.shopId })).toBeNull();
    expect(await svc.readProductReconciliationState(shopA.shopId, shopA.gid)).toMatchObject({ pending: false });
    expect(await svc.readProductReconciliationState(shopB.shopId, shopB.gid)).toMatchObject({ pending: true });
    const tenants = await svc.listProductReconciliationTenants({ limit: 100 });
    expect(tenants).toContain(shopB.shopId);
    expect(tenants).not.toContain(shopA.shopId);

    // Forced RLS: tenant A's context sees none of B's watermark / obligation rows.
    const crossTenantRows = await withTenant(shopA.shopId, (trx) =>
      trx('shopify_product_source_watermarks').where({ shop_id: shopB.shopId }).count('* as c').first());
    expect(Number(crossTenantRows?.c ?? 0)).toBe(0);

    await productsUpdate(shopA, 'active', T3);
    const claimB = await svc.claimProductReconciliation({ shopId: shopB.shopId });
    expect(claimB).toMatchObject({ shopId: shopB.shopId, externalProductId: shopB.gid });
    const stateA = await svc.readProductReconciliationState(shopA.shopId, shopA.gid);
    const stateB = await svc.readProductReconciliationState(shopB.shopId, shopB.gid);
    expect(stateA).toMatchObject({ pending: true, claimed: false });
    expect(stateB).toMatchObject({ pending: true, claimed: true });

    // B's claim token presented for tenant A applies, completes and fails nothing anywhere.
    const forged = { ...claimB!, shopId: shopA.shopId };
    const success = stubShopify(() => ({ data: { product: snapshotNode(productId, 'ACTIVE', shopB.variants, T3) } }));
    expect((await svc.processProductReconciliationClaim(forged, deps(shopA.shopDomain, success.client))).kind).toBe('SUPERSEDED');
    const failing = stubShopify(() => { throw new Error('GH1262_R21H_PROVIDER_DOWN'); });
    expect((await svc.processProductReconciliationClaim(forged, deps(shopA.shopDomain, failing.client))).kind).toBe('SUPERSEDED');
    expect(await svc.readProductReconciliationState(shopA.shopId, shopA.gid)).toEqual(stateA);
    expect(await svc.readProductReconciliationState(shopB.shopId, shopB.gid)).toEqual(stateB);
    await expectCatalog(shopA, 'forged claim against tenant A', 'archived');

    // The legitimate claim resolves B only.
    expect((await svc.processProductReconciliationClaim(claimB!, deps(shopB.shopDomain, success.client))).kind).toBe('APPLIED');
    await expectCatalog(shopB, 'tenant B resolved', 'active');
    await expectCatalog(shopA, 'tenant A untouched by B', 'archived');
    expect(await svc.readProductReconciliationState(shopA.shopId, shopA.gid)).toEqual(stateA);
  });

  it('R21i — the authoritative fetch paginates every variant and fails closed on a malformed response', async () => {
    const base = await conflicted('r21i');
    const svc = await loadReconciliationService();
    const extra: VariantSpec = { variantId: numericId(), cost: '7.00' };

    // First page: the two known variants, hasNextPage; continuation: the third.
    const claim = await svc.claimProductReconciliation({ shopId: base.shopId });
    const paged = stubShopify((variables) => (variables.cursor
      ? { data: { product: { id: base.gid, variants: {
          edges: graphqlEdge(base.productId, 'ACTIVE', [extra]).node.variants.edges,
          pageInfo: { hasNextPage: false, endCursor: null } } } } }
      : { data: { product: snapshotNode(base.productId, 'ACTIVE', base.variants, T3,
          { hasNextPage: true, endCursor: 'gh1262-r21i-cursor-1' }) } }));
    expect((await svc.processProductReconciliationClaim(claim!, deps(base.shopDomain, paged.client))).kind).toBe('APPLIED');
    expect(paged.calls).toEqual([
      expect.objectContaining({ id: base.gid }),
      expect.objectContaining({ id: base.gid, cursor: 'gh1262-r21i-cursor-1' }),
    ]);
    const paginated = await catalogState(base.shopId, base.productId);
    expect(paginated.mappings).toHaveLength(3);
    expect(paginated.parents.map((p: any) => p.status)).toEqual(base.parentIds.map(() => 'active'));
    expect(identitySnapshot(paginated).filter((r: any) => base.identity.some((b: any) => b.mapping_id === r.mapping_id)))
      .toEqual(base.identity);
    for (const v of paginated.variants) expect(v.lasyncro_barcode).toMatch(LSP_PATTERN);

    // A new equal conflict, then a response whose variants connection lacks pageInfo.
    await productsUpdate({ ...base, variants: [...base.variants, extra] }, 'archived', T3);
    const malformedClaim = await svc.claimProductReconciliation({ shopId: base.shopId });
    const malformedNode = snapshotNode(base.productId, 'ARCHIVED', [...base.variants, extra], T3);
    delete (malformedNode.variants as { pageInfo?: unknown }).pageInfo;
    const malformed = stubShopify(() => ({ data: { product: malformedNode } }));
    const before = await catalogState(base.shopId, base.productId);
    const outcome = await svc.processProductReconciliationClaim(malformedClaim!, deps(base.shopDomain, malformed.client));
    expect(outcome.kind).toBe('FAILED');
    const after = await catalogState(base.shopId, base.productId);
    expect(identitySnapshot(after)).toEqual(identitySnapshot(before));
    expect(after.parents).toEqual(before.parents);
    expect(await svc.readProductReconciliationState(base.shopId, base.gid))
      .toMatchObject({ pending: true, attempts: 1, lastError: 'SHOPIFY_CATALOG_PAGINATION_FATAL' });
  });

  // ── GH-1262 A2.2 compatibility contract (SF-GH1262-COMPAT-IMPLEMENT-001) ──

  /** Exact persisted watermark facts for one product (timestamp at microsecond precision). */
  const watermarkFacts = (base: Base) =>
    withTenant(base.shopId, (trx) =>
      trx('shopify_product_source_watermarks')
        .where({ shop_id: base.shopId, platform: 'shopify', external_product_id: base.gid })
        .first(
          'reconcile_generation', 'reconcile_attempts', 'is_deleted',
          trx.raw('reconcile_requested_at IS NOT NULL AS pending'),
          trx.raw(`to_char(source_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_updated_at`)));

  const pendingObligations = (shopId: number) =>
    withTenant(shopId, (trx) =>
      trx('shopify_product_source_watermarks')
        .where({ shop_id: shopId, platform: 'shopify' })
        .whereNotNull('reconcile_requested_at')
        .pluck('external_product_id'));

  it('M2c — an equal-timestamp webhook alone records exactly one obligation and writes nothing', async () => {
    const base = await archivedAtT3('m2c');
    const before = await watermarkFacts(base);
    expect(await pendingObligations(base.shopId)).toEqual([]);

    await productsUpdate(base, 'active', T3);

    expect(await pendingObligations(base.shopId)).toEqual([base.gid]);
    expect(await watermarkFacts(base)).toEqual({
      ...before, pending: true, reconcile_attempts: 0,
      reconcile_generation: before.reconcile_generation + 1,
    });
    await expectCatalog(base, `equal-timestamp active@${T3} alone`, 'archived');
  });

  it('M3 — a tombstoned obligation is never claimed, fetched or counted, never resurfaces, and a tombstoned null fetch settles uncounted', async () => {
    const svc = await loadReconciliationService();

    // Tombstone committed while the obligation is pending.
    const base = await conflicted('m3');
    await deliver(base.shopId, base.shopDomain, 'products/delete', { id: Number(base.productId) });
    const tombstoned = await watermarkFacts(base);
    expect(tombstoned).toMatchObject({ is_deleted: true, pending: true, reconcile_attempts: 0 });
    expect(await svc.claimProductReconciliation({ shopId: base.shopId })).toBeNull();
    expect(await svc.listProductReconciliationTenants({ limit: 100 })).not.toContain(base.shopId);

    // Later equal and newer inputs for the deleted product resurface nothing.
    await productsUpdate(base, 'active', T3);
    await productsUpdate(base, 'active', T4);
    expect(await watermarkFacts(base)).toEqual(tombstoned);
    expect(await svc.claimProductReconciliation({ shopId: base.shopId })).toBeNull();
    expect(await svc.listProductReconciliationTenants({ limit: 100 })).not.toContain(base.shopId);
    await expectCatalog(base, 'tombstoned obligation after later inputs', 'deleted');

    // Tombstone committed during the fetch, provider returns no product: one
    // request, settled as TOMBSTONED, attempt not counted, never claimed again.
    const racing = await conflicted('m3-null');
    const claim = await svc.claimProductReconciliation({ shopId: racing.shopId });
    expect(claim).not.toBeNull();
    const shopify = stubShopify(async (_v, call) => {
      if (call === 1) await deliver(racing.shopId, racing.shopDomain, 'products/delete', { id: Number(racing.productId) });
      return { data: { product: null } };
    });
    expect((await svc.processProductReconciliationClaim(claim!, deps(racing.shopDomain, shopify.client))).kind)
      .toBe('TOMBSTONED');
    expect(shopify.calls).toHaveLength(1);
    expect(await watermarkFacts(racing)).toMatchObject({ is_deleted: true, pending: false, reconcile_attempts: 0 });
    expect(await svc.readProductReconciliationState(racing.shopId, racing.gid))
      .toMatchObject({ pending: false, claimed: false, attempts: 0, lastError: null });
    expect(await svc.claimProductReconciliation({ shopId: racing.shopId })).toBeNull();
    await expectCatalog(racing, 'tombstoned during a null fetch', 'deleted');
  });

  it('M4 — repeated equal-timestamp events while pending never reset attempts or revive exhaustion; a completed episode restarts at zero', async () => {
    const svc = await loadReconciliationService();
    const BOUND: ReconciliationOptions = { ...FAST_RETRY, maxAttempts: 2 };
    const base = await conflicted('m4');
    const claimWhenDue = () => waitUntil(
      () => svc.claimProductReconciliation({ shopId: base.shopId, ...BOUND }), 'claim after backoff');
    const providerDown = stubShopify(() => { throw new Error('GH1262_M4_PROVIDER_DOWN'); });

    // Attempt 1 fails.
    const first = await svc.claimProductReconciliation({ shopId: base.shopId, ...BOUND });
    expect((await svc.processProductReconciliationClaim(first!, deps(base.shopDomain, providerDown.client), BOUND)).kind)
      .toBe('FAILED');
    const failedOnce = await svc.readProductReconciliationState(base.shopId, base.gid, BOUND);
    expect(failedOnce).toMatchObject({ pending: true, attempts: 1, exhausted: false });

    // Distinct equal-timestamp events while pending: generation advances, attempts do not reset.
    for (const status of ['draft', 'active', 'draft'] as const) await productsUpdate(base, status, T3);
    expect(await svc.readProductReconciliationState(base.shopId, base.gid, BOUND)).toMatchObject({
      pending: true, attempts: 1, exhausted: false, generation: failedOnce!.generation + 3,
    });

    // Attempt 2 exhausts the bound.
    const second = await claimWhenDue();
    expect((await svc.processProductReconciliationClaim(second, deps(base.shopDomain, providerDown.client), BOUND)).kind)
      .toBe('FAILED');
    expect(await svc.readProductReconciliationState(base.shopId, base.gid, BOUND))
      .toMatchObject({ pending: true, attempts: 2, exhausted: true });

    // Further equal events cannot revive the exhausted obligation.
    await productsUpdate(base, 'active', T3);
    await productsUpdate(base, 'draft', T3);
    await dbSleep(1_500);
    expect(await svc.readProductReconciliationState(base.shopId, base.gid, BOUND))
      .toMatchObject({ pending: true, attempts: 2, exhausted: true, claimed: false });
    expect(await svc.claimProductReconciliation({ shopId: base.shopId, ...BOUND })).toBeNull();
    expect(await svc.listProductReconciliationTenants({ limit: 100, ...BOUND })).not.toContain(base.shopId);
    await expectCatalog(base, 'exhausted obligation', 'archived');

    // A completed episode: the next equal event starts a NEW episode at zero attempts.
    const fresh = await conflicted('m4-episode');
    const failClaim = await svc.claimProductReconciliation({ shopId: fresh.shopId, ...BOUND });
    expect((await svc.processProductReconciliationClaim(failClaim!, deps(fresh.shopDomain, providerDown.client), BOUND)).kind)
      .toBe('FAILED');
    const applyClaim = await waitUntil(
      () => svc.claimProductReconciliation({ shopId: fresh.shopId, ...BOUND }), 'claim after backoff');
    const success = stubShopify(() => ({ data: { product: snapshotNode(fresh.productId, 'ACTIVE', fresh.variants, T3) } }));
    expect((await svc.processProductReconciliationClaim(applyClaim, deps(fresh.shopDomain, success.client), BOUND)).kind)
      .toBe('APPLIED');
    const completed = await svc.readProductReconciliationState(fresh.shopId, fresh.gid, BOUND);
    expect(completed).toMatchObject({ pending: false, attempts: 0, lastError: null });
    await productsUpdate(fresh, 'archived', T3);
    expect(await svc.readProductReconciliationState(fresh.shopId, fresh.gid, BOUND)).toMatchObject({
      pending: true, attempts: 0, exhausted: false, generation: completed!.generation + 1,
    });
  });

  it('M5 — uninstall, re-authentication or a replaced installation between fetch and apply writes nothing and releases uncounted; a routine refresh still applies', async () => {
    const svc = await loadReconciliationService();

    async function lostBetweenFetchAndApply(label: string, change: (base: Base) => Promise<void>) {
      const base = await conflicted(label);
      const claim = await svc.claimProductReconciliation({ shopId: base.shopId });
      expect(claim).not.toBeNull();
      const before = await watermarkFacts(base);
      const shopify = stubShopify(async (_v, call) => {
        if (call === 1) await change(base);
        return { data: { product: snapshotNode(base.productId, 'ACTIVE', base.variants, T3) } };
      });
      const outcome = await svc.processProductReconciliationClaim(claim!, deps(base.shopDomain, shopify.client));
      expect({ label, kind: outcome.kind }).toEqual({ label, kind: 'AUTHORITY_LOST' });
      await expectCatalog(base, `${label}: no catalog write`, 'archived');
      expect({ label, watermark: await watermarkFacts(base) }).toEqual({ label, watermark: before });
      expect({ label, state: await svc.readProductReconciliationState(base.shopId, base.gid) })
        .toMatchObject({ label, state: { pending: true, claimed: false, attempts: 0, lastError: null } });
      return base;
    }

    // Uninstall.
    await lostBetweenFetchAndApply('m5-uninstall', (base) => withTenant(base.shopId, (trx) =>
      trx('shopify_app_installations').where({ id: base.authority.installationId })
        .update({ uninstalled_at: trx.fn.now() })).then(() => undefined));

    // Re-authentication / reconnect start: the credential leaves ACTIVE.
    await lostBetweenFetchAndApply('m5-reauth', (base) => withTenant(base.shopId, (trx) =>
      trx('shopify_admin_credentials').where({ shop_id: base.shopId, installation_id: base.authority.installationId })
        .update({ credential_state: 'REAUTH_REQUIRED',
          credential_generation: trx.raw('credential_generation + 1') })).then(() => undefined));

    // Replaced installation: the fetched-under installation is retired and the
    // shop gets a new active installation with its own ACTIVE credential.
    await lostBetweenFetchAndApply('m5-replaced', async (base) => {
      await withTenant(base.shopId, (trx) =>
        trx('shopify_app_installations').where({ id: base.authority.installationId })
          .update({ uninstalled_at: trx.fn.now() }));
      const replacementDomain = base.shopDomain.replace('.myshopify.com', '-replacement.myshopify.com');
      await withTenant(base.shopId, (trx) =>
        trx('shopify_app_installations').insert({ shop_id: base.shopId, shop_domain: replacementDomain, scopes: 'read_products' }));
      await seedInstallationAuthority(base.shopId, replacementDomain);
    });

    // Routine token refresh: generation advances, same ACTIVE installation → applies.
    const refreshed = await conflicted('m5-refresh');
    const claim = await svc.claimProductReconciliation({ shopId: refreshed.shopId });
    const shopify = stubShopify(async (_v, call) => {
      if (call === 1) {
        await withTenant(refreshed.shopId, (trx) =>
          trx('shopify_admin_credentials')
            .where({ shop_id: refreshed.shopId, installation_id: refreshed.authority.installationId })
            .update({ credential_generation: trx.raw('credential_generation + 1') }));
      }
      return { data: { product: snapshotNode(refreshed.productId, 'ACTIVE', refreshed.variants, T3) } };
    });
    expect((await svc.processProductReconciliationClaim(claim!, deps(refreshed.shopDomain, shopify.client))).kind)
      .toBe('APPLIED');
    await expectCatalog(refreshed, 'apply after a routine refresh', 'active');
    const refreshedCredential = await withTenant(refreshed.shopId, (trx) =>
      trx('shopify_admin_credentials')
        .where({ shop_id: refreshed.shopId, installation_id: refreshed.authority.installationId })
        .first('credential_generation', 'credential_state'));
    expect({ state: refreshedCredential.credential_state, advanced: String(refreshedCredential.credential_generation) !== refreshed.authority.generation })
      .toEqual({ state: 'ACTIVE', advanced: true });
  });
});

// ── M1: combined migration ordering, checksums, security and RLS ───────────

describe('M1 — 0218 follows the protected reconnect tail and keeps every security boundary', () => {
  const PROTECTED_TAIL = [
    '20261016120000_0212_authorize_shopify_reconnect_sync_reset.js',
    '20261016150000_0215_harden_reconnect_and_priority_function_authority.js',
    '20261018120000_0216_durable_shopify_sync_dispatch.js',
    '20261019120000_0217_shopify_manual_recovery.js',
    '20261020120000_0218_create_shopify_product_source_watermarks.js',
  ];
  const DISCOVERY = 'public.list_shopify_product_reconciliation_tenants(integer,integer,integer,integer)';
  let admin: Knex | undefined;
  let runtime: Knex | undefined;

  /** Read-only connections to the disposable DB only (gh1068-t3b pattern). */
  function disposableConnection(user: string | undefined, password: string | undefined) {
    const database = process.env.PGDATABASE ?? '';
    if (process.env.NODE_ENV !== 'test' || process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1'
      || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(database) || process.env.PGUSER !== 'sf_app'
      || !process.env.PGMIGRATION_USER || process.env.PGMIGRATION_USER === 'sf_app') {
      throw new Error('GH1262_M1_REFUSING_UNSAFE_DB');
    }
    return knex({
      client: 'pg',
      connection: { host: process.env.PGHOST, port: Number(process.env.PGPORT), database,
        user, password: String(password || ''), connectionTimeoutMillis: 3_000 },
      pool: { min: 0, max: 1 },
    });
  }

  beforeAll(() => {
    admin = disposableConnection(process.env.PGMIGRATION_USER, process.env.PGMIGRATION_PASSWORD);
    runtime = disposableConnection(process.env.PGUSER, process.env.PGPASSWORD);
  });

  afterAll(async () => {
    await admin?.destroy();
    await runtime?.destroy();
  });

  it('M1a — the protected runner applied 0212 → 0215 → 0216 → 0217 → 0218 in order, with recorded checksums', async () => {
    const ledger: string[] = await admin!('knex_migrations').orderBy('id', 'asc').pluck('name');
    expect(ledger.filter((name) => /^2026101[6-9]|^2026102/.test(name))).toEqual(PROTECTED_TAIL);
    expect(ledger.slice(-PROTECTED_TAIL.length)).toEqual(PROTECTED_TAIL);
    expect(ledger.some((name) => name.includes('_0214_'))).toBe(false);

    const checksums = await admin!('migration_checksums').whereIn('name', PROTECTED_TAIL).select('name', 'checksum');
    expect(checksums.map((row: any) => row.name).sort()).toEqual([...PROTECTED_TAIL].sort());
    const compiled = path.join(process.cwd(), 'apps/backend/dist/migrations', PROTECTED_TAIL[4]);
    expect(fs.existsSync(compiled)).toBe(true);
    expect(checksums.find((row: any) => row.name === PROTECTED_TAIL[4]).checksum)
      .toBe(crypto.createHash('sha256').update(fs.readFileSync(compiled)).digest('hex'));
  });

  it('M1b — the 0217 security postconditions still hold and no reconnect-authority table gained a watermark dependency', async () => {
    await expect(assertSecurityPostconditions(admin!)).resolves.toBeUndefined();
    const authorityRefs = await admin!.raw(`
      SELECT count(*)::int AS refs
        FROM pg_catalog.pg_constraint k
       WHERE k.conrelid IN ('public.shops'::regclass, 'public.shopify_app_installations'::regclass,
                            'public.shopify_admin_credentials'::regclass, 'public.integrations'::regclass)
         AND pg_catalog.pg_get_constraintdef(k.oid) ILIKE '%source_watermarks%'`);
    expect(authorityRefs.rows[0].refs).toBe(0);
    const authorityTriggers = await admin!.raw(`
      SELECT count(*)::int AS triggers
        FROM pg_catalog.pg_trigger t
       WHERE NOT t.tgisinternal
         AND t.tgrelid IN ('public.shops'::regclass, 'public.shopify_app_installations'::regclass,
                           'public.shopify_admin_credentials'::regclass, 'public.integrations'::regclass)
         AND pg_catalog.pg_get_functiondef(t.tgfoid) ILIKE '%source_watermarks%'`);
    expect(authorityTriggers.rows[0].triggers).toBe(0);
  });

  it('M1c — forced RLS, least privilege and the restricted runtime role hold for the watermark table and discovery function', async () => {
    const table = await admin!.raw(`
      SELECT c.relrowsecurity, c.relforcerowsecurity,
             array(SELECT p.polcmd::text FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1) AS commands
        FROM pg_catalog.pg_class c WHERE c.oid = 'public.shopify_product_source_watermarks'::regclass`);
    expect(table.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, commands: ['a', 'r', 'w'] });

    const roles = await admin!.raw(`
      SELECT rolname, rolsuper, rolbypassrls FROM pg_catalog.pg_roles
       WHERE rolname IN ('sf_app', 'sf_shopify_reconnect_executor', 'sf_shopify_reconnect_owner') ORDER BY rolname`);
    expect(roles.rows).toEqual([
      { rolname: 'sf_app', rolsuper: false, rolbypassrls: false },
      { rolname: 'sf_shopify_reconnect_executor', rolsuper: false, rolbypassrls: false },
      { rolname: 'sf_shopify_reconnect_owner', rolsuper: false, rolbypassrls: false },
    ]);

    const privileges = await admin!.raw(`
      SELECT r.rolname,
             has_table_privilege(r.rolname, 'public.shopify_product_source_watermarks', 'SELECT') AS can_select,
             has_table_privilege(r.rolname, 'public.shopify_product_source_watermarks', 'INSERT') AS can_insert,
             has_table_privilege(r.rolname, 'public.shopify_product_source_watermarks', 'UPDATE') AS can_update,
             has_table_privilege(r.rolname, 'public.shopify_product_source_watermarks', 'DELETE') AS can_delete,
             has_table_privilege(r.rolname, 'public.shopify_product_source_watermarks', 'TRUNCATE') AS can_truncate,
             has_function_privilege(r.rolname, '${DISCOVERY}', 'EXECUTE') AS can_discover
        FROM pg_catalog.pg_roles r
       WHERE r.rolname IN ('sf_app', 'sf_shopify_reconnect_executor', 'sf_shopify_reconnect_owner')
       ORDER BY r.rolname`);
    expect(privileges.rows).toEqual([
      { rolname: 'sf_app', can_select: true, can_insert: true, can_update: true,
        can_delete: false, can_truncate: false, can_discover: true },
      { rolname: 'sf_shopify_reconnect_executor', can_select: false, can_insert: false, can_update: false,
        can_delete: false, can_truncate: false, can_discover: false },
      { rolname: 'sf_shopify_reconnect_owner', can_select: false, can_insert: false, can_update: false,
        can_delete: false, can_truncate: false, can_discover: false },
    ]);

    const discovery = await admin!.raw(`
      SELECT p.prosecdef, p.proconfig,
             EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_grant
        FROM pg_catalog.pg_proc p WHERE p.oid = '${DISCOVERY}'::regprocedure`);
    expect(discovery.rows[0]).toEqual({
      prosecdef: true, proconfig: ['search_path=pg_catalog, public'], public_grant: false,
    });

    // Restricted runtime role without a tenant: rows exist, none are visible or writable.
    const total = await admin!('shopify_product_source_watermarks').count('* as c').first();
    expect(Number(total?.c ?? 0)).toBeGreaterThan(0);
    const identity = await runtime!.raw('SELECT current_user AS role');
    expect(identity.rows[0].role).toBe('sf_app');
    const visible = await runtime!.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.current_tenant', '', true)`);
      return trx('shopify_product_source_watermarks').count('* as c').first();
    });
    expect(Number(visible?.c ?? 0)).toBe(0);
    const anyShop = await admin!('shops').min('id as id').first();
    await expect(runtime!.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.current_tenant', '', true)`);
      await trx('shopify_product_source_watermarks').insert({
        shop_id: anyShop.id, platform: 'shopify', external_product_id: 'gid://shopify/Product/1262000000001',
        source_updated_at: '2026-09-01T10:00:00Z',
      });
    })).rejects.toThrow(/row-level security/);
  });
});

// ── A2.3: SHOPIFY PARTIAL-PAYLOAD SAFETY (SF-GH1262-A23-PAYLOAD-RED-002) ────

/**
 * Ratified owner decisions O1–O6 (parent audit SF-GH1262-A23-PAYLOAD-AUDIT-001):
 *   RC1  absent sku / barcode / inventory_item_id preserve persisted values;
 *        an explicit null or '' clears only the field it names (O1)
 *   RC2  malformed product / variant identity fails the webhook and persists
 *        nothing — no synthetic identity, no cross-product association (O6)
 *   RC3  a never-seen product without status is rejected; an existing product
 *        keeps its status; active / draft / archived stay supported (O2, O3)
 *   RC4  duplicate Shopify SKU: characterization of current behaviour only (O4)
 *   RC5  unknown status, unresolved / foreign shop ownership and an invalid
 *        creation payload fail; a valid update may omit title (O2, O6);
 *        a first write of an unknown product needs a real title whatever the
 *        topic (RC5g); Shopify 2026-04 'unlisted' is a recognized status that
 *        is persisted as-is (RC5h — SF-GH1262-A23-CORRECT-005)
 *
 * Every delivery is signed and goes through the real HTTP endpoint and
 * WebhookRouter (R15 pattern) so the ledger outcome is observed, except the
 * handler-level shop-ownership cases, which the router cannot reach (it
 * resolves the tenant from the same installation row the handler re-reads).
 * Rejected events must be recorded as failed and answered with HTTP 500.
 */
describe('A2.3 — Shopify partial-payload safety', () => {
  const T1 = '2026-09-01T10:00:00Z';
  const T2 = '2026-09-02T10:00:00Z';
  const T3 = '2026-09-03T10:00:00Z';

  let savedWebhookSecret: string | undefined;

  beforeAll(() => {
    savedWebhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret || 'gh1262-test-webhook-secret';
  });

  afterAll(() => {
    if (savedWebhookSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = savedWebhookSecret;
  });

  type SeedVariant = { variantId: string; sku: string | null; barcode: string | null; inventoryItemId: string | null };

  const seedVariant = (): SeedVariant => {
    const variantId = numericId();
    return { variantId, sku: `A23-SKU-${variantId}`, barcode: `GTIN${variantId}`, inventoryItemId: numericId() };
  };

  const inventoryItemGid = (id: string) => `gid://shopify/InventoryItem/${id}`;

  /** GraphQL full-sync edge with populated Shopify-owned identifiers and a source timestamp. */
  const seedEdge = (productId: string, status: ShopifyStatus, variants: SeedVariant[], updatedAt: string) => ({
    node: {
      id: productGid(productId),
      title: `A23 product ${productId}`,
      status,
      productType: 'Widgets',
      updatedAt,
      featuredImage: null,
      variants: {
        edges: variants.map((v) => ({
          node: {
            id: variantGid(v.variantId),
            title: `Variant ${v.variantId}`,
            sku: v.sku,
            barcode: v.barcode,
            image: null,
            inventoryItem: {
              id: v.inventoryItemId ? inventoryItemGid(v.inventoryItemId) : null,
              unitCost: { amount: '5.00' },
            },
          },
        })),
      },
    },
  });

  /** Complete REST variant as Shopify sends it. */
  const restVariant = (v: SeedVariant) => ({
    id: Number(v.variantId),
    title: `Variant ${v.variantId}`,
    sku: v.sku,
    barcode: v.barcode,
    inventory_item_id: v.inventoryItemId ? Number(v.inventoryItemId) : null,
  });

  /**
   * Signed delivery of an arbitrary raw payload through the real endpoint.
   * JSON.stringify drops undefined keys, so an omitted field is genuinely
   * absent from the raw body while an explicit null is preserved.
   */
  async function deliver(shopId: number, shopDomain: string, topic: string, payload: unknown) {
    const webhookId = `gh1262-a23-${crypto.randomUUID()}`;
    const rawBody = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
      .update(Buffer.from(rawBody, 'utf8')).digest('base64');
    const res = await request(app)
      .post('/api/v1/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Topic', topic)
      .set('X-Shopify-Shop-Domain', shopDomain)
      .set('X-Shopify-Webhook-Id', webhookId)
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(rawBody);
    const rows = await withTenant(shopId, (trx) =>
      trx('integration_webhook_events')
        .where({ integration: 'shopify', external_event_id: webhookId })
        .select('processing_status', 'processing_error'));
    return {
      httpStatus: res.status,
      ledger: rows.map((r: any) => r.processing_status),
      errors: rows.map((r: any) => r.processing_error),
    };
  }

  const REJECTED = { httpStatus: 500, ledger: ['failed'] };
  const PROCESSED = { httpStatus: 200, ledger: ['processed'] };
  const outcome = (d: Awaited<ReturnType<typeof deliver>>) => ({ httpStatus: d.httpStatus, ledger: d.ledger });

  /** Shopify-owned identifiers and internal identity of every mapped variant of one product. */
  async function fieldState(shopId: number, productId: string) {
    return withTenant(shopId, (trx) =>
      trx('external_product_identity_map as m')
        .join('variants as v', 'v.lasyncro_variant_id', 'm.lasyncro_variant_id')
        .where({ 'm.shop_id': shopId, 'm.platform': 'shopify', 'm.external_product_id': productGid(productId) })
        .orderBy('m.external_variant_id')
        .select(
          'm.id as mapping_id', 'm.external_variant_id', 'm.lasyncro_variant_id', 'v.lasyncro_product_id',
          'v.lasyncro_barcode', 'v.sku', 'v.barcode', 'm.external_sku', 'm.barcode as map_barcode',
          'm.external_inventory_item_id',
        ));
  }

  /** Shop-wide catalog row counts: any write by a rejected event shows up here. */
  async function footprint(shopId: number) {
    return withTenant(shopId, async (trx) => {
      const count = async (table: string) =>
        Number((await trx(table).where({ shop_id: shopId }).count('* as c').first())?.c ?? 0);
      return {
        products: await count('products'),
        variants: await count('variants'),
        mappings: await count('external_product_identity_map'),
        watermarks: await count('shopify_product_source_watermarks'),
      };
    });
  }

  async function watermarkOf(shopId: number, productId: string) {
    return withTenant(shopId, async (trx) => {
      const r = await trx.raw(
        `SELECT is_deleted,
                to_char(source_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS source_updated_at
           FROM shopify_product_source_watermarks
          WHERE shop_id = ? AND platform = 'shopify' AND external_product_id = ?`,
        [shopId, productGid(productId)]);
      return r.rows[0] ?? null;
    });
  }

  async function parentRows(shopId: number, productId: string) {
    const state = await catalogState(shopId, productId);
    return withTenant(shopId, (trx) =>
      trx('products').whereIn('lasyncro_product_id', state.parentIds)
        .orderBy('lasyncro_product_id').select('lasyncro_product_id', 'title', 'status'));
  }

  /** Identity rows that only a malformed id can produce. */
  async function syntheticIdentities(shopId: number) {
    return withTenant(shopId, (trx) =>
      trx('external_product_identity_map')
        .where({ shop_id: shopId, platform: 'shopify' })
        .andWhere(function () {
          this.where('external_variant_id', 'like', '%/undefined')
            .orWhere('external_variant_id', 'like', '%/null')
            .orWhere('external_product_id', 'like', 'gid://shopify/Product/gid:%')
            .orWhereRaw(`external_product_id !~ '^gid://shopify/Product/[1-9][0-9]*$'`)
            .orWhereRaw(`external_variant_id !~ '^gid://shopify/ProductVariant/[1-9][0-9]*$'`);
        })
        .select('external_product_id', 'external_variant_id', 'lasyncro_variant_id'));
  }

  /** lasyncro variants mapped from more than one Shopify product. */
  async function crossProductVariants(shopId: number) {
    const r = await withTenant(shopId, (trx) => trx.raw(
      `SELECT lasyncro_variant_id, array_agg(DISTINCT external_product_id ORDER BY external_product_id) AS products
         FROM external_product_identity_map
        WHERE shop_id = ? AND platform = 'shopify'
        GROUP BY lasyncro_variant_id
       HAVING count(DISTINCT external_product_id) > 1`, [shopId]));
    return r.rows;
  }

  // ── RC1: presence-aware field updates (O1) ──

  it('RC1a — a newer products/update omitting sku, barcode and inventory_item_id preserves every persisted value and identity', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc1a');
    const productId = numericId();
    const v = seedVariant();

    await initialSync(shopId, [seedEdge(productId, 'ACTIVE', [v], T1)]);
    const before = await fieldState(shopId, productId);
    expect(before).toEqual([expect.objectContaining({
      sku: v.sku, barcode: v.barcode, external_sku: v.sku, map_barcode: v.barcode,
      external_inventory_item_id: inventoryItemGid(v.inventoryItemId!),
    })]);
    expect(before[0].lasyncro_barcode).toMatch(LSP_PATTERN);

    const delivery = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(productId),
      title: `A23 product ${productId}`,
      status: 'active',
      updated_at: T2,
      // sku, barcode and inventory_item_id are absent from the raw payload.
      variants: [{ id: Number(v.variantId), title: `Variant ${v.variantId}` }],
    });

    expect(outcome(delivery)).toEqual(PROCESSED);
    expect(await fieldState(shopId, productId)).toEqual(before);
  });

  it('RC1b — an explicit null / empty value clears only the fields it names; identity is unchanged', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc1b');
    const productId = numericId();
    const v = seedVariant();

    await initialSync(shopId, [seedEdge(productId, 'ACTIVE', [v], T1)]);
    const before = await fieldState(shopId, productId);
    expect(before).toHaveLength(1);

    // Step 1: clear sku ('') and barcode (null); inventory_item_id is sent unchanged.
    const clearSkuBarcode = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(productId), title: `A23 product ${productId}`, status: 'active', updated_at: T2,
      variants: [{ ...restVariant(v), sku: '', barcode: null }],
    });
    expect(outcome(clearSkuBarcode)).toEqual(PROCESSED);
    expect(await fieldState(shopId, productId)).toEqual([{
      ...before[0], sku: null, barcode: null, external_sku: null, map_barcode: null,
    }]);

    // Step 2: explicit null inventory_item_id clears only the inventory item.
    const clearInventoryItem = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(productId), title: `A23 product ${productId}`, status: 'active', updated_at: T3,
      variants: [{ ...restVariant(v), sku: '', barcode: null, inventory_item_id: null }],
    });
    expect(outcome(clearInventoryItem)).toEqual(PROCESSED);
    expect(await fieldState(shopId, productId)).toEqual([{
      ...before[0], sku: null, barcode: null, external_sku: null, map_barcode: null,
      external_inventory_item_id: null,
    }]);
  });

  // ── RC2: malformed identities (O6) ──

  it('RC2a — products/create with an invalid Shopify product id fails and persists nothing', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc2a');
    const before = await footprint(shopId);

    const delivery = await deliver(shopId, shopDomain, 'products/create', {
      id: 'not-a-product-id', title: 'A23 invalid product id', status: 'active', updated_at: T1,
      variants: [restVariant(seedVariant())],
    });

    expect(outcome(delivery)).toEqual(REJECTED);
    expect(await footprint(shopId)).toEqual(before);
    expect(await syntheticIdentities(shopId)).toEqual([]);
  });

  it('RC2b — products/create with a non-canonical (GID-form) product id fails and persists no doubled identity', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc2b');
    const before = await footprint(shopId);

    const delivery = await deliver(shopId, shopDomain, 'products/create', {
      id: productGid(numericId()), title: 'A23 non-canonical product id', status: 'active', updated_at: T1,
      variants: [restVariant(seedVariant())],
    });

    expect(outcome(delivery)).toEqual(REJECTED);
    expect(await footprint(shopId)).toEqual(before);
    expect(await syntheticIdentities(shopId)).toEqual([]);
  });

  it('RC2c — a products/update containing a variant with no id fails; the valid product identity is unchanged', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc2c');
    const productId = numericId();
    const v = seedVariant();
    await initialSync(shopId, [seedEdge(productId, 'ACTIVE', [v], T1)]);
    const before = { fields: await fieldState(shopId, productId), counts: await footprint(shopId) };

    const delivery = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(productId), title: `A23 product ${productId}`, status: 'active', updated_at: T2,
      variants: [restVariant(v), { title: 'A23 variant without id', sku: `A23-NOID-${numericId()}` }],
    });

    expect(outcome(delivery)).toEqual(REJECTED);
    expect(await fieldState(shopId, productId)).toEqual(before.fields);
    expect(await footprint(shopId)).toEqual(before.counts);
    expect(await syntheticIdentities(shopId)).toEqual([]);
    expect(await watermarkOf(shopId, productId)).toEqual({ is_deleted: false, source_updated_at: T1 });
  });

  it('RC2d — a products/update containing a malformed variant id fails; the valid product identity is unchanged', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc2d');
    const productId = numericId();
    const v = seedVariant();
    await initialSync(shopId, [seedEdge(productId, 'ACTIVE', [v], T1)]);
    const before = { fields: await fieldState(shopId, productId), counts: await footprint(shopId) };

    const delivery = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(productId), title: `A23 product ${productId}`, status: 'active', updated_at: T2,
      variants: [restVariant(v), { id: 'abc-variant', title: 'A23 malformed variant', sku: `A23-BADID-${numericId()}` }],
    });

    expect(outcome(delivery)).toEqual(REJECTED);
    expect(await fieldState(shopId, productId)).toEqual(before.fields);
    expect(await footprint(shopId)).toEqual(before.counts);
    expect(await syntheticIdentities(shopId)).toEqual([]);
    expect(await watermarkOf(shopId, productId)).toEqual({ is_deleted: false, source_updated_at: T1 });
  });

  it('RC2e — two different products each carrying an id-less variant never share a variant identity', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc2e');
    const before = await footprint(shopId);
    const productA = numericId();
    const productB = numericId();

    const deliveryA = await deliver(shopId, shopDomain, 'products/create', {
      id: Number(productA), title: `A23 product ${productA}`, status: 'active', updated_at: T1,
      variants: [{ title: 'A23 id-less variant A', sku: `A23-NOID-A-${productA}` }],
    });
    const deliveryB = await deliver(shopId, shopDomain, 'products/create', {
      id: Number(productB), title: `A23 product ${productB}`, status: 'active', updated_at: T1,
      variants: [{ title: 'A23 id-less variant B', sku: `A23-NOID-B-${productB}` }],
    });

    const evidence = {
      deliveries: [outcome(deliveryA), outcome(deliveryB)],
      synthetic: await syntheticIdentities(shopId),
      crossProduct: await crossProductVariants(shopId),
      footprint: await footprint(shopId),
    };
    console.info('RC2E_EVIDENCE', JSON.stringify(evidence));
    expect(evidence).toEqual({
      deliveries: [REJECTED, REJECTED],
      synthetic: [],
      crossProduct: [],
      footprint: before,
    });
  });

  // ── RC3: first-time status safety (O2, O3) ──

  it('RC3a — a never-seen product delivered without status is rejected and no active product is created', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc3a');
    const productId = numericId();
    const before = await footprint(shopId);

    const delivery = await deliver(shopId, shopDomain, 'products/create', {
      id: Number(productId), title: `A23 product ${productId}`, updated_at: T1,
      variants: [restVariant(seedVariant())],
    });

    expect(outcome(delivery)).toEqual(REJECTED);
    expect((await catalogState(shopId, productId)).parents).toEqual([]);
    expect(await footprint(shopId)).toEqual(before);
  });

  it('RC3b — an existing product updated without status keeps its status', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc3b');
    const productId = numericId();
    const v = seedVariant();
    await initialSync(shopId, [seedEdge(productId, 'ARCHIVED', [v], T1)]);

    const delivery = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(productId), title: `A23 product ${productId}`, updated_at: T2, variants: [restVariant(v)],
    });

    expect(outcome(delivery)).toEqual(PROCESSED);
    const parents = await parentRows(shopId, productId);
    expect(parents.map((p: any) => p.status)).toEqual(parents.map(() => 'archived'));
    expect(parents).toHaveLength(1);
  });

  it('RC3c — recognized statuses draft → archived → active remain supported', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc3c');
    const productId = numericId();
    const v = seedVariant();
    const statuses: string[][] = [];

    for (const [status, updatedAt, topic] of [
      ['draft', T1, 'products/create'], ['archived', T2, 'products/update'], ['active', T3, 'products/update'],
    ] as const) {
      const delivery = await deliver(shopId, shopDomain, topic, {
        id: Number(productId), title: `A23 product ${productId}`, status, updated_at: updatedAt,
        variants: [restVariant(v)],
      });
      expect({ status, outcome: outcome(delivery) }).toEqual({ status, outcome: PROCESSED });
      statuses.push((await parentRows(shopId, productId)).map((p: any) => p.status));
    }

    expect(statuses).toEqual([['draft'], ['archived'], ['active']]);
  });

  // ── RC4: duplicate Shopify SKU characterization (O4 — evidence only) ──

  /**
   * Shopify permits two variants to share a SKU; variants carries
   * UNIQUE(shop_id, sku) (migration 0027). This pins the CURRENT behaviour as
   * evidence. It authorizes no duplicate-SKU policy.
   */
  it('RC4 — CHARACTERIZATION: a second Shopify variant sharing a persisted SKU fails the webhook and rolls back the whole product', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc4');
    const productOne = numericId();
    const duplicateSku = `A23-DUP-${numericId()}`;
    const existing: SeedVariant = { ...seedVariant(), sku: duplicateSku };
    await initialSync(shopId, [seedEdge(productOne, 'ACTIVE', [existing], T1)]);
    const before = { productOne: await fieldState(shopId, productOne), counts: await footprint(shopId) };

    const productTwo = numericId();
    const delivery = await deliver(shopId, shopDomain, 'products/create', {
      id: Number(productTwo), title: `A23 product ${productTwo}`, status: 'active', updated_at: T1,
      // The unique, otherwise valid variant is written FIRST; the second reuses the
      // persisted SKU — so a full rollback must also undo the first variant's writes.
      variants: [restVariant(seedVariant()), restVariant({ ...seedVariant(), sku: duplicateSku })],
    });

    const evidence = {
      outcome: outcome(delivery),
      error: delivery.errors[0],
      productTwoMappings: (await catalogState(shopId, productTwo)).mappings.length,
      productTwoWatermark: await watermarkOf(shopId, productTwo),
      counts: await footprint(shopId),
      productOne: await fieldState(shopId, productOne),
    };
    console.info('RC4_EVIDENCE', JSON.stringify(evidence));

    expect(evidence.outcome).toEqual(REJECTED);
    expect(evidence.error).toMatch(/duplicate key value violates unique constraint "variants_shop_id_sku_unique"/);
    expect(evidence.productTwoMappings).toBe(0);
    expect(evidence.productTwoWatermark).toBeNull();
    expect(evidence.counts).toEqual(before.counts);
    expect(evidence.productOne).toEqual(before.productOne);
  });

  // ── RC5: status and guard failures (O2, O6) ──

  it('RC5a — an unknown Shopify status fails the webhook and leaves the product unchanged', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc5a');
    const productId = numericId();
    const v = seedVariant();
    await initialSync(shopId, [seedEdge(productId, 'ACTIVE', [v], T1)]);
    const before = { parents: await parentRows(shopId, productId), fields: await fieldState(shopId, productId) };

    // CORRECT-005: this case originally used 'unlisted', which the owner has
    // since confirmed is a recognized Shopify 2026-04 product status (see
    // RC5h). 'suspended' is not a Shopify product status, so the
    // unknown-status rejection contract is preserved unchanged.
    const delivery = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(productId), title: `A23 product ${productId}`, status: 'suspended', updated_at: T2,
      variants: [restVariant(v)],
    });

    expect(outcome(delivery)).toEqual(REJECTED);
    expect(await parentRows(shopId, productId)).toEqual(before.parents);
    expect(await fieldState(shopId, productId)).toEqual(before.fields);
    expect(await watermarkOf(shopId, productId)).toEqual({ is_deleted: false, source_updated_at: T1 });
  });

  it('RC5b — a status value of "deleted" is unknown, fails, and is never treated as a deletion', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc5b');
    const productId = numericId();
    const v = seedVariant();
    await initialSync(shopId, [seedEdge(productId, 'ACTIVE', [v], T1)]);

    const forged = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(productId), title: `A23 product ${productId}`, status: 'deleted', updated_at: T2,
      variants: [restVariant(v)],
    });
    expect(outcome(forged)).toEqual(REJECTED);
    expect((await parentRows(shopId, productId)).map((p: any) => p.status)).toEqual(['active']);
    expect(await watermarkOf(shopId, productId)).toEqual({ is_deleted: false, source_updated_at: T1 });

    // Not tombstoned: a later recognized update still applies.
    const later = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(productId), title: `A23 product ${productId}`, status: 'archived', updated_at: T3,
      variants: [restVariant(v)],
    });
    expect(outcome(later)).toEqual(PROCESSED);
    expect((await parentRows(shopId, productId)).map((p: any) => p.status)).toEqual(['archived']);
  });

  it('RC5c — a delivery for a shop domain with no installation is not acknowledged (router)', async () => {
    const unknownDomain = `a23-noinstall-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.myshopify.com`;
    const rawBody = JSON.stringify({
      id: Number(numericId()), title: 'A23 unknown shop', status: 'active', updated_at: T1,
      variants: [restVariant(seedVariant())],
    });
    const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
      .update(Buffer.from(rawBody, 'utf8')).digest('base64');
    const res = await request(app)
      .post('/api/v1/shopify/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Topic', 'products/update')
      .set('X-Shopify-Shop-Domain', unknownDomain)
      .set('X-Shopify-Webhook-Id', `gh1262-a23-${crypto.randomUUID()}`)
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(rawBody);

    // No tenant can be resolved, so no tenant-scoped ledger row can exist.
    expect(res.status).toBe(500);
  });

  it('RC5d — handler-level missing installation or foreign shop ownership fails and writes nothing', async () => {
    const shopA = await provisionCatalogShop('a23-rc5d-a');
    const shopB = await provisionCatalogShop('a23-rc5d-b');
    const before = { a: await footprint(shopA.shopId), b: await footprint(shopB.shopId) };
    const payload = {
      id: Number(numericId()), title: 'A23 ownership', status: 'active', updated_at: T1,
      variants: [restVariant(seedVariant())],
    };
    const resolvedEnvelope = (shopDomain: string): WebhookEnvelope => ({
      ...envelope(shopDomain, 'products/update', payload), shopId: shopA.shopId,
    });
    const settle = (p: Promise<unknown>) => p.then(() => 'resolved', (e: Error) => `rejected: ${e.message}`);

    const missingInstallation = await settle(withTenant(shopA.shopId, (trx) =>
      handleProductUpdated(resolvedEnvelope(`a23-missing-${numericId()}.myshopify.com`), trx)));
    const foreignOwnership = await settle(withTenant(shopA.shopId, (trx) =>
      handleProductUpdated(resolvedEnvelope(shopB.shopDomain), trx)));
    console.info('RC5D_EVIDENCE', JSON.stringify({ missingInstallation, foreignOwnership }));

    expect({ missingInstallation, foreignOwnership }).toEqual({
      missingInstallation: expect.stringMatching(/^rejected: /),
      foreignOwnership: expect.stringMatching(/^rejected: /),
    });
    expect(await footprint(shopA.shopId)).toEqual(before.a);
    expect(await footprint(shopB.shopId)).toEqual(before.b);
  });

  it('RC5e — a valid existing-product update without title is applied and preserves the title', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc5e');
    const productId = numericId();
    const v = seedVariant();
    await initialSync(shopId, [seedEdge(productId, 'ACTIVE', [v], T1)]);
    const before = await parentRows(shopId, productId);

    const delivery = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(productId), status: 'archived', updated_at: T2, variants: [restVariant(v)],
    });

    expect(outcome(delivery)).toEqual(PROCESSED);
    expect(await parentRows(shopId, productId)).toEqual(before.map((p: any) => ({ ...p, status: 'archived' })));
    expect(await watermarkOf(shopId, productId)).toEqual({ is_deleted: false, source_updated_at: T2 });
  });

  it('RC5f — a products/create without title (invalid creation payload) fails and persists nothing', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc5f');
    const productId = numericId();
    const before = await footprint(shopId);

    const delivery = await deliver(shopId, shopDomain, 'products/create', {
      id: Number(productId), status: 'active', updated_at: T1, variants: [restVariant(seedVariant())],
    });

    expect(outcome(delivery)).toEqual(REJECTED);
    expect(await footprint(shopId)).toEqual(before);
  });

  it('RC5g — a products/update for a never-seen product without a real title is rejected and writes nothing', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc5g');
    const stock = () => withTenant(shopId, async (trx) => {
      const count = async (table: string) =>
        Number((await trx(table).where({ shop_id: shopId }).count('* as c').first())?.c ?? 0);
      return {
        movements: await count('inventory_movements'),
        truth: await count('inventory_truth'),
        units: await count('inventory_units'),
      };
    });
    const before = { catalog: await footprint(shopId), stock: await stock() };

    // Absent (the ratified RC5g case), then null / empty / whitespace-only (R1).
    const titles: Array<{ label: string; title?: unknown }> = [
      { label: 'absent' }, { label: 'null', title: null }, { label: 'empty', title: '' }, { label: 'whitespace', title: '   ' },
    ];
    for (const { label, title } of titles) {
      const productId = numericId();
      const delivery = await deliver(shopId, shopDomain, 'products/update', {
        id: Number(productId), ...(label === 'absent' ? {} : { title }), status: 'active', updated_at: T1,
        variants: [restVariant(seedVariant())],
      });
      expect({ label, outcome: outcome(delivery) }).toEqual({ label, outcome: REJECTED });
      expect({ label, error: delivery.errors[0] }).toEqual({
        label, error: expect.stringMatching(/SHOPIFY_(PRODUCT_TITLE_REQUIRED|REST_PRODUCT_TITLE_INVALID)/),
      });
      expect({ label, mappings: (await catalogState(shopId, productId)).mappings })
        .toEqual({ label, mappings: [] });
      expect({ label, watermark: await watermarkOf(shopId, productId) }).toEqual({ label, watermark: null });
    }

    // No product, variant, mapping, watermark or stock row was written.
    expect({ catalog: await footprint(shopId), stock: await stock() }).toEqual(before);
  });

  it('RC5h — Shopify 2026-04 status unlisted is persisted as-is on first creation and on update; unknown statuses still fail', async () => {
    const { shopId, shopDomain } = await provisionCatalogShop('a23-rc5h');

    // First-time creation with unlisted.
    const created = numericId();
    const createdVariant = seedVariant();
    const create = await deliver(shopId, shopDomain, 'products/create', {
      id: Number(created), title: `A23 product ${created}`, status: 'unlisted', updated_at: T1,
      variants: [restVariant(createdVariant)],
    });
    expect(outcome(create)).toEqual(PROCESSED);
    expect((await parentRows(shopId, created)).map((p: any) => p.status)).toEqual(['unlisted']);
    expect((await fieldState(shopId, created))[0].lasyncro_barcode).toMatch(LSP_PATTERN);
    expect(await watermarkOf(shopId, created)).toEqual({ is_deleted: false, source_updated_at: T1 });

    // Existing product updated to unlisted: identities unchanged, no tombstone.
    const existing = numericId();
    const existingVariant = seedVariant();
    await initialSync(shopId, [seedEdge(existing, 'ACTIVE', [existingVariant], T1)]);
    const before = { parents: await parentRows(shopId, existing), fields: await fieldState(shopId, existing) };

    const update = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(existing), title: `A23 product ${existing}`, status: 'unlisted', updated_at: T2,
      variants: [restVariant(existingVariant)],
    });
    expect(outcome(update)).toEqual(PROCESSED);
    expect(await parentRows(shopId, existing)).toEqual(before.parents.map((p: any) => ({ ...p, status: 'unlisted' })));
    expect(await fieldState(shopId, existing)).toEqual(before.fields);
    expect(await watermarkOf(shopId, existing)).toEqual({ is_deleted: false, source_updated_at: T2 });

    // An unsupported status still fails closed and leaves unlisted in place.
    const unknown = await deliver(shopId, shopDomain, 'products/update', {
      id: Number(existing), title: `A23 product ${existing}`, status: 'suspended', updated_at: T3,
      variants: [restVariant(existingVariant)],
    });
    expect(outcome(unknown)).toEqual(REJECTED);
    expect((await parentRows(shopId, existing)).map((p: any) => p.status)).toEqual(['unlisted']);
    expect(await watermarkOf(shopId, existing)).toEqual({ is_deleted: false, source_updated_at: T2 });
  });
});

// ── ISOLATION ───────────────────────────────────────────────────────────────

it('ISOLATION — no provider call was attempted by any contract above', () => {
  expect(mockProviderAttempts).toEqual([]);
});
