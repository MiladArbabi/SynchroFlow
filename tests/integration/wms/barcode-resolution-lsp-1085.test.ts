/**
 * GH-1085 / BARCODE-LIFECYCLE-01 — Slice A, contracts A3 + A4.
 *
 * A minted LSP- product barcode is worthless if the scanner cannot resolve it.
 *
 * A3 — LSP- is a FIRST-CLASS namespace, resolved on its own terms alongside
 *      LSU-, and therefore independent of legacy_barcode_fallback_enabled.
 *      A tenant that has sunset legacy EAN/UPC/SKU scanning must still be able
 *      to scan the labels laSyncro itself printed. Today an LSP- value falls
 *      through to the legacy branch and is refused by that gate, which makes
 *      the app's own barcodes unscannable exactly for the tenants furthest
 *      along the unit-labelling migration.
 *
 * A4 — LSP- resolution is tenant-scoped. One shop's product identity must never
 *      resolve inside another shop. This test carries a same-value positive
 *      control so it cannot pass vacuously: the identical barcode resolves for
 *      its owner in the same run, and the cross-tenant attempt is made with
 *      legacy fallback ENABLED so a null can never be blamed on that gate.
 *
 * Real resolveBarcode() against the disposable synchroflow_test_* database —
 * `npm run test:integration`. Direct service + DB: the contract is resolver
 * behaviour and tenant scoping, and HTTP would add a routing layer without
 * adding contract value.
 *
 * Scope: LSP only. LSU-, external EAN/UPC and SKU resolution are already
 * covered elsewhere and are deliberately not duplicated or weakened here.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { resolveBarcode } from 'api-src/services/wms/barcodeResolution.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(120000);

const LSP_PATTERN = /^LSP-[A-Z2-9]{8}$/;

/**
 * Mirrors the production alphabet in productBarcode.service.ts (no I, O, 0, 1 —
 * visually ambiguous under a scanner). Built locally rather than imported so
 * this resolver contract does not depend on the minting service.
 */
const LSP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeLspBarcode(): string {
  let code = 'LSP-';
  for (let i = 0; i < 8; i++) {
    code += LSP_ALPHABET[crypto.randomInt(LSP_ALPHABET.length)];
  }
  return code;
}

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
  const shopDomain = `lsp1085-${label}-${Date.now()}.myshopify.com`;
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
  return { shopId, userId, token };
}

// ── fixtures ────────────────────────────────────────────────────────────────

/** One tenant-owned product + variant. Every identity column is explicit. */
async function seedCatalogVariant(
  shopId: number,
  opts: {
    label: string;
    sku?: string | null;
    barcode?: string | null;
    lasyncroBarcode?: string | null;
  }
): Promise<{ lasyncroProductId: string; lasyncroVariantId: string }> {
  const lasyncroProductId = crypto.randomUUID();
  const lasyncroVariantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: lasyncroProductId,
      shop_id: shopId,
      title: `GH1085 ${opts.label} product`,
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: lasyncroVariantId,
      lasyncro_product_id: lasyncroProductId,
      shop_id: shopId,
      sku: opts.sku ?? null,
      title: `GH1085 ${opts.label} variant`,
      unit_cost: '3.50',
      status: 'active',
      barcode: opts.barcode ?? null,
      lasyncro_barcode: opts.lasyncroBarcode ?? null,
    });
  });

  return { lasyncroProductId, lasyncroVariantId };
}

/**
 * A tenant-owned variant carrying a known LSP- identity and nothing else a
 * legacy path could match on: no sku, no external EAN/UPC, and no identity-map
 * row. Any successful resolution therefore came from the LSP- namespace itself.
 */
async function seedLspVariant(shopId: number): Promise<{
  lasyncroVariantId: string;
  lspBarcode: string;
}> {
  const lspBarcode = makeLspBarcode();
  expect(lspBarcode).toMatch(LSP_PATTERN);

  const { lasyncroVariantId } = await seedCatalogVariant(shopId, {
    label: 'LSP',
    sku: null,
    barcode: null,
    lasyncroBarcode: lspBarcode,
  });

  return { lasyncroVariantId, lspBarcode };
}

/** shop_wms_settings is provisioned at install; this flips the legacy gate. */
async function setLegacyFallback(shopId: number, enabled: boolean): Promise<void> {
  const updated = await withTenant(shopId, (trx) =>
    trx('shop_wms_settings')
      .where({ shop_id: shopId })
      .update({ legacy_barcode_fallback_enabled: enabled, updated_at: new Date() }));
  expect(updated).toBe(1);

  const row = await withTenant(shopId, (trx) =>
    trx('shop_wms_settings').where({ shop_id: shopId }).first('legacy_barcode_fallback_enabled'));
  expect(row!.legacy_barcode_fallback_enabled).toBe(enabled);
}

