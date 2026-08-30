/**
 * SHOP-REVIEW-BARCODE-PRINT-05 — Floor Planning barcode print endpoints.
 *
 * Behavioural, DB-backed coverage of the four label endpoints the Barcodes tab
 * calls, plus the printer-role validation fix:
 *
 *   BE1  POST /zones/:code/print            → application/pdf + sensible filename
 *   BE2  POST /zones/print-batch            → application/pdf (small batch)
 *   BE2b POST /zones/print-batch  30 codes  → application/pdf, PDF has exactly 2 pages
 *   BE3  POST /products/:variantId/print    → application/pdf
 *   BE4  POST /products/print-batch         → application/pdf (small batch)
 *   BE4b POST /products/print-batch 30 vars → application/pdf, PDF has exactly 2 pages
 *   BE5  empty batch                        → controlled 400
 *   BE6  no printable result               → controlled 404
 *   BE7  cross-tenant ids are excluded / cannot print foreign data
 *   BE8  printer role 'product_label' accepted by printer create validation
 *   BE9  an unknown printer role is still rejected 400
 *
 * BE2b/BE4b close BP2_FULL_PDF_PROOF: pagination is asserted on the real HTTP
 * response with pdf-lib, not inferred. 30 labels at avery-5160 (24/sheet) must
 * be exactly 2 pages — proving no selected item is silently dropped to the
 * first sheet.
 *
 * Disposable synchroflow_test_* DB only (`npm run test:integration`). No
 * production PDF rendering is asserted pixel-for-pixel — only the HTTP contract
 * and page count.
 */
import crypto from 'crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { issueTestToken } from '../../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

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
  const shopDomain = `bcp-${label}-${Date.now()}.myshopify.com`;
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
  const rootLocationCode = `WH-${shopId}-ROOT`;
  return { shopId, userId, token, rootLocationCode };
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function firstVariantId(shopId: number): Promise<string> {
  const row = await withTenant(shopId, (trx) =>
    trx('variants').where({ shop_id: shopId }).orderBy('sku').first('lasyncro_variant_id'));
  expect(row?.lasyncro_variant_id).toBeTruthy();
  return row!.lasyncro_variant_id;
}

async function allVariantIds(shopId: number): Promise<string[]> {
  const rows = await withTenant(shopId, (trx) =>
    trx('variants').where({ shop_id: shopId }).orderBy('sku').select('lasyncro_variant_id'));
  return rows.map((r: { lasyncro_variant_id: string }) => r.lasyncro_variant_id);
}

/** Create an active pick bin via the real floor-planning endpoint. */
async function createBin(token: string, rootLocationCode: string, code: string) {
  const res = await request(app)
    .post('/api/v1/floor-planning/zones')
    .set(authed(token))
    .send({ location_code: code, type: 'bin', parent_location_code: rootLocationCode, zone_type: 'pick' });
  expect(res.status).toBe(201);
  return code;
}

/** supertest binary body → Buffer, so pdf-lib can load the real PDF bytes. */
function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  (res as unknown as NodeJS.ReadableStream).on('data', (c: Buffer | string) =>
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, 'binary')));
  (res as unknown as NodeJS.ReadableStream).on('end', () => cb(null, Buffer.concat(chunks)));
}

async function pageCount(buf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buf);
  return doc.getPageCount();
}

/** Create N tenant-owned variants that already carry a lasyncro_barcode, so a
 *  print test exercises pagination rather than mint-on-print. */
async function seedBarcodedVariants(shopId: number, n: number): Promise<string[]> {
  const seedProduct = await withTenant(shopId, (trx) =>
    trx('variants').where({ shop_id: shopId }).first('lasyncro_product_id'));
  expect(seedProduct?.lasyncro_product_id).toBeTruthy();
  const now = new Date();
  const stamp = Date.now().toString(36);
  const rows = Array.from({ length: n }, (_, i) => ({
    lasyncro_variant_id: crypto.randomUUID(),
    lasyncro_product_id: seedProduct!.lasyncro_product_id,
    shop_id: shopId,
    sku: `BULK-${stamp}-${String(i).padStart(3, '0')}`,
    title: `Bulk variant ${i}`,
    unit_cost: '1.00',
    status: 'active',
    lasyncro_barcode: `LSPB${stamp}${String(i).padStart(3, '0')}`.slice(0, 20),
    created_at: now,
    updated_at: now,
  }));
  await withTenant(shopId, (trx) => trx('variants').insert(rows));
  return rows.map((r) => r.lasyncro_variant_id);
}

