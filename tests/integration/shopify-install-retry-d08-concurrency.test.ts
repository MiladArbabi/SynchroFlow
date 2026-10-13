/**
 * D08-CONCURRENCY-01 — real PostgreSQL contention, authoring only.
 * Execute only through the canonical disposable test:integration harness.
 * Two signed HTTP requests must BOTH wait on the exact install lock and then
 * BOTH redirect to distinct persisted OAuth intents for one provisioned tenant.
 */
jest.mock('axios', () => {
  const blocked = jest.fn(async () => { throw new Error('D08_CONCURRENCY_PROVIDER_CALL'); });
  const instance = {
    post: blocked, get: blocked, put: blocked, patch: blocked, delete: blocked,
    head: blocked, options: blocked, request: blocked,
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: Object.assign(blocked, instance, {
    create: jest.fn(() => instance),
    isAxiosError: (value: any) => value?.isAxiosError === true,
  }) };
});

import crypto from 'crypto';
import https from 'https';
import { Client } from 'pg';
import knexFactory, { Knex } from 'knex';
import request from 'supertest';
import axios from 'axios';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { resolveAuthUserByEmail } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';

const LOCK_NAMESPACE = 'shopify_app_store_install';
const OBSERVATION_MS = 10_000;
const HTTP_DEADLINE_MS = 20_000;
const app = createApp();
const savedFetch = global.fetch;
const envKeys = ['SHOPIFY_API_SECRET', 'SHOPIFY_API_KEY', 'API_URL'] as const;
const savedEnv = new Map(envKeys.map(key => [key, process.env[key]]));
let observer: Knex | undefined;
let transport: jest.Mock;
let httpsRequest: jest.SpyInstance | undefined;
let httpsGet: jest.SpyInstance | undefined;

type Fixture = { domain: string; shopId: number; userId: number };
type Outcome = { ok: true; response: request.Response } | { ok: false };
type Tracked = { result: Promise<Outcome>; settled: () => boolean };
type LockRow = {
  pid: number;
  virtualtransaction: string;
  granted: boolean;
  usename: string;
  transaction_open: boolean;
  state: string;
  wait_event_type: string | null;
};
const ghostEmail = (domain: string) => `shopify-install+${domain}@lasyncro.internal`;

function disposableDb(): string {
  const name = process.env.PGDATABASE ?? '';
  if (process.env.NODE_ENV !== 'test' || process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1'
    || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(name) || process.env.PGUSER !== 'sf_app') {
    throw new Error('D08_CONCURRENCY_REFUSING_UNSAFE_DB');
  }
  return name;
}

// Same read-only migration-role observer pattern as D08. It only observes
// orphan/competing roots and lock metadata; it never seeds, serves HTTP, changes
// RLS, or performs application writes. Tenant assertions and blocker use sf_app.
async function tenantIds(domain: string, knownId?: number): Promise<number[]> {
  if (!observer) throw new Error('D08_CONCURRENCY_OBSERVER_MISSING');
  return observer.transaction(async trx => {
    await trx.raw('SET TRANSACTION READ ONLY');
    const rows = await trx('shops as s').select('s.id').where(builder => {
      builder.where('s.name', domain)
        .orWhereExists(trx('users as u').select(trx.raw('1'))
          .whereRaw('u.shop_id = s.id').where('u.email', ghostEmail(domain)))
        .orWhereExists(trx('shopify_app_installations as i').select(trx.raw('1'))
          .whereRaw('i.shop_id = s.id').where('i.shop_domain', domain));
      if (knownId !== undefined) builder.orWhere('s.id', knownId);
    }).orderBy('s.id');
    return rows.map(row => Number(row.id));
  });
}

async function oauthRows(domain: string) {
  return systemQuery(db('integration_oauth_states')
    .where({ platform: 'shopify', shop_domain: domain })
    .select('user_id', 'shop_domain', 'state', 'install_source', 'expires_at'));
}

