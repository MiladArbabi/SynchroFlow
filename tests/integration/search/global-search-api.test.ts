import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

async function seedShop(label: string): Promise<{ shopId: number; userId: number; token: string }> {
  const shopDomain = `global-search-${label}-${crypto.randomBytes(6).toString('hex')}.myshopify.com`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params).sort()
    .map((key) => `${key}=${params[key as keyof typeof params]}`)
    .join('&');
  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  const install = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ ...params, hmac })
    .redirects(0);
  expect(install.status).toBe(302);

  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [
      `shopify-install+${shopDomain}@lasyncro.internal`,
    ])
  );
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();

  const shopId = ghost.shop_id as number;
  const userId = ghost.id as number;
  await seedFreshInstall(shopId);

  return {
    shopId,
    userId,
    token: issueTestToken({ userId, shopId }),
  };
}

async function seedVariant(
  shopId: number,
  input: {
    productTitle: string;
    variantTitle: string;
    sku: string;
    barcode: string | null;
    lasyncroBarcode: string | null;
  }
): Promise<string> {
  const lasyncroProductId = crypto.randomUUID();
  const lasyncroVariantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: lasyncroProductId,
      shop_id: shopId,
      title: input.productTitle,
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: lasyncroVariantId,
      lasyncro_product_id: lasyncroProductId,
      shop_id: shopId,
      sku: input.sku,
      title: input.variantTitle,
      unit_cost: '4.00',
      status: 'active',
      barcode: input.barcode,
      lasyncro_barcode: input.lasyncroBarcode,
    });
  });

  return lasyncroVariantId;
}

async function seedOrder(shopId: number, externalOrderId: string): Promise<string> {
  const lasyncroOrderId = crypto.randomUUID();
  const now = new Date();

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '42.00',
      subtotal_price: '42.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });
  });

  return lasyncroOrderId;
}

async function seedBatch(
  shopId: number,
  pickBatchId = crypto.randomUUID(),
  status: 'pending' | 'picking' | 'pick_complete' | 'packing' | 'pack_complete' | 'cancelled' = 'pending',
): Promise<string> {
  await withTenant(shopId, (trx) =>
    trx('pick_batches').insert({
      pick_batch_id: pickBatchId,
      shop_id: shopId,
      status,
      release_trigger: 'manual',
      max_line_items: 50,
      total_line_items: 1,
      total_units: 1,
      released_by: null,
      released_at: new Date(),
    })
  );
  return pickBatchId;
}

async function representativeCounts(shopId: number) {
  return withTenant(shopId, async (trx) => ({
    orders: Number((await trx('orders').where({ shop_id: shopId }).count('* as count').first())!.count),
    variants: Number((await trx('variants').where({ shop_id: shopId }).count('* as count').first())!.count),
    batches: Number((await trx('pick_batches').where({ shop_id: shopId }).count('* as count').first())!.count),
  }));
}

describe('GET /api/v1/search', () => {
  it('rejects unauthenticated requests through auth middleware', async () => {
    const response = await request(app).get('/api/v1/search').query({ q: 'anything' });
    expect(response.status).toBe(401);
  });

  it('returns an empty result set for short queries', async () => {
    const shop = await seedShop('short');
    const response = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${shop.token}`)
      .query({ q: ' a ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: [] });
  });

  it('resolves orders, variants, barcodes, batches, tenant isolation, cap, and read-only behavior', async () => {
    const shopA = await seedShop('a');
    const shopB = await seedShop('b');
    const shared = 'GS1085';
    const numericOrderBase =
      `${Date.now()}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
    const sharedExternalOrderId = `${numericOrderBase}00`;

    const orderA = await seedOrder(shopA.shopId, sharedExternalOrderId);
    const orderB = await seedOrder(shopB.shopId, sharedExternalOrderId);

    const skuVariant = await seedVariant(shopA.shopId, {
      productTitle: `${shared} SKU product`,
      variantTitle: 'Default Title',
      sku: `${shared}-SKU`,
      barcode: null,
      lasyncroBarcode: 'LSP-GS1085AA',
    });
    const shopifyBarcodeVariant = await seedVariant(shopA.shopId, {
      productTitle: `${shared} EAN product`,
      variantTitle: 'Blue',
      sku: `${shared}-EAN-SKU`,
      barcode: '5012345678900',
      lasyncroBarcode: 'LSP-GS1085BB',
    });
    const lspVariant = await seedVariant(shopA.shopId, {
      productTitle: `${shared} LSP product`,
      variantTitle: 'Red',
      sku: `${shared}-LSP-SKU`,
      barcode: null,
      lasyncroBarcode: 'LSP-GS1085CC',
    });
    await seedVariant(shopB.shopId, {
      productTitle: `${shared} foreign product`,
      variantTitle: 'Default Title',
      sku: `${shared}-FOREIGN`,
      barcode: '5012345678900',
      lasyncroBarcode: 'LSP-GS1085DD',
    });

    const batchA = await seedBatch(shopA.shopId, '11111111-1111-4111-8111-111111111111');
    const completedBatchA = await seedBatch(shopA.shopId, '11111111-1111-4111-8111-333333333333', 'pack_complete');
    const cancelledBatchA = await seedBatch(shopA.shopId, '11111111-1111-4111-8111-444444444444', 'cancelled');
    await seedBatch(shopB.shopId, '11111111-1111-4111-8111-222222222222');

    for (let i = 0; i < 8; i++) {
      await seedOrder(shopA.shopId, `${numericOrderBase}${String(i + 1).padStart(2, '0')}`);
    }

    const before = await representativeCounts(shopA.shopId);

    const orderSearch = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${shopA.token}`)
      .query({ q: `order ${sharedExternalOrderId}` });
    expect(orderSearch.status).toBe(200);
    expect(orderSearch.body.results).toContainEqual(
      expect.objectContaining({ type: 'order', id: orderA, label: sharedExternalOrderId })
    );
    expect(orderSearch.body.results).not.toContainEqual(
      expect.objectContaining({ type: 'order', id: orderB })
    );

    const skuSearch = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${shopA.token}`)
      .query({ q: `${shared}-SKU` });
    expect(skuSearch.body.results).toContainEqual(
      expect.objectContaining({ type: 'variant', id: skuVariant })
    );

    const shopifyBarcodeSearch = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${shopA.token}`)
      .query({ q: '5012345678900' });
    expect(shopifyBarcodeSearch.body.results).toContainEqual(
      expect.objectContaining({ type: 'variant', id: shopifyBarcodeVariant })
    );

    const lspSearch = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${shopA.token}`)
      .query({ q: 'LSP-GS1085CC' });
    expect(lspSearch.body.results).toContainEqual(
      expect.objectContaining({ type: 'variant', id: lspVariant })
    );

    const batchSearch = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${shopA.token}`)
      .query({ q: batchA.slice(0, 8) });
    expect(batchSearch.body.results).toContainEqual(
      expect.objectContaining({ type: 'batch', id: batchA })
    );
    expect(batchSearch.body.results).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'batch', id: completedBatchA }),
        expect.objectContaining({ type: 'batch', id: cancelledBatchA }),
      ])
    );

    const broadSearch = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${shopA.token}`)
      .query({ q: shared });
    expect(broadSearch.status).toBe(200);
    expect(broadSearch.body.results.length).toBeLessThanOrEqual(6);
    expect(broadSearch.body.results).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: orderB }),
        expect.objectContaining({ id: '11111111-1111-4111-8111-222222222222' }),
      ])
    );

    expect(await representativeCounts(shopA.shopId)).toEqual(before);
  });
});
