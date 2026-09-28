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


async function seedCriticalDemandVariant(shopId: number) {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const fulfilledAt = new Date();
  const pickCode = `A-${shopId}-1`;

  await withTenant(shopId, async (trx) => {
    const warehouse = await trx('warehouses')
      .where({
        shop_id: shopId,
        is_default: true,
        active: true,
      })
      .first('warehouse_id', 'root_location_code');

    if (!warehouse) {
      throw new Error(
        'GH1171 fixture requires the warehouse bootstrapped by installFreshShop'
      );
    }

    const warehouseId = String(warehouse.warehouse_id);
    const rootCode = String(warehouse.root_location_code);

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Aha critical product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `AHA-${variantId.slice(0, 8)}`,
      title: 'Aha critical variant',
      unit_cost: '5.00',
      status: 'active',
    });

    await trx('warehouse_locations').insert({
      shop_id: shopId,
      warehouse_id: warehouseId,
      location_code: pickCode,
      type: 'bin',
      parent_location_code: rootCode,
      active: true,
      zone_type: 'pick',
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    await trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: pickCode,
      on_hand_quantity: 0,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: 0,
      last_evaluated_at: fulfilledAt,
    });

    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      aggregate_version: 1,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: fulfilledAt,
      order_updated_at: fulfilledAt,
      created_at: fulfilledAt,
      updated_at: fulfilledAt,
    });

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: String(Date.now()),
    });

    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: `AHA-${variantId.slice(0, 8)}`,
      title: 'Aha fulfilled sale',
      quantity: 1,
      fulfilled_quantity: 1,
      unit_price: '100.00',
      line_total: '100.00',
      estimated_unit_cost: '5.00',
    });

    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'fulfilled',
      status_updated_at: fulfilledAt,
      fulfilled_at: fulfilledAt,
    });
  });

  return variantId;
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

  it('AHA-E — generic active inventory alert with zero current critical SKUs never manufactures priority 1', async () => {
    const shopDomain = `aha-stale-inventory-${Date.now()}.myshopify.com`;
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
    expect(res.body.signal.priority).not.toBe(1);
    expect(res.body.signal.headline).not.toMatch(/replenishment attention/i);
  });

  it('AHA-F — a real current critical SKU produces one coherent priority-1 first report', async () => {
    const shopDomain = `aha-current-critical-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    await seedAuthoritativeIntegration(shopId, shopDomain);
    await seedCriticalDemandVariant(shopId);
    const token = await tokenFor(shopId, userId);

    const res = await request(app)
      .get('/api/v1/aha/signal')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.signal.priority).toBe(1);
    expect(res.body.signal.headline).toBe('1 SKU needs replenishment attention');
    expect(res.body.signal.revenueImpact).toBeNull();
    expect(res.body.signal.cards).toEqual([
      {
        label: 'SKUs needing action',
        value: '1',
        sublabel: 'current replenishment urgency',
      },
      {
        label: 'Out of stock now',
        value: '1',
        sublabel: 'zero available stock',
      },
      {
        label: 'Avg days of stock',
        value: '0d',
        sublabel: 'across catalogue',
      },
    ]);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/revenue at risk/i);
    expect(serialized).not.toMatch(/potential impact/i);
    expect(serialized).not.toMatch(/within 7 days/i);
  });
});
