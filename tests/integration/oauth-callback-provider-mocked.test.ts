/**
 * SHOP-REVIEW-OAUTH-REGRESSION-162 — Slice 162B.
 *
 * Provider-mocked, disposable-DB integration coverage for the CURRENT Shopify
 * OAuth callback / token-exchange path (`handleOAuthCallback`,
 * GET /api/v1/integrations/oauth/callback/:platform).
 *
 * Historical note: session-based callback unit tests
 * (tests/unit/api/integration.controller*.test.ts) were deleted at 1d32f58c and
 * targeted a pre-refactor, session-CSRF, pre-canonical-scope controller with no
 * DB-backed `integration_oauth_states`, no `shopify_app_installations` single
 * source of truth, and no `integration/sync_requested` emission. This slice does
 * NOT resurrect them — it drives the rewritten stateless DB-backed callback
 * through the real Express app against a disposable synchroflow_test_* database,
 * with only the Shopify network boundary mocked.
 *
 * Anti-duplication:
 *  - the `integrations` row is NEVER hand-inserted — it is created by the real
 *    callback;
 *  - WMS provisioning idempotency is owned by FRESH-INSTALL-03 and not re-asserted;
 *  - the pure scope-normalizer matrix is owned by Slice 162A and not repeated —
 *    only the callback's wiring/fail-closed behaviour around it is exercised.
 *
 * User states protected: S1 (REVIEWER_FRESH), S3 (PRE_OAUTH_FT_MINUS_ONE),
 * S6 (RECONNECT_REINSTALL).
 */

