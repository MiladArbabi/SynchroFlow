/**
 * GH-1101 — canonical Shopify connection truth across every connection surface.
 *
 * Real createApp routes, JWT admission, sf_app and forced RLS on a disposable
 * database. The stored users.shopify_connected flag is deliberately stale in
 * both directions; every surface must derive one tenant-level fact from the
 * installation and credential metadata instead, without provider calls,
 * credential exposure or writes.
 */
jest.mock('api-src/services/shopify/shopifyAdminCredentialRefreshProvider.service', () => ({
  refreshShopifyAdminCredential: jest.fn(async () => { throw new Error('GH1101_PROVIDER_CALLED'); }),
}));

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { ShopifyAppService } from '@lasyncro/backend-core/services/shopify-app.service.js';
import { persistShopifyAdminCredentials } from 'api-src/services/shopify/shopifyAdminCredential.repository';
import {
  finalizeShopifyAdminCredentialReconnect,
  prepareShopifyAdminCredentialReconnect,
  settleShopifyAdminCredentialReconnect,
} from 'api-src/services/shopify/shopifyAdminCredentialLifecycle.service';
import { closeShopifyReconnectExecutor } from 'api-src/services/shopify/shopifyReconnectExecutor.db';
import { updateIntegrationStatus } from 'api-src/services/shopify/shopifyIntegrationStatus.service';
import { readShopifyConnection } from 'api-src/services/shopify/shopifyConnectionState.service';
import { refreshShopifyAdminCredential } from 'api-src/services/shopify/shopifyAdminCredentialRefreshProvider.service';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const PASSWORD = 'gh1101-synthetic-password';
let passwordHash = '';

type Fixture = {
  shopId: number; domain: string; integrationId: number; installationId?: number;
  owner: number; admin: number; ownerEmail: string;
};

async function fixture(label: string, options: {
  installation?: 'active' | 'uninstalled' | 'none'; credential?: boolean;
  ownerFlag?: boolean; adminFlag?: boolean;
} = {}): Promise<Fixture> {
  const { installation = 'active', credential = true, ownerFlag = false, adminFlag = false } = options;
  const unique = crypto.randomUUID();
  const domain = `gh1101-${label}-${unique}.myshopify.com`;
  return systemTransaction(async trx => {
    const shopId = await createTenantShop(trx, `gh1101-${label}-${unique}`);
    await setTenantContext(trx, shopId);
    const ownerEmail = `gh1101-${label}-owner-${unique}@test.invalid`;
    const [owner] = await trx('users').insert({ shop_id: shopId, role: 'owner', email: ownerEmail,
      password_hash: passwordHash, shopify_connected: ownerFlag }).returning('id');
    const [admin] = await trx('users').insert({ shop_id: shopId, role: 'admin',
      email: `gh1101-${label}-admin-${unique}@test.invalid`, password_hash: passwordHash,
      shopify_connected: adminFlag }).returning('id');
    await trx('shop_memberships').insert([{ shop_id: shopId, user_id: owner.id, role: 'owner' },
      { shop_id: shopId, user_id: admin.id, role: 'admin' }]);
    const [integration] = await trx('integrations').insert({ shop_id: shopId, platform: 'shopify',
      platform_shop_name: domain, updated_at: new Date() }).returning('id');
    let installationId: number | undefined;
    if (installation !== 'none') {
      const [row] = await trx('shopify_app_installations').insert({ shop_id: shopId, shop_domain: domain,
        shop_gid: `gid://shopify/Shop/${shopId}`, scopes: SHOPIFY_REQUIRED_SCOPE_STRING,
        uninstalled_at: installation === 'uninstalled' ? new Date() : null }).returning('id');
      installationId = Number(row.id);
      if (credential) {
        const now = Date.now();
        await persistShopifyAdminCredentials(trx, installationId, shopId, {
          accessToken: `gh1101-access-${unique}`, refreshToken: `gh1101-refresh-${unique}`,
          accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
          grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING });
      }
    }
    return { shopId, domain, integrationId: Number(integration.id), installationId,
      owner: Number(owner.id), admin: Number(admin.id), ownerEmail };
  });
}