// ── A3 ──────────────────────────────────────────────────────────────────────

it('A3 — an LSP- product barcode resolves on its own namespace even when legacy barcode fallback is disabled', async () => {
  const { shopId } = await provisionFt2Shop(crypto.randomUUID());
  const { lasyncroVariantId, lspBarcode } = await seedLspVariant(shopId);

  // The tenant has sunset legacy EAN/UPC/SKU scanning. LSP- must be unaffected:
  // these are laSyncro's own labels, not a legacy platform identifier.
  await setLegacyFallback(shopId, false);

  const result = await withTenant(shopId, (trx) => resolveBarcode(trx, shopId, lspBarcode));

  expect(result).not.toBeNull();
  expect(result).toMatchObject({
    lasyncro_variant_id: lasyncroVariantId,
    resolution_method: 'product_barcode',
  });
});

// ── A4 ──────────────────────────────────────────────────────────────────────

it('A4 — an LSP- product barcode never resolves inside another tenant, and its owner still resolves it', async () => {
  const tenantA = await provisionFt2Shop(crypto.randomUUID());
  const tenantB = await provisionFt2Shop(crypto.randomUUID());
  expect(tenantA.shopId).not.toBe(tenantB.shopId);

  const { lasyncroVariantId, lspBarcode } = await seedLspVariant(tenantA.shopId);

  /**
   * Tenant B keeps legacy fallback ENABLED on purpose. With the gate open, a
   * null result cannot be attributed to the legacy switch — it can only mean
   * the lookup was shop-scoped. This is what stops A4 passing for the wrong
   * reason.
   */
  await setLegacyFallback(tenantB.shopId, true);

  const asTenantB = await withTenant(tenantB.shopId, (trx) =>
    resolveBarcode(trx, tenantB.shopId, lspBarcode));

  expect(asTenantB).toBeNull();

  // Positive control, same value, same run: the barcode IS resolvable — just
  // not by a stranger. Without this, A4 would pass simply because nothing
  // resolves LSP- at all.
  const asTenantA = await withTenant(tenantA.shopId, (trx) =>
    resolveBarcode(trx, tenantA.shopId, lspBarcode));

  expect(asTenantA).toMatchObject({
    lasyncro_variant_id: lasyncroVariantId,
    resolution_method: 'product_barcode',
  });

  // Tenant B's own catalog is untouched by the foreign identity.
  const leaked = await withTenant(tenantB.shopId, (trx) =>
    trx('variants').where({ shop_id: tenantB.shopId, lasyncro_barcode: lspBarcode }).first());
  expect(leaked).toBeUndefined();
});

// ── neighbour-regression fixtures (N1–N5) ───────────────────────────────────
//
// The Slice A refactor hoisted and renamed the shared unit-attachment helper
// (pickLegacyUnit → resolveAvailableUnitForVariant) and inserted the LSP-
// branch ahead of the legacy gate. These fixtures exist to prove that neither
// change altered any pre-existing barcode semantics.

/**
 * Per-unit identity is created by the receive workflow in production, and
 * inventory_units.receive_job_line_id is NOT NULL, so the minimum valid fixture
 * is supplier → purchase_order → receive_job → receive_job_line.
 * Synthetic identifiers only; no provider identifiers, no network.
 */
