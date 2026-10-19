/**
 * AUTH-ADMISSION-01 D03: request-time shop_user membership admission.
 * Authoring-only RED regressions; execute only through with-test-db.js.
 * AUTH-TENANT-01 precedents: createApp, real pre-tenant membership authority,
 * sf_app/forced RLS, synthetic tenant bootstrap, real events/outbox snapshots.
 * Provider boundaries and Redis are disabled doubles. Memberships are real
 * except for the explicitly scoped authority-unavailable fault below.
 * No server/worker bootstrap and no production testability seam.
 */
const mockMembershipFault = { userId: null as number | null, calls: 0 };
jest.mock('@lasyncro/backend-core/services/pre-tenant.service.js', () => {
  const actual = jest.requireActual('@lasyncro/backend-core/services/pre-tenant.service.js');
  return {
    ...actual,
    resolveActiveShopMemberships: (userId: number) => {
      if (mockMembershipFault.userId === userId) {
        mockMembershipFault.calls += 1;
        return Promise.reject(new Error('AUTH_ADMISSION_SYNTHETIC_AUTHORITY_UNAVAILABLE'));
      }
      return actual.resolveActiveShopMemberships(userId);
    },
  };
});
jest.mock('api-src/services/shopify/shopifyAdminCredentialConsumer.service', () => ({
  resolveShopifyAdminCredentialForConsumer: jest.fn().mockResolvedValue({
    kind: 'READY', accessToken: 'synthetic-auth-admission-token',
    shopDomain: 'auth-admission.invalid',
  }),
}));
jest.mock('api-src/services/shopify.service', () => ({
  performInitialSync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('api-src/services/shopify/shopifyRefundBackfill.service', () => ({
  backfillShopifyRefunds: jest.fn().mockResolvedValue({ refundsBackfilled: 0 }),
}));
// Cache miss: permission decisions still read the real tenant-scoped database.
jest.mock('@lasyncro/backend-core/services/redis.client.js', () => ({
  getRedisClient: () => ({ get: async () => null, set: async () => 'OK' }),
}));

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop, resolveActiveShopMemberships } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { requireShopContextForUser, resolveShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { resolveShopifyAdminCredentialForConsumer } from 'api-src/services/shopify/shopifyAdminCredentialConsumer.service';
import { performInitialSync } from 'api-src/services/shopify.service';
import { backfillShopifyRefunds } from 'api-src/services/shopify/shopifyRefundBackfill.service';
import { persistShopifyAdminCredentials } from 'api-src/services/shopify/shopifyAdminCredential.repository';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';
import { issueTestToken } from '../../unit/helpers/auth';

const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'auth-admission-db-synthetic-jwt-secret';
const app = createApp();
type Role = 'owner' | 'admin' | 'operator';
type Shop = { shopId: number; integrationId: number; installationId: number; users: Record<Role, number> };
let shopA: Shop;
let shopB: Shop;
const queries: string[] = [];
const recordQuery = (query: { sql: string }) => queries.push(query.sql);
const protectedTables = ['shops', 'users', 'shop_memberships', 'integrations',
  'shop_role_permissions', 'shopify_admin_credentials', 'domain_events', 'domain_event_outbox'];

async function fixture(label: string): Promise<Shop> {
  const unique = crypto.randomUUID();
  return systemTransaction(async (trx) => {
    const shopId = await createTenantShop(trx, `auth-admission-${label}-${unique}`);
    await setTenantContext(trx, shopId);
    const users = {} as Record<Role, number>;
    for (const role of ['owner', 'admin', 'operator'] as const) {
      const [user] = await trx('users').insert({
        shop_id: shopId, role,
        email: `auth-admission-${label}-${role}-${unique}@test.invalid`,
        password_hash: 'synthetic-not-a-login-hash',
      }).returning('id');
      users[role] = Number(user.id);
      await trx('shop_memberships').insert({ shop_id: shopId, user_id: user.id, role, revoked_at: null });
    }
    const [integration] = await trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: `auth-admission-${unique}.invalid`,
      sync_status: 'FAILED', updated_at: new Date(),
    }).returning('id');
    // GH-1101: manual recovery admits only a canonically connected tenant.
    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId, shop_domain: `auth-admission-${unique}.invalid`,
      shop_gid: `gid://shopify/Shop/${shopId}`, scopes: SHOPIFY_REQUIRED_SCOPE_STRING, uninstalled_at: null,
    }).returning('id');
    await persistShopifyAdminCredentials(trx, Number(installation.id), shopId, {
      accessToken: `auth-admission-access-${unique}`, refreshToken: `auth-admission-refresh-${unique}`,
      accessExpiresAt: new Date(Date.now() + 86_400_000), refreshExpiresAt: new Date(Date.now() + 604_800_000),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    });
    await trx('domain_events').insert({
      shop_id: shopId, event_type: 'auth-admission/protected-fixture',
      event_payload: { integration_id: Number(integration.id) },
      event_time: trx.fn.now(), event_version: 1,
      external_event_id: `internal:auth-admission-fixture:${unique}`,
    });
    return { shopId, integrationId: Number(integration.id), installationId: Number(installation.id), users };
  });
}