// --- Shopify network boundary: axios is mocked at module scope. Every expected
//     axios.post is configured per-test; any other URL rejects so no provider
//     HTTP call can silently escape to the network. ---
jest.mock('axios', () => {
  const post = jest.fn();
  const get = jest.fn();
  const inst: Record<string, unknown> = {
    post,
    get,
    request: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  const callable = jest.fn();
  Object.assign(callable, inst, {
    create: jest.fn(() => inst),
    // Real axios sets `isAxiosError: true` on its errors; `safeProviderError`
    // in the controller narrows on this. Keep the mock's predicate faithful.
    isAxiosError: (p: unknown) =>
      !!(p && typeof p === 'object' && (p as { isAxiosError?: unknown }).isAxiosError === true),
  });
  return { __esModule: true, default: callable };
});

import crypto from 'crypto';
import request from 'supertest';
import axios from 'axios';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { SHOPIFY_REQUIRED_SCOPES } from 'api-src/services/shopify/shopifyScopes';
import { decrypt } from 'api-src/security/encryption.service';

const app = createApp();

const axiosPost = (axios as unknown as { post: jest.Mock }).post;
const axiosGet = (axios as unknown as { get: jest.Mock }).get;

const TOKEN_URL_FRAGMENT = '/admin/oauth/access_token';
const GRAPHQL_URL_FRAGMENT = '/graphql.json';

// Partner billing uses fetch; keep the resolver and persistence real.
const PARTNER_GRAPHQL_URL = 'https://partners.shopify.com/123/api/2026-07/graphql.json';
const realFetch = global.fetch;
let billingFetch: jest.Mock;
const fixtureShops = new Map<string, number>();
const adminUrl = (domain: string) => `https://${domain}/admin/api/2024-01/graphql.json`;
let rejectAdminForShop: number | undefined;
let adminObservations: { url: string; canonicalAccess: boolean }[];
let savedAppBaseUrl: string | undefined;

/** The effective normalized 10-scope grant the callback must persist. */
const EFFECTIVE_SCOPES_SORTED = [...SHOPIFY_REQUIRED_SCOPES].sort().join(',');
const FULL_GRANT_STRING = [...SHOPIFY_REQUIRED_SCOPES].join(',');
const GRANT_WITHOUT_READ_LOCATIONS = SHOPIFY_REQUIRED_SCOPES.filter(
  (s) => s !== 'read_locations',
).join(',');

const SHOP_GID = 'gid://shopify/Shop/999001';

// Slice 162C redaction sentinels — must never surface in any captured log.
const SENTINEL_CLIENT_SECRET = 'SENTINEL_CLIENT_SECRET_162C';
const SENTINEL_OAUTH_CODE = 'SENTINEL_OAUTH_CODE_162C';
const SENTINEL_ADMIN_TOKEN = 'SENTINEL_ADMIN_TOKEN_162C';

/** Canonicalise captured console.* arguments to a single searchable string. */
function stringifyArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
function canonicaliseCalls(calls: unknown[][]): string {
  return calls.map((args) => args.map(stringifyArg).join(' ')).join('\n');
}

/**
 * Program axios.post for one callback invocation.
 *  - `token`   : resolve/reject the `/admin/oauth/access_token` call
 *  - `graphql` : resolve/reject the `/graphql.json` identity lookup (optional —
 *                only reached when a token is returned)
 * Any other URL rejects with a network-escape guard.
 */
function programAxios(plan: {
  token?: { resolve?: unknown; reject?: unknown };
  graphql?: { resolve?: unknown; reject?: unknown };
}) {
  axiosPost.mockReset();
  axiosGet.mockReset();
  axiosPost.mockImplementation(async (url: unknown) => {
    if (typeof url === 'string' && url.includes(TOKEN_URL_FRAGMENT)) {
      if (plan.token?.reject !== undefined) throw plan.token.reject;
      if (plan.token) return plan.token.resolve;
      throw new Error(`UNMOCKED_TOKEN_CALL:${url}`);
    }
    if (typeof url === 'string' && url.includes(GRAPHQL_URL_FRAGMENT)) {
      if (plan.graphql?.reject !== undefined) throw plan.graphql.reject;
      if (plan.graphql) return plan.graphql.resolve;
      throw new Error(`UNMOCKED_GRAPHQL_CALL:${url}`);
    }
    throw new Error(`PROVIDER_NETWORK_ESCAPE_BLOCKED:${String(url)}`);
  });
}

const ROTATING_TOKEN_DEFAULTS = {
  refresh_token: 'fake-shopify-refresh-token-default',
  expires_in: 86400,
  refresh_token_expires_in: 2592000,
};

function tokenOk(
  accessToken: string,
  scope: string,
  refreshToken = ROTATING_TOKEN_DEFAULTS.refresh_token,
) {
  return {
    resolve: {
      data: {
        ...ROTATING_TOKEN_DEFAULTS,
        access_token: accessToken,
        refresh_token: refreshToken,
        scope,
      },
    },
  };
}
function graphqlOk(shopDomain: string) {
  return {
    resolve: {
      data: {
        data: {
          shop: {
            id: SHOP_GID,
            currencyCode: 'USD',
            name: 'Provider Mocked Store',
            // Distinct per shop — real stores have distinct contact emails; a
            // shared value would collide on users_email_unique during the
            // (non-fatal) ghost-identity backfill.
            contactEmail: `owner+${shopDomain}@provider-mocked.example`,
            ianaTimezone: 'UTC',
          },
        },
      },
    },
  };
}

/** Fresh HMAC install — the established installFreshShop pattern (S3). */
async function installFreshShop(shopDomain: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key as keyof typeof params]}`)
    .join('&');
  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  const install = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ ...params, hmac })
    .redirects(0);

  expect(install.status).toBe(302);

  const ghostEmail = `shopify-install+${shopDomain}@lasyncro.internal`;
  const ghostLookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [ghostEmail]),
  );
  const ghostUser = ghostLookup.rows?.[0]?.value;
  expect(ghostUser).toBeTruthy();

  fixtureShops.set(adminUrl(shopDomain), ghostUser.shop_id as number);
  return {
    shopId: ghostUser.shop_id as number,
    userId: ghostUser.id as number,
    shopDomain,
  };
}

async function readOAuthState(userId: number): Promise<string> {
  const row = await systemQuery(
    db('integration_oauth_states')
      .where({ user_id: userId, platform: 'shopify' })
      .orderBy('id', 'desc')
      .first(),
  );
  const state = (row as { state?: string } | undefined)?.state;
  expect(typeof state).toBe('string');
  return state as string;
}

async function seedOAuthState(input: {
  userId: number;
  shopDomain: string;
  state: string;
  installSource?: 'app_store' | 'reconnect';
}) {
  await systemQuery(
    db('integration_oauth_states').insert({
      user_id: input.userId,
      platform: 'shopify',
      state: input.state,
      shop_domain: input.shopDomain,
      install_source: input.installSource ?? 'app_store',
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    }),
  );
}

function callback(query: Record<string, string>) {
  return request(app)
    .get('/api/v1/integrations/oauth/callback/shopify')
    .query(query)
    .redirects(0);
}

/** Fixture-scoped counts. */
async function counts(shopId: number) {
  const one = async (
    table: string,
    where: Record<string, unknown> = { shop_id: shopId },
  ) => {
    const row = await withTenant(shopId, (trx) =>
      trx(table).where(where).count<{ count: string }>('* as count').first(),
    );
    return Number(row?.count ?? 0);
  };
  return {
    shops: await one('shops', { id: shopId }),
    integrationsShopify: await one('integrations', {
      shop_id: shopId,
      platform: 'shopify',
    }),
    installations: await one('shopify_app_installations'),
    warehouses: await one('warehouses'),
    warehouseLocations: await one('warehouse_locations'),
    binLocations: await one('warehouse_locations', {
      shop_id: shopId,
      type: 'bin',
    }),
    products: await one('products'),
    variants: await one('variants'),
    orders: await one('orders'),
    customers: await one('customers'),
  };
}

async function oauthStateRows(state: string) {
  const rows = (await systemQuery(
    db('integration_oauth_states').where({ platform: 'shopify', state }),
  )) as unknown[];
  return rows.length;
}

async function firstWarehouseLocation(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('warehouse_locations').where({ shop_id: shopId }).first(),
  );
}

async function syncRequestedEvents(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId, event_type: 'integration/sync_requested' })
      .select('id', 'event_payload')
      .orderBy('id', 'asc'),
  );
}

async function outboxRowsForEvent(shopId: number, domainEventId: number) {
  return withTenant(shopId, (trx) =>
    trx('domain_event_outbox').where({ domain_event_id: domainEventId }).select('id'),
  );
}

jest.setTimeout(120_000);

describe('SHOP-REVIEW-OAUTH-REGRESSION-162 — OAuth callback (provider-mocked, disposable DB)', () => {
  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET =
      process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY =
      process.env.SHOPIFY_API_KEY || 'test_shopify_key';
    process.env.API_URL = process.env.API_URL || 'https://api.test';
    process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret';
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789abcdef';

    process.env.SHOPIFY_PARTNER_ORG_ID = '123';
    process.env.SHOPIFY_APP_GID = 'gid://shopify/App/320563019777';
    process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN = 'test-partner-token-not-real';
    billingFetch = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = billingFetch;

    savedAppBaseUrl = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://webhooks.provider-mocked.example';
  });

  beforeEach(() => {
    billingFetch.mockReset();
    fixtureShops.clear();
    adminObservations = [];
    rejectAdminForShop = undefined;
    billingFetch.mockImplementation(async (url: unknown, init: RequestInit) => {
      const href = String(url);
      if (href === PARTNER_GRAPHQL_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { activeSubscription: null } }),
        };
      }
      const shopId = fixtureShops.get(href);
      if (shopId === undefined) throw new Error(`PROVIDER_NETWORK_ESCAPE_BLOCKED:${href}`);
      // A separate DB transaction sees the committed canonical row at the
      // actual provider boundary; no resolver internals are mocked or spied on.
      const credential = await withTenant(shopId, trx =>
        trx('shopify_admin_credentials').where({ shop_id: shopId }).first());
      const access = new Headers(init.headers).get('X-Shopify-Access-Token');
      adminObservations.push({ url: href,
        canonicalAccess: !!credential && access === decrypt(credential.access_token_encrypted, 'shopify.dev') });
      if (rejectAdminForShop === shopId) throw new Error('A13_SYNTHETIC_WEBHOOK_PROVIDER_FAILURE');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { webhookSubscriptionCreate: {
          webhookSubscription: { id: 'gid://shopify/WebhookSubscription/999001' }, userErrors: [],
        } } }),
      };
    });
  });

  afterAll(() => {
    if (savedAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = savedAppBaseUrl;
    (global as unknown as { fetch: unknown }).fetch = realFetch;
  });

  afterEach(() => {
    // Safety net: prove no axios.post reached anything other than the two mocked
    // Shopify endpoints, and axios.get / callable-axios were never used.
    for (const call of axiosPost.mock.calls) {
      const url = String(call[0]);
      expect(
        url.includes(TOKEN_URL_FRAGMENT) || url.includes(GRAPHQL_URL_FRAGMENT),
      ).toBe(true);
    }
    expect(axiosGet).not.toHaveBeenCalled();
    for (const call of billingFetch.mock.calls) {
      const href = String(call[0]);
      if (href === PARTNER_GRAPHQL_URL) {
        expect(href).toBe(PARTNER_GRAPHQL_URL);
      } else {
        expect(fixtureShops.has(href)).toBe(true);
        const init = call[1] as RequestInit;
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body)).query).toContain('webhookSubscriptionCreate');
      }
    }
    const adminCalls = billingFetch.mock.calls.filter(call => String(call[0]) !== PARTNER_GRAPHQL_URL);
    expect(adminObservations).toHaveLength(adminCalls.length);
    for (const observed of adminObservations) {
      expect(observed.canonicalAccess).toBe(true);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Happy path — S3 -> S1
  // ─────────────────────────────────────────────────────────────────────────
  it('S3 -> S1: a valid callback exchanges the token, persists the integration + installation, burns the state, and emits integration/sync_requested — root-only shape unchanged', async () => {
    const shopDomain = `oauth-cb-happy-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);

    // --- S3 pre-callback fixture (truthful, install-endpoint produced) ---
    const before = await counts(shopId);
    expect(before.shops).toBe(1);
    expect(before.warehouses).toBe(1);
    expect(before.warehouseLocations).toBe(1);
    expect(before.binLocations).toBe(0);
    expect((await firstWarehouseLocation(shopId))?.type).toBe('warehouse');
    expect(before.integrationsShopify).toBe(0);
    expect(before.installations).toBe(0);
    expect(before.products).toBe(0);
    expect(before.variants).toBe(0);
    expect(before.orders).toBe(0);
    expect(before.customers).toBe(0);
    expect(await oauthStateRows(state)).toBe(1);

    programAxios({
      token: tokenOk('fake-shopify-access-token-happy', FULL_GRANT_STRING),
      graphql: graphqlOk(shopDomain),
    });

    const res = await callback({ code: 'fake-oauth-code', state, shop: shopDomain });

    // --- HTTP ---
    expect(res.status).toBe(302);
    const location = String(res.headers.location);
    expect(location.startsWith(process.env.FRONTEND_URL!)).toBe(true);
    const q = new URL(location).searchParams;
    expect(q.get('connect')).toBe('app_store');
    expect((q.get('token') ?? '').length).toBeGreaterThan(0);

    // --- integrations persistence ---
    const integration = await withTenant(shopId, (trx) =>
      trx('integrations').where({ shop_id: shopId, platform: 'shopify' }).first(),
    );
    expect(integration).toBeTruthy();
    expect(integration.platform_shop_name).toBe(shopDomain);

    // --- shopify_app_installations ---
    const install = await withTenant(shopId, (trx) =>
      trx('shopify_app_installations').where({ shop_id: shopId }).first(),
    );
    expect(install).toBeTruthy();
    expect(install.shop_domain).toBe(shopDomain);
    expect(install.shop_gid).toBe(SHOP_GID);
    expect(install.scopes).toBe(EFFECTIVE_SCOPES_SORTED);
    expect(install.scopes.split(',')).toContain('read_locations');
    expect(install.uninstalled_at).toBeNull();

    // --- OAuth state consumed ---
    expect(await oauthStateRows(state)).toBe(0);

    // --- sync_requested event + owned outbox row ---
    const events = await syncRequestedEvents(shopId);
    expect(events).toHaveLength(1);
    expect(Number(events[0].event_payload.integration_id)).toBe(
      Number(integration.id),
    );
    expect(await outboxRowsForEvent(shopId, Number(events[0].id))).toHaveLength(1);

    // --- S1 lock: root-only, no bins, no operational data ---
    const after = await counts(shopId);
    expect(after.shops).toBe(1);
    expect(after.integrationsShopify).toBe(1);
    expect(after.installations).toBe(1);
    expect(after.warehouses).toBe(1);
    expect(after.warehouseLocations).toBe(1);
    expect(after.binLocations).toBe(0);
    expect((await firstWarehouseLocation(shopId))?.type).toBe('warehouse');
    expect(after.products).toBe(0);
    expect(after.variants).toBe(0);
    expect(after.orders).toBe(0);
    expect(after.customers).toBe(0);

    const adminCalls = billingFetch.mock.calls.filter(call => String(call[0]) === adminUrl(shopDomain));
    expect(adminCalls.length).toBeGreaterThan(0);
    expect(adminObservations.length).toBeGreaterThan(0);
    for (const call of adminCalls) {
      expect(new Headers(call[1].headers).get('X-Shopify-Access-Token') === 'fake-shopify-access-token-happy').toBe(true);
    }
    expect(axiosPost.mock.calls.filter(call => call[1]?.grant_type === 'refresh_token')).toHaveLength(0);
  });

  it('A13: failed post-OAuth Admin webhook registration preserves committed credentials, state burn, sync, JWT and redirect', async () => {
    const shopDomain = `oauth-cb-a13-nonfatal-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);
    const accessToken = 'A13_NONFATAL_CANONICAL_ACCESS';
    const refreshToken = 'A13_NONFATAL_CANONICAL_REFRESH';
    programAxios({ token: tokenOk(accessToken, FULL_GRANT_STRING, refreshToken), graphql: graphqlOk(shopDomain) });
    rejectAdminForShop = shopId;
    const logs: unknown[][] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => { logs.push(args); }));
    try {
      const res = await callback({ code: 'fake-oauth-code-a13', state, shop: shopDomain });
      expect(res.status).toBe(302);
      const location = String(res.headers.location);
      expect(location.startsWith(process.env.FRONTEND_URL!)).toBe(true);
      const params = new URL(location).searchParams;
      expect(params.get('connect')).toBe('app_store');
      expect((params.get('token') ?? '').length).toBeGreaterThan(0);
      expect(res.headers['set-cookie'].some((cookie: string) => cookie.startsWith('refreshToken='))).toBe(true);
      expect(await oauthStateRows(state)).toBe(0);
      const integration = await withTenant(shopId, trx =>
        trx('integrations').where({ shop_id: shopId, platform: 'shopify' }).first());
      expect(integration).toBeTruthy();
      const installation = await withTenant(shopId, trx =>
        trx('shopify_app_installations').where({ shop_id: shopId }).first());
      expect(installation).toBeTruthy();
      expect(installation.uninstalled_at).toBeNull();
      const credentials = await withTenant(shopId, trx =>
        trx('shopify_admin_credentials').where({ shop_id: shopId }).select('*'));
      expect(credentials).toHaveLength(1);
      expect(credentials[0].installation_id).toBe(installation.id);
      expect(decrypt(credentials[0].access_token_encrypted, 'shopify.dev') === accessToken).toBe(true);
      expect(decrypt(credentials[0].refresh_token_encrypted, 'shopify.dev') === refreshToken).toBe(true);
      const persisted = await counts(shopId);
      expect(persisted.integrationsShopify).toBe(1);
      expect(persisted.installations).toBe(1);
      const events = await syncRequestedEvents(shopId);
      expect(events).toHaveLength(1);
      expect(Number(events[0].event_payload.integration_id)).toBe(Number(integration.id));
      expect(await outboxRowsForEvent(shopId, Number(events[0].id))).toHaveLength(1);
      expect(logs.some(args => args[0] === '[SYNC_JOB_ENQUEUED]' &&
        (args[1] as { integrationId?: number })?.integrationId === integration.id)).toBe(true);
      expect(billingFetch.mock.calls.some(call => String(call[0]) === PARTNER_GRAPHQL_URL)).toBe(true);
      expect(billingFetch.mock.calls.filter(call => String(call[0]) === adminUrl(shopDomain))).toHaveLength(1);
      expect(adminObservations).toHaveLength(1);
      expect(logs.some(args => args[0] === '[SHOPIFY_WEBHOOK_REGISTRATION_FAILED_NON_FATAL]' &&
        (args[1] as { error?: string })?.error === 'A13_SYNTHETIC_WEBHOOK_PROVIDER_FAILURE')).toBe(true);
      expect(axiosPost.mock.calls.filter(call => call[1]?.grant_type === 'refresh_token')).toHaveLength(0);
      const publicAndLogs = canonicaliseCalls(logs) + JSON.stringify({ body: res.body, headers: res.headers });
      for (const secret of [accessToken, refreshToken, credentials[0].access_token_encrypted, credentials[0].refresh_token_encrypted]) {
        expect(publicAndLogs.includes(secret)).toBe(false);
      }
    } finally {
      spies.forEach(spy => spy.mockRestore());
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // A. Token endpoint non-2xx
  // ─────────────────────────────────────────────────────────────────────────
  it('A: token endpoint failure -> 502, no integration/installation persisted, state already burned', async () => {
    const shopDomain = `oauth-cb-tokenfail-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);

    programAxios({ token: { reject: new Error('Request failed with status code 500') } });

    const res = await callback({ code: 'fake-oauth-code', state, shop: shopDomain });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Failed to exchange OAuth token' });

    const c = await counts(shopId);
    expect(c.integrationsShopify).toBe(0);
    expect(c.installations).toBe(0);
    // CURRENT implementation: state is burned during validation, BEFORE token exchange.
    expect(await oauthStateRows(state)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B. Missing access_token in token response
  // ─────────────────────────────────────────────────────────────────────────
  it('B: token response without access_token -> 502, NO GraphQL identity call, no persistence, state burned (OBS-162B-1)', async () => {
    const shopDomain = `oauth-cb-noatoken-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);

    // No `graphql` mock — after OBS-162B-1 the identity lookup must not fire when
    // Shopify returned no access token.
    programAxios({ token: { resolve: { data: { ...ROTATING_TOKEN_DEFAULTS, scope: FULL_GRANT_STRING } } } });

    const res = await callback({ code: 'fake-oauth-code', state, shop: shopDomain });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Failed to exchange OAuth token' });

    // Exactly one axios.post — the token endpoint — and never `/graphql.json`.
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(String(axiosPost.mock.calls[0][0])).toContain(TOKEN_URL_FRAGMENT);
    for (const call of axiosPost.mock.calls) {
      expect(String(call[0])).not.toContain(GRAPHQL_URL_FRAGMENT);
    }

    const c = await counts(shopId);
    expect(c.integrationsShopify).toBe(0);
    expect(c.installations).toBe(0);
    expect(await oauthStateRows(state)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // C. Missing read_locations (fail-closed scope enforcement in the callback)
  // ─────────────────────────────────────────────────────────────────────────
  it('C: grant missing only read_locations -> 403 insufficient-permissions, SECURITY audit names read_locations, NO GraphQL call, no partial state (OBS-162B-2)', async () => {
    const shopDomain = `oauth-cb-noloc-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);

    // No `graphql` mock — scope validation fails before the identity lookup.
    programAxios({
      token: {
        resolve: {
          data: {
            ...ROTATING_TOKEN_DEFAULTS,
            access_token: 'fake-shopify-access-token-noloc',
            scope: GRANT_WITHOUT_READ_LOCATIONS,
          },
        },
      },
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await callback({ code: 'fake-oauth-code', state, shop: shopDomain });
    const auditLines = logSpy.mock.calls
      .filter((a) => a[0] === '[AUDIT]')
      .map((a) => String(a[1]));
    logSpy.mockRestore();

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Shopify did not grant all required permissions',
    });
    // The HTTP response must not leak the internal missing-scope names.
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('read_locations');
    expect(bodyStr).not.toContain('SHOPIFY_REQUIRED_SCOPES_MISSING');

    const insufficient = auditLines.filter((l) =>
      l.includes('"event":"oauth_scopes_insufficient"'),
    );
    expect(insufficient).toHaveLength(1);
    const audited = JSON.parse(insufficient[0]);
    expect(audited.level).toBe('SECURITY');
    expect(audited.userId).toBe(userId);
    expect(audited.metadata.platform).toBe('shopify');
    expect(audited.metadata.reason).toBe('required_scopes_missing');
    expect(audited.metadata.missing).toEqual(['read_locations']);

    // Identity endpoint never touched.
    for (const call of axiosPost.mock.calls) {
      expect(String(call[0])).not.toContain(GRAPHQL_URL_FRAGMENT);
    }

    const c = await counts(shopId);
    expect(c.integrationsShopify).toBe(0);
    expect(c.installations).toBe(0);
    expect(await oauthStateRows(state)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // C2. Empty / missing granted-scope value (route-level, OBS-162B-2)
  // ─────────────────────────────────────────────────────────────────────────
  it('C2: token response with an empty scope string -> same 403 public contract, SECURITY audit distinguishes the missing/empty grant, no GraphQL call, no partial state', async () => {
    const shopDomain = `oauth-cb-noscope-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);

    programAxios({
      token: {
        resolve: {
          data: { ...ROTATING_TOKEN_DEFAULTS, access_token: 'fake-shopify-access-token-noscope', scope: '' },
        },
      },
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await callback({ code: 'fake-oauth-code', state, shop: shopDomain });
    const auditLines = logSpy.mock.calls
      .filter((a) => a[0] === '[AUDIT]')
      .map((a) => String(a[1]));
    logSpy.mockRestore();

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Shopify did not grant all required permissions',
    });

    const insufficient = auditLines.filter((l) =>
      l.includes('"event":"oauth_scopes_insufficient"'),
    );
    expect(insufficient).toHaveLength(1);
    const audited = JSON.parse(insufficient[0]);
    expect(audited.level).toBe('SECURITY');
    expect(audited.metadata.reason).toBe('no_granted_scopes');
    // No fabricated missing-scope list for an empty grant.
    expect(audited.metadata.missing).toBeUndefined();

    for (const call of axiosPost.mock.calls) {
      expect(String(call[0])).not.toContain(GRAPHQL_URL_FRAGMENT);
    }

    const c = await counts(shopId);
    expect(c.integrationsShopify).toBe(0);
    expect(c.installations).toBe(0);
    expect(await oauthStateRows(state)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D. Unknown state
  // ─────────────────────────────────────────────────────────────────────────
  it('D: unknown state -> 403, no persistence, the legitimate state is untouched', async () => {
    const shopDomain = `oauth-cb-unknown-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const realState = await readOAuthState(userId);

    // No axios call is expected — validation rejects before token exchange.
    programAxios({});

    const res = await callback({
      code: 'fake-oauth-code',
      state: `does-not-exist-${Date.now()}`,
      shop: shopDomain,
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Invalid or reused OAuth state' });
    expect(axiosPost).not.toHaveBeenCalled();

    const c = await counts(shopId);
    expect(c.integrationsShopify).toBe(0);
    expect(c.installations).toBe(0);
    // The real state seeded by the install endpoint is still present/unconsumed.
    expect(await oauthStateRows(realState)).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // E. Burned state (replay)
  // ─────────────────────────────────────────────────────────────────────────
  it('E: replaying a burned state -> 403, no duplicate persistence', async () => {
    const shopDomain = `oauth-cb-replay-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);

    programAxios({
      token: {
        resolve: {
          data: {
            ...ROTATING_TOKEN_DEFAULTS,
            access_token: 'fake-shopify-access-token-replay',
            scope: FULL_GRANT_STRING,
          },
        },
      },
      graphql: graphqlOk(shopDomain),
    });

    const first = await callback({ code: 'fake-oauth-code', state, shop: shopDomain });
    expect(first.status).toBe(302);
    expect(await oauthStateRows(state)).toBe(0);

    const afterFirst = await counts(shopId);
    expect(afterFirst.integrationsShopify).toBe(1);
    expect(afterFirst.installations).toBe(1);

    const replay = await callback({ code: 'fake-oauth-code', state, shop: shopDomain });
    expect(replay.status).toBe(403);
    expect(replay.body).toEqual({ error: 'Invalid or reused OAuth state' });

    const afterReplay = await counts(shopId);
    expect(afterReplay.integrationsShopify).toBe(1);
    expect(afterReplay.installations).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // S6 — reconnect / reinstall: a second valid callback MERGES, never duplicates
  // ─────────────────────────────────────────────────────────────────────────
  it('S6: a second valid callback for the same shop merges the integration + installation metadata (uninstalled_at cleared, scopes refreshed) and emits a second sync_requested — no tenant/warehouse duplication', async () => {
    const shopDomain = `oauth-cb-reconnect-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state1 = await readOAuthState(userId);

    programAxios({
      token: {
        resolve: {
          data: {
            ...ROTATING_TOKEN_DEFAULTS,
            access_token: 'fake-shopify-access-token-first',
            scope: FULL_GRANT_STRING,
          },
        },
      },
      graphql: graphqlOk(shopDomain),
    });
    const first = await callback({ code: 'fake-oauth-code', state: state1, shop: shopDomain });
    expect(first.status).toBe(302);

    const installAfterFirst = await withTenant(shopId, (trx) =>
      trx('shopify_app_installations').where({ shop_id: shopId }).first(),
    );
    expect(installAfterFirst.uninstalled_at).toBeNull();
    // Simulate a prior uninstall so the merge's uninstalled_at clear is exercised.
    await withTenant(shopId, (trx) =>
      trx('shopify_app_installations')
        .where({ shop_id: shopId })
        .update({ uninstalled_at: new Date() }),
    );

    // New valid state for the SAME user + shop_domain (reinstall through the
    // App Store entry).
    const state2 = `reconnect-state-${Date.now()}`;
    await seedOAuthState({ userId, shopDomain, state: state2, installSource: 'app_store' });

    programAxios({
      token: {
        resolve: {
          data: {
            ...ROTATING_TOKEN_DEFAULTS,
            access_token: 'fake-shopify-access-token-second',
            scope: FULL_GRANT_STRING,
          },
        },
      },
      graphql: graphqlOk(shopDomain),
    });
    const second = await callback({ code: 'fake-oauth-code-2', state: state2, shop: shopDomain });
    expect(second.status).toBe(302);

    // --- merge, not duplicate ---
    const c = await counts(shopId);
    expect(c.shops).toBe(1);
    expect(c.integrationsShopify).toBe(1);
    expect(c.installations).toBe(1);
    expect(c.warehouses).toBe(1);
    expect(c.warehouseLocations).toBe(1);
    expect(c.binLocations).toBe(0);

    const installAfterSecond = await withTenant(shopId, (trx) =>
      trx('shopify_app_installations').where({ shop_id: shopId }).first(),
    );
    expect(installAfterSecond.uninstalled_at).toBeNull();
    expect(installAfterSecond.scopes).toBe(EFFECTIVE_SCOPES_SORTED);
    // --- a second sync_requested event exists ---
    const events = await syncRequestedEvents(shopId);
    expect(events.length).toBe(2);
    for (const ev of events) {
      expect(await outboxRowsForEvent(shopId, Number(ev.id))).toHaveLength(1);
    }

    expect(await oauthStateRows(state1)).toBe(0);
    expect(await oauthStateRows(state2)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Redaction — OBS-162B-3
  // ─────────────────────────────────────────────────────────────────────────
  it('token-exchange failure: the raw Axios error (client_secret + OAuth code) never reaches console.error; safe diagnostics remain', async () => {
    const shopDomain = `oauth-cb-redact-token-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);

    const axiosError = Object.assign(
      new Error('Request failed with status code 400'),
      {
        isAxiosError: true,
        code: 'ERR_BAD_REQUEST',
        response: {
          status: 400,
          data: {
            error: 'invalid_request',
            error_description: `authorization code ${SENTINEL_OAUTH_CODE} rejected`,
          },
        },
        config: {
          url: `https://${shopDomain}/admin/oauth/access_token`,
          data: JSON.stringify({
            client_id: 'ci-key',
            client_secret: SENTINEL_CLIENT_SECRET,
            code: SENTINEL_OAUTH_CODE,
          }),
          headers: { 'Content-Type': 'application/json' },
        },
        request: {
          _header: `POST /admin/oauth/access_token HTTP/1.1\r\nbody=${SENTINEL_CLIENT_SECRET}`,
        },
      },
    );
    programAxios({ token: { reject: axiosError } });

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await callback({ code: SENTINEL_OAUTH_CODE, state, shop: shopDomain });
    const logged = canonicaliseCalls(errSpy.mock.calls);
    errSpy.mockRestore();

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Failed to exchange OAuth token' });

    for (const needle of [
      SENTINEL_CLIENT_SECRET,
      SENTINEL_OAUTH_CODE,
      'client_secret',
      'error_description',
      '_header',
      '"config"',
      '"request"',
    ]) {
      expect(logged).not.toContain(needle);
    }
    // Safe diagnostics survive.
    expect(logged).toContain('[OAuth] Token exchange failed');
    expect(logged).toContain('Request failed with status code 400');
    expect(logged).toContain('400');
    expect(logged).toContain('ERR_BAD_REQUEST');

    const c = await counts(shopId);
    expect(c.integrationsShopify).toBe(0);
    expect(c.installations).toBe(0);
  });

  it('identity/GID lookup failure fails closed before provider-state persistence and never leaks the merchant Admin token', async () => {
    const shopDomain = `oauth-cb-redact-gql-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);

    const gqlError = Object.assign(
      new Error('Request failed with status code 401'),
      {
        isAxiosError: true,
        code: 'ERR_BAD_REQUEST',
        response: { status: 401, data: { errors: [{ message: 'unauthorized' }] } },
        config: {
          url: `https://${shopDomain}/admin/api/2024-01/graphql.json`,
          data: JSON.stringify({ query: '{ shop { id } }' }),
          headers: {
            'X-Shopify-Access-Token': SENTINEL_ADMIN_TOKEN,
            'Content-Type': 'application/json',
          },
        },
      },
    );
    programAxios({
      token: {
        resolve: {
          data: { ...ROTATING_TOKEN_DEFAULTS, access_token: SENTINEL_ADMIN_TOKEN, scope: FULL_GRANT_STRING },
        },
      },
      graphql: { reject: gqlError },
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await callback({ code: 'fake-oauth-code', state, shop: shopDomain });
    const logged = canonicaliseCalls(warnSpy.mock.calls);
    warnSpy.mockRestore();

    // ARCH-04: canonical Shop GID is required installation infrastructure.
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Failed to verify Shopify shop identity' });

    for (const needle of [
      SENTINEL_ADMIN_TOKEN,
      'X-Shopify-Access-Token',
      '"headers"',
      '"config"',
      '"request"',
    ]) {
      expect(logged).not.toContain(needle);
    }
    expect(logged).toContain(
      '[OAuth] Failed to fetch Shopify currency/identity/GID',
    );
    expect(logged).toContain('401');

    // Failed identity verification must not persist provider state or finalize OAuth.
    const c = await counts(shopId);
    expect(c.integrationsShopify).toBe(0);
    expect(c.installations).toBe(0);
    const credentials = await withTenant(shopId, (trx) =>
      trx('shopify_admin_credentials').where({ shop_id: shopId }).select('id'),
    );
    expect(credentials).toHaveLength(0);
    expect(billingFetch).not.toHaveBeenCalled();
    expect(await syncRequestedEvents(shopId)).toHaveLength(0);
    expect(await oauthStateRows(state)).toBe(0);
  });

  // SHOP-REVIEW-AUTH-01 — RED-2: expiring offline acquisition only.
  it('requests an expiring offline Shopify credential during token exchange', async () => {
    const shopDomain = `oauth-cb-red2a-${Date.now()}.myshopify.com`;
    const { userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);
    programAxios({
      token: tokenOk('fake-shopify-expiring-access-red2a', FULL_GRANT_STRING),
      graphql: graphqlOk(shopDomain),
    });

    const res = await callback({ code: 'fake-oauth-code-red2a', state, shop: shopDomain });
    expect(res.status).toBe(302);
    const exchanges = axiosPost.mock.calls.filter(call =>
      String(call[0]) === `https://${shopDomain}/admin/oauth/access_token`);
    expect(exchanges).toHaveLength(1);
    const body = exchanges[0][1];
    // Check presence without exposing environment-supplied credentials.
    expect(typeof body.client_id).toBe('string');
    expect(body.client_id.length).toBeGreaterThan(0);
    expect(typeof body.client_secret).toBe('string');
    expect(body.client_secret.length).toBeGreaterThan(0);
    expect(body.code).toBe('fake-oauth-code-red2a');
    expect(body.expiring).toBe(1);
  });

  it('persists one complete canonical rotating credential pair for a successful OAuth grant', async () => {
    const shopDomain = `oauth-cb-red2b-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);
    const accessToken = 'fake-shopify-expiring-access-red2';
    const refreshToken = 'fake-shopify-expiring-refresh-red2';
    const grant = tokenOk(accessToken, FULL_GRANT_STRING, refreshToken);
    const beforeState = await counts(shopId);
    expect(beforeState.integrationsShopify).toBe(0);
    expect(beforeState.installations).toBe(0);
    const beforeCredentials = await withTenant(shopId, trx =>
      trx('shopify_admin_credentials').where({ shop_id: shopId }).select('*'));
    expect(beforeCredentials).toHaveLength(0);
    programAxios({ token: grant, graphql: graphqlOk(shopDomain) });

    const before = Date.now();
    const res = await callback({ code: 'fake-oauth-code-red2b', state, shop: shopDomain });
    const after = Date.now();
    expect(res.status).toBe(302);
    const installation = await withTenant(shopId, trx =>
      trx('shopify_app_installations').where({ shop_id: shopId }).first());
    expect(installation).toBeTruthy();
    const credentials = await withTenant(shopId, trx =>
      trx('shopify_admin_credentials').where({ shop_id: shopId }).select('*'));
    expect(credentials).toHaveLength(1);
    const credential = credentials[0];
    expect(credential.shop_id).toBe(shopId);
    expect(credential.installation_id).toBe(installation.id);
    for (const [encrypted, plaintext] of [
      [credential.access_token_encrypted, accessToken],
      [credential.refresh_token_encrypted, refreshToken],
    ]) {
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).not.toContain(plaintext);
      const payload = JSON.parse(encrypted);
      for (const field of ['ciphertext', 'iv', 'auth_tag']) {
        expect(typeof payload[field]).toBe('string');
        expect(payload[field].length).toBeGreaterThan(0);
      }
      expect(payload.key_version).toBe('v1');
      expect(decrypt(encrypted, 'shopify.dev')).toBe(plaintext);
    }
    expect(credential.granted_scopes).toBe(EFFECTIVE_SCOPES_SORTED);
    const toleranceMs = 2000;
    for (const [expiry, seconds] of [
      [credential.access_expires_at, grant.resolve.data.expires_in],
      [credential.refresh_expires_at, grant.resolve.data.refresh_token_expires_in],
    ] as const) {
      const timestamp = new Date(expiry).getTime();
      expect(Number.isFinite(timestamp)).toBe(true);
      expect(timestamp).toBeGreaterThanOrEqual(before + seconds * 1000 - toleranceMs);
      expect(timestamp).toBeLessThanOrEqual(after + seconds * 1000 + toleranceMs);
    }
  });

  it('fails closed when refresh_token is missing from an otherwise complete token response', async () => {
    const shopDomain = `oauth-cb-red2c-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);
    const complete = tokenOk('fake-shopify-expiring-access-red2c', FULL_GRANT_STRING);
    const { refresh_token: omitted, ...data } = complete.resolve.data;
    expect(omitted).toBeDefined();
    const beforeState = await counts(shopId);
    expect(beforeState.integrationsShopify).toBe(0);
    expect(beforeState.installations).toBe(0);
    const beforeCredentials = await withTenant(shopId, trx =>
      trx('shopify_admin_credentials').where({ shop_id: shopId }).select('id'));
    expect(beforeCredentials).toHaveLength(0);
    programAxios({
      token: { resolve: { data } },
      graphql: graphqlOk(shopDomain),
    });

    const res = await callback({ code: 'fake-oauth-code-red2c', state, shop: shopDomain });
    const afterState = await counts(shopId);
    const credentials = await withTenant(shopId, trx =>
      trx('shopify_admin_credentials').where({ shop_id: shopId }).select('id'));
    // Collect every boundary before asserting, so RED evidence includes HTTP,
    // identity lookup and all three fixture-scoped persistence surfaces.
    expect({
      status: res.status,
      body: res.body,
      adminGraphqlRequests: axiosPost.mock.calls.filter(call =>
        String(call[0]).includes(GRAPHQL_URL_FRAGMENT)).length,
      integrationsShopify: afterState.integrationsShopify,
      installations: afterState.installations,
      canonicalCredentials: credentials.length,
    }).toEqual({
      status: 502,
      body: { error: 'Failed to exchange OAuth token' },
      adminGraphqlRequests: 0,
      integrationsShopify: 0,
      installations: 0,
      canonicalCredentials: 0,
    });
  });

  it('fails closed when expires_in is missing from an otherwise complete rotating token response', async () => {
    const shopDomain = `oauth-cb-red2d-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);
    const complete = tokenOk('fake-shopify-expiring-access-red2d', FULL_GRANT_STRING);
    const { expires_in: omitted, ...data } = complete.resolve.data;
    expect(omitted).toBeDefined();
    const beforeState = await counts(shopId);
    expect(beforeState.integrationsShopify).toBe(0);
    expect(beforeState.installations).toBe(0);
    const beforeCredentials = await withTenant(shopId, trx =>
      trx('shopify_admin_credentials').where({ shop_id: shopId }).select('id'));
    expect(beforeCredentials).toHaveLength(0);
    programAxios({
      token: { resolve: { data } },
      graphql: graphqlOk(shopDomain),
    });

    const res = await callback({ code: 'fake-oauth-code-red2d', state, shop: shopDomain });
    const afterState = await counts(shopId);
    const credentials = await withTenant(shopId, trx =>
      trx('shopify_admin_credentials').where({ shop_id: shopId }).select('id'));
    // Collect every boundary before asserting, so RED evidence includes HTTP,
    // identity lookup and all three fixture-scoped persistence surfaces.
    expect({
      status: res.status,
      body: res.body,
      adminGraphqlRequests: axiosPost.mock.calls.filter(call =>
        String(call[0]).includes(GRAPHQL_URL_FRAGMENT)).length,
      integrationsShopify: afterState.integrationsShopify,
      installations: afterState.installations,
      canonicalCredentials: credentials.length,
    }).toEqual({
      status: 502,
      body: { error: 'Failed to exchange OAuth token' },
      adminGraphqlRequests: 0,
      integrationsShopify: 0,
      installations: 0,
      canonicalCredentials: 0,
    });
  });

  it('fails closed when refresh_token_expires_in is missing from an otherwise complete rotating token response', async () => {
    const shopDomain = `oauth-cb-red2e-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state = await readOAuthState(userId);
    const complete = tokenOk('fake-shopify-expiring-access-red2e', FULL_GRANT_STRING);
    const { refresh_token_expires_in: omitted, ...data } = complete.resolve.data;
    expect(omitted).toBeDefined();
    const beforeState = await counts(shopId);
    expect(beforeState.integrationsShopify).toBe(0);
    expect(beforeState.installations).toBe(0);
    const beforeCredentials = await withTenant(shopId, trx =>
      trx('shopify_admin_credentials').where({ shop_id: shopId }).select('id'));
    expect(beforeCredentials).toHaveLength(0);
    programAxios({
      token: { resolve: { data } },
      graphql: graphqlOk(shopDomain),
    });

    const res = await callback({ code: 'fake-oauth-code-red2e', state, shop: shopDomain });
    const afterState = await counts(shopId);
    const credentials = await withTenant(shopId, trx =>
      trx('shopify_admin_credentials').where({ shop_id: shopId }).select('id'));
    // Collect every boundary before asserting, so RED evidence includes HTTP,
    // identity lookup and all three fixture-scoped persistence surfaces.
    expect({
      status: res.status,
      body: res.body,
      adminGraphqlRequests: axiosPost.mock.calls.filter(call =>
        String(call[0]).includes(GRAPHQL_URL_FRAGMENT)).length,
      integrationsShopify: afterState.integrationsShopify,
      installations: afterState.installations,
      canonicalCredentials: credentials.length,
    }).toEqual({
      status: 502,
      body: { error: 'Failed to exchange OAuth token' },
      adminGraphqlRequests: 0,
      integrationsShopify: 0,
      installations: 0,
      canonicalCredentials: 0,
    });
  });
});
