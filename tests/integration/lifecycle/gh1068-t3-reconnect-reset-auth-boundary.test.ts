import crypto from 'crypto';
import db, { systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { persistShopifyAdminCredentials } from
  'api-src/services/shopify/shopifyAdminCredential.repository';
import { updateIntegrationStatus } from
  'api-src/services/shopify/shopifyIntegrationStatus.service';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';

beforeAll(() => {
  if (process.env.NODE_ENV !== 'test'
    || process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1'
    || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(process.env.PGDATABASE ?? '')
    || process.env.PGUSER !== 'sf_app') {
    throw new Error('GH1068_T3_AUTH_REFUSING_UNSAFE_DB');
  }
});

afterAll(async () => { await db.destroy(); });

it('rejects forged reconnect markers without reconnect and preserves completed authority', async () => {
  const suffix = `t3-auth-${crypto.randomUUID()}`;
  const domain = `${suffix}.myshopify.com`;
  const shopId = await systemTransaction(trx => createTenantShop(trx, suffix));
  const fixture = await withTenant(shopId, async trx => {
    const [integration] = await trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: domain,
    }).returning('id');
    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId, shop_domain: domain,
      shop_gid: `gid://shopify/Shop/${shopId}`,
      scopes: SHOPIFY_REQUIRED_SCOPE_STRING, uninstalled_at: null,
    }).returning('id');
    await persistShopifyAdminCredentials(trx, Number(installation.id), shopId, {
      accessToken: `access-${suffix}`, refreshToken: `refresh-${suffix}`,
      accessExpiresAt: new Date(Date.now() + 86_400_000),
      refreshExpiresAt: new Date(Date.now() + 604_800_000),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    });
    const credential = await trx('shopify_admin_credentials')
      .where({ shop_id: shopId, installation_id: installation.id }).first();
    expect(credential.credential_state).toBe('ACTIVE');
    return { integrationId: Number(integration.id), installationId: Number(installation.id),
      generation: String(credential.credential_generation) };
  });

  for (const status of ['SYNCING_PRODUCTS', 'SYNCING_ORDERS', 'COMPLETED']) {
    await updateIntegrationStatus({
      integrationId: fixture.integrationId, shopId, status,
      progressCurrent: 11, progressTotal: 11, error: null,
      executionAuthority: { installationId: fixture.installationId,
        shopDomain: domain, generation: fixture.generation },
    });
  }
  const snapshot = () => withTenant(shopId, async trx => ({
    integration: await trx('integrations').where({ id: fixture.integrationId, shop_id: shopId }).first(),
    credential: await trx('shopify_admin_credentials')
      .where({ installation_id: fixture.installationId, shop_id: shopId }).first(),
    installation: await trx('shopify_app_installations')
      .where({ id: fixture.installationId, shop_id: shopId }).first(),
  }));
  const before = await snapshot();
  expect(before.integration.sync_status).toBe('COMPLETED');

  let rejected = false;
  let rejection: unknown;
  try {
    await withTenant(shopId, async trx => {
      const identity = await trx.raw(`SELECT current_database() AS database,
        current_user AS role, r.rolsuper, r.rolbypassrls,
        current_setting('app.current_tenant') AS tenant
        FROM pg_roles r WHERE r.rolname = current_user`);
      expect(identity.rows[0]).toEqual({ database: process.env.PGDATABASE,
        role: 'sf_app', rolsuper: false, rolbypassrls: false, tenant: String(shopId) });
      console.info('AUTH_BOUNDARY_RUNTIME', identity.rows[0]);
      await trx.raw(`SELECT
        set_config('app.shopify_reconnect_shop_id', ?, true),
        set_config('app.shopify_reconnect_integration_id', ?, true),
        set_config('app.shopify_reconnect_generation', ?, true)`,
      [String(shopId), String(fixture.integrationId), fixture.generation]);
      const updated = await trx('integrations')
        .where({ id: fixture.integrationId, shop_id: shopId }).update({
          sync_status: 'PENDING', sync_progress_current: 0,
          sync_progress_total: 0, sync_last_error: null,
        });
      expect(updated).toBe(1);
    });
  } catch (error) {
    rejected = true;
    rejection = error;
  }
  const after = await snapshot();
  console.info('AUTH_BOUNDARY_EVIDENCE', {
    markersAcceptedAndResetCommitted: !rejected,
    beforeStatus: before.integration.sync_status, afterStatus: after.integration.sync_status,
    beforeGeneration: String(before.credential.credential_generation),
    afterGeneration: String(after.credential.credential_generation),
    credentialUnchanged: JSON.stringify(after.credential) === JSON.stringify(before.credential),
    installationUnchanged: JSON.stringify(after.installation) === JSON.stringify(before.installation),
    rejection: rejection instanceof Error ? rejection.message : rejection,
  });
  expect(after.credential).toEqual(before.credential);
  expect(after.installation).toEqual(before.installation);
  expect(after.integration.sync_status).toBe('COMPLETED');
  expect(rejected).toBe(true);
  expect(rejection).toBeInstanceOf(Error);
  expect((rejection as Error).message).toMatch(/cannot regress after COMPLETED/);
  expect(after.integration).toEqual(before.integration);
});