function get(f: Fixture, path: string, user: 'owner' | 'admin' = 'owner') {
  const token = issueTestToken({ userId: user === 'owner' ? f.owner : f.admin, shopId: f.shopId, roles: [user] });
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

/** Every connection surface, as one comparable fact. */
async function surfaces(f: Fixture, user: 'owner' | 'admin' = 'owner') {
  const state = await get(f, '/api/v1/user-state/state', user);
  const verdict = await get(f, '/api/v1/activation/verdict', user);
  const readiness = await get(f, '/api/v1/onboarding/readiness', user);
  const sync = await get(f, '/api/v1/integrations/sync-status', user);
  expect([state.status, verdict.status, readiness.status, sync.status]).toEqual([200, 200, 200, 200]);
  const platform = readiness.body.modules.find((module: any) => module.moduleId === 'platform');
  return {
    userState: { connected: state.body.user.shopify_connected, state: state.body.user.shopify_connection_state,
      platforms: state.body.user.connected_platforms },
    verdict: { noIntegration: verdict.body.verdict.reason === 'NO_INTEGRATION',
      state: verdict.body.connection?.state, connected: verdict.body.connection?.connected },
    readiness: platform.signals.find((signal: any) => signal.name === 'integration.connected')?.value,
    sync: { state: sync.body.connectionState, legacyStatus: sync.body.connectionStatus },
  };
}

function expected(state: string, connected: boolean) {
  return {
    userState: { connected, state, platforms: connected ? ['shopify'] : [] },
    verdict: { noIntegration: !connected, state, connected },
    readiness: connected,
    sync: { state, legacyStatus: state === 'UNINSTALLED' ? 'UNINSTALLED' : undefined },
  };
}

async function storedFlags(f: Fixture) {
  return withTenant(f.shopId, trx => trx('users').where({ shop_id: f.shopId }).orderBy('id')
    .select('id', 'shopify_connected'));
}

async function credentialRow(f: Fixture) {
  return withTenant(f.shopId, trx => trx('shopify_admin_credentials').where({ shop_id: f.shopId }).first());
}

async function setCredential(f: Fixture, fields: Record<string, unknown>) {
  await withTenant(f.shopId, trx => trx('shopify_admin_credentials').where({ shop_id: f.shopId }).update(fields));
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ||= 'gh1101-regression-encryption-key-2026-0123';
  expect(process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB).toBe('1');
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  passwordHash = await bcrypt.hash(PASSWORD, 4);
});

beforeEach(() => jest.clearAllMocks());

afterAll(async () => {
  const results = await Promise.allSettled([db.destroy(), closeShopifyReconnectExecutor()]);
  expect(results.every(result => result.status === 'fulfilled')).toBe(true);
});

