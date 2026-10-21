/**
 * GH-979 SECTION C — owner-only Shopify disconnect (appUninstall).
 *
 * Real createApp routes, JWT admission, current-membership owner authority,
 * sf_app and forced RLS on a disposable database. The real credential
 * resolver and lifecycle, GH-1068 hard fence, app/uninstalled durable receipt,
 * uninstall-verification worker, reconnect executor, 0219 durable attempt and
 * 0220 state-bound recovery proof run unmocked. Only the Shopify
 * GraphQL transport is a double: it is routed by document so the guard read
 * and the irreversible mutation are counted separately, and it fails closed
 * for anything else. No real Shopify call.
 *
 * A second createApp is loaded in an isolated module registry with its own
 * database pool: an independent application instance sharing only PostgreSQL.
 */
jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  createShopifyGraphQLClient: (...args: unknown[]) => mockCreateClient(...args),
}));
jest.mock('api-src/services/shopify/shopifyAdminCredentialRefreshProvider.service', () => ({
  refreshShopifyAdminCredential: (...args: unknown[]) => mockRefresh(...args),
}));
jest.mock('@lasyncro/backend-core/services/redis.client.js', () => ({
  getRedisClient: () => ({ get: async () => null, set: async () => 'OK', del: async () => 0 }),
}));

const mockPrecheck = jest.fn();
const mockUninstall = jest.fn();
const mockAttribution = jest.fn();
const mockRefresh = jest.fn(async (..._args: unknown[]) => { throw new Error('GH979_REFRESH_PROVIDER_CALLED'); });
const mockCreateClient = jest.fn((..._args: unknown[]) => ({
  request: async (document: string, options?: unknown) => {
    if (document.includes('LaSyncroDisconnectPrecheck')) return mockPrecheck(document, options);
    if (document.includes('LaSyncroAppUninstall')) return mockUninstall(document, options);
    if (document.includes('LaSyncroUninstallAttribution')) return mockAttribution(document, options);
    throw new Error('[GH979_TEST] unexpected Shopify document');
  },
}));

import crypto from 'crypto';
import { Client as PgClient } from 'pg';
import request from 'supertest';
import { HttpRequestError, HttpResponseError } from '@shopify/shopify-api';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemTransaction, systemQuery, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { persistShopifyAdminCredentials } from 'api-src/services/shopify/shopifyAdminCredential.repository';
import { resolveShopifyAdminCredentialForConsumer } from 'api-src/services/shopify/shopifyAdminCredentialConsumer.service';
import { readShopifyConnection } from 'api-src/services/shopify/shopifyConnectionState.service';
import { handleAppUninstalled } from 'api-src/api/shopify/handlers/handleAppUninstalled';
import {
  finalizeShopifyAdminCredentialReconnect,
  prepareShopifyAdminCredentialReconnect,
} from 'api-src/services/shopify/shopifyAdminCredentialLifecycle.service';
import { closeShopifyReconnectExecutor } from 'api-src/services/shopify/shopifyReconnectExecutor.db';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';
import {
  RECONCILE_MAX_ATTEMPTS,
  SHOPIFY_DISCONNECT_PROVIDER_DEADLINE_MS,
} from 'api-src/services/shopify/shopifyAppDisconnect.service';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { processShopifyUninstallVerificationOnce } from 'api-src/workers/shopifyUninstallVerification.worker';
import {
  claimShopifyUninstallVerification,
  issueShopifyOAuthStateWithRecoveryBinding,
  nextShopifyUninstallRecoveryShop,
  readOwnedShopifyUninstallVerification,
  settleShopifyUninstallRecovery,
  settleShopifyUninstallVerification,
} from 'api-src/services/shopify/shopifyUninstallVerification.repository';
import { assertSecurityPostconditions as assert0220SecurityPostconditions }
  from '../../../apps/backend/migrations/20261021130000_0220_add_state_bound_shopify_reconnect_proof';
// Production GH-1068 registrations (app/uninstalled → onShopifyAppUninstalled).
import 'api-src/api/shopify/shopify.webhook';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
let secondApp: ReturnType<typeof createApp>;
let secondDb: typeof db;
const DISCONNECT = '/api/v1/integrations/shopify/disconnect';
const RECONCILE = '/api/v1/integrations/shopify/disconnect/reconcile';
const CAPABILITY = '/api/v1/integrations/shopify/disconnect/capability';
const PROVIDER_INSTALLATION_GID = 'gid://shopify/AppInstallation/979';
const DEADLINE_TEST_TIMEOUT = SHOPIFY_DISCONNECT_PROVIDER_DEADLINE_MS + 20_000;

type Role = 'owner' | 'admin' | 'operator';
type Fixture = {
  shopId: number; domain: string; installationId: number; integrationId: number;
  users: Record<Role, number>; accessToken: string;
};

async function fixture(label: string): Promise<Fixture> {
  const unique = crypto.randomUUID();
  const domain = `gh979-${label}-${unique}.myshopify.com`;
  const accessToken = `gh979-access-${unique}`;
  return systemTransaction(async trx => {
    const shopId = await createTenantShop(trx, `gh979-${label}-${unique}`);
    await setTenantContext(trx, shopId);
    const users = {} as Record<Role, number>;
    for (const role of ['owner', 'admin', 'operator'] as Role[]) {
      const [user] = await trx('users').insert({ shop_id: shopId, role,
        email: `gh979-${label}-${role}-${unique}@test.invalid`, password_hash: 'synthetic' }).returning('id');
      await trx('shop_memberships').insert({ shop_id: shopId, user_id: user.id, role });
      users[role] = Number(user.id);
    }
    const [integration] = await trx('integrations').insert({ shop_id: shopId, platform: 'shopify',
      platform_shop_name: domain }).returning('id');
    const [installation] = await trx('shopify_app_installations').insert({ shop_id: shopId, shop_domain: domain,
      shop_gid: `gid://shopify/Shop/${shopId}`, scopes: SHOPIFY_REQUIRED_SCOPE_STRING, uninstalled_at: null })
      .returning('id');
    const now = Date.now();
    await persistShopifyAdminCredentials(trx, Number(installation.id), shopId, {
      accessToken, refreshToken: `gh979-refresh-${unique}`,
      accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING });
    const orderNow = new Date();
    await trx('orders').insert({ lasyncro_order_id: crypto.randomUUID(), shop_id: shopId, payment_state: 'paid',
      currency: 'USD', total_price: '10.00', subtotal_price: '10.00', total_tax: '0.00',
      order_created_at: orderNow, order_updated_at: orderNow, created_at: orderNow, updated_at: orderNow });
    return { shopId, domain, installationId: Number(installation.id), integrationId: Number(integration.id),
      users, accessToken };
  });
}

function token(f: Fixture, role: Role, shopId = f.shopId, claimedRoles: string[] = [role]) {
  return issueTestToken({ userId: f.users[role], shopId, roles: claimedRoles });
}
function post(path: string, f: Fixture, role: Role = 'owner', body: unknown = { confirmShopDomain: f.domain },
  options: { shopId?: number; claimedRoles?: string[]; instance?: typeof app } = {}) {
  return request(options.instance ?? app).post(path)
    .set('Authorization', `Bearer ${token(f, role, options.shopId, options.claimedRoles)}`).send(body as object);
}
const disconnect = (f: Fixture, role: Role = 'owner', body?: unknown, options?: Parameters<typeof post>[4]) =>
  post(DISCONNECT, f, role, body ?? { confirmShopDomain: f.domain }, options);
const reconcile = (f: Fixture, role: Role = 'owner', body?: unknown, options?: Parameters<typeof post>[4]) =>
  post(RECONCILE, f, role, body ?? { confirmShopDomain: f.domain }, options);
const capability = (f: Fixture, role: Role = 'owner', instance = app) =>
  request(instance).get(CAPABILITY).set('Authorization', `Bearer ${token(f, role)}`);
const syncStatus = (f: Fixture) =>
  request(app).get('/api/v1/integrations/sync-status').set('Authorization', `Bearer ${token(f, 'owner')}`);

async function credential(f: Fixture) {
  return withTenant(f.shopId, trx => trx('shopify_admin_credentials').where({ shop_id: f.shopId })
    .first('credential_state', 'credential_generation', 'access_token_encrypted', 'refresh_token_encrypted',
      'rotation_lease_token', 'access_expires_at', 'refresh_expires_at'));
}
async function installation(f: Fixture) {
  return withTenant(f.shopId, trx => trx('shopify_app_installations').where({ id: f.installationId })
    .first('uninstalled_at', 'shop_domain'));
}
async function attemptRows(f: Fixture) {
  return withTenant(f.shopId, trx => trx('shopify_app_disconnect_attempts').where({ shop_id: f.shopId })
    .orderBy('created_at', 'asc')
    .select('status', 'outcome_code', 'resolved_at', 'reconcile_attempts', 'uninstall_sent_at',
      'credential_generation', 'provider_installation_gid', 'claim_token', 'provider_confirmed_at', 'updated_at'));
}
async function latestAttempt(f: Fixture) {
  const rows = await attemptRows(f);
  return rows[rows.length - 1];
}
async function latestVerification(f: Fixture) {
  return withTenant(f.shopId, trx => trx('shopify_uninstall_verifications')
    .where({ shop_id: f.shopId }).orderBy('created_at', 'desc')
    .first('status', 'outcome_code', 'observed_installation_id',
      'observed_credential_generation', 'reconnect_event_watermark_id'));
}
/** Simulates the settle window having elapsed since the recorded intent. */
async function settle(f: Fixture) {
  await withTenant(f.shopId, trx => trx('shopify_app_disconnect_attempts')
    .where({ shop_id: f.shopId }).whereNull('resolved_at')
    .update({ uninstall_sent_at: trx.raw("pg_catalog.now() - interval '10 minutes'") }));
}
/** Simulates the sender stalling past its lease (optionally also past the settle window). */
async function stallSender(f: Fixture, options: { settled: boolean }) {
  await withTenant(f.shopId, trx => trx('shopify_app_disconnect_attempts')
    .where({ shop_id: f.shopId, status: 'UNINSTALL_SENT' })
    .update({ lease_expires_at: trx.raw("pg_catalog.now() - interval '1 second'"),
      ...(options.settled ? { uninstall_sent_at: trx.raw("pg_catalog.now() - interval '10 minutes'") } : {}) }));
}
/** A real GH-1068 app/uninstalled delivery through the canonical router (attribution, ledger, handler). */
function deliverAppUninstalledWebhook(f: Fixture, eventId = `gh979-${crypto.randomUUID()}`) {
  return WebhookRouter.dispatch({ integration: 'shopify', eventId,
    eventType: 'app/uninstalled', verified: true, receivedAt: new Date(),
    rawPayload: { domain: f.domain, myshopify_domain: f.domain }, shopDomain: f.domain });
}
/**
 * Simulates the durable trace left by a crashed or interrupted instance.
 * lease: 'live' (still running), 'expired' (process died), 'none' (outcome recorded).
 */