async function protectedState(shop: Shop) {
  return withTenant(shop.shopId, async (trx) => {
    const state: Record<string, any[]> = {};
    for (const table of protectedTables.filter(table => !['shops', 'domain_event_outbox'].includes(table))) {
      state[table] = await trx(table).where({ shop_id: shop.shopId }).orderBy('id');
    }
    state.shops = await trx('shops').where({ id: shop.shopId });
    state.outbox = await trx('domain_event_outbox as outbox')
      .join('domain_events as event', 'event.id', 'outbox.domain_event_id')
      .where('event.shop_id', shop.shopId).select('outbox.*').orderBy('outbox.id');
    return state;
  });
}
async function bothStates() {
  return { A: await protectedState(shopA), B: await protectedState(shopB) };
}
function tokenFor(role: Role = 'owner') {
  return issueTestToken({ userId: shopA.users[role], shopId: shopA.shopId, roles: [role] });
}
function assertLiveToken(token: string, role: Role = 'owner') {
  const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
  expect(payload).toMatchObject({ actor_type: 'shop_user', user_id: shopA.users[role],
    shop_id: shopA.shopId, shop_roles: [role] });
  expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
}
async function privilegedOperations(token: string) {
  const post = (path: string, body: unknown) => request(app)
    .post(`/api/v1/integrations/${path}`).set('Authorization', `Bearer ${token}`).send(body);
  return [
    await post('manual-initial-sync', { shopId: shopA.shopId, integrationId: shopA.integrationId }),
    await post(`sync/${shopA.integrationId}`, {}),
    await post('refund-backfill', {}),
  ];
}
async function protectedOperations(token: string) {
  // This real protected GET must reject admission, even when a controller
  // currently translates missing/ambiguous membership into 200 NOT_FOUND.
  return [await request(app).get('/api/v1/integrations/sync-status')
    .set('Authorization', `Bearer ${token}`), ...await privilegedOperations(token)];
}
type States = Awaited<ReturnType<typeof bothStates>>;
async function assertRejectedWithoutEffects(
  before: States, responses: request.Response[], status: 403 | 503 | 'fail-closed',
) {
  // Capture all evidence before assertions, including unexpected successful writes.
  const operationQueries = queries.filter(sql => /"(?:integrations|shopify_admin_credentials|domain_events|domain_event_outbox|orders|variants|customers|products)"/.test(sql));
  const after = await bothStates();
  const observed = {
    admission: responses.map(response => status === 'fail-closed'
      ? response.status === 403 || (response.status >= 500 && response.status < 600)
      : response.status === status),
    retryable: responses.map(response => status !== 503 || response.body.retryable === true),
    operationQueries,
    credentialCalls: (resolveShopifyAdminCredentialForConsumer as jest.Mock).mock.calls,
    syncCalls: (performInitialSync as jest.Mock).mock.calls,
    refundCalls: (backfillShopifyRefunds as jest.Mock).mock.calls,
    state: after,
  };
  console.info('AUTH_ADMISSION_HTTP', responses.map(response => ({ status: response.status, body: response.body })));
  expect(observed).toEqual({ admission: responses.map(() => true), retryable: responses.map(() => true),
    operationQueries: [], credentialCalls: [], syncCalls: [], refundCalls: [], state: before });
}
async function revoke(userId: number) {
  const changed = await withTenant(shopA.shopId, trx => trx('shop_memberships')
    .where({ shop_id: shopA.shopId, user_id: userId }).whereNull('revoked_at')
    .update({ revoked_at: trx.fn.now() }));
  expect(changed).toBe(1);
}
async function demotedRejection(role: 'owner' | 'admin') {
  const token = tokenFor(role); // Issued BEFORE demotion; retain the same JWT.
  const changed = await withTenant(shopA.shopId, trx => trx('shop_memberships')
    .where({ shop_id: shopA.shopId, user_id: shopA.users[role] }).update({ role: 'operator' }));
  expect(changed).toBe(1);
  expect(await requireShopContextForUser(shopA.users[role])).toMatchObject({ shopId: shopA.shopId, role: 'operator' });
  assertLiveToken(token, role);
  const before = await bothStates();
  queries.length = 0;
  await assertRejectedWithoutEffects(before, await privilegedOperations(token), 403);
}