describe('GH-1101 — canonical connection truth on every surface', () => {
  it('an active installation with a stale false flag is connected everywhere; the stored flag is never overwritten', async () => {
    const f = await fixture('stale-false');
    const flagsBefore = await storedFlags(f);
    expect(await surfaces(f)).toEqual(expected('CONNECTED', true));
    expect(await storedFlags(f)).toEqual(flagsBefore);
    expect(flagsBefore.every(row => row.shopify_connected === false)).toBe(true);
  });

  it('an uninstalled installation with a stale true flag is disconnected everywhere', async () => {
    const f = await fixture('stale-true', { installation: 'uninstalled', ownerFlag: true, adminFlag: true });
    expect(await surfaces(f)).toEqual(expected('UNINSTALLED', false));
    expect((await storedFlags(f)).every(row => row.shopify_connected === true)).toBe(true);
  });

  it('every user of one tenant sees the identical tenant fact regardless of per-user flags', async () => {
    const f = await fixture('multi-user', { ownerFlag: false, adminFlag: true });
    expect(await surfaces(f, 'owner')).toEqual(expected('CONNECTED', true));
    expect(await surfaces(f, 'admin')).toEqual(expected('CONNECTED', true));
  });

  it('connection reads are tenant-isolated', async () => {
    const connected = await fixture('tenant-b');
    const notInstalled = await fixture('tenant-a', { installation: 'none' });
    expect(await surfaces(notInstalled)).toEqual(expected('NOT_INSTALLED', false));
    expect(await surfaces(connected)).toEqual(expected('CONNECTED', true));
    expect(await readShopifyConnection(notInstalled.shopId)).toMatchObject({ state: 'NOT_INSTALLED',
      installationId: null });
  });

  it('credential readiness is classified from metadata only, with server time and no provider call or write', async () => {
    const f = await fixture('credential-matrix');
    const hour = 3_600_000;
    const cases: Array<[string, Record<string, unknown>, string, boolean]> = [
      ['expired access, usable refresh', { access_expires_at: new Date(Date.now() - hour) }, 'CONNECTED', true],
      ['expired access, live lease', { access_expires_at: new Date(Date.now() - hour),
        rotation_lease_token: crypto.randomUUID(), rotation_lease_expires_at: new Date(Date.now() + hour),
        rotation_started_at: new Date() }, 'REFRESHING', true],
      ['expired access and refresh', { rotation_lease_token: null, rotation_lease_expires_at: null,
        rotation_started_at: null, refresh_expires_at: new Date(Date.now() - hour) }, 'REAUTH_REQUIRED', false],
      ['reauth required', { credential_state: 'REAUTH_REQUIRED' }, 'REAUTH_REQUIRED', false],
      ['reauth with live reconnect lease', { rotation_lease_token: crypto.randomUUID(),
        rotation_lease_expires_at: new Date(Date.now() + hour), rotation_started_at: new Date() },
        'RECONNECT_IN_PROGRESS', false],
    ];
    for (const [label, fields, state, connected] of cases) {
      await setCredential(f, fields);
      const before = await credentialRow(f);
      expect([label, await readShopifyConnection(f.shopId)]).toEqual([label, expect.objectContaining({
        state, connected, installed: true, installationId: f.installationId, shopDomain: f.domain })]);
      expect([label, (await surfaces(f)).userState]).toEqual([label, expected(state, connected).userState]);
      expect(await credentialRow(f)).toEqual(before);
    }
    expect(refreshShopifyAdminCredential).not.toHaveBeenCalled();
    const response = await get(f, '/api/v1/user-state/state');
    expect(JSON.stringify(response.body)).not.toMatch(/token|encrypted/i);
  });

  it('an installation without a credential (legacy bootstrap) requires reauthorization', async () => {
    const f = await fixture('no-credential', { credential: false });
    expect(await surfaces(f)).toEqual(expected('REAUTH_REQUIRED', false));
  });

  it('uninstall, reinstall and a failed reconnect move every surface with the canonical state', async () => {
    const f = await fixture('lifecycle');
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
    await withTenant(f.shopId, trx => ShopifyAppService.hardFenceAppUninstalled(f.shopId, trx, new Date(), f.domain));
    expect(await surfaces(f)).toEqual(expected('UNINSTALLED', false));

    const reinstall = await prepareShopifyAdminCredentialReconnect({ shopId: f.shopId, shopDomain: f.domain,
      now: new Date() });
    if (reinstall.kind !== 'RECONNECT_PREPARED') throw new Error(`GH1101_NOT_PREPARED:${reinstall.kind}`);
    expect(reinstall.installationState).toBe('UNINSTALLED');
    const now = Date.now();
    const finalized = await finalizeShopifyAdminCredentialReconnect({ ...reinstall, credentials: {
      accessToken: 'gh1101-reinstall-access', refreshToken: 'gh1101-reinstall-refresh',
      accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING, shopIdentity: { gid: `gid://shopify/Shop/${f.shopId}`,
        currencyCode: 'USD', name: null, contactEmail: null, ianaTimezone: null } } });
    expect(finalized.kind).toBe('RECONNECTED');
    expect(await surfaces(f)).toEqual(expected('CONNECTED', true));

    const reconnect = await prepareShopifyAdminCredentialReconnect({ shopId: f.shopId, shopDomain: f.domain,
      now: new Date() });
    if (reconnect.kind !== 'RECONNECT_PREPARED') throw new Error(`GH1101_NOT_PREPARED:${reconnect.kind}`);
    expect((await readShopifyConnection(f.shopId)).state).toBe('RECONNECT_IN_PROGRESS');
    await settleShopifyAdminCredentialReconnect({ ...reconnect, outcome: { kind: 'POSSIBLY_ISSUED' } });
    expect(await surfaces(f)).toEqual(expected('REAUTH_REQUIRED', false));
  });
});