async function seedAttempt(f: Fixture, status: 'CLAIMED' | 'UNINSTALL_SENT' | 'PROVIDER_CONFIRMED',
  lease: 'live' | 'expired' | 'none') {
  await withTenant(f.shopId, async trx => {
    const current = await trx('shopify_admin_credentials').where({ shop_id: f.shopId })
      .first('credential_generation', 'access_expires_at', 'refresh_expires_at');
    const sent = status !== 'CLAIMED';
    await trx('shopify_app_disconnect_attempts').insert({
      shop_id: f.shopId, installation_id: f.installationId, shop_domain: f.domain,
      credential_generation: current.credential_generation, status,
      claim_token: lease === 'none' ? null : crypto.randomUUID(),
      lease_expires_at: lease === 'none' ? null : trx.raw(lease === 'live'
        ? "pg_catalog.now() + interval '1 minute'" : "pg_catalog.now() - interval '1 second'"),
      ...(sent ? {
        uninstall_sent_at: trx.raw("pg_catalog.now() - interval '30 seconds'"),
        pinned_access_expires_at: current.access_expires_at,
        pinned_refresh_expires_at: current.refresh_expires_at,
        provider_installation_gid: PROVIDER_INSTALLATION_GID,
      } : {}),
    });
  });
}
/** Tenant-owned workspace/history row counts that disconnect must never reduce. */
async function preserved(f: Fixture) {
  return withTenant(f.shopId, async trx => {
    const count = async (table: string) => Number((await trx(table).where({ shop_id: f.shopId })
      .count<{ count: string }[]>({ count: '*' }))[0].count);
    return {
      shops: Number((await trx('shops').where({ id: f.shopId }).count<{ count: string }[]>({ count: '*' }))[0].count),
      users: await count('users'), memberships: await count('shop_memberships'), orders: await count('orders'),
      integrations: await count('integrations'), installations: await count('shopify_app_installations'),
      credentials: await count('shopify_admin_credentials'), inventoryMovements: await count('inventory_movements'),
    };
  });
}
/** Backends of this database holding an open transaction while idle (e.g. awaiting network I/O). */
async function idleInTransaction(): Promise<number> {
  const rows = await db.raw(`SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity
    WHERE datname = pg_catalog.current_database() AND pid <> pg_catalog.pg_backend_pid()
      AND state LIKE 'idle in transaction%'`);
  return rows.rows[0].n;
}
async function reinstall(f: Fixture, label: string) {
  const prepared = await prepareShopifyAdminCredentialReconnect({ shopId: f.shopId, shopDomain: f.domain,
    now: new Date() });
  expect(prepared.kind).toBe('RECONNECT_PREPARED');
  const now = Date.now();
  return finalizeShopifyAdminCredentialReconnect({ ...(prepared as any), credentials: {
    accessToken: `gh979-${label}-access`, refreshToken: `gh979-${label}-refresh`,
    accessExpiresAt: new Date(now + 172_800_000), refreshExpiresAt: new Date(now + 1_209_600_000),
    grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    shopIdentity: { gid: `gid://shopify/Shop/${f.shopId}`, currencyCode: 'EUR', name: null,
      contactEmail: null, ianaTimezone: null } } });
}
const consumerKind = async (f: Fixture, now = new Date()) =>
  (await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now })).kind;

const precheckOk = (f: Fixture) => ({ data: { shop: { myshopifyDomain: f.domain },
  currentAppInstallation: { id: PROVIDER_INSTALLATION_GID } } });
const uninstallOk = { data: { appUninstall: { app: { id: 'gid://shopify/App/979' }, userErrors: [] } } };
const unauthorized = () => new HttpResponseError({ message: 'revoked', code: 401, statusText: 'Unauthorized' });

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

beforeAll(() => {
  process.env.ENCRYPTION_KEY ||= 'gh979-disconnect-encryption-key-2026-0123456';
  // Test-only webhook signing secrets for the real HMAC route (never provider secrets).
  process.env.SHOPIFY_WEBHOOK_SECRET ||= 'gh979-test-webhook-secret';
  process.env.SHOPIFY_API_SECRET ||= 'gh979-test-api-secret';
  const database = process.env.PGDATABASE ?? '';
  if (process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1' || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(database)) {
    throw new Error('GH979_REFUSING_UNSAFE_DB');
  }
  jest.isolateModules(() => {
    secondApp = require('api-src/bootstrap/express').createApp();
    secondDb = require('@lasyncro/backend-core/db.js').default;
  });
});

afterAll(async () => {
  const results = await Promise.allSettled([db.destroy(), secondDb?.destroy(), closeShopifyReconnectExecutor()]);
  expect(results.every(result => result.status === 'fulfilled')).toBe(true);
});

beforeEach(() => {
  mockCreateClient.mockClear();
  mockPrecheck.mockReset();
  mockUninstall.mockReset();
  mockAttribution.mockReset();
  mockRefresh.mockClear();
});

describe('GH-979 C — owner disconnect success and preservation', () => {
  it('records intent before one bounded uninstall, holds no transaction across it, fences and preserves data', async () => {
    const f = await fixture('success');
    const before = await preserved(f);
    const generationBefore = (await credential(f)).credential_generation;
    const during: Record<string, unknown> = {};
    mockPrecheck.mockImplementation(async () => {
      during.precheckIdleInTransaction = await idleInTransaction();
      return precheckOk(f);
    });
    mockUninstall.mockImplementation(async () => {
      // Observed from an independent connection while the provider call is outstanding.
      during.idleInTransaction = await idleInTransaction();
      during.attempt = await latestAttempt(f);
      during.state = (await readShopifyConnection(f.shopId)).state;
      during.consumer = await consumerKind(f);
      return uninstallOk;
    });

    const response = await disconnect(f, 'owner', { confirmShopDomain: f.domain.toUpperCase() });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'SHOPIFY_DISCONNECTED', shopDomain: f.domain,
      connectionState: 'UNINSTALLED' });
    expect(JSON.stringify(response.body)).not.toContain(f.accessToken);
    expect(mockPrecheck).toHaveBeenCalledTimes(1);
    expect(mockUninstall).toHaveBeenCalledTimes(1);
    // Bounded and never retried by the SDK.
    expect(mockUninstall).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ retries: 0, signal: expect.any(AbortSignal) }));
    expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: f.accessToken, platformShopName: f.domain, shopId: f.shopId }));

    // F1: no transaction open during provider I/O. F3: durable intent committed first, consumers already closed.
    expect(during.precheckIdleInTransaction).toBe(0);
    expect(during.idleInTransaction).toBe(0);
    expect(during.attempt).toMatchObject({ status: 'UNINSTALL_SENT', resolved_at: null,
      credential_generation: generationBefore, provider_installation_gid: PROVIDER_INSTALLATION_GID });
    expect(during.state).toBe('REAUTH_REQUIRED');
    expect(during.consumer).toBe('REAUTH_REQUIRED');

    // Canonical GH-1068 fence on the pinned installation: authority advanced once, tokens destroyed.
    expect((await installation(f)).uninstalled_at).not.toBeNull();
    const fenced = await credential(f);
    expect(fenced.credential_state).toBe('REAUTH_REQUIRED');
    expect(BigInt(fenced.credential_generation)).toBe(BigInt(generationBefore) + 1n);
    expect(fenced.access_token_encrypted).toBeNull();
    expect(fenced.refresh_token_encrypted).toBeNull();
    expect(await latestAttempt(f)).toMatchObject({ status: 'CONFIRMED', outcome_code: 'LOCAL_FENCE_APPLIED' });

    expect(await consumerKind(f)).not.toBe('READY');
    expect((await readShopifyConnection(f.shopId)).state).toBe('UNINSTALLED');
    expect((await syncStatus(f)).body.connectionState).toBe('UNINSTALLED');
    expect((await capability(f)).body).toEqual({ canDisconnectShopify: true, disconnect: null });
    const resync = await request(app).post(`/api/v1/integrations/sync/${f.integrationId}`)
      .set('Authorization', `Bearer ${token(f, 'owner')}`);
    expect(resync.status).toBe(409);

    expect(await preserved(f)).toEqual(before);
    expect(before.orders).toBe(1);
  });
});

describe('GH-979 C — authorization and tenant isolation', () => {
  it.each(['admin', 'operator'] as Role[])('%s is denied disconnect and reconcile even with an owner JWT claim',
    async role => {
      const f = await fixture(`deny-${role}`);
      const before = { credential: await credential(f), installation: await installation(f) };
      for (const call of [disconnect, reconcile]) {
        const response = await call(f, role, { confirmShopDomain: f.domain }, { claimedRoles: ['owner'] });
        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'OWNER_REQUIRED' });
      }
      const cap = await capability(f, role);
      expect(cap.status).toBe(200);
      expect(cap.body).toEqual({ canDisconnectShopify: false, disconnect: null });
      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(await attemptRows(f)).toEqual([]);
      expect({ credential: await credential(f), installation: await installation(f) }).toEqual(before);
    });

  it('owner capability is true; unauthenticated requests are rejected', async () => {
    const f = await fixture('capability');
    expect((await capability(f)).body).toEqual({ canDisconnectShopify: true, disconnect: null });
    expect((await request(app).post(DISCONNECT).send({ confirmShopDomain: f.domain })).status).toBe(401);
    expect((await request(app).post(RECONCILE).send({ confirmShopDomain: f.domain })).status).toBe(401);
    expect((await request(app).get(CAPABILITY)).status).toBe(401);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('cross-tenant: foreign claims and confirmations never reach either tenant; attempts and gates are tenant-scoped', async () => {
    const a = await fixture('tenant-a');
    const b = await fixture('tenant-b');
    const beforeB = { credential: await credential(b), installation: await installation(b) };

    const foreignClaim = await disconnect(a, 'owner', { confirmShopDomain: b.domain }, { shopId: b.shopId });
    // Rejected first by canonical AUTH-ADMISSION-01 (authenticateToken), before this controller.
    expect(foreignClaim.status).toBe(403);
    expect(foreignClaim.body).toEqual({ error: 'Shop context mismatch.' });
    expect((await reconcile(a, 'owner', { confirmShopDomain: b.domain }, { shopId: b.shopId })).status).toBe(403);

    const foreignStore = await disconnect(a, 'owner', { confirmShopDomain: b.domain });
    expect(foreignStore.status).toBe(409);
    expect(foreignStore.body).toEqual({ error: 'DISCONNECT_CONFIRMATION_MISMATCH' });
    expect((await disconnect(a, 'owner', {})).status).toBe(400);
    expect(mockCreateClient).not.toHaveBeenCalled();

    // An unresolved disconnect in A is invisible to B (forced RLS) and never gates B.
    mockPrecheck.mockResolvedValue(precheckOk(a));
    mockUninstall.mockRejectedValue(new HttpRequestError('socket hang up'));
    expect((await disconnect(a)).status).toBe(502);
    expect((await readShopifyConnection(a.shopId)).state).toBe('REAUTH_REQUIRED');
    const visibleToB = await withTenant(b.shopId, trx => trx('shopify_app_disconnect_attempts')
      .where({ shop_id: a.shopId }).count<{ count: string }[]>({ count: '*' }));
    expect(Number(visibleToB[0].count)).toBe(0);
    const foreignReconcile = await reconcile(b, 'owner', { confirmShopDomain: a.domain });
    expect(foreignReconcile.status).toBe(409);
    expect(foreignReconcile.body).toEqual({ error: 'SHOPIFY_DISCONNECT_NOT_PENDING', connectionState: 'CONNECTED' });
    expect((await capability(b)).body.disconnect).toBeNull();
    expect((await readShopifyConnection(b.shopId)).state).toBe('CONNECTED');
    expect(await consumerKind(b)).toBe('READY');
    expect({ credential: await credential(b), installation: await installation(b) }).toEqual(beforeB);
  });
});