beforeAll(async () => {
  expect(process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB).toBe('1');
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const identity = await systemQuery(db.raw(`
    SELECT current_database() AS db, current_user AS usr, r.rolsuper, r.rolbypassrls
    FROM pg_roles r WHERE r.rolname = current_user
  `));
  expect(identity.rows[0]).toEqual({ db: process.env.PGDATABASE, usr: 'sf_app', rolsuper: false, rolbypassrls: false });
  const rls = await systemQuery(db.raw(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
      EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS has_policy
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(?::text[]) ORDER BY c.relname
  `, [protectedTables]));
  expect(rls.rows.map((row: any) => row.relname)).toEqual([...protectedTables].sort());
  for (const row of rls.rows) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, has_policy: true });
  db.on('query', recordQuery);
});
beforeEach(async () => {
  jest.clearAllMocks();
  mockMembershipFault.userId = null;
  mockMembershipFault.calls = 0;
  shopA = await fixture('A');
  shopB = await fixture('B');
  for (const role of ['owner', 'admin', 'operator'] as const) {
    expect(await requireShopContextForUser(shopA.users[role])).toMatchObject({ shopId: shopA.shopId, role });
  }
  // Real restricted-role RLS proof, independent of the JWT's tenant claim.
  expect(await withTenant(shopA.shopId, trx => trx('integrations').where({ id: shopB.integrationId }))).toEqual([]);
  expect(await withTenant(shopB.shopId, trx => trx('integrations').where({ id: shopB.integrationId }))).toHaveLength(1);
  queries.length = 0;
});
afterEach(() => { mockMembershipFault.userId = null; });
afterAll(async () => {
  db.removeListener('query', recordQuery);
  await db.destroy();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe('AUTH-ADMISSION-01 D03 shop_user real PostgreSQL admission', () => {
  it('REVOKED: same unexpired JWT is 403 on the next protected requests, with no protected effects', async () => {
    const token = tokenFor();
    await revoke(shopA.users.owner);
    expect(await resolveShopContextForUser(shopA.users.owner)).toBeNull();
    assertLiveToken(token);
    const before = await bothStates();
    queries.length = 0;
    await assertRejectedWithoutEffects(before, await protectedOperations(token), 403);
  });
  it('DEMOTED OWNER: current operator membership defeats stale owner JWT privileges without effects', async () => {
    await demotedRejection('owner');
  });
  it('DEMOTED ADMIN: current operator membership defeats stale admin JWT privileges without effects', async () => {
    await demotedRejection('admin');
  });
  it('TENANT MISMATCH: JWT A/current membership B is 403 before protected operations in either shop', async () => {
    const token = tokenFor();
    await revoke(shopA.users.owner);
    await withTenant(shopB.shopId, trx => trx('shop_memberships').insert({
      shop_id: shopB.shopId, user_id: shopA.users.owner, role: 'owner', revoked_at: null,
    }));
    expect(await requireShopContextForUser(shopA.users.owner)).toMatchObject({ shopId: shopB.shopId, role: 'owner' });
    assertLiveToken(token);
    const before = await bothStates();
    queries.length = 0;
    await assertRejectedWithoutEffects(before, await protectedOperations(token), 403);
  });
  it('MULTIPLE MEMBERSHIPS: two real active memberships fail closed without protected effects', async () => {
    const token = tokenFor();
    await withTenant(shopB.shopId, trx => trx('shop_memberships').insert({
      shop_id: shopB.shopId, user_id: shopA.users.owner, role: 'owner', revoked_at: null,
    }));
    const memberships = await resolveActiveShopMemberships(shopA.users.owner);
    expect(memberships).toHaveLength(2);
    expect(memberships.map(row => row.shopId).sort((a, b) => a - b)).toEqual([shopA.shopId, shopB.shopId].sort((a, b) => a - b));
    await expect(requireShopContextForUser(shopA.users.owner)).rejects.toThrow();
    assertLiveToken(token);
    const before = await bothStates();
    queries.length = 0;
    await assertRejectedWithoutEffects(before, await protectedOperations(token), 'fail-closed');
  });
  it('RESOLUTION FAILURE: unavailable membership authority is 503 retryable, never JWT-role fallback or effects', async () => {
    const token = tokenFor();
    assertLiveToken(token);
    const before = await bothStates();
    mockMembershipFault.userId = shopA.users.owner;
    queries.length = 0;
    try {
      const responses = await protectedOperations(token);
      expect(mockMembershipFault.calls).toBeGreaterThan(0);
      await assertRejectedWithoutEffects(before, responses, 503);
    } finally {
      mockMembershipFault.userId = null;
    }
    expect(await requireShopContextForUser(shopA.users.owner)).toMatchObject({ shopId: shopA.shopId, role: 'owner' });
  });
  it('VALID MEMBERSHIP GREEN: unchanged owner/admin retain access and effects remain in the authoritative shop', async () => {
    const before = await bothStates();
    for (const role of ['owner', 'admin'] as const) {
      const token = tokenFor(role);
      assertLiveToken(token, role);
      expect(await requireShopContextForUser(shopA.users[role])).toMatchObject({ shopId: shopA.shopId, role });
      const responses = await protectedOperations(token);
      // GH-1101: the first durable recovery request is accepted; later ones see it outstanding.
      expect(responses.map(response => response.status))
        .toEqual(role === 'owner' ? [200, 202, 409, 200] : [200, 409, 409, 200]);
      expect(responses[0].body.integrationId).toBe(shopA.integrationId);
      expect(responses[1].body).toMatchObject(role === 'owner'
        ? { status: 'SYNC_RECOVERY_REQUESTED', shopId: shopA.shopId, integrationId: shopA.integrationId }
        : { error: 'SYNC_ALREADY_REQUESTED', integrationId: shopA.integrationId });
    }
    // Admission is a pure read: no credential resolution and no inline initial sync.
    expect((resolveShopifyAdminCredentialForConsumer as jest.Mock).mock.calls).toEqual([]);
    expect((performInitialSync as jest.Mock).mock.calls).toEqual([]);
    expect((backfillShopifyRefunds as jest.Mock).mock.calls).toEqual([[shopA.shopId], [shopA.shopId]]);
    const after = await bothStates();
    expect(after.B).toEqual(before.B);
    const added = after.A.domain_events.filter(event => !before.A.domain_events.some(old => old.id === event.id));
    expect(added).toHaveLength(1);
    for (const event of added) {
      expect(event).toMatchObject({ shop_id: shopA.shopId, event_type: 'integration/sync_dispatch_requested',
        event_payload: { integration_id: shopA.integrationId, installation_id: shopA.installationId,
          source: 'recovery' } });
      expect(after.A.outbox.filter(row => String(row.domain_event_id) === String(event.id))).toHaveLength(1);
    }
    expect(after.A.outbox.length).toBe(before.A.outbox.length + 1);
    expect(after.A.integrations).toEqual(before.A.integrations);
  });
  it('VALID OPERATOR GREEN: unchanged membership retains read access, privileged actions remain 403 without effects', async () => {
    const token = tokenFor('operator');
    assertLiveToken(token, 'operator');
    const read = await request(app).get('/api/v1/integrations/sync-status').set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body.integrationId).toBe(shopA.integrationId);
    const before = await bothStates();
    queries.length = 0;
    await assertRejectedWithoutEffects(before, await privilegedOperations(token), 403);
  });
});

// Actor-type cases reuse the existing signed-token shape and disposable fixtures.
// Only the actor claim and, for recognized controls, JWT roles differ.
function actorToken(actorType: string | undefined, claimedRoles: Role[] = ['owner']) {
  const payload = jwt.verify(tokenFor(), process.env.JWT_SECRET!) as jwt.JwtPayload;
  delete payload.iat;
  delete payload.exp;
  if (actorType === undefined) delete payload.actor_type;
  else payload.actor_type = actorType;
  payload.shop_roles = claimedRoles;
  const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' });
  const verified = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
  expect(verified).toMatchObject({ user_id: shopA.users.owner,
    shop_id: shopA.shopId, shop_roles: claimedRoles });
  expect(verified.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  if (actorType === undefined) expect(verified).not.toHaveProperty('actor_type');
  else expect(verified.actor_type).toBe(actorType);
  return token;
}

async function assertInvalidActorWithoutEffects(token: string) {
  const before = await bothStates();
  queries.length = 0;
  const responses = await protectedOperations(token);
  // Capture operation evidence before snapshot reads or any failing assertion.
  const operationQueries = queries.filter(sql => /"(?:integrations|shopify_admin_credentials|domain_events|domain_event_outbox|orders|variants|customers|products)"/.test(sql));
  const after = await bothStates();
  console.info('AUTH_ADMISSION_ACTOR_HTTP', responses.map(response => ({ status: response.status, body: response.body })));
  expect({
    admission: responses.map(response => ({ status: response.status, error: response.body.error })),
    operationQueries,
    credentialCalls: (resolveShopifyAdminCredentialForConsumer as jest.Mock).mock.calls,
    syncCalls: (performInitialSync as jest.Mock).mock.calls,
    refundCalls: (backfillShopifyRefunds as jest.Mock).mock.calls,
    state: after,
  }).toEqual({
    admission: responses.map(() => ({ status: 401, error: 'INVALID_TOKEN_ACTOR_TYPE' })),
    operationQueries: [], credentialCalls: [], syncCalls: [], refundCalls: [], state: before,
  });
}

async function assertRecognizedActorControl(actorType: 'system_service' | 'support_admin') {
  // Existing non-shop_user admission retains JWT roles. An owner membership
  // must not elevate this operator-only token to owner privileges.
  expect(await requireShopContextForUser(shopA.users.owner)).toMatchObject({ shopId: shopA.shopId, role: 'owner' });
  const token = actorToken(actorType, ['operator']);
  const before = await bothStates();
  const read = await request(app).get('/api/v1/integrations/sync-status')
    .set('Authorization', `Bearer ${token}`);
  expect(read.status).toBe(200);
  expect(read.body.integrationId).toBe(shopA.integrationId);
  queries.length = 0;
  await assertRejectedWithoutEffects(before, await privilegedOperations(token), 403);
}

describe('AUTH-ADMISSION-01 actor-type admission regressions', () => {
  it('MISSING ACTOR TYPE RED: signed owner JWT without actor_type is 401 INVALID_TOKEN_ACTOR_TYPE without effects', async () => {
    await assertInvalidActorWithoutEffects(actorToken(undefined));
  });
  it('UNKNOWN ACTOR TYPE RED: signed owner JWT with unrecognized actor_type is 401 INVALID_TOKEN_ACTOR_TYPE without effects', async () => {
    await assertInvalidActorWithoutEffects(actorToken('auth_admission_unknown_actor'));
  });
  it('SYSTEM SERVICE GREEN: recognized actor retains read admission and operator JWT roles without privileged effects', async () => {
    await assertRecognizedActorControl('system_service');
  });
  it('SUPPORT ADMIN GREEN: recognized actor retains read admission and operator JWT roles without privileged effects', async () => {
    await assertRecognizedActorControl('support_admin');
  });
});
