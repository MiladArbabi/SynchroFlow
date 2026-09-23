import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

const app = createApp();

function buildInstallRequest(shopDomain: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key as keyof typeof params]}`)
    .join('&');
  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!) // test-only secret set in beforeAll
    .update(message)
    .digest('hex');
  return { ...params, hmac };
}

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
    // S1-04 (SLICE 1) — a genuinely new shop provisioned by the Shopify
    // install path is explicitly classified reconcile_opening_expectation_v2.
    expect(wmsSettings?.bootstrap_model).toBe('reconcile_opening_expectation_v2');

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

  // S1-05 (SLICE 1) — reinstall/retry against an EXISTING shop must never
  // change its existing bootstrap_model. Fixture reproduces the reinstall
  // lookup's real prerequisite (a row in shopify_app_installations keyed by
  // shop_domain — see resolve_shopify_reinstall_shop, migration 0137) so the
  // real handleShopifyInstall "existing" branch (integration.controller.ts)
  // is exercised over HTTP, not bypassed.
  it('reinstall against an existing shop leaves its bootstrap_model unchanged', async () => {
    const reinstallDomain = `reinstall-test-${Date.now()}.myshopify.com`;

    const shopId = await systemTransaction(async (trx) => {
      const id = await createTenantShop(trx, `reinstall-fixture-${reinstallDomain}`);
      await setTenantContext(trx, id);
      return id;
    });

    await withTenant(shopId, (trx) =>
      trx('shop_wms_settings')
        .insert({ shop_id: shopId, bootstrap_model: 'legacy_opening_balance_v1' })
        .onConflict('shop_id')
        .ignore()
    );

    await withTenant(shopId, (trx) =>
      trx('shopify_app_installations').insert({
        shop_id: shopId,
        shop_domain: reinstallDomain,
        access_token: 'test-reinstall-token',
        scopes: 'read_products',
      })
    );

    // The reinstall branch (integration.controller.ts) requires an existing
    // owner membership ("No owner found for reinstall" -> 500 otherwise).
    // shop_memberships.user_id is NOT NULL, so seed a real fixture user.
    const [fixtureUser] = await withTenant(shopId, (trx) =>
      trx('users')
        .insert({
          shop_id: shopId,
          email: `reinstall-fixture+${reinstallDomain}@lasyncro.internal`,
          password_hash: 'test-fixture-hash',
          first_name: 'Reinstall',
          last_name: 'Fixture',
        })
        .returning('id')
    );
    const fixtureUserId = Number((fixtureUser as any).id ?? fixtureUser);

    await withTenant(shopId, (trx) =>
      trx('shop_memberships').insert({ shop_id: shopId, user_id: fixtureUserId, role: 'owner' })
    );

    const before = await withTenant(shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: shopId }).first('bootstrap_model')
    );
    expect(before?.bootstrap_model).toBe('legacy_opening_balance_v1');

    const res = await request(app)
      .get('/api/v1/integrations/shopify/install')
      .query(buildInstallRequest(reinstallDomain))
      .redirects(0);

    expect(res.status).toBe(302);

    const after = await withTenant(shopId, (trx) =>
      trx('shop_wms_settings').where({ shop_id: shopId }).first('bootstrap_model')
    );
    expect(after?.bootstrap_model).toBe('legacy_opening_balance_v1');
  });
});