describe('GH-979 C — provider rejection, guard failures and deadlines', () => {
  it('userErrors are a rejection: provider codes only, nothing fenced, readiness restored', async () => {
    const f = await fixture('user-errors');
    const before = await credential(f);
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockResolvedValue({ data: { appUninstall: { app: null,
      userErrors: [{ field: null, message: 'Shopify-authored detail', code: 'APP_UNINSTALL_FAILED' }] } } });
    const response = await disconnect(f);
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: 'SHOPIFY_DISCONNECT_REJECTED', providerErrorCodes: ['APP_UNINSTALL_FAILED'] });
    expect(JSON.stringify(response.body)).not.toContain('Shopify-authored');
    expect(await credential(f)).toEqual(before);
    expect(await latestAttempt(f)).toMatchObject({ status: 'REJECTED', outcome_code: 'APP_UNINSTALL_FAILED' });
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
    expect(await consumerKind(f)).toBe('READY');
    expect((await capability(f)).body.disconnect).toBeNull();
  });

  it('a guard-read transport failure never sends the irreversible mutation', async () => {
    const f = await fixture('precheck-transport');
    mockPrecheck.mockRejectedValue(new HttpRequestError('synthetic network failure'));
    const response = await disconnect(f);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'SHOPIFY_UNAVAILABLE', retryable: true });
    expect(mockUninstall).not.toHaveBeenCalled();
    expect(await latestAttempt(f)).toMatchObject({ status: 'ABORTED', outcome_code: 'PRECHECK_FAILED' });
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
  });

  it('a guard read answering for another store refuses before mutating', async () => {
    const f = await fixture('identity');
    mockPrecheck.mockResolvedValue({ data: { shop: { myshopifyDomain: 'someone-else.myshopify.com' },
      currentAppInstallation: { id: 'gid://shopify/AppInstallation/1' } } });
    const response = await disconnect(f);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'SHOPIFY_IDENTITY_MISMATCH' });
    expect(mockUninstall).not.toHaveBeenCalled();
    expect(await latestAttempt(f)).toMatchObject({ status: 'ABORTED', outcome_code: 'IDENTITY_MISMATCH' });
  });

  it('a hung guard read is cut off at the deadline; nothing is sent and nothing stays blocked', async () => {
    const f = await fixture('precheck-deadline');
    mockPrecheck.mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    const response = await disconnect(f);
    const elapsed = Date.now() - started;
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'SHOPIFY_UNAVAILABLE', retryable: true });
    expect(elapsed).toBeGreaterThanOrEqual(SHOPIFY_DISCONNECT_PROVIDER_DEADLINE_MS - 50);
    expect(elapsed).toBeLessThan(SHOPIFY_DISCONNECT_PROVIDER_DEADLINE_MS + 5_000);
    expect(mockPrecheck.mock.calls[0][1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect((mockPrecheck.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect(mockUninstall).not.toHaveBeenCalled();
    expect(await latestAttempt(f)).toMatchObject({ status: 'ABORTED' });
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockResolvedValue(uninstallOk);
    expect((await disconnect(f)).status).toBe(200);
  }, DEADLINE_TEST_TIMEOUT);
});

describe('GH-979 C — ambiguous outcomes are durable, fail-closed, visible and never repeated', () => {
  it.each([
    ['a thrown transport failure', () => mockUninstall.mockRejectedValue(new HttpRequestError('socket hang up'))],
    ['an HTTP 5xx', () => mockUninstall.mockRejectedValue(new HttpResponseError({ message: 'synthetic',
      code: 503, statusText: 'Service Unavailable' }))],
    ['a malformed payload', () => mockUninstall.mockResolvedValue({ data: { appUninstall: null } })],
    ['success without the uninstalled app', () => mockUninstall.mockResolvedValue({ data: { appUninstall: {
      app: null, userErrors: [] } } })],
  ])('%s is OUTCOME_UNKNOWN: never success, nothing fenced, consumers closed, no repeat', async (_label, arrange) => {
    const f = await fixture('ambiguous');
    const before = await credential(f);
    const data = await preserved(f);
    mockPrecheck.mockResolvedValue(precheckOk(f));
    arrange();

    const response = await disconnect(f);
    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'SHOPIFY_DISCONNECT_OUTCOME_UNKNOWN', retryable: false,
      shopDomain: f.domain, recovery: 'CHECK_LATER' });
    expect(await credential(f)).toEqual(before);
    expect((await installation(f)).uninstalled_at).toBeNull();
    expect(await latestAttempt(f)).toMatchObject({ status: 'OUTCOME_UNKNOWN', resolved_at: null });

    // Fail-closed: never CONNECTED/healthy; no provider work; manual sync refused.
    expect((await readShopifyConnection(f.shopId)).state).toBe('REAUTH_REQUIRED');
    expect((await syncStatus(f)).body.connectionState).toBe('REAUTH_REQUIRED');
    expect(await consumerKind(f)).toBe('REAUTH_REQUIRED');
    expect((await request(app).post(`/api/v1/integrations/sync/${f.integrationId}`)
      .set('Authorization', `Bearer ${token(f, 'owner')}`)).status).toBe(409);
    // Visible to every member, durable across instances.
    const unresolved = { status: 'OUTCOME_UNKNOWN', shopDomain: f.domain, recovery: 'CHECK_LATER' };
    expect((await capability(f, 'operator', secondApp)).body).toEqual({ canDisconnectShopify: false, disconnect: unresolved });

    // A repeated disconnect or an early re-check never contacts Shopify.
    mockCreateClient.mockClear();
    for (const call of [disconnect, reconcile]) {
      const repeat = await call(f);
      expect(repeat.status).toBe(502);
      expect(repeat.body).toMatchObject({ error: 'SHOPIFY_DISCONNECT_OUTCOME_UNKNOWN', recovery: 'CHECK_LATER' });
    }
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockUninstall).toHaveBeenCalledTimes(1);
    expect(await preserved(f)).toEqual(data);
  });

  it('a hung uninstall is cut off at the deadline as OUTCOME_UNKNOWN, then reconciled as not uninstalled', async () => {
    const f = await fixture('uninstall-deadline');
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    const response = await disconnect(f);
    expect(Date.now() - started).toBeLessThan(SHOPIFY_DISCONNECT_PROVIDER_DEADLINE_MS + 5_000);
    expect(response.status).toBe(502);
    expect((mockUninstall.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect((await readShopifyConnection(f.shopId)).state).toBe('REAUTH_REQUIRED');

    // After the settle window, the same provider installation still answering with the pinned grant
    // is independent evidence the uninstall did not take effect.
    await settle(f);
    mockPrecheck.mockClear();
    const check = await reconcile(f);
    expect(check.status).toBe(409);
    expect(check.body).toEqual({ error: 'SHOPIFY_DISCONNECT_NOT_APPLIED', shopDomain: f.domain });
    expect(mockPrecheck).toHaveBeenCalledTimes(1);
    expect(mockUninstall).toHaveBeenCalledTimes(1);
    expect(await latestAttempt(f)).toMatchObject({ status: 'NOT_UNINSTALLED', reconcile_attempts: 1 });
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
    expect(await consumerKind(f)).toBe('READY');
    expect((await capability(f)).body.disconnect).toBeNull();
  }, DEADLINE_TEST_TIMEOUT);

  it('lost response + lost webhook: auth failure is never proof; bounded checks; reinstall recovers', async () => {
    const f = await fixture('lost-both');
    const data = await preserved(f);
    mockPrecheck.mockResolvedValue(precheckOk(f));
    // Shopify uninstalled the app, but the response and the webhook are both lost.
    mockUninstall.mockRejectedValue(new HttpRequestError('connection reset'));
    expect((await disconnect(f)).status).toBe(502);
    await settle(f);

    mockPrecheck.mockReset().mockRejectedValue(unauthorized());
    for (let check = 1; check <= RECONCILE_MAX_ATTEMPTS; check += 1) {
      const response = await reconcile(f);
      expect(response.status).toBe(502);
      expect(response.body.recovery).toBe(check < RECONCILE_MAX_ATTEMPTS ? 'CHECK_LATER' : 'RECONNECT');
      expect((await readShopifyConnection(f.shopId)).state).toBe('REAUTH_REQUIRED');
    }
    expect(mockPrecheck).toHaveBeenCalledTimes(RECONCILE_MAX_ATTEMPTS);
    // Bounded: no further provider checks; explicit recovery path.
    const exhausted = await reconcile(f);
    expect(exhausted.body).toMatchObject({ error: 'SHOPIFY_DISCONNECT_OUTCOME_UNKNOWN', recovery: 'RECONNECT' });
    expect(mockPrecheck).toHaveBeenCalledTimes(RECONCILE_MAX_ATTEMPTS);
    expect(mockUninstall).toHaveBeenCalledTimes(1);
    expect((await capability(f)).body.disconnect).toEqual({ status: 'OUTCOME_UNKNOWN', shopDomain: f.domain,
      recovery: 'RECONNECT' });
    expect(await latestAttempt(f)).toMatchObject({ status: 'OUTCOME_UNKNOWN', resolved_at: null,
      reconcile_attempts: RECONCILE_MAX_ATTEMPTS });
    // Still only an unconfirmed state: nothing fenced locally on authentication failure.
    expect((await installation(f)).uninstalled_at).toBeNull();
    expect((await credential(f)).credential_state).toBe('ACTIVE');

    // Recovery: canonical reconnect/reinstall issues new verified authority.
    await expect(reinstall(f, 'lost-both')).resolves.toMatchObject({ kind: 'RECONNECTED' });
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
    expect(await consumerKind(f)).toBe('READY');
    expect((await capability(f)).body.disconnect).toBeNull();
    const settled = await reconcile(f);
    expect(settled.body).toEqual({ error: 'SHOPIFY_DISCONNECT_NOT_PENDING', connectionState: 'CONNECTED' });
    expect(await latestAttempt(f)).toMatchObject({ status: 'SUPERSEDED', outcome_code: 'AUTHORITY_CHANGED' });
    expect(await preserved(f)).toEqual(data);
  });

  it('a later app/uninstalled webhook confirms an unknown outcome', async () => {
    const f = await fixture('unknown-webhook');
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockRejectedValue(new HttpRequestError('socket hang up'));
    expect((await disconnect(f)).status).toBe(502);

    await withTenant(f.shopId, trx => handleAppUninstalled(f.shopId, trx));
    expect((await readShopifyConnection(f.shopId)).state).toBe('UNINSTALLED');
    expect((await capability(f)).body.disconnect).toBeNull();
    mockCreateClient.mockClear();
    const check = await reconcile(f);
    expect(check.status).toBe(409);
    expect(check.body).toEqual({ error: 'SHOPIFY_DISCONNECT_NOT_PENDING', connectionState: 'UNINSTALLED' });
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(await latestAttempt(f)).toMatchObject({ status: 'CONFIRMED', outcome_code: 'WEBHOOK_FENCED' });
  });
});