async function seedReceiveJob(shopId: number): Promise<string> {
  return withTenant(shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shopId, name: `GH1085 supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: supplier.id })
      .returning('id');
    const [job] = await trx('receive_jobs')
      .insert({ shop_id: shopId, po_id: po.id })
      .returning('receive_job_id');
    return job.receive_job_id as string;
  });
}

async function seedInventoryUnit(
  shopId: number,
  opts: {
    lasyncroVariantId: string;
    receiveJobId: string;
    sequence: number;
    status: 'received' | 'stowed' | 'picked' | 'packed' | 'shipped';
    locationCode?: string | null;
  }
): Promise<string> {
  const lasyncroUnitId = `LSU-${crypto.randomBytes(4).toString('hex')}`;

  await withTenant(shopId, async (trx) => {
    const existing = await trx('receive_job_lines')
      .where({
        shop_id: shopId,
        receive_job_id: opts.receiveJobId,
        lasyncro_variant_id: opts.lasyncroVariantId,
      })
      .first('receive_job_line_id');

    const receiveJobLineId =
      existing?.receive_job_line_id ??
      (
        await trx('receive_job_lines')
          .insert({
            shop_id: shopId,
            receive_job_id: opts.receiveJobId,
            lasyncro_variant_id: opts.lasyncroVariantId,
            quantity_expected: 10,
          })
          .returning('receive_job_line_id')
      )[0].receive_job_line_id;

    await trx('inventory_units').insert({
      shop_id: shopId,
      lasyncro_unit_id: lasyncroUnitId,
      lasyncro_variant_id: opts.lasyncroVariantId,
      receive_job_line_id: receiveJobLineId,
      receive_sequence: opts.sequence,
      status: opts.status,
      current_location_code: opts.locationCode ?? null,
    });
  });

  return lasyncroUnitId;
}

type LegacyNamespace = 'barcode' | 'sku' | 'external_variant_id';

/**
 * A variant reachable through exactly ONE legacy identifier, plus two units:
 * an eligible 'received' one the resolver must attach, and an ineligible
 * 'shipped' sibling it must ignore. Every non-target identity column is left
 * null so a match can only have come from the namespace under test.
 */
async function seedLegacyVariant(
  shopId: number,
  namespace: LegacyNamespace
): Promise<{
  lasyncroVariantId: string;
  scanValue: string;
  eligibleUnitId: string;
  ineligibleUnitId: string;
}> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalProductId = `gid://shopify/Product/1085N${nonce}`;
  const externalVariantId = `gid://shopify/ProductVariant/1085N${nonce}`;

  const externalBarcode = `50${crypto.randomInt(10 ** 10, 10 ** 11)}`; // EAN-13 shaped
  const externalSku = `GH1085-SKU-${nonce}`;

  const scanValue =
    namespace === 'barcode' ? externalBarcode
    : namespace === 'sku' ? externalSku
    : externalVariantId;

  const { lasyncroVariantId } = await seedCatalogVariant(shopId, {
    label: `legacy-${namespace}`,
    // variants.sku is cosmetic for resolution (the resolver reads the identity
    // map's external_sku) but is kept coherent with the fixture.
    sku: namespace === 'sku' ? externalSku : null,
    // variants.barcode deliberately stays null: 4a checks the identity map
    // first, and this keeps each namespace reachable by exactly one route.
    barcode: null,
    lasyncroBarcode: null,
  });

  await withTenant(shopId, (trx) =>
    trx('external_product_identity_map').insert({
      id: crypto.randomUUID(),
      shop_id: shopId,
      // Migration 0028 renamed this table's lasyncro_product_id column to
      // lasyncro_variant_id — the map is variant-grained. Same shape
      // shopifyProducts.core.ts writes.
      lasyncro_variant_id: lasyncroVariantId,
      platform: 'shopify',
      external_product_id: externalProductId,
      external_variant_id: externalVariantId,
      external_inventory_item_id: null,
      external_sku: namespace === 'sku' ? externalSku : null,
      barcode: namespace === 'barcode' ? externalBarcode : null,
    }));

  const receiveJobId = await seedReceiveJob(shopId);
  const eligibleUnitId = await seedInventoryUnit(shopId, {
    lasyncroVariantId, receiveJobId, sequence: 1, status: 'received', locationCode: 'RCV-01',
  });
  const ineligibleUnitId = await seedInventoryUnit(shopId, {
    lasyncroVariantId, receiveJobId, sequence: 2, status: 'shipped',
  });

  return { lasyncroVariantId, scanValue, eligibleUnitId, ineligibleUnitId };
}

// ── N1 ──────────────────────────────────────────────────────────────────────

it('N1 — an LSU- scan still resolves that exact unit, never a sibling candidate', async () => {
  const { shopId } = await provisionFt2Shop(crypto.randomUUID());
  const { lasyncroVariantId } = await seedCatalogVariant(shopId, { label: 'LSU exact' });
  const receiveJobId = await seedReceiveJob(shopId);

  /**
   * The sibling is deliberately the unit the GENERIC helper would choose:
   * 'received' outranks 'stowed', and sequence 1 outranks sequence 2. So if
   * LSU- ever fell through to resolveAvailableUnitForVariant, this test would
   * return the sibling. Getting the target back is what proves exact-unit
   * semantics survived the refactor.
   */
  const siblingUnitId = await seedInventoryUnit(shopId, {
    lasyncroVariantId, receiveJobId, sequence: 1, status: 'received', locationCode: 'RCV-01',
  });
  const targetUnitId = await seedInventoryUnit(shopId, {
    lasyncroVariantId, receiveJobId, sequence: 2, status: 'stowed', locationCode: 'A-01-01',
  });
  expect(targetUnitId).not.toBe(siblingUnitId);

  const result = await withTenant(shopId, (trx) => resolveBarcode(trx, shopId, targetUnitId));

  expect(result).toMatchObject({
    lasyncro_variant_id: lasyncroVariantId,
    resolution_method: 'unit_barcode',
    lasyncro_unit_id: targetUnitId,
    unit_status: 'stowed',
    current_location_code: 'A-01-01',
  });
  expect(result!.lasyncro_unit_id).not.toBe(siblingUnitId);
});

// ── N2 ──────────────────────────────────────────────────────────────────────

it('N2 — a legacy external barcode still resolves and still attaches an eligible unit', async () => {
  const { shopId } = await provisionFt2Shop(crypto.randomUUID());
  await setLegacyFallback(shopId, true);
  const fixture = await seedLegacyVariant(shopId, 'barcode');

  const result = await withTenant(shopId, (trx) => resolveBarcode(trx, shopId, fixture.scanValue));

  expect(result).toMatchObject({
    lasyncro_variant_id: fixture.lasyncroVariantId,
    resolution_method: 'barcode',
    lasyncro_unit_id: fixture.eligibleUnitId,
    unit_status: 'received',
  });
  // A shipped unit is not available stock and must never be attached.
  expect(result!.lasyncro_unit_id).not.toBe(fixture.ineligibleUnitId);
});

// ── N3 ──────────────────────────────────────────────────────────────────────

it('N3 — a legacy SKU still resolves and still attaches an eligible unit', async () => {
  const { shopId } = await provisionFt2Shop(crypto.randomUUID());
  await setLegacyFallback(shopId, true);
  const fixture = await seedLegacyVariant(shopId, 'sku');

  const result = await withTenant(shopId, (trx) => resolveBarcode(trx, shopId, fixture.scanValue));

  expect(result).toMatchObject({
    lasyncro_variant_id: fixture.lasyncroVariantId,
    resolution_method: 'sku',
    lasyncro_unit_id: fixture.eligibleUnitId,
    unit_status: 'received',
  });
  expect(result!.lasyncro_unit_id).not.toBe(fixture.ineligibleUnitId);
});

// ── N4 ──────────────────────────────────────────────────────────────────────

it('N4 — a legacy external variant id still resolves and still attaches an eligible unit', async () => {
  const { shopId } = await provisionFt2Shop(crypto.randomUUID());
  await setLegacyFallback(shopId, true);
  const fixture = await seedLegacyVariant(shopId, 'external_variant_id');

  const result = await withTenant(shopId, (trx) => resolveBarcode(trx, shopId, fixture.scanValue));

  expect(result).toMatchObject({
    lasyncro_variant_id: fixture.lasyncroVariantId,
    resolution_method: 'external_variant_id',
    lasyncro_unit_id: fixture.eligibleUnitId,
    unit_status: 'received',
  });
  expect(result!.lasyncro_unit_id).not.toBe(fixture.ineligibleUnitId);
});

// ── N5 ──────────────────────────────────────────────────────────────────────

it('N5 — the legacy gate still refuses every legacy namespace when fallback is disabled', async () => {
  const { shopId } = await provisionFt2Shop(crypto.randomUUID());

  // Seed with the gate OPEN and prove each value resolves, so the nulls below
  // cannot be explained by a broken fixture.
  await setLegacyFallback(shopId, true);
  const byBarcode = await seedLegacyVariant(shopId, 'barcode');
  const bySku = await seedLegacyVariant(shopId, 'sku');
  const byVariantId = await seedLegacyVariant(shopId, 'external_variant_id');

  for (const fixture of [byBarcode, bySku, byVariantId]) {
    const open = await withTenant(shopId, (trx) => resolveBarcode(trx, shopId, fixture.scanValue));
    expect(open).not.toBeNull();
  }

  // Sunset legacy scanning. Every legacy namespace must now fail closed.
  await setLegacyFallback(shopId, false);

  for (const fixture of [byBarcode, bySku, byVariantId]) {
    const closed = await withTenant(shopId, (trx) => resolveBarcode(trx, shopId, fixture.scanValue));
    expect(closed).toBeNull();
  }
});
