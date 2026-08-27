/**
 * SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, Slice 3.
 *
 * Certifies GET /api/v1/aha/signal's new priority-0 zero-order branch —
 * real authenticated HTTP through the real Express app, real DB facts,
 * isolated fixture shops. No dev_seed, no shared shop_id=1, no ambient DB.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

async function installFreshShop(shopDomain: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
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

  const ghostEmail = `shopify-install+${shopDomain}@lasyncro.internal`;
  const ghostLookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [ghostEmail])
  );
  const ghostUser = ghostLookup.rows?.[0]?.value;
  expect(ghostUser).toBeTruthy();

  return { shopId: ghostUser.shop_id as number, userId: ghostUser.id as number };
}

async function seedAuthoritativeIntegration(shopId: number, shopDomain: string) {
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: shopDomain,
      access_token_encrypted: 'offline-test-token-no-network-call',
      sync_status: 'COMPLETED',
      sync_last_error: null,
      updated_at: new Date(),
    })
  );
}

async function seedPcdFallbackIntegration(shopId: number, shopDomain: string) {
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: shopDomain,
      access_token_encrypted: 'offline-test-token-no-network-call',
      sync_status: 'COMPLETED',
      sync_last_error: 'PCD access required for orders and customers',
      updated_at: new Date(),
    })
  );
}

async function seedProduct(shopId: number) {
  const lasyncroProductId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('products').insert({
      lasyncro_product_id: lasyncroProductId,
      shop_id: shopId,
      title: 'Test Product',
    })
  );
  return lasyncroProductId;
}

async function seedOrder(shopId: number) {
  const lasyncroOrderId = crypto.randomUUID();
  const now = new Date();
  await withTenant(shopId, (trx) =>
    trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      currency: 'USD',
      total_price: 10,
      subtotal_price: 10,
      total_tax: 0,
      order_created_at: now,
      order_updated_at: now,
      payment_state: 'unpaid',
      aggregate_version: 1,
      created_at: now,
      updated_at: now,
    })
  );
  return lasyncroOrderId;
}

async function seedStockOutAlert(shopId: number) {
  await withTenant(shopId, (trx) =>
    trx('alerts').insert({
      shop_id: shopId,
      alert_key: `stock-out-${crypto.randomUUID()}`,
      source: 'demand_intelligence',
      alert_type: 'inventory',
      title: 'SKU stock-out risk',
      message: 'A SKU will stock out within 7 days.',
      is_active: true,
      revenue_impact: 500,
    })
  );
}

async function tokenFor(shopId: number, userId: number) {
  return issueTestToken({ userId, shopId });
}

describe('SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02 — GET /api/v1/aha/signal priority 0', () => {
  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  });

  it('AHA-A — authoritative zero-order store returns priority 0 with exact locked copy and factual cards', async () => {
    const shopDomain = `aha-zero-order-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    const token = await tokenFor(shopId, userId);

    const res = await request(app)
      .get('/api/v1/aha/signal')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.signal.priority).toBe(0);
    expect(res.body.signal.headline).toBe("You're connected — no orders yet.");
    expect(res.body.signal.detail).toBe(
      "Your Shopify sync finished successfully. You can set up your warehouse now — insights will start populating when your first orders arrive."
    );
    expect(res.body.signal.revenueImpact).toBeNull();
    expect(res.body.signal.cards).toEqual([
      { label: 'Sync status', value: 'Complete', sublabel: 'Shopify connection ready' },
      { label: 'Products synced', value: '0', sublabel: 'from your catalogue' },
      { label: 'Orders synced', value: '0', sublabel: 'no orders yet' },
    ]);

    // No fabricated analytics fields/content anywhere in the response.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/velocity/i);
    expect(serialized).not.toMatch(/days of stock/i);
    expect(serialized).not.toMatch(/operation looks healthy/i);
  });

  it('AHA-B — products exist, zero orders: still priority 0, Products synced card reflects the real count', async () => {
    const shopDomain = `aha-products-only-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedProduct(shopId);
    await seedProduct(shopId);
    const token = await tokenFor(shopId, userId);

    const res = await request(app)
      .get('/api/v1/aha/signal')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.signal.priority).toBe(0);
    expect(res.body.signal.cards[1]).toEqual({
      label: 'Products synced',
      value: '2',
      sublabel: 'from your catalogue',
    });
  });

  it('AHA-C — PCD-fallback completion never returns priority 0, no "sync finished successfully" claim', async () => {
    const shopDomain = `aha-pcd-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    await seedPcdFallbackIntegration(shopId, shopDomain);
    const token = await tokenFor(shopId, userId);

    const res = await request(app)
      .get('/api/v1/aha/signal')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.signal.priority).not.toBe(0);
    expect(res.body.signal.headline).not.toBe("You're connected — no orders yet.");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/sync finished successfully/i);
  });

  it('AHA-D — orders present: priority 0 never engages', async () => {
    const shopDomain = `aha-populated-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedProduct(shopId);
    await seedOrder(shopId);
    const token = await tokenFor(shopId, userId);

    const res = await request(app)
      .get('/api/v1/aha/signal')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.signal.priority).not.toBe(0);
  });

  it('AHA-E — existing priority-1 stock-out signal is unaffected: priority 0 did not reorder populated-store semantics', async () => {
    const shopDomain = `aha-stockout-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedProduct(shopId);
    await seedOrder(shopId);
    await seedStockOutAlert(shopId);
    const token = await tokenFor(shopId, userId);

    const res = await request(app)
      .get('/api/v1/aha/signal')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.signal.priority).toBe(1);
  });
});
