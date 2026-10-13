/**
 * D08 / SHOP-REVIEW-OAUTH-RETRY-03b — ratified install recovery contracts.
 * Authoring only: execute later through the disposable test:integration harness.
 * Real Express routes, DB-backed state, canonical pre-tenant/withTenant helpers.
 * Only provider transports are mocked. No state-invalidation policy is invented.
 */
jest.mock('axios', () => {
  const blocked = jest.fn(async () => { throw new Error('D08_UNPROGRAMMED_PROVIDER_CALL'); });
  const instance = {
    post: jest.fn(), get: blocked, request: blocked,
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: Object.assign(blocked, instance, {
    create: jest.fn(() => instance),
    isAxiosError: (value: any) => value?.isAxiosError === true,
  }) };
});

import crypto from 'crypto';
import { isDeepStrictEqual } from 'util';
import knexFactory, { Knex } from 'knex';
import request from 'supertest';
import axios from 'axios';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { resolveAuthUserByEmail } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';
import { decrypt } from 'api-src/security/encryption.service';

const app = createApp();
const post = axios.post as jest.Mock;
const savedFetch = global.fetch;
const envKeys = ['SHOPIFY_API_SECRET', 'SHOPIFY_API_KEY', 'API_URL', 'FRONTEND_URL',
  'JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'SHOPIFY_PARTNER_ORG_ID',
  'SHOPIFY_APP_GID', 'SHOPIFY_PARTNER_API_ACCESS_TOKEN', 'APP_BASE_URL'] as const;
const savedEnv = new Map(envKeys.map(key => [key, process.env[key]]));
const partnerUrl = 'https://partners.shopify.com/123/api/2026-07/graphql.json';
let observer: Knex;
let transport: jest.Mock;
let callbackClient = 0;
let providerDomain: string | undefined;
let providerFailure = false;
let providerAccess = '';

type Fixture = { domain: string; shopId: number; userId: number; state: string };
const ghostEmail = (domain: string) => `shopify-install+${domain}@lasyncro.internal`;
const ownerEmail = (domain: string) => `owner+${domain}@d08.example`;
const uniqueDomain = () => `d08-${crypto.randomBytes(12).toString('hex')}.myshopify.com`;

function disposableDb(): string {
  const name = process.env.PGDATABASE ?? '';
  if (process.env.NODE_ENV !== 'test' || process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1'
    || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error('D08_REFUSING_NON_DISPOSABLE_DB');
  }
  return name;
}

function signed(params: Record<string, string>): Record<string, string> {
  const message = Object.keys(params).filter(key => key !== 'hmac').sort()
    .map(key => `${key}=${params[key]}`).join('&');
  return { ...params, hmac: crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message).digest('hex') };
}

function install(domain: string, invalid = false) {
  const query = signed({ shop: domain, timestamp: String(Math.floor(Date.now() / 1000)) });
  if (invalid) query.hmac = (query.hmac[0] === '0' ? '1' : '0') + query.hmac.slice(1);
  return request(app).get('/api/v1/integrations/shopify/install').query(query).redirects(0);
}

function callback(f: Fixture, denial = false) {
  const params: Record<string, string> = { shop: f.domain, state: f.state,
    timestamp: String(Math.floor(Date.now() / 1000)) };
  if (denial) params.error = 'access_denied'; else params.code = 'd08-synthetic-code';
  return request(app).get('/api/v1/integrations/oauth/callback/shopify')
    .set('X-Forwarded-For', `192.0.2.${++callbackClient}`)
    .query(signed(params)).redirects(0);
}

// The auth-reset/session suites establish this disposable migration-role
// connection pattern. Here it is READ ONLY, solely to observe orphan/competing
// tenant roots that restricted sf_app cannot enumerate. It never serves routes,
// seeds data, disables RLS, or changes schema. All tenant assertions use sf_app.
async function tenantIds(domain: string, knownId?: number): Promise<number[]> {
  return observer.transaction(async trx => {
    await trx.raw('SET TRANSACTION READ ONLY');
    const rows = await trx('shops as s').select('s.id').where(builder => {
      builder.where('s.name', domain)
        .orWhereExists(trx('users as u').select(trx.raw('1'))
          .whereRaw('u.shop_id = s.id').whereIn('u.email', [ghostEmail(domain), ownerEmail(domain)]))
        .orWhereExists(trx('shopify_app_installations as i').select(trx.raw('1'))
          .whereRaw('i.shop_id = s.id').where('i.shop_domain', domain));
      if (knownId !== undefined) builder.orWhere('s.id', knownId);
    }).orderBy('s.id');
    return rows.map(row => Number(row.id));
  });
}