describe('GH-979 C — expired, crashed and interrupted attempts', () => {
  it('an expired pre-intent claim never gates readiness and never blocks a new disconnect', async () => {
    const f = await fixture('claim-expired');
    await seedAttempt(f, 'CLAIMED', 'expired');
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockResolvedValue(uninstallOk);
    expect((await disconnect(f)).status).toBe(200);
    const rows = await attemptRows(f);
    expect(rows.map(row => [row.status, row.outcome_code])).toEqual([
      ['ABORTED', 'LEASE_EXPIRED'], ['CONFIRMED', 'LOCAL_FENCE_APPLIED']]);
  });

  it('a live claim held by another instance is IN_PROGRESS without any provider call', async () => {
    const f = await fixture('claim-live');
    await seedAttempt(f, 'CLAIMED', 'live');
    const response = await disconnect(f);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'SHOPIFY_DISCONNECT_IN_PROGRESS', retryable: true });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('an instance that crashed after recording intent stays fail-closed and is never resent', async () => {
    const f = await fixture('sent-crashed');
    await seedAttempt(f, 'UNINSTALL_SENT', 'live');
    expect((await readShopifyConnection(f.shopId)).state).toBe('REAUTH_REQUIRED');
    expect((await disconnect(f)).body).toEqual({ error: 'SHOPIFY_DISCONNECT_IN_PROGRESS', retryable: true });
    expect((await capability(f)).body.disconnect).toEqual({ status: 'IN_PROGRESS', shopDomain: f.domain, recovery: null });

    await withTenant(f.shopId, trx => trx('shopify_app_disconnect_attempts').where({ shop_id: f.shopId })
      .update({ lease_expires_at: trx.raw("pg_catalog.now() - interval '1 second'") }));
    const response = await disconnect(f);
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ error: 'SHOPIFY_DISCONNECT_OUTCOME_UNKNOWN', recovery: 'CHECK_LATER' });
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(await latestAttempt(f)).toMatchObject({ status: 'OUTCOME_UNKNOWN', outcome_code: 'OUTCOME_NOT_RECORDED' });
    expect((await readShopifyConnection(f.shopId)).state).toBe('REAUTH_REQUIRED');
  });

  it('an instance interrupted after Shopify confirmed completes the pinned fence without contacting Shopify', async () => {
    const f = await fixture('confirmed-crashed');
    const generationBefore = (await credential(f)).credential_generation;
    await seedAttempt(f, 'PROVIDER_CONFIRMED', 'none');
    expect((await readShopifyConnection(f.shopId)).state).toBe('REAUTH_REQUIRED');
    expect((await capability(f)).body.disconnect).toMatchObject({ status: 'LOCAL_FENCE_PENDING' });
    const response = await reconcile(f);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'SHOPIFY_DISCONNECTED', shopDomain: f.domain, connectionState: 'UNINSTALLED' });
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(BigInt((await credential(f)).credential_generation)).toBe(BigInt(generationBefore) + 1n);
  });
});

describe('GH-979 C — concurrency across independent application instances', () => {
  it('the instances share no in-memory state: separate module registries and database pools', () => {
    expect(secondApp).not.toBe(app);
    expect(secondDb).not.toBe(db);
  });

  it('a disconnect in flight on one instance is IN_PROGRESS on the other; exactly one uninstall', async () => {
    const f = await fixture('instances');
    const entered = deferred();
    const release = deferred();
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockImplementation(async () => { entered.resolve(); await release.promise; return uninstallOk; });

    const first = disconnect(f).then(response => response);
    await entered.promise;
    for (const instance of [secondApp, app]) {
      const other = await disconnect(f, 'owner', undefined, { instance });
      expect(other.status).toBe(409);
      expect(other.body).toEqual({ error: 'SHOPIFY_DISCONNECT_IN_PROGRESS', retryable: true });
    }
    release.resolve();
    expect((await first).status).toBe(200);
    expect(mockUninstall).toHaveBeenCalledTimes(1);
  });

  it('a simultaneous burst across both instances admits exactly one attempt', async () => {
    const f = await fixture('burst');
    // The admitted attempt stays in flight until every other request has been answered.
    const othersAnswered = deferred();
    let answered = 0;
    mockPrecheck.mockImplementation(async () => {
      await othersAnswered.promise;
      return precheckOk(f);
    });
    mockUninstall.mockResolvedValue(uninstallOk);
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      disconnect(f, 'owner', undefined, { instance: index % 2 === 0 ? app : secondApp }).then(response => {
        if (response.status !== 200 && ++answered === 5) othersAnswered.resolve();
        return response;
      })));
    const statuses = responses.map(response => response.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409, 409]);
    expect(responses.filter(response => response.status === 409)
      .every(response => response.body.error === 'SHOPIFY_DISCONNECT_IN_PROGRESS')).toBe(true);
    expect(mockPrecheck).toHaveBeenCalledTimes(1);
    expect(mockUninstall).toHaveBeenCalledTimes(1);
    expect((await attemptRows(f)).map(row => row.status)).toEqual(['CONFIRMED']);
  });
});

describe('GH-979 C — newer installation and credential epochs are never fenced', () => {
  it('a rotation committed before the intent refuses the mutation', async () => {
    const f = await fixture('rotation-before');
    mockPrecheck.mockImplementation(async () => {
      // A completed rotation: new epoch and new material for the same installation.
      await withTenant(f.shopId, trx => trx('shopify_admin_credentials').where({ shop_id: f.shopId }).update({
        credential_generation: trx.raw('credential_generation + 1'),
        access_expires_at: trx.raw("pg_catalog.now() + interval '2 days'") }));
      return precheckOk(f);
    });
    const response = await disconnect(f);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'SHOPIFY_CREDENTIAL_UNAVAILABLE', retryable: true });
    expect(mockUninstall).not.toHaveBeenCalled();
    expect(await latestAttempt(f)).toMatchObject({ status: 'ABORTED', outcome_code: 'AUTHORITY_CHANGED' });
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
  });

  it('no rotation can start once the intent is recorded', async () => {
    const control = await fixture('rotation-control');
    const f = await fixture('rotation-after');
    const due = async (fx: Fixture) => new Date((await credential(fx)).access_expires_at.getTime() - 60_000);
    // Control: without an unresolved disconnect, a due credential claims a refresh.
    await expect(resolveShopifyAdminCredentialForConsumer({ shopId: control.shopId, now: await due(control) }))
      .rejects.toThrow('GH979_REFRESH_PROVIDER_CALLED');
    mockRefresh.mockClear();

    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockRejectedValue(new HttpRequestError('socket hang up'));
    expect((await disconnect(f)).status).toBe(502);
    const before = await credential(f);
    expect(await consumerKind(f, await due(f))).toBe('REAUTH_REQUIRED');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(await credential(f)).toEqual(before);
    expect(before.rotation_lease_token).toBeNull();
  });

  it('a generation-only advance (same material) is not fenced and stays fail-closed', async () => {
    const f = await fixture('epoch-moved');
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockImplementation(async () => {
      await withTenant(f.shopId, trx => trx('shopify_admin_credentials').where({ shop_id: f.shopId })
        .update({ credential_generation: trx.raw('credential_generation + 1') }));
      return uninstallOk;
    });
    const response = await disconnect(f);
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'SHOPIFY_DISCONNECT_PENDING_CONFIRMATION', shopDomain: f.domain,
      reason: 'LOCAL_FENCE_PENDING' });
    const after = await credential(f);
    expect(after.credential_state).toBe('ACTIVE');
    expect(after.access_token_encrypted).not.toBeNull();
    expect((await installation(f)).uninstalled_at).toBeNull();
    expect((await readShopifyConnection(f.shopId)).state).toBe('REAUTH_REQUIRED');
    expect(await consumerKind(f)).toBe('REAUTH_REQUIRED');
    expect((await capability(f)).body.disconnect).toMatchObject({ status: 'LOCAL_FENCE_PENDING' });

    // A re-check never fences the moved epoch; the webhook still completes it.
    expect((await reconcile(f)).status).toBe(202);
    expect((await credential(f)).credential_state).toBe('ACTIVE');
    await withTenant(f.shopId, trx => handleAppUninstalled(f.shopId, trx));
    expect((await readShopifyConnection(f.shopId)).state).toBe('UNINSTALLED');
    expect((await reconcile(f)).body).toEqual({ error: 'SHOPIFY_DISCONNECT_NOT_PENDING', connectionState: 'UNINSTALLED' });
    expect(await latestAttempt(f)).toMatchObject({ status: 'CONFIRMED', outcome_code: 'WEBHOOK_FENCED' });
  });

  it('an old-installation uninstall racing a reinstall never fences the new installation epoch', async () => {
    const f = await fixture('reinstall-race');
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockImplementation(async () => {
      await expect(reinstall(f, 'race')).resolves.toMatchObject({ kind: 'RECONNECTED' });
      return uninstallOk;
    });
    const response = await disconnect(f);
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'SHOPIFY_DISCONNECT_PENDING_CONFIRMATION', shopDomain: f.domain,
      reason: 'AUTHORITY_CHANGED' });
    expect((await installation(f)).uninstalled_at).toBeNull();
    expect((await credential(f)).credential_state).toBe('ACTIVE');
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
    const consumer = await resolveShopifyAdminCredentialForConsumer({ shopId: f.shopId, now: new Date() });
    expect(consumer).toMatchObject({ kind: 'READY', accessToken: 'gh979-race-access' });
    expect(await latestAttempt(f)).toMatchObject({ status: 'SUPERSEDED', outcome_code: 'AUTHORITY_CHANGED' });
  });
});

describe('GH-979 C — webhook before, during and after the API response', () => {
  it('a webhook uninstall before the request leaves nothing to disconnect and no provider call', async () => {
    const f = await fixture('webhook-first');
    await withTenant(f.shopId, trx => handleAppUninstalled(f.shopId, trx));
    const response = await disconnect(f);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'SHOPIFY_NOT_CONNECTED', connectionState: 'UNINSTALLED' });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('a webhook fence landing during the provider call is not fenced twice', async () => {
    const f = await fixture('webhook-race');
    const generationBefore = (await credential(f)).credential_generation;
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockImplementation(async () => {
      await withTenant(f.shopId, trx => handleAppUninstalled(f.shopId, trx));
      return uninstallOk;
    });
    const response = await disconnect(f);
    expect(response.status).toBe(200);
    expect(response.body.connectionState).toBe('UNINSTALLED');
    expect(BigInt((await credential(f)).credential_generation)).toBe(BigInt(generationBefore) + 1n);
    expect(await latestAttempt(f)).toMatchObject({ status: 'CONFIRMED', outcome_code: 'WEBHOOK_FENCED' });
  });

  it('a duplicate disconnect after success and a later app/uninstalled webhook are both safe', async () => {
    const f = await fixture('duplicate');
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockResolvedValue(uninstallOk);
    expect((await disconnect(f)).status).toBe(200);

    const again = await disconnect(f);
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: 'SHOPIFY_NOT_CONNECTED', connectionState: 'UNINSTALLED' });
    expect(mockUninstall).toHaveBeenCalledTimes(1);

    await withTenant(f.shopId, trx => handleAppUninstalled(f.shopId, trx));
    expect((await readShopifyConnection(f.shopId)).state).toBe('UNINSTALLED');
    expect((await credential(f)).access_token_encrypted).toBeNull();
  });
});

