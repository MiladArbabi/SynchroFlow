/** Final Shopify Admin credential architecture on disposable PostgreSQL. */
jest.mock('axios', () => {
  const blocked = jest.fn(() => { throw new Error('PROVIDER_NETWORK_ESCAPE_BLOCKED'); });
  const client = { post: jest.fn(() => { throw new Error('UNPROGRAMMED_REFRESH'); }),
    get: blocked, request: blocked, put: blocked, patch: blocked, delete: blocked,
    create: () => client,
    isAxiosError: (error: unknown) => !!error && typeof error === 'object'
      && (error as { isAxiosError?: boolean }).isAxiosError === true };
  return { __esModule: true, default: client };
});
import { getSyncStatus } from 'api-src/api/integrations/integration.controller';
import { updateIntegrationStatus } from 'api-src/services/shopify/shopifyIntegrationStatus.service';
import crypto from 'crypto';
import axios from 'axios';
import db, { systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { ShopifyAppService } from '@lasyncro/backend-core/services/shopify-app.service.js';
import { decrypt } from 'api-src/security/encryption.service';
import { persistShopifyAdminCredentials, type CredentialPair,
  type ShopifyAdminCredentialRow } from 'api-src/services/shopify/shopifyAdminCredential.repository';
import { resolveShopifyAdminCredentialForConsumer } from 'api-src/services/shopify/shopifyAdminCredentialConsumer.service';
import { prepareShopifyAdminCredentialReconnect,
  finalizeShopifyAdminCredentialReconnect } from 'api-src/services/shopify/shopifyAdminCredentialLifecycle.service';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const ACCESS_A = 'certification-access-a', REFRESH_A = 'certification-refresh-a';
const ACCESS_B = 'certification-access-b', REFRESH_B = 'certification-refresh-b';
const post = axios.post as jest.Mock;
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
type Fixture = { shopId: number; installationId: number; domain: string };
function pair(accessToken = ACCESS_A, refreshToken = REFRESH_A, accessSeconds = 3600): CredentialPair {
  return { accessToken, refreshToken, accessExpiresAt: later(accessSeconds),
    refreshExpiresAt: later(86400), grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING };
}
async function fixture(material = pair()): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const domain = 'credential-certification-' + suffix + '.myshopify.com';
  const shopId = await systemTransaction(trx => createTenantShop(trx, 'credential-certification-' + suffix));
  return withTenant(shopId, async trx => {
    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId, shop_domain: domain, shop_gid: 'gid://shopify/Shop/' + shopId,
      scopes: SHOPIFY_REQUIRED_SCOPE_STRING, uninstalled_at: null,
    }).returning('id');
    await trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: domain,
    });
    await persistShopifyAdminCredentials(trx, installation.id, shopId, material);
    return { shopId, installationId: Number(installation.id), domain };
  });
}
async function credentials(f: Fixture): Promise<ShopifyAdminCredentialRow[]> {
  return withTenant(f.shopId, trx => trx('shopify_admin_credentials')
    .where({ shop_id: f.shopId, installation_id: f.installationId }).select('*'));
}
async function metadata(f: Fixture) {
  return withTenant(f.shopId, async trx => ({
    installation: await trx('shopify_app_installations').where({ shop_id: f.shopId, id: f.installationId }).first(),
    integration: await trx('integrations').where({ shop_id: f.shopId, platform: 'shopify' }).first(),
  }));
}
let fetchSpy: jest.SpyInstance;
beforeAll(() => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'certification-encryption-key-0123456789';
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => {
    throw new Error('PROVIDER_NETWORK_ESCAPE_BLOCKED');
  });
});
beforeEach(() => {
  post.mockReset();
  post.mockImplementation(() => { throw new Error('UNPROGRAMMED_REFRESH'); });
});
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); });
afterAll(async () => { fetchSpy.mockRestore(); await db.destroy(); });