describe('GH-1101 — compatibility responses and freshness', () => {

  it('returns null when authoritative recovery lookup fails', async () => {
    const f = await fixture('recovery-lookup-unavailable');
    const service = jest.requireActual(
      'api-src/services/shopify/shopifyIntegrationStatus.service'
    ) as typeof import('api-src/services/shopify/shopifyIntegrationStatus.service');

    const lookup = jest.spyOn(service, 'readShopifyRecoveryRequestOutstanding')
      .mockRejectedValueOnce(new Error('SYNTHETIC_RECOVERY_LOOKUP_FAILURE'));
    const logger = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await get(f, '/api/v1/integrations/sync-status');

      expect(lookup).toHaveBeenCalledWith({
        shopId: f.shopId,
        integrationId: f.integrationId,
        status: 'PENDING',
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        integrationId: f.integrationId,
        connectionState: 'CONNECTED',
        recoveryRequestOutstanding: null,
      });
      expect(JSON.stringify(response.body))
        .not.toContain('SYNTHETIC_RECOVERY_LOOKUP_FAILURE');
    } finally {
      lookup.mockRestore();
      logger.mockRestore();
    }
  });

  it('sync status exposes additive connection metadata with and without historical integrations', async () => {
    const historical = await fixture('historical-no-installation', { installation: 'none' });
    const historicalResponse = await get(historical, '/api/v1/integrations/sync-status');
    expect(historicalResponse.body).toMatchObject({
      integrationId: historical.integrationId,
      status: 'PENDING',
      connectionState: 'NOT_INSTALLED',
      shopDomain: null,
      recoveryRequestOutstanding: false,
      lastSyncedAt: null,
      progress: { current: 0, total: 0, percentage: 0 },
      lastError: null,
    });

    const noInstallation = await fixture('no-integration-no-installation', { installation: 'none' });
    await withTenant(noInstallation.shopId, trx => trx('integrations')
      .where({ shop_id: noInstallation.shopId, id: noInstallation.integrationId }).delete());
    expect((await get(noInstallation, '/api/v1/integrations/sync-status')).body).toEqual({
      integrationId: null,
      status: 'NOT_FOUND',
      connectionState: 'NOT_INSTALLED',
      shopDomain: null,
      lastSyncedAt: null,
      progress: { current: 0, total: 0, percentage: 0 },
      recoveryRequestOutstanding: false,
      lastError: null,
    });

    const installationOnly = await fixture('installation-only');
    await withTenant(installationOnly.shopId, trx => trx('integrations')
      .where({ shop_id: installationOnly.shopId, id: installationOnly.integrationId }).delete());
    expect((await get(installationOnly, '/api/v1/integrations/sync-status')).body).toEqual({
      integrationId: null,
      status: 'NOT_FOUND',
      connectionState: 'CONNECTED',
      shopDomain: installationOnly.domain,
      recoveryRequestOutstanding: false,
      lastSyncedAt: null,
      progress: { current: 0, total: 0, percentage: 0 },
      lastError: null,
    });
  });

  it('sync status fails closed when authenticated identity has no tenant context', async () => {
    const token = issueTestToken({ userId: 2_000_000_001, shopId: 2_000_000_001, roles: ['owner'] });
    const response = await request(app).get('/api/v1/integrations/sync-status')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'User shop not found.' });
  });

  it('login returns the unchanged public shape with a derived shopify_connected', async () => {
    const f = await fixture('login', { ownerFlag: false });
    const response = await request(app).post('/api/v1/auth/login')
      .send({ email: f.ownerEmail, password: PASSWORD });
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
    expect(response.body.user).not.toHaveProperty('password_hash');
    expect(response.body.user.shopify_connected).toBe(true);
    expect(response.body.user).not.toHaveProperty('shopify_connection_state');
    expect((await storedFlags(f))[0].shopify_connected).toBe(false);
  });

  it('register returns the unchanged public shape with a derived (not installed) shopify_connected', async () => {
    const email = `gh1101-register-${crypto.randomUUID()}@test.invalid`;
    const response = await request(app).post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, firstName: 'Synthetic', lastName: 'Register' });
    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(['accessToken', 'user']);
    expect(response.body.user).not.toHaveProperty('password_hash');
    expect(response.body.user.shopify_connected).toBe(false);
  });

  it('lastSyncedAt is the latest integration-scoped sync_completed fact, never integrations.updated_at', async () => {
    const f = await fixture('freshness');
    const authority = await withTenant(f.shopId, async trx => {
      const credential = await trx('shopify_admin_credentials').where({ shop_id: f.shopId }).first('credential_generation');
      return { installationId: f.installationId!, shopDomain: f.domain, generation: String(credential.credential_generation) };
    });
    expect((await get(f, '/api/v1/integrations/sync-status')).body.lastSyncedAt).toBeNull();
    // A completion fact for another integration id never counts.
    await withTenant(f.shopId, trx => trx('domain_events').insert({ shop_id: f.shopId,
      event_type: 'integration/sync_completed', event_payload: { integration_id: f.integrationId + 100000 },
      event_time: new Date('2026-01-01T00:00:00.000Z'), event_version: 1,
      external_event_id: `gh1101-foreign-completion-${crypto.randomUUID()}` }));
    expect((await get(f, '/api/v1/integrations/sync-status')).body.lastSyncedAt).toBeNull();
    for (const status of ['SYNCING_PRODUCTS', 'SYNCING_ORDERS', 'COMPLETED'] as const) {
      await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId, status,
        executionAuthority: authority, error: null });
    }
    const fact = await withTenant(f.shopId, trx => trx('domain_events').where({ shop_id: f.shopId,
      event_type: 'integration/sync_completed' }).whereRaw("event_payload->>'integration_id' = ?",
      [String(f.integrationId)]).orderBy('id', 'desc').first('event_time'));
    await withTenant(f.shopId, trx => trx('integrations').where({ id: f.integrationId })
      .update({ updated_at: new Date('2030-01-01T00:00:00.000Z') }));
    const sync = await get(f, '/api/v1/integrations/sync-status');
    expect(sync.body.lastSyncedAt).toBe(new Date(fact.event_time).toISOString());
    expect(sync.body.status).toBe('COMPLETED');
    expect(sync.body.connectionState).toBe('CONNECTED');
    expect(sync.body.shopDomain).toBe(f.domain);
  });

  it('keeps historical completed synchronization separate after uninstall', async () => {
    const f = await fixture('completed-then-uninstalled');
    const authority = await withTenant(f.shopId, async trx => {
      const credential = await trx('shopify_admin_credentials').where({ shop_id: f.shopId })
        .first('credential_generation');
      return { installationId: f.installationId!, shopDomain: f.domain,
        generation: String(credential.credential_generation) };
    });
    for (const status of ['SYNCING_PRODUCTS', 'SYNCING_ORDERS', 'COMPLETED'] as const) {
      await updateIntegrationStatus({ integrationId: f.integrationId, shopId: f.shopId, status,
        executionAuthority: authority, error: null });
    }
    await withTenant(f.shopId, trx => ShopifyAppService.hardFenceAppUninstalled(
      f.shopId, trx, new Date(), f.domain));

    const response = await get(f, '/api/v1/integrations/sync-status');
    expect(response.body).toMatchObject({
      integrationId: f.integrationId,
      status: 'COMPLETED',
      connectionStatus: 'UNINSTALLED',
      connectionState: 'UNINSTALLED',
      shopDomain: f.domain,
    });
    expect(response.body.lastSyncedAt).not.toBeNull();
  });
});