describe('GH-979 C — reinstallation compatibility', () => {
  it('a disconnected store reinstalls through the canonical GH-1068 reconnect path', async () => {
    const f = await fixture('reinstall');
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockResolvedValue(uninstallOk);
    expect((await disconnect(f)).status).toBe(200);

    const prepared = await prepareShopifyAdminCredentialReconnect({ shopId: f.shopId, shopDomain: f.domain,
      now: new Date() });
    expect(prepared).toMatchObject({ kind: 'RECONNECT_PREPARED', mode: 'REINSTALL', installationState: 'UNINSTALLED' });
    const now = Date.now();
    await expect(finalizeShopifyAdminCredentialReconnect({ ...(prepared as any), credentials: {
      accessToken: 'gh979-reinstalled-access', refreshToken: 'gh979-reinstalled-refresh',
      accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
      shopIdentity: { gid: `gid://shopify/Shop/${f.shopId}`, currencyCode: 'EUR', name: null,
        contactEmail: null, ianaTimezone: null } } })).resolves.toMatchObject({ kind: 'RECONNECTED' });

    expect((await installation(f)).uninstalled_at).toBeNull();
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
    expect((await credential(f)).credential_state).toBe('ACTIVE');
    // The reinstalled store can be disconnected again as a fresh attempt.
    mockUninstall.mockClear();
    expect((await disconnect(f)).status).toBe(200);
    expect(mockUninstall).toHaveBeenCalledTimes(1);
    expect((await attemptRows(f)).map(row => row.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
  });
});

describe('GH-979 C — late outcome ownership (Finding A)', () => {
  /** Sender is inside appUninstall; returns a release function that answers it. */
  async function senderInFlight(f: Fixture) {
    const entered = deferred();
    const answer = deferred<() => Promise<unknown>>();
    mockPrecheck.mockImplementationOnce(async () => precheckOk(f));
    mockUninstall.mockImplementationOnce(async () => { entered.resolve(); return (await answer.promise)(); });
    const response = disconnect(f).then(r => r);
    await entered.promise;
    return { response, answer: (reply: () => Promise<unknown>) => answer.resolve(reply) };
  }

  it('a late success never overwrites a live reconciliation lease; the lease owner promotes it', async () => {
    const f = await fixture('late-vs-lease');
    const sender = await senderInFlight(f);
    await stallSender(f, { settled: true });

    // Another owner request takes over the expired attempt and holds a live reconciliation lease.
    const reconEntered = deferred();
    const reconAnswer = deferred();
    mockPrecheck.mockImplementationOnce(async () => { reconEntered.resolve(); await reconAnswer.promise; throw unauthorized(); });
    const reconciliation = reconcile(f).then(r => r);
    await reconEntered.promise;
    const leased = await latestAttempt(f);
    expect(leased).toMatchObject({ status: 'OUTCOME_UNKNOWN', provider_confirmed_at: null });
    expect(leased.claim_token).not.toBeNull();

    sender.answer(async () => uninstallOk);
    const late = await sender.response;
    expect(late.status).toBe(202);
    expect(late.body).toEqual({ status: 'SHOPIFY_DISCONNECT_PENDING_CONFIRMATION', shopDomain: f.domain,
      reason: 'LOCAL_FENCE_PENDING' });
    const kept = await latestAttempt(f);
    // The reconciler's lease and status are untouched; the provider evidence is durable.
    expect(kept).toMatchObject({ status: 'OUTCOME_UNKNOWN', claim_token: leased.claim_token });
    expect(kept.provider_confirmed_at).not.toBeNull();
    expect((await readShopifyConnection(f.shopId)).state).toBe('REAUTH_REQUIRED');
    expect((await capability(f)).body.disconnect).toMatchObject({ status: 'LOCAL_FENCE_PENDING' });

    // The reconciler's 401 is not proof, but the recorded confirmation is: it fences.
    reconAnswer.resolve();
    const settled = await reconciliation;
    expect(settled.status).toBe(200);
    expect(settled.body).toEqual({ status: 'SHOPIFY_DISCONNECTED', shopDomain: f.domain, connectionState: 'UNINSTALLED' });
    expect(await latestAttempt(f)).toMatchObject({ status: 'CONFIRMED', outcome_code: 'LOCAL_FENCE_APPLIED' });
    expect(mockUninstall).toHaveBeenCalledTimes(1);
  });

  it('a recorded provider confirmation outranks a later "still installed" read', async () => {
    const f = await fixture('late-vs-read');
    const sender = await senderInFlight(f);
    await stallSender(f, { settled: true });
    const reconEntered = deferred();
    const reconAnswer = deferred();
    mockPrecheck.mockImplementationOnce(async () => { reconEntered.resolve(); await reconAnswer.promise; return precheckOk(f); });
    const reconciliation = reconcile(f).then(r => r);
    await reconEntered.promise;

    sender.answer(async () => uninstallOk);
    expect((await sender.response).status).toBe(202);
    reconAnswer.resolve();
    const settled = await reconciliation;
    expect(settled.status).toBe(200);
    expect(settled.body.status).toBe('SHOPIFY_DISCONNECTED');
    expect((await attemptRows(f)).map(row => row.status)).toEqual(['CONFIRMED']);
    expect(mockUninstall).toHaveBeenCalledTimes(1);
  });

  it('a late success with no live owner is promoted and fenced exactly once', async () => {
    const f = await fixture('late-free');
    const generationBefore = (await credential(f)).credential_generation;
    const sender = await senderInFlight(f);
    await stallSender(f, { settled: false });
    // A concurrent request converts the expired attempt without taking a lease.
    const takeover = await disconnect(f);
    expect(takeover.body).toMatchObject({ error: 'SHOPIFY_DISCONNECT_OUTCOME_UNKNOWN', recovery: 'CHECK_LATER' });
    expect(await latestAttempt(f)).toMatchObject({ status: 'OUTCOME_UNKNOWN', outcome_code: 'OUTCOME_NOT_RECORDED',
      claim_token: null });

    sender.answer(async () => uninstallOk);
    const late = await sender.response;
    expect(late.status).toBe(200);
    expect(late.body).toEqual({ status: 'SHOPIFY_DISCONNECTED', shopDomain: f.domain, connectionState: 'UNINSTALLED' });
    expect(await latestAttempt(f)).toMatchObject({ status: 'CONFIRMED', outcome_code: 'LOCAL_FENCE_APPLIED' });
    expect(BigInt((await credential(f)).credential_generation)).toBe(BigInt(generationBefore) + 1n);
    expect(mockUninstall).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rejection', async () => ({ data: { appUninstall: { app: null, userErrors: [{ code: 'APP_UNINSTALL_FAILED' }] } } })],
    ['ambiguity', async () => { throw new HttpRequestError('socket hang up'); }],
  ])('a late %s that lost ownership is never reported as persisted', async (_label, reply) => {
    const f = await fixture('late-unpersisted');
    const sender = await senderInFlight(f);
    await stallSender(f, { settled: false });
    expect((await disconnect(f)).status).toBe(502);
    const before = await latestAttempt(f);

    sender.answer(reply);
    const late = await sender.response;
    expect(late.status).toBe(502);
    expect(late.body).toMatchObject({ error: 'SHOPIFY_DISCONNECT_OUTCOME_UNKNOWN', recovery: 'CHECK_LATER' });
    expect(await latestAttempt(f)).toEqual(before);
    expect((await readShopifyConnection(f.shopId)).state).toBe('REAUTH_REQUIRED');
    expect(mockUninstall).toHaveBeenCalledTimes(1);
  });

  it('resolved attempts never regress: late writers are no-ops and the database refuses any change', async () => {
    const f = await fixture('late-resolved');
    const sender = await senderInFlight(f);
    await stallSender(f, { settled: false });
    // A webhook is a durable receipt only (GH-979 C): an independent canonical
    // fence, as in the sibling cases above, confirms the uninstall and an owner
    // request resolves the attempt.
    await withTenant(f.shopId, trx => handleAppUninstalled(f.shopId, trx));
    expect((await disconnect(f)).body).toEqual({ error: 'SHOPIFY_NOT_CONNECTED', connectionState: 'UNINSTALLED' });
    const resolved = await latestAttempt(f);
    expect(resolved).toMatchObject({ status: 'CONFIRMED', outcome_code: 'WEBHOOK_FENCED' });

    sender.answer(async () => { throw new HttpRequestError('socket hang up'); });
    const late = await sender.response;
    expect(late.status).toBe(200);
    expect(late.body).toEqual({ status: 'SHOPIFY_DISCONNECTED', shopDomain: f.domain, connectionState: 'UNINSTALLED' });
    expect(await latestAttempt(f)).toEqual(resolved);

    await expect(withTenant(f.shopId, trx => trx('shopify_app_disconnect_attempts').where({ shop_id: f.shopId })
      .update({ status: 'OUTCOME_UNKNOWN', resolved_at: null }))).rejects.toThrow('SHOPIFY_DISCONNECT_ATTEMPT_RESOLVED_IMMUTABLE');
    await expect(withTenant(f.shopId, trx => trx('shopify_app_disconnect_attempts').where({ shop_id: f.shopId })
      .update({ provider_confirmed_at: trx.fn.now() }))).rejects.toThrow('SHOPIFY_DISCONNECT_ATTEMPT_RESOLVED_IMMUTABLE');
    expect(mockUninstall).toHaveBeenCalledTimes(1);
  });
});

/** Runs the uninstall-verification worker until it reports IDLE (bounded). */
async function drainVerification(maxCycles = 25) {
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    if (await processShopifyUninstallVerificationOnce() === 'IDLE') return;
  }
  throw new Error('GH979_VERIFICATION_NOT_IDLE');
}
/** Simulates the verification retry backoff having elapsed for this shop. */
async function verificationDue(f: Fixture) {
  await withTenant(f.shopId, trx => trx('shopify_uninstall_verifications')
    .where({ shop_id: f.shopId, status: 'UNRESOLVED' })
    .update({ next_attempt_at: trx.raw("pg_catalog.now() - interval '1 second'") }));
}
async function verificationRows(f: Fixture) {
  return withTenant(f.shopId, trx => trx('shopify_uninstall_verifications').where({ shop_id: f.shopId })
    .orderBy('created_at', 'asc').select('status', 'outcome_code', 'attempt_count', 'owner_recovery_state_hash'));
}
/**
 * Every shop the cross-tenant discovery returns, each settled by the identical
 * tenant-scoped settlement. A discovered shop that settles nothing is a
 * discovery/settlement divergence (an endless rediscovery loop): fail.
 */
async function recoveryCandidates(): Promise<number[]> {
  const discovered: number[] = [];
  for (let cycle = 0; cycle < 25; cycle += 1) {
    const shopId = await nextShopifyUninstallRecoveryShop();
    if (shopId === null) return discovered;
    discovered.push(shopId);
    if (await settleShopifyUninstallRecovery(shopId) === 0) throw new Error('GH979_DISCOVERY_SETTLEMENT_DIVERGED');
  }
  throw new Error('GH979_DISCOVERY_NOT_EXHAUSTED');
}
/** A signed receipt whose T2 ordering is unprovable (the lock is held elsewhere): ORDER_UNPROVEN. */
async function orderUnprovenReceipt(f: Fixture, eventId = `gh979-${crypto.randomUUID()}`) {
  await secondDb.transaction(async trx => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)', ['shopify_admin_credential_rotation', f.shopId]);
    await deliverAppUninstalledWebhook(f, eventId);
  });
  return eventId;
}
/** The OAuth-start issuance + binding exactly as initiateOAuth performs it. */
async function issueRecoveryState(f: Fixture, role: Role = 'owner') {
  const state = crypto.randomBytes(16).toString('hex');
  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  const bound = await systemTransaction(async trx => {
    await setTenantContext(trx, f.shopId);
    return issueShopifyOAuthStateWithRecoveryBinding(trx, { shopId: f.shopId, userId: f.users[role], state,
      shopDomain: f.domain, expiresAt: new Date(Date.now() + 540_000) });
  });
  return { stateHash, bound };
}
/** The callback's reconnect finalization, with no post-commit settlement (a crashed callback). */
async function reconnectWith(f: Fixture, recoveryStateHash: string | undefined, label: string) {
  const prepared = await prepareShopifyAdminCredentialReconnect({ shopId: f.shopId, shopDomain: f.domain, now: new Date() });
  expect(prepared).toMatchObject({ kind: 'RECONNECT_PREPARED' });
  const now = Date.now();
  return finalizeShopifyAdminCredentialReconnect({ ...(prepared as any), recoveryStateHash, credentials: {
    accessToken: `gh979-${label}-access`, refreshToken: `gh979-${label}-refresh`,
    accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
    grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    shopIdentity: { gid: `gid://shopify/Shop/${f.shopId}`, currencyCode: 'EUR', name: null,
      contactEmail: null, ianaTimezone: null } } });
}
async function proofs(f: Fixture) {
  return withTenant(f.shopId, trx => trx('shopify_reconnect_recovery_proofs').where({ shop_id: f.shopId })
    .select('oauth_state_hash', 'installation_id', 'integration_id', 'credential_generation'));
}
async function ledger(f: Fixture, eventId: string) {
  return withTenant(f.shopId, trx => trx('integration_webhook_events')
    .where({ shop_id: f.shopId, integration: 'shopify', external_event_id: eventId }).select('processing_status'));
}
async function reinstallB(f: Fixture, label = 'authority-b') {
  const prepared = await prepareShopifyAdminCredentialReconnect({ shopId: f.shopId, shopDomain: f.domain, now: new Date() });
  expect(prepared).toMatchObject({ kind: 'RECONNECT_PREPARED' });
  const now = Date.now();
  await expect(finalizeShopifyAdminCredentialReconnect({ ...(prepared as any), credentials: {
    accessToken: `gh979-${label}`, refreshToken: `gh979-${label}-refresh`,
    accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
    grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    shopIdentity: { gid: `gid://shopify/Shop/${f.shopId}`, currencyCode: 'EUR', name: null,
      contactEmail: null, ianaTimezone: null } } })).resolves.toMatchObject({ kind: 'RECONNECTED' });
}
async function disconnectThenReinstall(f: Fixture) {
  mockPrecheck.mockResolvedValue(precheckOk(f));
  mockUninstall.mockResolvedValue(uninstallOk);
  expect((await disconnect(f)).status).toBe(200);
  await reinstallB(f);
  expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
}
async function authorityB(f: Fixture) {
  return { state: (await readShopifyConnection(f.shopId)).state,
    consumer: await consumerKind(f), installationUninstalled: (await installation(f)).uninstalled_at !== null,
    credentialState: (await credential(f)).credential_state };
}
const B_INTACT = { state: 'CONNECTED', consumer: 'READY', installationUninstalled: false, credentialState: 'ACTIVE' };
/** A real signed delivery through POST /api/v1/shopify/webhooks (HMAC over the raw body only). */
function signedWebhook(f: Fixture, headers: Record<string, string>, options: { tamperBody?: boolean } = {}) {
  const body = JSON.stringify({ id: f.shopId, domain: f.domain, myshopify_domain: f.domain });
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(body).digest('base64');
  return request(app).post('/api/v1/shopify/webhooks')
    .set('Content-Type', 'application/json').set('x-shopify-topic', 'app/uninstalled')
    .set('x-shopify-shop-domain', f.domain).set('x-shopify-webhook-id', `gh979-${crypto.randomUUID()}`)
    .set('x-shopify-hmac-sha256', hmac).set(headers)
    .send(options.tamperBody ? body.replace(f.domain, `x${f.domain}`) : body);
}

