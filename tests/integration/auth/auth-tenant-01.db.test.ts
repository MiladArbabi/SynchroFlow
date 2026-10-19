/**
 * AUTH-TENANT-01 DB certification. Run only through scripts/with-test-db.js.
 * Real createApp, JWT auth, membership resolution, requireAction, permissions,
 * tenant queries, PostgreSQL RLS, domain events and automatic outbox insertion.
 * Credential/provider execution and Redis are deterministic doubles. This does
 * not certify Shopify sync/backfill internals, delivery, retries or replay.
 */
jest.mock('api-src/services/shopify/shopifyAdminCredentialConsumer.service', () => ({
  resolveShopifyAdminCredentialForConsumer: jest.fn().mockResolvedValue({
    kind: 'READY', accessToken: 'synthetic-auth-tenant-token',
    shopDomain: 'auth-tenant.invalid',
  }),
}));
jest.mock('api-src/services/shopify.service', () => ({
  performInitialSync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('api-src/services/shopify/shopifyRefundBackfill.service', () => ({
  backfillShopifyRefunds: jest.fn().mockResolvedValue({ refundsBackfilled: 0 }),
}));
// Always miss the cache, so real tenant-scoped permission rows decide admission.
jest.mock('@lasyncro/backend-core/services/redis.client.js', () => ({
  getRedisClient: () => ({
    get: async () => null, set: async () => 'OK',
  }),
}));

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, systemTransaction, setTenantContext, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { requireShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { resolveShopifyAdminCredentialForConsumer } from 'api-src/services/shopify/shopifyAdminCredentialConsumer.service';
import { performInitialSync } from 'api-src/services/shopify.service';
import { backfillShopifyRefunds } from 'api-src/services/shopify/shopifyRefundBackfill.service';
import { persistShopifyAdminCredentials } from 'api-src/services/shopify/shopifyAdminCredential.repository';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';
import { issueTestToken } from '../../unit/helpers/auth';

const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'auth-tenant-db-synthetic-jwt-secret';
const app = createApp(); // Never server.ts: no worker/server bootstrap.
type Role = 'owner' | 'admin' | 'operator';
type Shop = { shopId: number; integrationId: number; installationId: number; users: Record<Role, number> };
let shopA: Shop;
let shopB: Shop;
const queries: string[] = [];
const recordQuery = (query: { sql: string }) => queries.push(query.sql);

async function fixture(label: string): Promise<Shop> {
  const unique = crypto.randomUUID();
  return systemTransaction(async (trx) => {
    const shopId = await createTenantShop(trx, `auth-tenant-${label}-${unique}`);
    await setTenantContext(trx, shopId);
    const users = {} as Record<Role, number>;
    for (const role of ['owner', 'admin', 'operator'] as const) {
      const [user] = await trx('users').insert({
        shop_id: shopId, role,
        email: `auth-tenant-${label}-${role}-${unique}@test.invalid`,
        password_hash: 'synthetic-not-a-login-hash',
      }).returning('id');
      users[role] = Number(user.id);
      await trx('shop_memberships').insert({ shop_id: shopId, user_id: user.id, role });
    }
    const [integration] = await trx('integrations').insert({
      shop_id: shopId, platform: 'shopify',
      platform_shop_name: `auth-tenant-${unique}.invalid`,
      sync_status: 'FAILED', updated_at: new Date(),
    }).returning('id');
    // GH-1101: manual recovery admits only a canonically connected tenant.
    const [installation] = await trx('shopify_app_installations').insert({
      shop_id: shopId, shop_domain: `auth-tenant-${unique}.invalid`,
      shop_gid: `gid://shopify/Shop/${shopId}`, scopes: SHOPIFY_REQUIRED_SCOPE_STRING, uninstalled_at: null,
    }).returning('id');
    await persistShopifyAdminCredentials(trx, Number(installation.id), shopId, {
      accessToken: `auth-tenant-access-${unique}`, refreshToken: `auth-tenant-refresh-${unique}`,
      accessExpiresAt: new Date(Date.now() + 86_400_000), refreshExpiresAt: new Date(Date.now() + 604_800_000),
      grantedScopes: SHOPIFY_REQUIRED_SCOPE_STRING,
    });
    // Nonempty protected event/outbox rows make unchanged-state proof meaningful.
    await trx('domain_events').insert({
      shop_id: shopId, event_type: 'auth-tenant/protected-fixture',
      event_payload: { integration_id: Number(integration.id) },
      event_time: trx.fn.now(), event_version: 1,
      external_event_id: `internal:auth-tenant-fixture:${unique}`,
    });
    return { shopId, integrationId: Number(integration.id), installationId: Number(installation.id), users };
  });
}

async function protectedState(shop: Shop) {
  return withTenant(shop.shopId, async (trx) => {
    const state: Record<string, unknown> = {};
    for (const table of ['integrations', 'users', 'shop_memberships', 'shop_role_permissions',
      'shopify_admin_credentials', 'domain_events']) {
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
function post(path: string, body: unknown, role: Role = 'owner', jwtShop = shopA.shopId) {
  const token = issueTestToken({ userId: shopA.users[role], shopId: jwtShop, roles: [role] });
  return request(app).post(`/api/v1/integrations/${path}`)
    .set('Authorization', `Bearer ${token}`).send(body);
}
async function allOperations(role: Role, jwtShop = shopA.shopId) {
  return [
    await post('manual-initial-sync', { shopId: shopA.shopId, integrationId: shopA.integrationId }, role, jwtShop),
    await post(`sync/${shopA.integrationId}`, {}, role, jwtShop),
    await post('refund-backfill', {}, role, jwtShop),
  ];
}
function noProviderEffects() {
  expect(resolveShopifyAdminCredentialForConsumer).not.toHaveBeenCalled();
  expect(performInitialSync).not.toHaveBeenCalled();
  expect(backfillShopifyRefunds).not.toHaveBeenCalled();
}
function noIntegrationOrEffectQueries() {
  // Authentication tier and management permission reads are intentionally real.
  expect(queries.filter(sql => /"(?:integrations|shopify_admin_credentials|domain_events|domain_event_outbox)"/.test(sql))).toEqual([]);
}
async function permission(role: Role, granted: boolean) {
  await withTenant(shopA.shopId, trx => trx('shop_role_permissions').insert({
    shop_id: shopA.shopId, action: 'integrations:write', role, granted, locked: false,
  }));
}

beforeAll(async () => {
  expect(process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB).toBe('1');
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const identity = await systemQuery(db.raw(`
    SELECT current_database() AS db, current_user AS usr, r.rolsuper, r.rolbypassrls
    FROM pg_roles r WHERE r.rolname = current_user
  `));
  expect(identity.rows[0]).toEqual({ db: process.env.PGDATABASE, usr: 'sf_app', rolsuper: false, rolbypassrls: false });
  const tables = ['shops', 'users', 'shop_memberships', 'integrations', 'shop_role_permissions',
    'shopify_admin_credentials', 'domain_events', 'domain_event_outbox'];
  const rls = await systemQuery(db.raw(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
      EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS has_policy
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(?::text[]) ORDER BY c.relname
  `, [tables]));
  expect(rls.rows.map((row: any) => row.relname)).toEqual([...tables].sort());
  for (const row of rls.rows) {
    expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, has_policy: true });
  }
  console.info('AUTH_TENANT_DB_RUNTIME', { ...identity.rows[0], forcedRlsTables: rls.rows.map((row: any) => row.relname) });
  db.on('query', recordQuery);
});
beforeEach(async () => {
  jest.clearAllMocks();
  shopA = await fixture('A');
  shopB = await fixture('B');
  expect(await requireShopContextForUser(shopA.users.owner)).toMatchObject({ shopId: shopA.shopId, role: 'owner' });
  expect(await requireShopContextForUser(shopB.users.owner)).toMatchObject({ shopId: shopB.shopId, role: 'owner' });
  queries.length = 0;
});
afterAll(async () => {
  db.removeListener('query', recordQuery);
  await db.destroy();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe('AUTH-TENANT-01 real PostgreSQL certification', () => {
  it('RLS hides B integration from A; valid B identifiers cannot select initial-sync tenant', async () => {
    expect(await withTenant(shopA.shopId, trx => trx('integrations').where({ id: shopB.integrationId }))).toEqual([]);
    expect(await withTenant(shopB.shopId, trx => trx('integrations').where({ id: shopB.integrationId }))).toHaveLength(1);
    const before = await bothStates();
    queries.length = 0;
    const response = await post('manual-initial-sync', { shopId: shopB.shopId, integrationId: shopB.integrationId });
    expect(response.status).toBe(403);
    noIntegrationOrEffectQueries();
    noProviderEffects();
    expect(await bothStates()).toEqual(before);
  });
  it('real current membership rejects a disagreeing JWT tenant on all three routes before effects', async () => {
    const before = await bothStates();
    queries.length = 0;
    const responses = await allOperations('owner', shopB.shopId);
    expect(responses.map(response => response.status)).toEqual([403, 403, 403]);
    noIntegrationOrEffectQueries();
    noProviderEffects();
    expect(await bothStates()).toEqual(before);
  });
  it('foreign integration IDs return 404 and leave both tenants, events and outboxes unchanged', async () => {
    const before = await bothStates();
    const initial = await post('manual-initial-sync', { shopId: shopA.shopId, integrationId: shopB.integrationId });
    const manual = await post(`sync/${shopB.integrationId}`, {});
    expect([initial.status, manual.status]).toEqual([404, 404]);
    noProviderEffects();
    expect(await bothStates()).toEqual(before);
  });
  it('real operator default permissions deny all three operations without protected-state changes', async () => {
    const before = await bothStates();
    queries.length = 0;
    const responses = await allOperations('operator');
    expect(responses.map(response => response.status)).toEqual([403, 403, 403]);
    for (const response of responses) expect(response.body).toMatchObject({ error: 'ACTION_FORBIDDEN', action: 'integrations:write' });
    noIntegrationOrEffectQueries();
    noProviderEffects();
    expect(await bothStates()).toEqual(before);
  });
  it('same-tenant owner/admin admission persists one durable recovery intent/outbox only in A, never inline sync', async () => {
    const before = await bothStates();
    const initial = await post('manual-initial-sync', { shopId: shopA.shopId, integrationId: shopA.integrationId });
    const manual = await post(`sync/${shopA.integrationId}`, {}, 'admin');
    const refund = await post('refund-backfill', { shopId: shopB.shopId }, 'admin');
    // GH-1101: the first request is accepted durably; the second sees the outstanding intent.
    expect([initial.status, manual.status, refund.status]).toEqual([202, 409, 200]);
    expect(manual.body).toEqual({ error: 'SYNC_ALREADY_REQUESTED', integrationId: shopA.integrationId });
    // Admission is a pure read: no credential resolution and no inline initial sync.
    expect(resolveShopifyAdminCredentialForConsumer).not.toHaveBeenCalled();
    expect(performInitialSync).not.toHaveBeenCalled();
    expect((backfillShopifyRefunds as jest.Mock).mock.calls).toEqual([[shopA.shopId]]);
    const after = await bothStates();
    expect(after.B).toEqual(before.B);
    const events = after.A.domain_events as any[];
    const added = events.filter(event => !(before.A.domain_events as any[]).some(old => old.id === event.id));
    expect(added).toEqual([expect.objectContaining({ shop_id: shopA.shopId,
      event_type: 'integration/sync_dispatch_requested', event_payload: { integration_id: shopA.integrationId,
        installation_id: shopA.installationId, source: 'recovery' } })]);
    expect((after.A.outbox as any[]).filter(row => String(row.domain_event_id) === String(added[0].id))).toHaveLength(1);
    expect((after.A.outbox as any[]).length).toBe((before.A.outbox as any[]).length + 1);
    expect(after.A.integrations).toEqual(before.A.integrations);
  });
  it('persisted admin denial is authoritative for all routes and preserves both tenants', async () => {
    await permission('admin', false);
    const before = await bothStates();
    queries.length = 0;
    const responses = await allOperations('admin');
    expect(responses.map(response => response.status)).toEqual([403, 403, 403]);
    noIntegrationOrEffectQueries();
    noProviderEffects();
    expect(await bothStates()).toEqual(before);
  });
  it('persisted operator grant is respected without affecting protected tenant B', async () => {
    await permission('operator', true);
    const beforeB = await protectedState(shopB);
    const responses = await allOperations('operator');
    // GH-1101: durable acceptance, then the outstanding intent is reported truthfully.
    expect(responses.map(response => response.status)).toEqual([202, 409, 200]);
    expect(performInitialSync).not.toHaveBeenCalled();
    expect((backfillShopifyRefunds as jest.Mock).mock.calls).toEqual([[shopA.shopId]]);
    expect(await protectedState(shopB)).toEqual(beforeB);
    expect(await withTenant(shopA.shopId, trx => trx('domain_events')
      .where({ shop_id: shopA.shopId, event_type: 'integration/sync_dispatch_requested' }))).toHaveLength(1);
  });
});