describe('SHOP-REVIEW-BARCODE-PRINT-05 — barcode print endpoints', () => {
  it('BE1 — single location print returns a PDF with a sensible filename', async () => {
    const { shopId, token, rootLocationCode } = await provisionFt2Shop('be1');
    const bin = await createBin(token, rootLocationCode, `BCP-${shopId}-A1`);

    const res = await request(app)
      .post(`/api/v1/floor-planning/zones/${bin}/print`)
      .set(authed(token))
      .send({});

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/\.pdf/);
  }, 120_000);

  it('BE2 — batch location print returns a PDF', async () => {
    const { shopId, token, rootLocationCode } = await provisionFt2Shop('be2');
    const bin = await createBin(token, rootLocationCode, `BCP-${shopId}-B1`);

    const res = await request(app)
      .post('/api/v1/floor-planning/zones/print-batch')
      .set(authed(token))
      .send({ locationCodes: [rootLocationCode, bin], formatId: 'avery-5160' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/\.pdf/);
  }, 120_000);

  it('BE2b — 30 locations at avery-5160 → a 2-page PDF (multi-sheet pagination)', async () => {
    const { shopId, token, rootLocationCode } = await provisionFt2Shop('be2b');
    const FIXTURE = 30;                    // > 24/sheet → exactly 2 pages
    const codes: string[] = [rootLocationCode];
    for (let i = 1; i < FIXTURE; i++) {
      codes.push(await createBin(token, rootLocationCode, `BCP-${shopId}-M${String(i).padStart(2, '0')}`));
    }
    expect(codes).toHaveLength(FIXTURE);   // full request participation

    const res = await request(app)
      .post('/api/v1/floor-planning/zones/print-batch')
      .set(authed(token))
      .buffer(true)
      .parse(binaryParser)
      .send({ locationCodes: codes, formatId: 'avery-5160' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/\.pdf/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(await pageCount(res.body)).toBe(2);
  }, 180_000);

  it('BE3 — single product print returns a PDF', async () => {
    const { shopId, token } = await provisionFt2Shop('be3');
    const variantId = await firstVariantId(shopId);

    const res = await request(app)
      .post(`/api/v1/floor-planning/products/${variantId}/print`)
      .set(authed(token))
      .send({});

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/\.pdf/);
  }, 120_000);

  it('BE4 — batch product print returns a PDF', async () => {
    const { shopId, token } = await provisionFt2Shop('be4');
    const ids = await allVariantIds(shopId);
    expect(ids.length).toBeGreaterThanOrEqual(1);

    const res = await request(app)
      .post('/api/v1/floor-planning/products/print-batch')
      .set(authed(token))
      .send({ lasyncroVariantIds: ids, formatId: 'thermal-50x25' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  }, 120_000);

  it('BE4b — 30 pre-barcoded products at avery-5160 → a 2-page PDF (multi-sheet pagination)', async () => {
    const { shopId, token } = await provisionFt2Shop('be4b');
    const FIXTURE = 30;                    // > 24/sheet → exactly 2 pages
    const ids = await seedBarcodedVariants(shopId, FIXTURE);
    expect(ids).toHaveLength(FIXTURE);     // full request participation

    const res = await request(app)
      .post('/api/v1/floor-planning/products/print-batch')
      .set(authed(token))
      .buffer(true)
      .parse(binaryParser)
      .send({ lasyncroVariantIds: ids, formatId: 'avery-5160' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/\.pdf/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(await pageCount(res.body)).toBe(2);
  }, 180_000);

  it('BE5 — empty batch selection → controlled 400', async () => {
    const { token } = await provisionFt2Shop('be5');

    const zones = await request(app)
      .post('/api/v1/floor-planning/zones/print-batch').set(authed(token)).send({ locationCodes: [] });
    expect(zones.status).toBe(400);

    const products = await request(app)
      .post('/api/v1/floor-planning/products/print-batch').set(authed(token)).send({ lasyncroVariantIds: [] });
    expect(products.status).toBe(400);
  }, 120_000);

  it('BE6 — nothing printable in the selection → controlled 404', async () => {
    const { token } = await provisionFt2Shop('be6');

    const zones = await request(app)
      .post('/api/v1/floor-planning/zones/print-batch').set(authed(token))
      .send({ locationCodes: ['NO-SUCH-CODE-XYZ'] });
    expect(zones.status).toBe(404);

    const products = await request(app)
      .post('/api/v1/floor-planning/products/print-batch').set(authed(token))
      .send({ lasyncroVariantIds: [crypto.randomUUID()] });
    expect(products.status).toBe(404);
  }, 120_000);

  it('BE7 — cross-tenant ids cannot print foreign data', async () => {
    const a = await provisionFt2Shop('be7a');
    const b = await provisionFt2Shop('be7b');
    const foreignBin = await createBin(b.token, b.rootLocationCode, `BCP-${b.shopId}-FOREIGN`);
    const foreignVariant = await firstVariantId(b.shopId);

    // shop A submits shop B's location code → filtered out → 404, nothing printed
    const zones = await request(app)
      .post('/api/v1/floor-planning/zones/print-batch').set(authed(a.token))
      .send({ locationCodes: [foreignBin] });
    expect(zones.status).toBe(404);

    // shop A submits shop B's variant id → filtered out → 404
    const products = await request(app)
      .post('/api/v1/floor-planning/products/print-batch').set(authed(a.token))
      .send({ lasyncroVariantIds: [foreignVariant] });
    expect(products.status).toBe(404);

    // and the single-product endpoint refuses the foreign id
    const single = await request(app)
      .post(`/api/v1/floor-planning/products/${foreignVariant}/print`).set(authed(a.token)).send({});
    expect(single.status).toBe(404);
  }, 150_000);

  it('BE8 — printer role product_label is accepted by printer create validation', async () => {
    const { token } = await provisionFt2Shop('be8');

    const res = await request(app)
      .post('/api/v1/wms/printers')
      .set(authed(token))
      .send({ name: 'Product thermal', connection_type: 'usb', role: 'product_label', is_default: true });

    expect(res.status).toBe(201);
    expect(res.body.printer.role).toBe('product_label');
  }, 120_000);

  it('BE9 — an unknown printer role is still rejected 400', async () => {
    const { token } = await provisionFt2Shop('be9');

    const res = await request(app)
      .post('/api/v1/wms/printers')
      .set(authed(token))
      .send({ name: 'Bogus', connection_type: 'usb', role: 'totally_bogus_role' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/invalid role/i);
  }, 120_000);
});