// GH-979 C (#6289546373 modernization): app/uninstalled is a durable receipt.
// Delivery never probes Shopify, never fences and never transitions to
// UNINSTALLED. The Shopify-only worker verifies later; HTTP 401 and
// REAUTH_REQUIRED are never uninstall proof; recovery needs a later exact
// reconnect (ordered) or the committed state-bound proof (ORDER_UNPROVEN).

describe('GH-979 C — delayed app/uninstalled webhook after reinstall (Finding B)', () => {
  it('a delayed webhook from the disconnected installation A must not fence reinstalled authority B', async () => {
    const f = await fixture('delayed-webhook');
    // 1–3. Owner disconnects A (Shopify confirms); the merchant reinstalls; B is active.
    await disconnectThenReinstall(f);

    // 4. A's delayed delivery: a durable receipt only, no provider call, no fence.
    mockCreateClient.mockClear();
    const eventId = `gh979-${crypto.randomUUID()}`;
    await deliverAppUninstalledWebhook(f, eventId);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockAttribution).not.toHaveBeenCalled();
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'received' }]);
    expect(await latestVerification(f)).toMatchObject({ status: 'PENDING', outcome_code: null });
    expect((await installation(f)).uninstalled_at).toBeNull();
    expect((await credential(f)).credential_state).toBe('ACTIVE');
    // Fail closed while unverified.
    expect((await readShopifyConnection(f.shopId)).state).toBe('UNINSTALL_VERIFICATION_UNRESOLVED');

    // 5. Deferred verification with B's own grant, bounded and unretried: B is live.
    mockPrecheck.mockReset().mockResolvedValue(precheckOk(f));
    await drainVerification();
    expect(mockPrecheck).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: 'gh979-authority-b' }));
    expect(mockPrecheck.mock.calls[0][1]).toEqual(expect.objectContaining({ retries: 0, signal: expect.any(AbortSignal) }));
    expect(await latestVerification(f)).toMatchObject({ status: 'CURRENT_AUTHORITY_VERIFIED' });
    expect(await authorityB(f)).toEqual(B_INTACT);
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'processed' }]);
  });
});

