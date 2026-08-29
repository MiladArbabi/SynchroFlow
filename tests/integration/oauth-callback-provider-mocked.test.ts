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
import { ShopifyAppService } from '@lasyncro/backend-core/services/shopify-app.service.js';
import { SHOPIFY_REQUIRED_SCOPES } from 'api-src/services/shopify/shopifyScopes';

const app = createApp();

const axiosPost = (axios as unknown as { post: jest.Mock }).post;
const axiosGet = (axios as unknown as { get: jest.Mock }).get;

const TOKEN_URL_FRAGMENT = '/admin/oauth/access_token';
const GRAPHQL_URL_FRAGMENT = '/graphql.json';

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

function tokenOk(accessToken: string, scope: string) {
  return { resolve: { data: { access_token: accessToken, scope } } };
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
  let completePostInstallationSpy: jest.SpyInstance;

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

    // Only external Shopify side effect on the callback happy path — webhook
    // registration. Neutralised; not under test here.
    completePostInstallationSpy = jest
      .spyOn(ShopifyAppService, 'completePostInstallation')
      .mockResolvedValue(undefined);
  });

  afterAll(() => {
    completePostInstallationSpy.mockRestore();
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
    expect(typeof integration.access_token_encrypted).toBe('string');
    expect(integration.access_token_encrypted.length).toBeGreaterThan(0);
    expect(integration.access_token_encrypted).not.toBe(
      'fake-shopify-access-token-happy',
    );

    // --- shopify_app_installations ---
    const install = await withTenant(shopId, (trx) =>
      trx('shopify_app_installations').where({ shop_id: shopId }).first(),
    );
    expect(install).toBeTruthy();
    expect(install.shop_domain).toBe(shopDomain);
    expect(install.shop_gid).toBe(SHOP_GID);
    expect(typeof install.access_token).toBe('string');
    expect(install.access_token).not.toBe('fake-shopify-access-token-happy');
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

    expect(completePostInstallationSpy).toHaveBeenCalledWith(shopDomain, shopId);
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
    programAxios({ token: { resolve: { data: { scope: FULL_GRANT_STRING } } } });

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
          data: { access_token: 'fake-shopify-access-token-noscope', scope: '' },
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
  it('S6: a second valid callback for the same shop merges the integration + installation (uninstalled_at cleared, scopes refreshed, token replaced) and emits a second sync_requested — no tenant/warehouse duplication', async () => {
    const shopDomain = `oauth-cb-reconnect-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const state1 = await readOAuthState(userId);

    programAxios({
      token: {
        resolve: {
          data: {
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
    const firstToken = installAfterFirst.access_token as string;

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
    expect(installAfterSecond.access_token).not.toBe(firstToken);
    expect(installAfterSecond.access_token).not.toBe(
      'fake-shopify-access-token-second',
    );

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

  it('identity-lookup failure: the merchant admin access token never reaches console.warn, and the callback still completes via the optional-metadata fallback', async () => {
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
          data: { access_token: SENTINEL_ADMIN_TOKEN, scope: FULL_GRANT_STRING },
        },
      },
      graphql: { reject: gqlError },
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await callback({ code: 'fake-oauth-code', state, shop: shopDomain });
    const logged = canonicaliseCalls(warnSpy.mock.calls);
    warnSpy.mockRestore();

    // Optional-metadata fallback: OAuth still completes.
    expect(res.status).toBe(302);
    const q = new URL(String(res.headers.location)).searchParams;
    expect(q.get('connect')).toBe('app_store');

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

    // Persistence still happened; the admin token is stored encrypted, not raw.
    const c = await counts(shopId);
    expect(c.integrationsShopify).toBe(1);
    expect(c.installations).toBe(1);
    const install = await withTenant(shopId, (trx) =>
      trx('shopify_app_installations').where({ shop_id: shopId }).first(),
    );
    expect(install.access_token).not.toBe(SENTINEL_ADMIN_TOKEN);
    expect(await oauthStateRows(state)).toBe(0);
  });
});