async function oauthRows(domain: string) {
  return systemQuery(db('integration_oauth_states')
    .where({ platform: 'shopify', shop_domain: domain }).orderBy('id'));
}

async function authorization(res: request.Response, f: Pick<Fixture, 'domain' | 'userId'>) {
  expect(res.status).toBe(302);
  const url = new URL(String(res.headers.location));
  expect(url.origin).toBe(`https://${f.domain}`);
  expect(url.pathname).toBe('/admin/oauth/authorize');
  expect(url.searchParams.get('client_id')).toBe(process.env.SHOPIFY_API_KEY);
  expect(url.searchParams.get('redirect_uri')).toBe(
    `${process.env.API_URL}/api/v1/integrations/oauth/callback/shopify`);
  expect(url.searchParams.get('scope')?.split(',').sort()).toEqual(
    SHOPIFY_REQUIRED_SCOPE_STRING.split(',').sort());
  const state = url.searchParams.get('state');
  expect(typeof state === 'string' && state.length > 0).toBe(true);
  const rows = await oauthRows(f.domain);
  const matching = rows.filter((row: any) => row.state === state);
  expect(matching).toHaveLength(1);
  expect(Number(matching[0].user_id)).toBe(f.userId);
  expect(matching[0].install_source).toBe('app_store');
  expect(new Date(matching[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  return state as string;
}

async function provisioning(f: Pick<Fixture, 'shopId' | 'userId'>) {
  return withTenant(f.shopId, async trx => ({
    shops: await trx('shops').where({ id: f.shopId }).select('id'),
    users: await trx('users').where({ shop_id: f.shopId }).select('id', 'shop_id', 'entry_channel').orderBy('id'),
    owners: await trx('shop_memberships').where({ shop_id: f.shopId, role: 'owner' })
      .select('user_id', 'shop_id', 'role').orderBy('user_id'),
    warehouses: await trx('warehouses').where({ shop_id: f.shopId })
      .select('warehouse_id', 'root_location_code', 'is_default', 'active').orderBy('warehouse_id'),
    locations: await trx('warehouse_locations').where({ shop_id: f.shopId })
      .select('warehouse_id', 'location_code', 'parent_location_code', 'type', 'active').orderBy('location_code'),
    settings: await trx('shop_wms_settings').where({ shop_id: f.shopId }).select('bootstrap_model'),
    subscriptions: await trx('shop_subscriptions').where({ shop_id: f.shopId })
      .select('tier', 'status', 'billing_provider', 'trial_ends_at'),
    usage: await trx('shop_usage_metrics').where({ shop_id: f.shopId })
      .select('id', 'tier_at_period_start', 'period_starts_at', 'period_ends_at').orderBy('id'),
    // Initial grant identity + validity are business facts: detect replacement,
    // duplicate rows, revoked/replayed grants, and shifted validity windows.
    grants: await trx('shop_module_entitlements').where({ shop_id: f.shopId,
      source: 'shopify_app_store_install:growth' })
      .select('id', 'module_key', 'flag_key', 'source', 'valid_from', 'valid_until').orderBy('id'),
    creationTransitions: await trx('shop_subscription_transitions').where({ shop_id: f.shopId,
      source: 'shopify_app_store_install', reason: 'app_store_install_growth_trial' })
      .select('id', 'from_tier', 'from_status', 'from_billing_provider',
        'to_tier', 'to_status', 'to_billing_provider').orderBy('id'),
  }));
}

async function validProvisioning(f: Fixture) {
  expect(await tenantIds(f.domain, f.shopId)).toEqual([f.shopId]);
  const p = await provisioning(f);
  expect(p.shops).toEqual([{ id: f.shopId }]);
  expect(p.users).toEqual([{ id: f.userId, shop_id: f.shopId, entry_channel: 'shopify_app_store' }]);
  expect(p.owners).toEqual([{ user_id: f.userId, shop_id: f.shopId, role: 'owner' }]);
  expect(p.warehouses).toHaveLength(1);
  expect(p.warehouses[0]).toMatchObject({ root_location_code: `WH-${f.shopId}-ROOT`,
    is_default: true, active: true });
  expect(p.locations).toEqual([{ warehouse_id: p.warehouses[0].warehouse_id,
    location_code: `WH-${f.shopId}-ROOT`, parent_location_code: null, type: 'warehouse', active: true }]);
  expect(p.settings).toEqual([{ bootstrap_model: 'reconcile_opening_expectation_v2' }]);
  expect(p.subscriptions).toHaveLength(1);
  expect(p.subscriptions[0]).toMatchObject({ tier: 'growth', status: 'trialing', billing_provider: 'shopify' });
  expect(new Date(p.subscriptions[0].trial_ends_at).getTime()).toBeGreaterThan(Date.now());
  expect(p.usage).toHaveLength(1);
  expect(p.usage[0]).toMatchObject({ tier_at_period_start: 'growth', period_ends_at: null });
  expect(p.creationTransitions).toHaveLength(1);
  expect(p.creationTransitions[0]).toMatchObject({ from_tier: null, from_status: null,
    from_billing_provider: null, to_tier: 'growth', to_status: 'trialing', to_billing_provider: 'shopify' });
  const expectedGrants: { module_key: string; flag_key: string | null }[] = [
    ...[...modulesForTier('growth')].map(module_key => ({ module_key, flag_key: null })),
    ...[...flagsForTier('growth')].map(flag_key => ({ module_key: flag_key.split('.')[0], flag_key })),
  ];
  expect(p.grants).toHaveLength(expectedGrants.length);
  for (const grant of expectedGrants) {
    expect(p.grants.filter(row => row.module_key === grant.module_key && row.flag_key === grant.flag_key))
      .toHaveLength(1);
  }
  expect(p.grants.every(row => row.valid_until === null && new Date(row.valid_from) <= new Date())).toBe(true);
  return p;
}

async function fresh(domain = uniqueDomain()): Promise<Fixture> {
  expect(await tenantIds(domain)).toEqual([]);
  expect(await oauthRows(domain)).toHaveLength(0);
  const res = await install(domain);
  expect(res.status).toBe(302);
  const user = await resolveAuthUserByEmail(ghostEmail(domain));
  // Never let Jest print the resolver's password hash.
  expect(user !== null).toBe(true);
  const f = { domain, shopId: Number(user!.shop_id), userId: Number(user!.id), state: '' };
  f.state = await authorization(res, f);
  await validProvisioning(f);
  return f;
}

async function authority(f: Fixture) {
  return withTenant(f.shopId, async trx => ({
    installations: await trx('shopify_app_installations').where({ shop_id: f.shopId }).orderBy('id'),
    credentials: await trx('shopify_admin_credentials').where({ shop_id: f.shopId }).orderBy('id'),
    integrations: await trx('integrations').where({ shop_id: f.shopId, platform: 'shopify' }).orderBy('id'),
  }));
}

async function retry(f: Fixture) {
  const before = await provisioning(f);
  const beforeAuthority = await authority(f);
  const res = await install(f.domain);
  // Persisted invariants run before redirect assertion: a rolled-back 500 is
  // distinct from duplicate provisioning but still fails the recovery contract.
  expect(await tenantIds(f.domain, f.shopId)).toEqual([f.shopId]);
  expect(await provisioning(f)).toEqual(before);
  expect(isDeepStrictEqual(await authority(f), beforeAuthority)).toBe(true);
  const user = await resolveAuthUserByEmail(ghostEmail(f.domain));
  expect(user !== null && Number(user.id) === f.userId && Number(user.shop_id) === f.shopId).toBe(true);
  return { ...f, state: await authorization(res, f) };
}

function programProvider(f: Fixture, fail = false) {
  providerDomain = f.domain;
  providerFailure = fail;
  providerAccess = `d08-synthetic-access-${crypto.randomBytes(8).toString('hex')}`;
}

async function complete(f: Fixture) {
  programProvider(f);
  const res = await callback(f);
  expect(res.status).toBe(302);
  const redirect = new URL(String(res.headers.location));
  expect(redirect.origin).toBe(new URL(process.env.FRONTEND_URL!).origin);
  expect(redirect.searchParams.get('connect')).toBe('app_store');
  expect(Boolean(redirect.searchParams.get('token'))).toBe(true); // do not print JWT
  const a = await authority(f);
  expect(a.installations).toHaveLength(1);
  expect(a.installations[0]).toMatchObject({ shop_id: f.shopId, shop_domain: f.domain, uninstalled_at: null });
  expect(a.integrations).toHaveLength(1);
  expect(a.integrations[0]).toMatchObject({ shop_id: f.shopId, platform_shop_name: f.domain });
  expect(a.credentials.length).toBe(1); // do not print encrypted credential rows
  const credential = a.credentials[0];
  expect(Number(credential.shop_id)).toBe(f.shopId);
  expect(Number(credential.installation_id)).toBe(Number(a.installations[0].id));
  expect(credential.credential_state).toBe('ACTIVE');
  expect(decrypt(credential.access_token_encrypted, 'shopify.dev') === providerAccess).toBe(true);
  expect(decrypt(credential.refresh_token_encrypted, 'shopify.dev') === 'd08-synthetic-refresh').toBe(true);
  expect(post.mock.calls.length).toBe(2);
  expect(transport.mock.calls.length).toBeGreaterThan(0);
  return a;
}

beforeAll(async () => {
  const database = disposableDb();
  const runtime = await systemQuery(db.raw(`SELECT current_database() AS database,
    current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`));
  expect(runtime.rows).toEqual([{ database, role: 'sf_app', rolsuper: false, rolbypassrls: false }]);
  const rls = await systemQuery(db.raw(`SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class WHERE oid IN ('public.shops'::regclass, 'public.users'::regclass,
      'public.shop_memberships'::regclass, 'public.shopify_admin_credentials'::regclass)`));
  expect(rls.rows).toHaveLength(4);
  expect(rls.rows.every((row: any) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  observer = knexFactory({ client: 'pg', connection: { host: process.env.PGHOST,
    port: Number(process.env.PGPORT), database, user: process.env.PGMIGRATION_USER,
    password: String(process.env.PGMIGRATION_PASSWORD || ''),
    options: '-c default_transaction_read_only=on' }, pool: { min: 0, max: 2 } });
  const observedDb = await observer.raw('SELECT current_database() AS database');
  expect(observedDb.rows[0].database).toBe(database);
  Object.assign(process.env, { SHOPIFY_API_SECRET: 'd08-test-secret', SHOPIFY_API_KEY: 'd08-test-key',
    API_URL: 'https://api.d08.example', FRONTEND_URL: 'https://app.d08.example',
    JWT_SECRET: 'd08-test-jwt-secret', JWT_REFRESH_SECRET: 'd08-test-refresh-secret',
    ENCRYPTION_KEY: 'test-encryption-key-0123456789abcdef', SHOPIFY_PARTNER_ORG_ID: '123',
    SHOPIFY_APP_GID: 'gid://shopify/App/320563019777', SHOPIFY_PARTNER_API_ACCESS_TOKEN: 'd08-test-partner',
    APP_BASE_URL: 'https://webhooks.d08.example' });
  transport = jest.fn();
  global.fetch = transport;
});

beforeEach(() => {
  providerDomain = undefined;
  providerFailure = false;
  post.mockReset();
  post.mockImplementation(async (url: unknown) => {
    if (!providerDomain) throw new Error('D08_UNPROGRAMMED_PROVIDER_CALL');
    if (url === `https://${providerDomain}/admin/oauth/access_token`) {
      if (providerFailure) throw new Error('D08_SYNTHETIC_TOKEN_EXCHANGE_FAILURE');
      return { data: { access_token: providerAccess, refresh_token: 'd08-synthetic-refresh',
        expires_in: 86400, refresh_token_expires_in: 2592000, scope: SHOPIFY_REQUIRED_SCOPE_STRING } };
    }
    if (url === `https://${providerDomain}/admin/api/2024-01/graphql.json`) {
      return { data: { data: { shop: { id: 'gid://shopify/Shop/999008', currencyCode: 'USD',
        name: providerDomain, contactEmail: ownerEmail(providerDomain), ianaTimezone: 'UTC' } } } };
    }
    throw new Error('D08_PROVIDER_NETWORK_ESCAPE_BLOCKED');
  });
  transport.mockReset();
  transport.mockImplementation(async (url: unknown) => {
    if (url === partnerUrl && providerDomain) {
      return { ok: true, status: 200, json: async () => ({ data: { activeSubscription: null } }) };
    }
    if (providerDomain && url === `https://${providerDomain}/admin/api/2024-01/graphql.json`) {
      return { ok: true, status: 200, json: async () => ({ data: { webhookSubscriptionCreate: {
        webhookSubscription: { id: 'gid://shopify/WebhookSubscription/999008' }, userErrors: [],
      } } }) };
    }
    throw new Error('D08_PROVIDER_NETWORK_ESCAPE_BLOCKED');
  });
});

afterAll(async () => {
  global.fetch = savedFetch;
  for (const key of envKeys) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (observer) await observer.destroy();
  await db.destroy();
});

describe('D08 — signed Shopify install retries (real routes, disposable PostgreSQL)', () => {
  it('R1 — first install creates one valid tenant, owner, warehouse, Growth trial and OAuth intent', async () => {
    const before = Date.now();
    const f = await fresh();
    const after = Date.now();
    expect(await oauthRows(f.domain)).toHaveLength(1);
    const p = await provisioning(f);
    const trialEnd = new Date(p.subscriptions[0].trial_ends_at).getTime();
    expect(trialEnd).toBeGreaterThanOrEqual(before + 14 * 24 * 60 * 60 * 1000);
    expect(trialEnd).toBeLessThanOrEqual(after + 14 * 24 * 60 * 60 * 1000);
    const a = await authority(f);
    expect(a.installations).toHaveLength(0);
    expect(a.credentials.length).toBe(0);
    expect(a.integrations).toHaveLength(0);
    expect(post.mock.calls.length).toBe(0);
    expect(transport.mock.calls.length).toBe(0);
  });

  it('R2 — repeated install before callback reuses tenant/owner and returns a valid authorization redirect', async () => {
    await retry(await fresh());
    expect(post.mock.calls.length).toBe(0);
    expect(transport.mock.calls.length).toBe(0);
  });

  it('R3a — signed denied callback can be followed by installation recovery without duplicate provisioning', async () => {
    const f = await fresh();
    const before = await provisioning(f);
    const res = await callback(f, true);
    expect(res.status).toBe(302);
    expect(new URL(String(res.headers.location)).searchParams.get('connect')).toBe('error');
    expect(await provisioning(f)).toEqual(before);
    expect(post.mock.calls.length).toBe(0);
    expect(transport.mock.calls.length).toBe(0);
    // Neither reuse nor invalidation of the earlier pending state is mandated.
    await complete(await retry(f));
    expect(await provisioning(f)).toEqual(before);
  });

  it('R3b — real callback token-exchange failure can recover through another signed install', async () => {
    const f = await fresh();
    const before = await provisioning(f);
    programProvider(f, true);
    const res = await callback(f);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Failed to exchange OAuth token' });
    expect(post.mock.calls.length).toBe(1);
    expect(transport.mock.calls.length).toBe(0);
    const failed = await authority(f);
    expect(failed.installations).toHaveLength(0);
    expect(failed.credentials.length).toBe(0);
    expect(failed.integrations).toHaveLength(0);
    expect(await provisioning(f)).toEqual(before);
    const recovered = await retry(f);
    post.mockClear();
    await complete(recovered);
    expect(await provisioning(f)).toEqual(before);
  });

  it('R4 — expired state is rejected and replaced with a fresh valid intent in the same tenant', async () => {
    const f = await fresh();
    const before = await provisioning(f);
    await systemQuery(db('integration_oauth_states').where({ platform: 'shopify',
      shop_domain: f.domain, user_id: f.userId, state: f.state })
      .update({ expires_at: new Date(Date.now() - 60_000) }));
    const expired = await oauthRows(f.domain);
    expect(expired).toHaveLength(1);
    expect(new Date(expired[0].expires_at).getTime()).toBeLessThan(Date.now());
    expect((await callback(f)).status).toBe(403);
    expect(post.mock.calls.length).toBe(0);
    expect(transport.mock.calls.length).toBe(0);
    const recovered = await retry(f);
    expect(recovered.state === f.state).toBe(false);
    // Do not assert whether the old expired row was retained or deleted.
    await complete(recovered);
    expect(await provisioning(f)).toEqual(before);
    expect(await tenantIds(f.domain, f.shopId)).toEqual([f.shopId]);
  });

  it('R5 — overlapping signed requests for an unseen domain leave one valid tenant and owner', async () => {
    const domain = uniqueDomain();
    expect(await tenantIds(domain)).toEqual([]);
    expect(await oauthRows(domain)).toHaveLength(0);
    // Observe both HTTP requests dispatched before either response settles.
    // No serial awaits, production resolver-name dependency, or hidden retry.
    let dispatched = 0;
    let overlapping = false;
    let settled = 0;
    const dispatch = () => {
      dispatched++;
      if (dispatched === 2 && settled === 0) overlapping = true;
    };
    const first = install(domain).on('request', dispatch).then(res => { settled++; return res; });
    const second = install(domain).on('request', dispatch).then(res => { settled++; return res; });
    const responses = await Promise.all([first, second]);
    expect(overlapping).toBe(true);
    const ids = await tenantIds(domain);
    expect(ids).toHaveLength(1);
    const user = await resolveAuthUserByEmail(ghostEmail(domain));
    expect(user !== null).toBe(true);
    const f = { domain, shopId: ids[0], userId: Number(user!.id), state: '' };
    expect(Number(user!.shop_id)).toBe(f.shopId);
    await validProvisioning(f);
    const successes = responses.filter(res => res.status === 302);
    expect(successes.length).toBeGreaterThan(0);
    // R5 does not ratify all-302 semantics for racing callers. Each successful
    // response must nonetheless point to persisted state for the SAME owner.
    for (const res of successes) await authorization(res, f);
    const states = await oauthRows(domain);
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((row: any) => Number(row.user_id) === f.userId)).toBe(true);
    expect(post.mock.calls.length).toBe(0);
    expect(transport.mock.calls.length).toBe(0);
  });

  it('R6 — completed installation reuses the backfilled owner and preserves canonical credentials on reinstall', async () => {
    const f = await fresh();
    const initial = await complete(f);
    const owner = await resolveAuthUserByEmail(ownerEmail(f.domain));
    expect(owner !== null && Number(owner.id) === f.userId && Number(owner.shop_id) === f.shopId).toBe(true);
    const before = await provisioning(f);
    const res = await install(f.domain);
    expect(await tenantIds(f.domain, f.shopId)).toEqual([f.shopId]);
    expect(await provisioning(f)).toEqual(before);
    expect(isDeepStrictEqual(await authority(f), initial)).toBe(true);
    const state = await authorization(res, f);
    post.mockClear();
    transport.mockClear();
    const reconnected = await complete({ ...f, state });
    expect(Number(reconnected.installations[0].id)).toBe(Number(initial.installations[0].id));
    expect(Number(reconnected.credentials[0].installation_id)).toBe(Number(initial.installations[0].id));
    expect(Number(reconnected.credentials[0].shop_id)).toBe(f.shopId);
    expect(await provisioning(f)).toEqual(before);
    expect(await tenantIds(f.domain, f.shopId)).toEqual([f.shopId]);
  });

  it('R7 — pending retry preserves original trial, bootstrap model, warehouse infrastructure and initial grants', async () => {
    const f = await fresh();
    const original = await validProvisioning(f);
    await retry(f);
    expect(await provisioning(f)).toEqual(original);
  });

  it('R8 — invalid HMAC fails before any runtime tenant lookup or mutation, with signed positive control', async () => {
    const domain = uniqueDomain();
    expect(await tenantIds(domain)).toEqual([]);
    expect(await oauthRows(domain)).toHaveLength(0);
    const assertRejectedWithoutSql = async () => {
      let sqlCount = 0;
      const observe = () => { sqlCount++; }; // never retain SQL bindings/secrets
      db.on('query', observe);
      let res: request.Response;
      try { res = await install(domain, true); }
      finally { db.removeListener('query', observe); }
      expect(res.status).toBe(401);
      expect(sqlCount).toBe(0);
      expect(post.mock.calls.length).toBe(0);
      expect(transport.mock.calls.length).toBe(0);
    };
    await assertRejectedWithoutSql();
    expect(await tenantIds(domain)).toEqual([]);
    expect(await oauthRows(domain)).toHaveLength(0);
    const f = await fresh(domain); // same domain/transport, valid signature provisions
    const before = await provisioning(f);
    const states = await oauthRows(domain);
    const credentials = await authority(f);
    await assertRejectedWithoutSql();
    expect(await tenantIds(domain)).toEqual([f.shopId]);
    expect(await provisioning(f)).toEqual(before);
    expect(isDeepStrictEqual(await oauthRows(domain), states)).toBe(true);
    expect(isDeepStrictEqual(await authority(f), credentials)).toBe(true);
  });
});