describe('GH-979 C / D1 — app/uninstalled durable receipt and deferred verification', () => {
  it('HTTP 401 for the current installation remains unresolved and preserves authority', async () => {
    const f = await fixture('d1-genuine');
    const data = await preserved(f);
    const generationBefore = (await credential(f)).credential_generation;
    mockPrecheck.mockRejectedValue(unauthorized());
    const eventId = `gh979-${crypto.randomUUID()}`;
    await deliverAppUninstalledWebhook(f, eventId);
    await expect(processShopifyUninstallVerificationOnce()).resolves.toBe('SETTLED');
    expect((await installation(f)).uninstalled_at).toBeNull();
    const preservedCredential = await credential(f);
    expect(preservedCredential).toMatchObject({ credential_state: 'ACTIVE' });
    expect(preservedCredential.access_token_encrypted).not.toBeNull();
    expect(preservedCredential.refresh_token_encrypted).not.toBeNull();
    expect(preservedCredential.credential_generation).toBe(generationBefore);
    expect((await readShopifyConnection(f.shopId)).state).toBe('UNINSTALL_VERIFICATION_UNRESOLVED');
    expect(await consumerKind(f)).toBe('REAUTH_REQUIRED');
    expect(await latestVerification(f)).toMatchObject({ status: 'UNRESOLVED', outcome_code: 'PROVIDER_UNVERIFIED' });
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'received' }]);
    expect(await preserved(f)).toEqual(data);
  });

  it('a webhook after a confirmed disconnect is a terminal receipt: processed, no probe, no new authority', async () => {
    const f = await fixture('d1-before-reinstall');
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockResolvedValue(uninstallOk);
    expect((await disconnect(f)).status).toBe(200);
    mockCreateClient.mockClear();
    const eventId = `gh979-${crypto.randomUUID()}`;
    await deliverAppUninstalledWebhook(f, eventId);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect((await readShopifyConnection(f.shopId)).state).toBe('UNINSTALLED');
    expect((await credential(f)).access_token_encrypted).toBeNull();
    // Terminal verification and its ledger settle together (finding C).
    expect(await latestVerification(f)).toMatchObject({ status: 'ALREADY_UNINSTALLED', outcome_code: 'NO_ACTIVE_AUTHORITY' });
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'processed' }]);
    // A duplicate is stopped by the ledger and changes nothing.
    await deliverAppUninstalledWebhook(f, eventId);
    expect(await verificationRows(f)).toHaveLength(1);
    // A later reinstall still establishes clean authority.
    await reinstallB(f);
    expect(await authorityB(f)).toEqual(B_INTACT);
  });

  it.each([
    ['missing', {}],
    ['malformed', { 'x-shopify-triggered-at': 'not-a-timestamp' }],
    ['manipulated into the past', { 'x-shopify-triggered-at': '2001-01-01T00:00:00.000Z' }],
    ['manipulated into the future', { 'x-shopify-triggered-at': '2999-12-31T23:59:59.999Z' }],
  ])('event time %s: a signed delayed delivery never fences live authority B', async (_label, headers) => {
    const f = await fixture('d1-timestamp-live');
    await disconnectThenReinstall(f);
    mockCreateClient.mockClear();
    const response = await signedWebhook(f, headers as Record<string, string>);
    expect(response.status).toBe(200);
    expect(mockCreateClient).not.toHaveBeenCalled();
    // The event time is never ordering evidence: the receipt is pending either way.
    expect(await latestVerification(f)).toMatchObject({ status: 'PENDING' });
    expect((await installation(f)).uninstalled_at).toBeNull();
    mockPrecheck.mockReset().mockResolvedValue(precheckOk(f));
    await drainVerification();
    expect(await authorityB(f)).toEqual(B_INTACT);
  });

  it('a manipulated future event time and HTTP 401 cannot establish uninstall identity', async () => {
    const f = await fixture('d1-timestamp-genuine');
    mockPrecheck.mockRejectedValue(unauthorized());
    const response = await signedWebhook(f, { 'x-shopify-triggered-at': '2999-12-31T23:59:59.999Z' });
    expect(response.status).toBe(200);
    await expect(processShopifyUninstallVerificationOnce()).resolves.toBe('SETTLED');
    expect((await installation(f)).uninstalled_at).toBeNull();
    expect((await credential(f)).access_token_encrypted).not.toBeNull();
    expect((await readShopifyConnection(f.shopId)).state).toBe('UNINSTALL_VERIFICATION_UNRESOLVED');
  });

  it('a delivery whose authenticated body was tampered with is rejected before any effect', async () => {
    const f = await fixture('d1-tampered');
    const before = { credential: await credential(f), installation: await installation(f) };
    const response = await signedWebhook(f, {}, { tamperBody: true });
    expect(response.status).toBe(401);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect({ credential: await credential(f), installation: await installation(f) }).toEqual(before);
    expect(await verificationRows(f)).toEqual([]);
  });

  it('provider ambiguity defers without destroying B; redelivery is idempotent; a live answer resolves', async () => {
    const f = await fixture('d1-ambiguous');
    await disconnectThenReinstall(f);
    const eventId = `gh979-${crypto.randomUUID()}`;
    await deliverAppUninstalledWebhook(f, eventId);
    for (const failure of [new HttpRequestError('socket hang up'),
      new HttpResponseError({ message: 'synthetic', code: 503, statusText: 'Service Unavailable' }),
      new HttpResponseError({ message: 'synthetic', code: 403, statusText: 'Forbidden' })]) {
      mockPrecheck.mockReset().mockRejectedValue(failure);
      await verificationDue(f);
      await drainVerification();
      expect(await latestVerification(f)).toMatchObject({ status: 'UNRESOLVED', outcome_code: 'PROVIDER_UNVERIFIED' });
      expect(await ledger(f, eventId)).toEqual([{ processing_status: 'received' }]);
      expect((await installation(f)).uninstalled_at).toBeNull();
      expect((await credential(f)).credential_state).toBe('ACTIVE');
      expect((await credential(f)).access_token_encrypted).not.toBeNull();
      // Shopify redelivers the same event: one receipt, one verification.
      await deliverAppUninstalledWebhook(f, eventId);
      expect(await verificationRows(f)).toHaveLength(1);
    }
    mockPrecheck.mockReset().mockResolvedValue(precheckOk(f));
    await verificationDue(f);
    await drainVerification();
    expect(await latestVerification(f)).toMatchObject({ status: 'CURRENT_AUTHORITY_VERIFIED' });
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'processed' }]);
    // A duplicate of the processed delivery is stopped by the ledger: no probe, no effect.
    mockCreateClient.mockClear();
    const generation = (await credential(f)).credential_generation;
    await deliverAppUninstalledWebhook(f, eventId);
    await drainVerification();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'processed' }]);
    expect((await credential(f)).credential_generation).toBe(generation);
    expect(await authorityB(f)).toEqual(B_INTACT);
  });

  it('a duplicate genuine delivery records exactly one verification and never fences', async () => {
    const f = await fixture('d1-duplicate');
    const generationBefore = (await credential(f)).credential_generation;
    mockPrecheck.mockRejectedValue(unauthorized());
    const eventId = `gh979-${crypto.randomUUID()}`;
    await deliverAppUninstalledWebhook(f, eventId);
    await deliverAppUninstalledWebhook(f, eventId);
    await drainVerification();
    expect(await verificationRows(f)).toEqual([expect.objectContaining({ status: 'UNRESOLVED',
      outcome_code: 'PROVIDER_UNVERIFIED', attempt_count: 1 })]);
    expect((await credential(f)).credential_generation).toBe(generationBefore);
    expect((await credential(f)).credential_state).toBe('ACTIVE');
    expect((await installation(f)).uninstalled_at).toBeNull();
    // An unresolved receipt is never marked processed.
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'received' }]);
  });

  it('several delayed deliveries with different webhook ids never fence B', async () => {
    const f = await fixture('d1-many-ids');
    await disconnectThenReinstall(f);
    const ids = [1, 2, 3].map(() => `gh979-${crypto.randomUUID()}`);
    for (const id of ids) await deliverAppUninstalledWebhook(f, id);
    mockPrecheck.mockReset().mockResolvedValue(precheckOk(f));
    await drainVerification();
    expect(mockPrecheck).toHaveBeenCalledTimes(3);
    for (const id of ids) expect(await ledger(f, id)).toEqual([{ processing_status: 'processed' }]);
    expect((await verificationRows(f)).map(row => row.status)).toEqual(Array(3).fill('CURRENT_AUTHORITY_VERIFIED'));
    expect(await authorityB(f)).toEqual(B_INTACT);
  });

  it('a replayed delivery (shop id only, no domain) is idempotent and never re-attributes', async () => {
    const f = await fixture('d1-replay');
    await disconnectThenReinstall(f);
    const eventId = `gh979-${crypto.randomUUID()}`;
    await deliverAppUninstalledWebhook(f, eventId);
    mockCreateClient.mockClear();
    // Same shape as webhookReplay.controller: ledger identity and shop id, no domain.
    await WebhookRouter.dispatch({ integration: 'shopify', eventId, eventType: 'app/uninstalled',
      rawPayload: { domain: f.domain }, shopId: f.shopId, verified: true, receivedAt: new Date() });
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(await verificationRows(f)).toHaveLength(1);
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'received' }]);
    mockPrecheck.mockReset().mockResolvedValue(precheckOk(f));
    await drainVerification();
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'processed' }]);
    expect(await authorityB(f)).toEqual(B_INTACT);
  });

  it('a delivery during an in-flight reconnect is ordered before it; the later reconnect supersedes it', async () => {
    const f = await fixture('d1-reconnect-race');
    const prepared = await prepareShopifyAdminCredentialReconnect({ shopId: f.shopId, shopDomain: f.domain, now: new Date() });
    expect(prepared).toMatchObject({ kind: 'RECONNECT_PREPARED' });
    expect((await readShopifyConnection(f.shopId)).state).toBe('RECONNECT_IN_PROGRESS');
    const eventId = `gh979-${crypto.randomUUID()}`;
    await deliverAppUninstalledWebhook(f, eventId);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(await latestVerification(f)).toMatchObject({ status: 'PENDING', outcome_code: null });
    expect((await installation(f)).uninstalled_at).toBeNull();
    const now = Date.now();
    await expect(finalizeShopifyAdminCredentialReconnect({ ...(prepared as any), credentials: {
      accessToken: 'gh979-authority-b', refreshToken: 'gh979-authority-b-refresh',
      accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
      shopIdentity: { gid: `gid://shopify/Shop/${f.shopId}`, currencyCode: 'EUR', name: null,
        contactEmail: null, ianaTimezone: null } } })).resolves.toMatchObject({ kind: 'RECONNECTED' });
    // The NULL-outcome ordered receipt is recovered by the later exact reconnect, without a probe.
    await drainVerification();
    expect(mockPrecheck).not.toHaveBeenCalled();
    expect(await latestVerification(f)).toMatchObject({ status: 'SUPERSEDED', outcome_code: 'LATER_RECONNECT_VERIFIED' });
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'processed' }]);
    expect(await authorityB(f)).toEqual(B_INTACT);
  });

  it.each([
    ['a reinstall', async (f: Fixture) => reinstallB(f, 'during-probe'), 'SUPERSEDED'],
    ['a rotation', async (f: Fixture) => withTenant(f.shopId, trx => trx('shopify_admin_credentials')
      .where({ shop_id: f.shopId }).update({ credential_generation: trx.raw('credential_generation + 1'),
        access_expires_at: trx.raw("pg_catalog.now() + interval '2 days'") })), 'UNRESOLVED'],
  ])('%s committed during the probe: a revoked answer never fences; only a reconnect recovers', async (_label, move, final) => {
    const f = await fixture('d1-epoch-moved');
    await deliverAppUninstalledWebhook(f);
    mockPrecheck.mockImplementation(async () => { await move(f); throw unauthorized(); });
    await drainVerification();
    mockPrecheck.mockReset();
    expect((await installation(f)).uninstalled_at).toBeNull();
    expect((await credential(f)).credential_state).toBe('ACTIVE');
    expect((await credential(f)).access_token_encrypted).not.toBeNull();
    // A later exact reconnect supersedes; a generation-only advance never does.
    await drainVerification();
    expect(await latestVerification(f)).toMatchObject({ status: final });
    expect(mockPrecheck).not.toHaveBeenCalled();
  });

  it('receipts and verification are tenant-scoped: another shop is never probed or mutated', async () => {
    const a = await fixture('d1-tenant-a');
    const b = await fixture('d1-tenant-b');
    const beforeB = { credential: await credential(b), installation: await installation(b) };
    mockPrecheck.mockRejectedValue(unauthorized());
    await deliverAppUninstalledWebhook(a);
    await drainVerification();
    expect((await installation(a)).uninstalled_at).toBeNull();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({ shopId: a.shopId, platformShopName: a.domain }));
    expect({ credential: await credential(b), installation: await installation(b) }).toEqual(beforeB);
    expect(await verificationRows(b)).toEqual([]);
    expect((await readShopifyConnection(b.shopId)).state).toBe('CONNECTED');
  });

  it('a webhook for an unresolved owner disconnect is a receipt only: still fail-closed, never confirmed by it', async () => {
    const f = await fixture('d1-unresolved');
    mockPrecheck.mockResolvedValue(precheckOk(f));
    mockUninstall.mockRejectedValue(new HttpRequestError('socket hang up'));
    expect((await disconnect(f)).status).toBe(502);
    mockCreateClient.mockClear();
    const eventId = `gh979-${crypto.randomUUID()}`;
    await deliverAppUninstalledWebhook(f, eventId);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect((await installation(f)).uninstalled_at).toBeNull();
    expect((await readShopifyConnection(f.shopId)).state).toBe('UNINSTALL_VERIFICATION_UNRESOLVED');
    expect(await consumerKind(f)).toBe('REAUTH_REQUIRED');
    expect(await latestAttempt(f)).toMatchObject({ status: 'OUTCOME_UNKNOWN', resolved_at: null });
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'received' }]);
  });
});