describe('Final Shopify Admin credential architecture', () => {
  it('C1 — physical schema has canonical authority and metadata-only tables', async () => {
    await systemTransaction(async trx => {
      expect(await trx.schema.hasTable('shopify_admin_credentials')).toBe(true);
      const columns = await trx('information_schema.columns')
        .where({ table_schema: 'public', table_name: 'shopify_admin_credentials' }).pluck('column_name');
      expect(columns).toEqual(expect.arrayContaining([
        'installation_id', 'shop_id', 'access_token_encrypted', 'refresh_token_encrypted',
        'credential_generation', 'credential_state',
      ]));
      expect(await trx.schema.hasColumn('shopify_app_installations', 'access_token')).toBe(false);
      expect(await trx.schema.hasColumn('integrations', 'access_token_encrypted')).toBe(false);
    });
  });
  it('C2 — canonical repository persists one encrypted valid credential pair', async () => {
    const f = await fixture(), rows = await credentials(f);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.access_token_encrypted).toEqual(expect.any(String));
    expect(row.refresh_token_encrypted).toEqual(expect.any(String));
    expect(row.access_token_encrypted).not.toBe(ACCESS_A);
    expect(row.refresh_token_encrypted).not.toBe(REFRESH_A);
    expect(decrypt(row.access_token_encrypted!, 'shopify.adminCredential.lifecycle')).toBe(ACCESS_A);
    expect(decrypt(row.refresh_token_encrypted!, 'shopify.adminCredential.lifecycle')).toBe(REFRESH_A);
    expect(row.credential_state).toBe('ACTIVE');
    expect(String(row.credential_generation)).toBe('0');
    expect(post).not.toHaveBeenCalled();
  });
  it('C3 — production consumer returns canonical access and installation identity', async () => {
    const f = await fixture();
    expect(await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW })).toEqual({
      kind: 'READY', accessToken: ACCESS_A, installationId: f.installationId, shopDomain: f.domain,
      generation: '0',
    });
    expect(post).not.toHaveBeenCalled();
  });
  it('C4 — reconnect replaces both credentials and advances generation once', async () => {
    const f = await fixture(), [before] = await credentials(f);
    const prepared = await prepareShopifyAdminCredentialReconnect({ shopId: f.shopId, shopDomain: f.domain, now: NOW });
    expect(prepared.kind).toBe('RECONNECT_PREPARED');
    if (prepared.kind !== 'RECONNECT_PREPARED') throw new Error('RECONNECT_NOT_PREPARED');
    const generation = (BigInt(before.credential_generation) + 1n).toString();
    expect(prepared.generation).toBe(generation);
    const result = await finalizeShopifyAdminCredentialReconnect({
      ...prepared, credentials: {
        ...pair(ACCESS_B, REFRESH_B),
        shopIdentity: { gid: 'gid://shopify/Shop/' + f.shopId, currencyCode: 'USD',
          name: null, contactEmail: null, ianaTimezone: null },
      },
    });
    expect(result.kind).toBe('RECONNECTED');
    if (result.kind !== 'RECONNECTED') throw new Error('RECONNECT_NOT_FINALIZED');
    expect(result.generation).toBe(generation);
    const rows = await credentials(f);
    expect(rows).toHaveLength(1);
    expect(decrypt(rows[0].access_token_encrypted!, 'shopify.adminCredential.lifecycle')).toBe(ACCESS_B);
    expect(decrypt(rows[0].refresh_token_encrypted!, 'shopify.adminCredential.lifecycle')).toBe(REFRESH_B);
    expect(String(rows[0].credential_generation)).toBe(generation);
    expect(rows[0].credential_state).toBe('ACTIVE');
    expect(await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW })).toEqual({
      kind: 'READY', accessToken: ACCESS_B, installationId: f.installationId, shopDomain: f.domain,
      generation,
    });
    expect(post).not.toHaveBeenCalled();
  });
  it('C5 — uninstall records lifecycle state and fences canonical authority', async () => {
    const f = await fixture();
    expect(await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW }))
      .toMatchObject({ kind: 'READY', accessToken: ACCESS_A });
    const [before] = await credentials(f);
    await withTenant(f.shopId, trx => ShopifyAppService.hardFenceAppUninstalled(f.shopId, trx, NOW, f.domain));
    expect((await metadata(f)).installation.uninstalled_at).toEqual(NOW);
    expect(await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW })).toEqual({ kind: 'REAUTH_REQUIRED' });
    const [after] = await credentials(f);
    expect(after.credential_state).toBe('REAUTH_REQUIRED');
    expect(String(after.credential_generation)).toBe((BigInt(before.credential_generation) + 1n).toString());
    expect(post).not.toHaveBeenCalled();
  });
  it('GH-1068 T1 — uninstalled connection projection overrides historical sync completion', async () => {
    const f = await fixture();

    // Reproduce a legally completed historical synchronization.
    const integration = (await metadata(f)).integration;
    for (const status of ['SYNCING_PRODUCTS', 'SYNCING_ORDERS', 'COMPLETED']) {
      await withTenant(f.shopId, trx =>
        trx('integrations')
          .where({ id: integration.id, shop_id: f.shopId })
          .update({
            sync_status: status,
            sync_progress_current: status === 'COMPLETED' ? 12 : 0,
            sync_progress_total: 12,
          })
      );
    }

    expect((await metadata(f)).integration.sync_status).toBe('COMPLETED');

    const [user] = await withTenant(f.shopId, trx =>
      trx('users').insert({
        shop_id: f.shopId,
        role: 'owner',
        email: `gh1068-${crypto.randomUUID()}@test.invalid`,
        password_hash: 'synthetic-test-only',
      }).returning('id')
    );

    await withTenant(f.shopId, trx =>
      trx('shop_memberships').insert({
        shop_id: f.shopId,
        user_id: user.id,
        role: 'owner',
      })
    );

    // An installed shop must not be classified as uninstalled.
    const installedResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      path: '/api/v1/integrations/sync-status',
      user: { userId: Number(user.id), shopId: f.shopId },
    };

    await getSyncStatus(request as any, installedResponse as any);
    expect(installedResponse.status).not.toHaveBeenCalled();
    expect(installedResponse.json).toHaveBeenCalledTimes(1);
    expect(installedResponse.json.mock.calls[0][0]).toMatchObject({
      status: 'COMPLETED',
    });
    expect(
      installedResponse.json.mock.calls[0][0].connectionStatus
    ).not.toBe('UNINSTALLED');

    await withTenant(f.shopId, trx =>
      ShopifyAppService.hardFenceAppUninstalled(f.shopId, trx, NOW, f.domain)
    );

    const after = await metadata(f);
    expect(after.installation.uninstalled_at).toEqual(NOW);
    expect(after.integration.sync_status).toBe('COMPLETED');
    expect(
      await resolveShopifyAdminCredentialForConsumer({
        shopId: f.shopId,
        now: NOW,
      })
    ).toEqual({ kind: 'REAUTH_REQUIRED' });

    // Exercise the actual status controller with real membership resolution.
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await getSyncStatus({
      path: '/api/v1/integrations/sync-status',
      user: { userId: Number(user.id), shopId: f.shopId },
    } as any, res as any);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);

    // Expected new read-model field; does not mutate historical sync status.
    expect(res.json.mock.calls[0][0]).toMatchObject({
      status: 'COMPLETED',
      connectionStatus: 'UNINSTALLED',
    });
  });

  it('GH-1068 T2 — stale generation cannot complete after uninstall', async () => {
    const f = await fixture();
    const integration = (await metadata(f)).integration;
    const [credential] = await credentials(f);

    const expectedCredentialGeneration =
      String(credential.credential_generation);

    // Establish the legal pre-completion state.
    for (const status of ['SYNCING_PRODUCTS', 'SYNCING_ORDERS']) {
      await withTenant(f.shopId, trx =>
        trx('integrations')
          .where({ id: integration.id, shop_id: f.shopId })
          .update({ sync_status: status })
      );
    }

    // Uninstall invalidates the generation captured by this sync.
    await withTenant(f.shopId, trx =>
      ShopifyAppService.hardFenceAppUninstalled(
        f.shopId, trx, NOW, f.domain
      )
    );

    const afterUninstall = await metadata(f);
    const [fencedCredential] = await credentials(f);

    expect(afterUninstall.installation.uninstalled_at).toEqual(NOW);
    expect(afterUninstall.integration.sync_status).toBe('SYNCING_ORDERS');
    expect(fencedCredential.credential_state).toBe('REAUTH_REQUIRED');
    expect(String(fencedCredential.credential_generation))
      .not.toBe(expectedCredentialGeneration);

    // Deliberately supply the generation the worker started with.
    // Current implementation ignores it: this must RED before the fix.
    const staleCompletion = {
      integrationId: Number(integration.id),
      shopId: f.shopId,
      status: 'COMPLETED',
      error: null,
      executionAuthority: {
        installationId: f.installationId,
        shopDomain: f.domain,
        generation: expectedCredentialGeneration,
      },
    };

    let outcome = 'ACCEPTED';

    try {
      await updateIntegrationStatus(staleCompletion);
    } catch (error) {
      expect((error as Error).message).toBe('SHOPIFY_SYNC_STALE_AUTHORITY');
      outcome = 'REJECTED';
    }

    const observed = await withTenant(f.shopId, async trx => {
      const row = await trx('integrations')
        .where({ id: integration.id, shop_id: f.shopId })
        .first('sync_status');

      const eventCount = await trx('domain_events')
        .where({
          shop_id: f.shopId,
          event_type: 'integration/sync_completed',
        })
        .count('* as count')
        .first();

      return {
        syncStatus: row?.sync_status,
        completionEvents: Number(eventCount?.count ?? 0),
      };
    });

    // A stale worker must not claim completion or emit its event.
    expect({ outcome, ...observed }).toEqual({
      outcome: 'REJECTED',
      syncStatus: 'SYNCING_ORDERS',
      completionEvents: 0,
    });
  });

  it('GH-1068 T2 — missing authority fails closed; current generation completes', async () => {
    const f = await fixture();
    const integration = (await metadata(f)).integration;
    const [credential] = await credentials(f);

    for (const status of ['SYNCING_PRODUCTS', 'SYNCING_ORDERS']) {
      await withTenant(f.shopId, trx =>
        trx('integrations')
          .where({ id: integration.id, shop_id: f.shopId })
          .update({ sync_status: status })
      );
    }

    const base = {
      integrationId: Number(integration.id),
      shopId: f.shopId,
      status: 'COMPLETED',
      error: null,
    };

    let missingAuthorityOutcome = 'ACCEPTED';
    try {
      await updateIntegrationStatus(base);
    } catch (error) {
      expect((error as Error).message).toBe('SHOPIFY_SYNC_AUTHORITY_REQUIRED');
      missingAuthorityOutcome = 'REJECTED';
    }

    const before = await withTenant(f.shopId, async trx => ({
      status: (await trx('integrations')
        .where({ id: integration.id, shop_id: f.shopId })
        .first('sync_status'))?.sync_status,
      events: Number((await trx('domain_events')
        .where({
          shop_id: f.shopId,
          event_type: 'integration/sync_completed',
        })
        .count('* as count')
        .first())?.count ?? 0),
    }));

    expect({
      missingAuthorityOutcome,
      ...before,
    }).toEqual({
      missingAuthorityOutcome: 'REJECTED',
      status: 'SYNCING_ORDERS',
      events: 0,
    });

    await updateIntegrationStatus({
      ...base,
      executionAuthority: {
        installationId: f.installationId,
        shopDomain: f.domain,
        generation: String(credential.credential_generation),
      },
    });

    const after = await withTenant(f.shopId, async trx => ({
      status: (await trx('integrations')
        .where({ id: integration.id, shop_id: f.shopId })
        .first('sync_status'))?.sync_status,
      events: Number((await trx('domain_events')
        .where({
          shop_id: f.shopId,
          event_type: 'integration/sync_completed',
        })
        .count('* as count')
        .first())?.count ?? 0),
    }));

    expect(after).toEqual({
      status: 'COMPLETED',
      events: 1,
    });
  });

  it('C6 — expired access refreshes through the canonical provider and lifecycle', async () => {
    const f = await fixture(pair(ACCESS_A, REFRESH_A, -1));
    const [before] = await credentials(f), metadataBefore = await metadata(f);
    post.mockImplementation(async (url: string, body: { grant_type: string; refresh_token: string }) => {
      expect(url).toBe('https://' + f.domain + '/admin/oauth/access_token');
      expect(body.grant_type).toBe('refresh_token');
      expect(body.refresh_token).toBe(REFRESH_A);
      return { data: { access_token: ACCESS_B, refresh_token: REFRESH_B,
        expires_in: 3600, refresh_token_expires_in: 86400, scope: SHOPIFY_REQUIRED_SCOPE_STRING } };
    });
    const ready = { kind: 'READY', accessToken: ACCESS_B, installationId: f.installationId,
      shopDomain: f.domain,
      generation: (BigInt(before.credential_generation) + 1n).toString() };
    expect(await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW })).toEqual(ready);
    const rows = await credentials(f);
    expect(rows).toHaveLength(1);
    expect(decrypt(rows[0].access_token_encrypted!, 'shopify.adminCredential.lifecycle')).toBe(ACCESS_B);
    expect(decrypt(rows[0].refresh_token_encrypted!, 'shopify.adminCredential.lifecycle')).toBe(REFRESH_B);
    expect(rows[0].credential_state).toBe('ACTIVE');
    expect(String(rows[0].credential_generation)).toBe((BigInt(before.credential_generation) + 1n).toString());
    expect(rows[0].access_expires_at).toEqual(later(3600));
    expect(rows[0].refresh_expires_at).toEqual(later(86400));
    expect(await metadata(f)).toEqual(metadataBefore);
    expect(await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW })).toEqual(ready);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('GH-1046 — lost successful refresh response preserves authority and falls back to reauthorization when the old refresh token is invalid', async () => {
    const f = await fixture(pair(ACCESS_A, REFRESH_A, -1));
    const [before] = await credentials(f);
    let providerRotated = false;
    post.mockImplementationOnce(async (_url: string, body: { refresh_token: string }) => {
      expect(body.refresh_token).toBe(REFRESH_A);
      providerRotated = true;
      throw Object.assign(new Error('simulated lost response'), {
        isAxiosError: true,
        code: 'ECONNRESET',
      });
    });

    expect(await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW }))
      .toEqual({ kind: 'RETRYABLE' });
    expect(providerRotated).toBe(true);
    const [afterLoss] = await credentials(f);
    expect(String(afterLoss.credential_generation)).toBe(String(before.credential_generation));
    expect(afterLoss.access_token_encrypted).toBe(before.access_token_encrypted);
    expect(afterLoss.refresh_token_encrypted).toBe(before.refresh_token_encrypted);
    expect(afterLoss.rotation_lease_token).toBeNull();
    expect(afterLoss.rotation_lease_expires_at).toBeNull();

    post.mockImplementationOnce(async (_url: string, body: { refresh_token: string }) => {
      expect(body.refresh_token).toBe(REFRESH_A);
      throw Object.assign(new Error('old refresh authority invalid after provider rotation'), {
        isAxiosError: true,
        code: 'ERR_BAD_REQUEST',
        response: { status: 401, data: { error: 'invalid_request' } },
      });
    });
    expect(await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW }))
      .toEqual({ kind: 'REAUTH_REQUIRED' });
    const [afterRetry] = await credentials(f);
    expect(afterRetry.credential_state).toBe('REAUTH_REQUIRED');
    expect(String(afterRetry.credential_generation))
      .toBe((BigInt(before.credential_generation) + 1n).toString());
    expect(afterRetry.access_token_encrypted).toBe(before.access_token_encrypted);
    expect(afterRetry.refresh_token_encrypted).toBe(before.refresh_token_encrypted);
    expect(afterRetry.rotation_lease_token).toBeNull();
    expect(afterRetry.rotation_lease_expires_at).toBeNull();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('GH-1046 — replacement persistence failure rolls back material and generation, retains lease ownership, and safely reauthorizes after lease expiry', async () => {
    const f = await fixture(pair(ACCESS_A, REFRESH_A, -1));
    const [before] = await credentials(f);
    const suffix = crypto.randomUUID().replace(/-/g, '');
    const functionName = `gh1046_refresh_persist_fail_${suffix}`;
    const triggerName = `gh1046_refresh_persist_fail_trigger_${suffix}`;
    await systemTransaction(async trx => {
      await trx.raw(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'GH1046_INJECTED_REFRESH_PERSISTENCE_FAILURE'; END; $$`);
      await trx.raw(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON shopify_admin_credentials
        FOR EACH ROW WHEN (NEW.access_token_encrypted IS DISTINCT FROM OLD.access_token_encrypted)
        EXECUTE FUNCTION ${functionName}()`);
    });
    post.mockResolvedValueOnce({ data: {
      access_token: ACCESS_B,
      refresh_token: REFRESH_B,
      expires_in: 3600,
      refresh_token_expires_in: 86400,
      scope: SHOPIFY_REQUIRED_SCOPE_STRING,
    } });

    await expect(resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: NOW }))
      .rejects.toThrow('GH1046_INJECTED_REFRESH_PERSISTENCE_FAILURE');
    const [afterFailure] = await credentials(f);
    expect(String(afterFailure.credential_generation)).toBe(String(before.credential_generation));
    expect(afterFailure.access_token_encrypted).toBe(before.access_token_encrypted);
    expect(afterFailure.refresh_token_encrypted).toBe(before.refresh_token_encrypted);
    expect(afterFailure.credential_state).toBe('ACTIVE');
    expect(afterFailure.rotation_lease_token).toEqual(expect.any(String));
    expect(afterFailure.rotation_lease_expires_at).toEqual(later(30));

    await systemTransaction(async trx => {
      await trx.raw(`DROP TRIGGER ${triggerName} ON shopify_admin_credentials`);
      await trx.raw(`DROP FUNCTION ${functionName}()`);
    });
    post.mockImplementationOnce(async (_url: string, body: { refresh_token: string }) => {
      expect(body.refresh_token).toBe(REFRESH_A);
      throw Object.assign(new Error('old refresh authority invalid after provider rotation'), {
        isAxiosError: true,
        code: 'ERR_BAD_REQUEST',
        response: { status: 401, data: { error: 'invalid_request' } },
      });
    });
    expect(await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: later(31) }))
      .toEqual({ kind: 'REAUTH_REQUIRED' });
    const [afterRecovery] = await credentials(f);
    expect(afterRecovery.credential_state).toBe('REAUTH_REQUIRED');
    expect(String(afterRecovery.credential_generation))
      .toBe((BigInt(before.credential_generation) + 1n).toString());
    expect(afterRecovery.access_token_encrypted).toBe(before.access_token_encrypted);
    expect(afterRecovery.refresh_token_encrypted).toBe(before.refresh_token_encrypted);
    expect(afterRecovery.rotation_lease_token).toBeNull();
    expect(afterRecovery.rotation_lease_expires_at).toBeNull();
    expect(post).toHaveBeenCalledTimes(2);
  });
});
