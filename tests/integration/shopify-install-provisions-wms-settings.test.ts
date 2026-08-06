import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';

const app = createApp();

describe('Shopify install flow', () => {
  const shopDomain = `fresh-install-test-${Date.now()}.myshopify.com`;

  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
    process.env.API_URL = process.env.API_URL || 'https://api.test';
  });

  it('bootstraps a new Shopify tenant with WMS settings and Shopify billing provider', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = { shop: shopDomain, timestamp };
    const message = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key as keyof typeof params]}`)
      .join('&');
    const hmac = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET!) // test-only secret set above
      .update(message)
      .digest('hex');

    const res = await request(app)
      .get('/api/v1/integrations/shopify/install')
      .query({ ...params, hmac })
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`${shopDomain}/admin/oauth/authorize`);

    // Migrations 0137/0138 made RLS a real enforcement boundary: under sf_app,
    // systemQuery only waives the application tenant guard — PostgreSQL still
    // applies the strict positive-tenant policy on users/shop_memberships, so a
    // pre-tenant read returns zero rows. Use the reviewed SECURITY DEFINER
    // resolver 0138 introduced for exactly this lookup.
    const ghostEmail = `shopify-install+${shopDomain}@lasyncro.internal`;
    const ghostLookup = await systemQuery(
      db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [ghostEmail])
    );
    const ghostUser = ghostLookup.rows?.[0]?.value;

    expect(ghostUser).toBeTruthy();
    expect(ghostUser.shop_id).toBeTruthy();

    const shopId = ghostUser.shop_id as number;

    const memberships = await withTenant(shopId, (trx) =>
      trx('shop_memberships').where({ user_id: ghostUser.id })
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');
    const wmsSettings = await withTenant(shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: shopId }).first()
    );
    expect(wmsSettings).toBeDefined();

    const subscription = await withTenant(shopId, (trx) =>
      trx('shop_subscriptions').where({ shop_id: shopId }).first()
    );
    expect(subscription).toBeDefined();
    expect(subscription?.billing_provider).toBe('shopify');

    const warehouse = await withTenant(shopId, (trx) =>
      trx('warehouses').where({ shop_id: shopId }).first()
    );
    expect(warehouse).toBeDefined();
    expect(warehouse?.root_location_code).toBe(`WH-${shopId}-ROOT`);

    const location = await withTenant(shopId, (trx) =>
      trx('warehouse_locations')
        .where({ shop_id: shopId, location_code: `WH-${shopId}-ROOT` })
        .first()
    );
    expect(location).toBeDefined();
    expect(location?.type).toBe('warehouse');
  });
});