describe('GH-979 C — state-bound OAuth recovery of ORDER_UNPROVEN receipts (0220)', () => {
  it('a callback crash after finalizer COMMIT is recovered by the worker from the durable proof', async () => {
    const f = await fixture('proof-crash');
    const eventId = await orderUnprovenReceipt(f);
    expect(await latestVerification(f)).toMatchObject({ status: 'UNRESOLVED', outcome_code: 'ORDER_UNPROVEN',
      observed_installation_id: null });
    const { stateHash, bound } = await issueRecoveryState(f);
    expect(bound).toBe(1);
    // Finalizer commits credentials + proof; the callback "crashes" before any settlement.
    await expect(reconnectWith(f, stateHash, 'crash')).resolves.toMatchObject({ kind: 'RECONNECTED', recoveryProof: true });
    expect(await proofs(f)).toEqual([expect.objectContaining({ oauth_state_hash: stateHash,
      installation_id: f.installationId, integration_id: f.integrationId })]);
    expect(await latestVerification(f)).toMatchObject({ status: 'UNRESOLVED', outcome_code: 'ORDER_UNPROVEN' });
    expect(await nextShopifyUninstallRecoveryShop()).toBe(f.shopId);
    await expect(processShopifyUninstallVerificationOnce()).resolves.toBe('SETTLED');
    expect(await latestVerification(f)).toMatchObject({ status: 'SUPERSEDED', outcome_code: 'LATER_RECONNECT_VERIFIED' });
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'processed' }]);
    expect((await readShopifyConnection(f.shopId)).state).toBe('CONNECTED');
    expect(mockPrecheck).not.toHaveBeenCalled();
    // Idempotent: nothing left to rediscover or settle.
    expect(await settleShopifyUninstallRecovery(f.shopId)).toBe(0);
  });

  it('binds only receipts that existed at state issuance; a later receipt stays fail-closed', async () => {
    const f = await fixture('proof-late-receipt');
    const { stateHash, bound } = await issueRecoveryState(f);
    expect(bound).toBe(0);
    await orderUnprovenReceipt(f);
    await reconnectWith(f, stateHash, 'late-receipt');
    expect(await settleShopifyUninstallRecovery(f.shopId)).toBe(0);
    expect(await latestVerification(f)).toMatchObject({ status: 'UNRESOLVED', outcome_code: 'ORDER_UNPROVEN' });
    expect((await readShopifyConnection(f.shopId)).state).toBe('UNINSTALL_VERIFICATION_UNRESOLVED');
  });

  it('an abandoned owner OAuth attempt can be retried successfully', async () => {
    const f = await fixture('proof-owner-retry');
    const eventId = await orderUnprovenReceipt(f);

    const abandoned = await issueRecoveryState(f);
    const retry = await issueRecoveryState(f);

    expect(abandoned.bound).toBe(1);
    expect(retry.bound).toBe(1);
    expect(abandoned.stateHash).not.toBe(retry.stateHash);

    const authorizations = await withTenant(f.shopId, trx =>
      trx('shopify_uninstall_recovery_authorizations')
        .where({ shop_id: f.shopId })
        .select('oauth_state_hash'));

    expect(authorizations.map(row => row.oauth_state_hash).sort()).toEqual(
      [abandoned.stateHash, retry.stateHash].sort());

    await expect(reconnectWith(f, retry.stateHash, 'owner-retry'))
      .resolves.toMatchObject({ recoveryProof: true });

    expect(await settleShopifyUninstallRecovery(f.shopId)).toBe(1);
    expect(await latestVerification(f)).toMatchObject({
      status: 'SUPERSEDED', outcome_code: 'LATER_RECONNECT_VERIFIED',
    });
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'processed' }]);
    expect(await settleShopifyUninstallRecovery(f.shopId)).toBe(0);
  });

  it('an earlier authorized owner attempt remains eligible after a later issuance', async () => {
    const f = await fixture('proof-owner-first-wins');
    await orderUnprovenReceipt(f);

    const first = await issueRecoveryState(f);
    const second = await issueRecoveryState(f);

    expect(first.bound).toBe(1);
    expect(second.bound).toBe(1);

    await expect(reconnectWith(f, first.stateHash, 'owner-first'))
      .resolves.toMatchObject({ recoveryProof: true });

    expect(await settleShopifyUninstallRecovery(f.shopId)).toBe(1);
    expect(await latestVerification(f)).toMatchObject({ status: 'SUPERSEDED' });
  });

  it('non-owner states and legacy reconnects cannot resolve ORDER_UNPROVEN', async () => {
    const f = await fixture('proof-nonowner');
    await orderUnprovenReceipt(f);

    const admin = await issueRecoveryState(f, 'admin');
    expect(admin.bound).toBe(0);

    await expect(reconnectWith(f, admin.stateHash, 'nonowner'))
      .resolves.toMatchObject({ recoveryProof: true });

    expect(await settleShopifyUninstallRecovery(f.shopId)).toBe(0);
    expect(await latestVerification(f)).toMatchObject({
      status: 'UNRESOLVED', outcome_code: 'ORDER_UNPROVEN',
    });

    const legacy = await fixture('proof-legacy');
    await orderUnprovenReceipt(legacy);
    expect((await issueRecoveryState(legacy)).bound).toBe(1);

    await expect(reconnectWith(legacy, undefined, 'legacy'))
      .resolves.toMatchObject({ recoveryProof: false });

    expect(await settleShopifyUninstallRecovery(legacy.shopId)).toBe(0);
    expect(await latestVerification(legacy)).toMatchObject({
      status: 'UNRESOLVED', outcome_code: 'ORDER_UNPROVEN',
    });
  });

  it('sf_app cannot forge a recovery authorization without controlled OAuth issuance', async () => {
    const f = await fixture('proof-forged-authorization');
    await orderUnprovenReceipt(f);
    const verification = await withTenant(f.shopId, trx => trx('shopify_uninstall_verifications')
      .where({ shop_id: f.shopId }).first('id'));
    expect(verification).toBeDefined();
    await expect(withTenant(f.shopId, trx => trx('shopify_uninstall_recovery_authorizations').insert({
      verification_id: verification!.id,
      shop_id: f.shopId,
      oauth_state_hash: crypto.createHash('sha256').update('forged-state').digest('hex'),
    }))).rejects.toThrow(/permission denied/i);
    expect(await withTenant(f.shopId, trx => trx('shopify_uninstall_recovery_authorizations')
      .where({ shop_id: f.shopId }))).toEqual([]);
  });

  it('a proof in another tenant or for revoked/refreshed authority never settles; discovery agrees', async () => {
    const a = await fixture('proof-tenant-a');
    const b = await fixture('proof-tenant-b');
    await orderUnprovenReceipt(a);
    await orderUnprovenReceipt(b);
    const { stateHash } = await issueRecoveryState(a);
    const tenantB = await issueRecoveryState(b);
    expect(tenantB.stateHash).not.toBe(stateHash);
    await reconnectWith(a, stateHash, 'tenant-a');
    // A's credential is then fenced (REAUTH_REQUIRED) before any worker runs.
    await withTenant(a.shopId, trx => trx('shopify_admin_credentials').where({ shop_id: a.shopId })
      .update({ credential_state: 'REAUTH_REQUIRED', credential_generation: trx.raw('credential_generation + 1') }));
    const candidates = await recoveryCandidates();
    expect(candidates).not.toContain(a.shopId);
    expect(candidates).not.toContain(b.shopId);
    expect(await settleShopifyUninstallRecovery(a.shopId)).toBe(0);
    expect(await settleShopifyUninstallRecovery(b.shopId)).toBe(0);
    // Restored live authority (a new exact reconnect) makes A eligible again — and only A.
    await reconnectWith(a, undefined, 'tenant-a-again');
    expect(await settleShopifyUninstallRecovery(a.shopId)).toBe(1);
    expect(await latestVerification(b)).toMatchObject({ status: 'UNRESOLVED', outcome_code: 'ORDER_UNPROVEN' });
  });

  it('two concurrent owner callbacks cannot both activate authority or duplicate recovery proof', async () => {
    const f = await fixture('proof-concurrent-callbacks');
    await orderUnprovenReceipt(f);
    const [first, second] = await Promise.all([issueRecoveryState(f), issueRecoveryState(f)]);
    const callback = async (stateHash: string, label: string) => {
      const prepared = await prepareShopifyAdminCredentialReconnect({
        shopId: f.shopId, shopDomain: f.domain, now: new Date(),
      });
      if (prepared.kind !== 'RECONNECT_PREPARED') return prepared.kind;
      const now = Date.now();
      const completed = await finalizeShopifyAdminCredentialReconnect({ ...prepared,
        recoveryStateHash: stateHash, credentials: {
          accessToken: `gh979-${label}-access`, refreshToken: `gh979-${label}-refresh`,
          accessExpiresAt: new Date(now + 86_400_000), refreshExpiresAt: new Date(now + 604_800_000),
          grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
          shopIdentity: { gid: `gid://shopify/Shop/${f.shopId}`, currencyCode: 'EUR', name: null,
            contactEmail: null, ianaTimezone: null },
        } });
      return completed.kind;
    };
    const outcomes = await Promise.all([
      callback(first.stateHash, 'concurrent-a'), callback(second.stateHash, 'concurrent-b'),
    ]);
    expect(outcomes.filter(outcome => outcome === 'RECONNECTED')).toHaveLength(1);
    expect(outcomes.some(outcome => outcome === 'REFRESH_IN_PROGRESS' || outcome === 'RETRYABLE')).toBe(true);
    expect(await proofs(f)).toHaveLength(1);
    expect(await settleShopifyUninstallRecovery(f.shopId)).toBe(1);
  });

  it('an ordinary token refresh (generation advance) never admits an ORDER_UNPROVEN receipt', async () => {
    const f = await fixture('proof-refresh');
    await orderUnprovenReceipt(f);
    expect((await issueRecoveryState(f)).bound).toBe(1);
    await withTenant(f.shopId, trx => trx('shopify_admin_credentials').where({ shop_id: f.shopId })
      .update({ credential_generation: trx.raw('credential_generation + 1') }));
    expect(await recoveryCandidates()).not.toContain(f.shopId);
    expect(await settleShopifyUninstallRecovery(f.shopId)).toBe(0);
    expect(await proofs(f)).toEqual([]);
  });

  it('a replayed state cannot produce a second proof; the duplicate finalization commits nothing', async () => {
    const f = await fixture('proof-replay');
    await orderUnprovenReceipt(f);
    const { stateHash } = await issueRecoveryState(f);
    await reconnectWith(f, stateHash, 'first');
    const before = await credential(f);
    await expect(reconnectWith(f, stateHash, 'replay')).rejects.toThrow('SHOPIFY_RECONNECT_EXECUTOR_REJECTED');
    expect(await proofs(f)).toHaveLength(1);
    expect((await credential(f)).access_token_encrypted).not.toBe(null);
    expect((await credential(f)).credential_generation).not.toBe(before.credential_generation); // fenced epoch, not activated
    expect((await credential(f)).credential_state).toBe('REAUTH_REQUIRED');
  });

  it('exhausted ordered verification attempts still recover from a later exact reconnect', async () => {
    const f = await fixture('exhausted');
    mockPrecheck.mockRejectedValue(unauthorized());
    const eventId = `gh979-${crypto.randomUUID()}`;
    await deliverAppUninstalledWebhook(f, eventId);
    await withTenant(f.shopId, trx => trx('shopify_uninstall_verifications').where({ shop_id: f.shopId })
      .update({ status: 'UNRESOLVED', outcome_code: 'PROVIDER_UNVERIFIED', attempt_count: 5 }));
    await drainVerification();
    expect(await latestVerification(f)).toMatchObject({ status: 'UNRESOLVED' });
    await reinstallB(f, 'exhausted');
    await drainVerification();
    expect(await latestVerification(f)).toMatchObject({ status: 'SUPERSEDED', outcome_code: 'LATER_RECONNECT_VERIFIED' });
    expect(await ledger(f, eventId)).toEqual([{ processing_status: 'processed' }]);
  });

  it.each(['PENDING', 'PROCESSING', 'UNRESOLVED'])('a NULL-outcome ordered %s receipt is recovered (NULL-safe predicate)', async status => {
    const f = await fixture(`null-safe-${status.toLowerCase()}`);
    await deliverAppUninstalledWebhook(f);
    await withTenant(f.shopId, trx => trx('shopify_uninstall_verifications').where({ shop_id: f.shopId })
      .update(status === 'PROCESSING'
        ? { status, outcome_code: null, claim_token: crypto.randomUUID(), lease_expires_at: trx.raw("pg_catalog.now() + interval '1 minute'") }
        : { status, outcome_code: null }));
    await reinstallB(f, `null-safe-${status}`);
    // Discovery returns it, and the identical tenant-scoped settlement supersedes it.
    expect(await recoveryCandidates()).toContain(f.shopId);
    expect(await settleShopifyUninstallRecovery(f.shopId)).toBe(0);
    expect(await latestVerification(f)).toMatchObject({ status: 'SUPERSEDED', outcome_code: 'LATER_RECONNECT_VERIFIED' });
  });

  it('concurrent settlements supersede once, and a stale provider worker cannot restore the row', async () => {
    const f = await fixture('concurrent-settlement');
    await drainVerification(); // no other tenant's due work may take the claim below
    await deliverAppUninstalledWebhook(f);
    const claim = await claimShopifyUninstallVerification();
    expect(claim).toMatchObject({ shopId: f.shopId });
    const authority = await readOwnedShopifyUninstallVerification(claim!);
    await reinstallB(f, 'concurrent');
    const results = await Promise.all([settleShopifyUninstallRecovery(f.shopId), settleShopifyUninstallRecovery(f.shopId)]);
    expect(results.sort()).toEqual([0, 1]);
    for (const outcome of ['UNRESOLVED', 'CURRENT_AUTHORITY_VERIFIED'] as const) {
      await expect(settleShopifyUninstallVerification(authority!, outcome, 'PROVIDER_UNVERIFIED')).resolves.toBe(false);
    }
    expect(await latestVerification(f)).toMatchObject({ status: 'SUPERSEDED', outcome_code: 'LATER_RECONNECT_VERIFIED' });
  });

  it('the applied 0220 security postconditions hold on this database', async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1' ||
      !/^synchroflow_test_[A-Za-z0-9_]+$/.test(process.env.PGDATABASE ?? '') ||
      process.env.PGUSER !== 'sf_app' ||
      process.env.PGMIGRATION_USER !== 'sf_user'
    ) {
      throw new Error('GH979_SECURITY_POSTCHECK_UNSAFE_DB');
    }

    const admin = new PgClient({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      database: process.env.PGDATABASE,
      user: process.env.PGMIGRATION_USER,
      password: process.env.PGMIGRATION_PASSWORD,
      ssl: false,
      connectionTimeoutMillis: 3000,
    });

    try {
      await admin.connect();
      await assert0220SecurityPostconditions({
        raw: (sql: string) => admin.query(sql),
      } as any);
    } finally {
      await admin.end();
    }
    const discovered = await systemQuery(db.raw(
      'SELECT * FROM public.next_shopify_uninstall_recovery_shop()'
    ));
    expect(discovered.fields.map((field: { name: string }) => field.name)).toEqual(['shop_id']);
  }, 30_000);

  it('billing and warehouse data are preserved across receipt, recovery and settlement', async () => {
    const f = await fixture('proof-preservation');
    const data = await preserved(f);
    const subscription = await withTenant(f.shopId, trx => trx('shop_subscriptions').where({ shop_id: f.shopId })
      .select('*'));
    await orderUnprovenReceipt(f);
    const { stateHash } = await issueRecoveryState(f);
    await reconnectWith(f, stateHash, 'preservation');
    await drainVerification();
    expect(await latestVerification(f)).toMatchObject({ status: 'SUPERSEDED' });
    expect(await preserved(f)).toEqual(data);
    expect(await withTenant(f.shopId, trx => trx('shop_subscriptions').where({ shop_id: f.shopId }).select('*')))
      .toEqual(subscription);
  });
});