function dispatch(domain: string): Tracked {
  const params = { shop: domain, timestamp: String(Math.floor(Date.now() / 1000)) };
  const message = Object.keys(params).sort()
    .map(key => `${key}=${params[key as keyof typeof params]}`).join('&');
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message).digest('hex');
  let settled = false;
  // Calling .then starts Supertest immediately. Neither request awaits the other.
  // Rejections are recorded immediately and asserted after cleanup, so a failed
  // request cannot become an unhandled rejection or print a sensitive URL.
  const result = request(app).get('/api/v1/integrations/shopify/install')
    .query({ ...params, hmac }).redirects(0).timeout({ deadline: HTTP_DEADLINE_MS })
    .then<Outcome, Outcome>(
      response => ({ ok: true, response }),
      () => ({ ok: false }),
    ).finally(() => { settled = true; });
  return { result, settled: () => settled };
}

async function exactLockRows(domain: string): Promise<LockRow[]> {
  if (!observer) throw new Error('D08_CONCURRENCY_OBSERVER_MISSING');
  // Two-int advisory keys use objsubid=2. OID columns hold the unsigned 32-bit
  // hash values; use the repository's modulo conversion for negative hashtext.
  // Never read pg_stat_activity.query: it can contain sensitive SQL bindings.
  const result = await observer.raw(`
    SELECT l.pid, l.virtualtransaction, l.granted, a.usename,
           a.xact_start IS NOT NULL AS transaction_open,
           a.state, a.wait_event_type
      FROM pg_locks AS l
      JOIN pg_stat_activity AS a ON a.pid = l.pid
     WHERE l.locktype = 'advisory' AND l.mode = 'ExclusiveLock'
       AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
       AND a.datname = current_database()
       AND l.objsubid = 2
       AND l.classid::bigint = (hashtext(?)::bigint + 4294967296) % 4294967296
       AND l.objid::bigint = (hashtext(?)::bigint + 4294967296) % 4294967296
  `, [LOCK_NAMESPACE, domain]);
  return result.rows;
}

function requireVisibleHolder(rows: LockRow[], blockerPid: number): void {
  const holders = rows.filter(row => row.granted);
  if (holders.length !== 1 || Number(holders[0].pid) !== blockerPid
    || holders[0].usename !== 'sf_app' || !holders[0].transaction_open
    || !holders[0].virtualtransaction) {
    throw new Error('D08_CONCURRENCY_EXACT_LOCK_HOLDER_NOT_VISIBLE');
  }
}

