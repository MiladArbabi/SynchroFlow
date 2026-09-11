/**
 * GH-1085 / BARCODE-LIFECYCLE-01 — Slice A, contracts A1 + A2.
 *
 * Shopify paused App Store review (ref 102766, 2.1.1) because "the product
 * barcodes are not generating". On a Shopify test store every variant ships
 * with an empty barcode field, so a tenant whose whole catalog is barcode-less
 * has nothing to scan and nothing to print.
 *
 * A1 — catalog ingestion must give every synced variant a laSyncro product
 *      identity (variants.lasyncro_barcode, LSP-), even when Shopify supplies
 *      neither sku nor barcode.
 * A2 — that identity is minted once. A resync of the same external variant must
 *      not renumber it, must not fork the identity mapping, and must not mint a
 *      second barcode. Labels already applied to physical stock stay valid.
 *
 * NAMESPACE BOUNDARY (productBarcode.service.ts):
 *   variants.barcode          external EAN/UPC/GTIN, Shopify-owned.
 *   variants.lasyncro_barcode LSP- internal identity, laSyncro-owned.
 * Minting into variants.barcode would fabricate a GTIN we have no GS1 prefix
 * for, and the next sync would overwrite it. These tests assert the split.
 *
 * Drives the real persistence path (syncProducts) against the disposable
 * synchroflow_test_* database — `npm run test:integration`. HTTP adds no
 * contract value here: the Shopify fetch is network I/O, and the contract under
 * test is what ingestion persists.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { issueTestToken } from '../../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';

const app = createApp();
jest.setTimeout(120000);

/** The laSyncro product identity namespace. */
const LSP_PATTERN = /^LSP-[A-Z2-9]{8}$/;

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as tests/integration/floor-planning/barcode-print.test.ts) ──

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).andWhere('id', '>', afterId)
      .orderBy('id', 'asc').select('id'));
  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }
  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

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

async function provisionFt2Shop(label: string) {
  const shopDomain = `pbl1085-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
      access_token_encrypted: encrypt('offline-test-token-no-network-call'),
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
  return { shopId, userId, token };
}

// ── Shopify catalog fixture ─────────────────────────────────────────────────

/**
 * One physical product with one variant carrying NEITHER sku NOR barcode —
 * the exact shape a Shopify development/test store produces, and the shape
 * that produced the App Store rejection.
 */
function barcodeLessCatalogEdge(suffix: string) {
  return {
    node: {
      id: `gid://shopify/Product/1085${suffix}`,
      title: `GH1085 barcode-less product ${suffix}`,
      status: 'ACTIVE',
      productType: 'Widgets',
      featuredImage: null,
      variants: {
        edges: [
          {
            node: {
              id: `gid://shopify/ProductVariant/1085${suffix}`,
              title: 'Default Title',
              sku: null,
              barcode: null,
              image: null,
              inventoryItem: {
                id: `gid://shopify/InventoryItem/1085${suffix}`,
                unitCost: { amount: '4.25' },
              },
            },
          },
        ],
      },
    },
  };
}

function externalVariantIdOf(edge: ReturnType<typeof barcodeLessCatalogEdge>): string {
  return edge.node.variants.edges[0].node.id;
}

/** Shop-scoped read of everything these contracts assert on. */
async function ingestedState(shopId: number, externalVariantId: string) {
  return withTenant(shopId, async (trx) => {
    const mappings = await trx('external_product_identity_map')
      .where({ shop_id: shopId, platform: 'shopify', external_variant_id: externalVariantId })
      .orderBy('id')
      .select('lasyncro_variant_id', 'external_variant_id', 'external_sku', 'barcode');

    const variant = mappings.length
      ? await trx('variants')
          .where({ shop_id: shopId, lasyncro_variant_id: mappings[0].lasyncro_variant_id })
          .first('lasyncro_variant_id', 'sku', 'barcode', 'lasyncro_barcode')
      : null;

    return { mappings, variant };
  });
}

// ── A1 ──────────────────────────────────────────────────────────────────────

it('A1 — a Shopify variant with no sku and no barcode still receives an LSP- product identity, without fabricating a GTIN', async () => {
  const { shopId } = await provisionFt2Shop(crypto.randomUUID());
  const edge = barcodeLessCatalogEdge(crypto.randomBytes(4).toString('hex'));
  const externalVariantId = externalVariantIdOf(edge);

  await withTenant(shopId, (trx) => syncProducts(trx, shopId, [edge]));

  const { mappings, variant } = await ingestedState(shopId, externalVariantId);

  // The Shopify variant is ingested and externally addressable.
  expect(mappings).toHaveLength(1);
  expect(mappings[0].external_variant_id).toBe(externalVariantId);
  expect(variant).toBeTruthy();

  // Shopify supplied nothing to scan.
  expect(variant!.sku).toBeNull();

  // laSyncro mints its own product identity so the catalog is labelable.
  expect(variant!.lasyncro_barcode).toEqual(expect.any(String));
  expect(variant!.lasyncro_barcode).toMatch(LSP_PATTERN);

  // NAMESPACE BOUNDARY: the platform-owned GTIN column stays empty. Minting
  // here would invent a GTIN and be overwritten by the next sync.
  expect(variant!.barcode).toBeNull();
});

// ── A2 ──────────────────────────────────────────────────────────────────────

it('A2 — resyncing the same Shopify variant keeps one mapping, one variant id, and the same LSP- barcode', async () => {
  const { shopId } = await provisionFt2Shop(crypto.randomUUID());
  const edge = barcodeLessCatalogEdge(crypto.randomBytes(4).toString('hex'));
  const externalVariantId = externalVariantIdOf(edge);

  await withTenant(shopId, (trx) => syncProducts(trx, shopId, [edge]));
  const before = await ingestedState(shopId, externalVariantId);

  expect(before.mappings).toHaveLength(1);
  expect(before.variant!.lasyncro_barcode).toMatch(LSP_PATTERN);

  // Same catalog, second sync — the ordinary periodic resync.
  await withTenant(shopId, (trx) => syncProducts(trx, shopId, [edge]));
  const after = await ingestedState(shopId, externalVariantId);

  // Identity does not fork.
  expect(after.mappings).toHaveLength(1);
  expect(after.variant!.lasyncro_variant_id).toBe(before.variant!.lasyncro_variant_id);

  // Mint-once: a label already stuck to physical stock stays valid. The exact
  // value is random and deliberately not asserted — only its stability.
  expect(after.variant!.lasyncro_barcode).toBe(before.variant!.lasyncro_barcode);
  expect(after.variant!.lasyncro_barcode).toMatch(LSP_PATTERN);

  // Still no fabricated GTIN after a resync.
  expect(after.variant!.barcode).toBeNull();
});