async function waitForTwoWaiters(domain: string, blockerPid: number, requests: Tracked[]) {
  const deadline = Date.now() + OBSERVATION_MS;
  while (Date.now() < deadline) {
    const rows = await exactLockRows(domain);
    requireVisibleHolder(rows, blockerPid);
    if (requests.some(req => req.settled())) {
      throw new Error('D08_CONCURRENCY_REQUEST_SETTLED_BEFORE_CONTENTION_PROOF');
    }
    const waiting = rows.filter(row => !row.granted);
    if (waiting.length > 2) throw new Error('D08_CONCURRENCY_UNEXPECTED_LOCK_WAITER');
    if (waiting.length === 2) {
      expect(new Set(waiting.map(row => Number(row.pid))).size).toBe(2);
      expect(new Set(waiting.map(row => row.virtualtransaction)).size).toBe(2);
      expect(waiting.every(row => Number(row.pid) !== blockerPid
        && row.usename === 'sf_app' && row.transaction_open
        && Boolean(row.virtualtransaction) && row.state === 'active'
        && row.wait_event_type === 'Lock')).toBe(true);
      return;
    }
    // Poll pacing only. Success requires live pg_locks evidence, never elapsed time.
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('D08_CONCURRENCY_TWO_EXACT_LOCK_WAITERS_NOT_OBSERVED');
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
    // Observe the initial grant set and active validity without provider data.
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

beforeAll(async () => {
  const database = disposableDb();
  const runtime = await systemQuery(db.raw(`SELECT current_database() AS database,
    current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`));
  expect(runtime.rows).toEqual([{ database, role: 'sf_app', rolsuper: false, rolbypassrls: false }]);
  const rls = await systemQuery(db.raw(`SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class WHERE oid IN ('public.shops'::regclass, 'public.users'::regclass,
      'public.shop_memberships'::regclass)`));
  expect(rls.rows.length).toBe(3);
  expect(rls.rows.every((row: any) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  if (!process.env.PGMIGRATION_USER || process.env.PGMIGRATION_USER === 'sf_app') {
    throw new Error('D08_CONCURRENCY_READ_ONLY_OBSERVER_ROLE_REQUIRED');
  }
  observer = knexFactory({ client: 'pg', connection: {
    host: process.env.PGHOST, port: Number(process.env.PGPORT), database,
    user: process.env.PGMIGRATION_USER, password: String(process.env.PGMIGRATION_PASSWORD || ''),
    connectionTimeoutMillis: 2_000,
    options: '-c default_transaction_read_only=on -c statement_timeout=2000',
  }, pool: { min: 0, max: 1 } });
  const identity = await observer.raw(`SELECT current_database() AS database,
    current_setting('transaction_read_only') AS read_only`);
  expect(identity.rows).toEqual([{ database, read_only: 'on' }]);
  Object.assign(process.env, { SHOPIFY_API_SECRET: 'd08-concurrency-secret',
    SHOPIFY_API_KEY: 'd08-concurrency-key', API_URL: 'https://api.d08-concurrency.example' });
  transport = jest.fn(async () => { throw new Error('D08_CONCURRENCY_FETCH_FORBIDDEN'); });
  global.fetch = transport;
  // Also block direct HTTPS transports (including the Stripe SDK). Supertest's
  // loopback HTTP and the real PostgreSQL sockets are unaffected.
  httpsRequest = jest.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('D08_CONCURRENCY_HTTPS_FORBIDDEN');
  });
  httpsGet = jest.spyOn(https, 'get').mockImplementation(() => {
    throw new Error('D08_CONCURRENCY_HTTPS_FORBIDDEN');
  });
});

afterAll(async () => {
  try {
    // allSettled ensures both pools close even if one destroy rejects.
    const results = await Promise.allSettled([observer?.destroy(), db.destroy()]);
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
  } finally {
    httpsRequest?.mockRestore();
    httpsGet?.mockRestore();
    global.fetch = savedFetch;
    for (const key of envKeys) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

it('D08-CONCURRENCY-01 — two exact-lock waiters both redirect with one original provisioned tenant', async () => {
  // Already canonical, lowercase myshopify hostname: the controller normalizes
  // this to the identical key. Never reuse a previously provisioned fixture.
  const domain = `d08-race-${crypto.randomBytes(12).toString('hex')}.myshopify.com`;
  expect(await tenantIds(domain)).toEqual([]);
  expect((await resolveAuthUserByEmail(ghostEmail(domain))) === null).toBe(true);
  expect((await oauthRows(domain)).length).toBe(0);
  expect((await exactLockRows(domain)).length).toBe(0);

  const blocker = new Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT),
    database: disposableDb(), user: 'sf_app', password: String(process.env.PGPASSWORD || ''),
    connectionTimeoutMillis: 2_000, statement_timeout: 2_000 });
  let connected = false;
  const requests: Tracked[] = [];
  let outcomes: Outcome[] = [];
  let releasedAt = 0;
  try {
    await blocker.connect();
    connected = true;
    const identity = await blocker.query(`SELECT current_database() AS database,
      current_user AS role, rolsuper, rolbypassrls, pg_backend_pid() AS pid
      FROM pg_roles WHERE rolname = current_user`);
    expect(identity.rows.length).toBe(1);
    expect(identity.rows[0]).toMatchObject({ database: disposableDb(), role: 'sf_app',
      rolsuper: false, rolbypassrls: false });
    const blockerPid = Number(identity.rows[0].pid);
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [LOCK_NAMESPACE, domain]);
    requireVisibleHolder(await exactLockRows(domain), blockerPid);

    requests.push(dispatch(domain));
    requests.push(dispatch(domain));
    await waitForTwoWaiters(domain, blockerPid, requests);
    // No install may have committed tenant/owner/state while BOTH requests wait.
    expect(await tenantIds(domain)).toEqual([]);
    expect((await resolveAuthUserByEmail(ghostEmail(domain))) === null).toBe(true);
    expect((await oauthRows(domain)).length).toBe(0);
  } finally {
    // The transaction contains only the lock. Always release it, including on
    // observation/assertion failures; ending the dedicated connection is a
    // second release guarantee if ROLLBACK itself fails. Drain both requests
    // before test teardown, with their original HTTP deadlines and no retries.
    try {
      releasedAt = Date.now();
      if (connected) await blocker.query('ROLLBACK');
    } finally {
      try { await blocker.end(); }
      finally { outcomes = await Promise.all(requests.map(req => req.result)); }
    }
  }
  const completedAt = Date.now();
  expect(outcomes.length).toBe(2);
  expect(outcomes.every(outcome => outcome.ok)).toBe(true);
  const responses = outcomes.map(outcome => {
    if (!outcome.ok) throw new Error('D08_CONCURRENCY_HTTP_TRANSPORT_FAILURE');
    return outcome.response;
  });
  // Strict 2/2 contract: no success filtering, fallback, or request retry.
  expect(responses.map(response => response.status)).toEqual([302, 302]);

  const tenantRoots = await tenantIds(domain);
  expect(tenantRoots).toHaveLength(1);
  const owner = await resolveAuthUserByEmail(ghostEmail(domain));
  // Never pass a resolver row (which contains a password hash) to expect/logging.
  expect(owner !== null).toBe(true);
  if (!owner) throw new Error('D08_CONCURRENCY_OWNER_MISSING');
  const fixture = { domain, shopId: Number(owner.shop_id), userId: Number(owner.id) };
  expect(tenantRoots).toEqual([fixture.shopId]);
  const p = await validProvisioning(fixture);
  const trialEnd = new Date(p.subscriptions[0].trial_ends_at).getTime();
  expect(trialEnd).toBeGreaterThanOrEqual(releasedAt + 14 * 24 * 60 * 60 * 1000);
  expect(trialEnd).toBeLessThanOrEqual(completedAt + 14 * 24 * 60 * 60 * 1000);
  // All initial grants must still be the sole canonical Growth grant set.
  const totals = await withTenant(fixture.shopId, async trx => ({
    grants: await trx('shop_module_entitlements').where({ shop_id: fixture.shopId }).select('id'),
    transitions: await trx('shop_subscription_transitions').where({ shop_id: fixture.shopId }).select('id'),
  }));
  expect(totals.grants.length).toBe(p.grants.length);
  expect(totals.transitions.length).toBe(1);

  const rows = await oauthRows(domain);
  expect(rows.length).toBe(2); // lengths/booleans keep state values out of failures
  const states = responses.map(response => {
    let url: URL;
    try { url = new URL(String(response.headers.location)); }
    catch { throw new Error('D08_CONCURRENCY_INVALID_AUTHORIZATION_URL'); }
    expect(url.origin).toBe(`https://${domain}`);
    expect(url.pathname).toBe('/admin/oauth/authorize');
    expect(url.searchParams.get('client_id') === process.env.SHOPIFY_API_KEY).toBe(true);
    expect(url.searchParams.get('redirect_uri') ===
      `${process.env.API_URL}/api/v1/integrations/oauth/callback/shopify`).toBe(true);
    expect(url.searchParams.get('scope')?.split(',').sort()).toEqual(
      SHOPIFY_REQUIRED_SCOPE_STRING.split(',').sort());
    const state = url.searchParams.get('state');
    expect(typeof state === 'string' && state.length > 0).toBe(true);
    const matches = rows.filter((row: any) => row.state === state);
    expect(matches.length).toBe(1);
    expect(Number(matches[0].user_id)).toBe(fixture.userId);
    expect(matches[0].shop_domain).toBe(domain);
    expect(matches[0].install_source).toBe('app_store');
    expect(new Date(matches[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    return state;
  });
  expect(new Set(states).size).toBe(2);
  expect(new Set(rows.map((row: any) => row.state)).size).toBe(2);
  expect(rows.every((row: any) => Number(row.user_id) === fixture.userId
    && row.shop_domain === domain && row.install_source === 'app_store')).toBe(true);
  expect(await tenantIds(domain, fixture.shopId)).toEqual([fixture.shopId]);
  expect((await exactLockRows(domain)).length).toBe(0);
  expect((axios as unknown as jest.Mock).mock.calls.length).toBe(0);
  expect(transport.mock.calls.length).toBe(0);
  expect(httpsRequest!.mock.calls.length).toBe(0);
  expect(httpsGet!.mock.calls.length).toBe(0);
}, 40_000);
