/**
 * BILL-ENTITLEMENT-01 / P0-B3 CORRECTION — OAUTH RECONNECT COMMERCIAL RECONCILIATION.
 *
 * PRODUCTION DEFECT THIS PROTECTS AGAINST
 *   Production certification found a reviewer tenant sitting at
 *   scale / active / stripe. A Shopify OAuth reconnect succeeded and migrated
 *   ownership stripe -> shopify, writing a ledger row
 *   (source=shopify_oauth_callback, reason=billing_provider_stamp:reconnect).
 *   Tier and status were left untouched at scale / active.
 *
 *   The live Shopify billing query for that same shop returned NO active
 *   subscriptions — canonically starter / canceled / not entitled. The database
 *   nevertheless stayed scale / active / shopify, and 23 entitlement rows stayed
 *   open (free_tier_default=4, manual:scale_upgrade=11, trial:growth=8).
 *
 *   Root cause: handleOAuthCallback stamps billing_provider='shopify' but never
 *   reconciles authoritative Shopify commercial state. It also calls
 *   issueAuthTokens() BEFORE that stamp block, so the session it hands back is
 *   minted from pre-reconnect commercial state.
 *
 * LOCKED RULE
 *   A Shopify OAuth install/reconnect must not complete merely by stamping
 *   billing_provider='shopify'. After the new Shopify credential is persisted,
 *   and BEFORE a successful post-OAuth application session is issued, the
 *   callback must reconcile live Shopify billing state through the existing
 *   authoritative path — applyShopifyBillingState(shopId, trx). If that
 *   reconciliation fails, OAuth fails closed: no successful session carrying
 *   stale paid access.
 *
 * WHY THESE ASSERTIONS ARE NOT VACUOUS
 *   - every scenario seeds a local tier DIFFERENT from the tier Shopify reports,
 *     so nothing can pass by the seeded value already being correct;
 *   - entitlement truth is asserted as EFFECTIVE ACCESS via
 *     EntitlementsService.getForUser (tier floor ∪ still-open rows), never as
 *     source-specific revocation bookkeeping;
 *   - applyShopifyBillingState is NOT mocked. Only the Shopify network boundary
 *     is: axios for token exchange/identity, global fetch for the Partner API
 *     billing query. Both reject unknown URLs so no call can escape.
 *
 * HARNESS
 *   Real Express app, real GET /api/v1/integrations/oauth/callback/shopify,
 *   disposable synchroflow_test_* DB (`npm run test:integration`). Callback
 *   style follows tests/integration/oauth-callback-provider-mocked.test.ts.
 */

// --- Shopify network boundary #1: axios (OAuth token exchange + shop identity).
//     Same module-scope mock shape as the sibling OAuth callback suite. ---
jest.mock('axios', () => {
  const post = jest.fn();
  const get = jest.fn();
  const inst: Record<string, unknown> = {
    post,
    get,
    request: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  const callable = jest.fn();
  Object.assign(callable, inst, {
    create: jest.fn(() => inst),
    isAxiosError: (p: unknown) =>
      !!(p && typeof p === 'object' && (p as { isAxiosError?: unknown }).isAxiosError === true),
  });
  return { __esModule: true, default: callable };
});

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import axios from 'axios';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { getTierConfig } from '@lasyncro/backend-core/config/tiers.js';
// EntitlementsService.getForUser computes effective access as
//   modulesForTier(tier) ∪ open rows   /   flagsForTier(tier) ∪ open rows
// so the fixture derives "what Starter does not provide" from those exact
// accessors. getTierConfig() is a different table and currently disagrees with
// them (see the report accompanying this slice) — deriving expectations from it
// would assert capabilities the access layer never grants.
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { SHOPIFY_REQUIRED_SCOPES } from 'api-src/services/shopify/shopifyScopes';
import fs from 'fs';
import path from 'path';

const app = createApp();

const axiosPost = (axios as unknown as { post: jest.Mock }).post;

const TOKEN_URL_FRAGMENT = '/admin/oauth/access_token';
const GRAPHQL_URL_FRAGMENT = '/graphql.json';
const FULL_GRANT_STRING = [...SHOPIFY_REQUIRED_SCOPES].join(',');
const SHOP_GID = 'gid://shopify/Shop/999042';
const LEDGER_TABLE = 'shop_subscription_transitions';
const REPO = path.resolve(__dirname, '../../..');

jest.setTimeout(180_000);

// ── axios programming (token exchange + identity) ───────────────────────────

function programAxios(shopDomain: string) {
  axiosPost.mockReset();
  axiosPost.mockImplementation(async (url: unknown) => {
    if (typeof url === 'string' && url.includes(TOKEN_URL_FRAGMENT)) {
      return {
        data: {
          access_token: `fake-token-${Date.now()}`,
          refresh_token: `fake-refresh-${Date.now()}`,
          expires_in: 86400,
          refresh_token_expires_in: 2592000,
          scope: FULL_GRANT_STRING,
        },
      };
    }
    if (typeof url === 'string' && url.includes(GRAPHQL_URL_FRAGMENT)) {
      return {
        data: {
          data: {
            shop: {
              id: SHOP_GID,
              currencyCode: 'USD',
              name: 'Reconnect Billing Store',
              contactEmail: `owner+${shopDomain}@reconnect-billing.example`,
              ianaTimezone: 'UTC',
            },
          },
        },
      };
    }
    throw new Error(`PROVIDER_NETWORK_ESCAPE_BLOCKED:${String(url)}`);
  });
}

// ── Shopify network boundary #2: global fetch (Partner API billing query) ───
//
// shopifyBillingReconciliation.service.ts issues the activeSubscription query
// with global fetch, not axios. The resolver itself is never mocked — only this
// transport is — so plan -> tier mapping and the DB write remain real.

const realFetch = global.fetch;
let billingFetch: jest.Mock;

/** One ACTIVE Managed Pricing subscription identified by canonical planHandle. */
function activePlan(planHandle: string) {
  return {
    data: {
      activeSubscription: {
        shop: { id: SHOP_GID },
        billingPeriod: 'EVERY_30_DAYS',
        cancelAtEndOfCycle: false,
        trialEndsAt: null,
        currentBillingCycle: {
          startTime: '2026-09-01T00:00:00Z',
          endTime: '2099-01-01T00:00:00Z',
        },
        items: [
          {
            handle: planHandle,
            description: `Display Name For ${planHandle}`,
            price: {
              __typename: 'FlatRatePrice',
              active: true,
              currency: 'USD',
              amount: '99.00',
            },
            usage: null,
          },
          {
            handle: 'shipped-order',
            description: 'Processed order overage',
            price: {
              __typename: 'TieredPrice',
              active: true,
              currency: 'USD',
              tiersMode: 'VOLUME',
              tiers: [
                {
                  upTo: null,
                  amountPerUnit: '0.08',
                  amount: null,
                },
              ],
            },
            usage: {
              quantity: 0,
              cost: { amount: '0.00', currencyCode: 'USD' },
            },
          },
        ],
        pendingUpdate: null,
        legacySubscriptionId: 'gid://shopify/AppSubscription/77',
      },
    },
  };
}

/** The production condition: merchant has no live Shopify subscription. */
const noActiveSubscriptions = {
  data: { activeSubscription: null },
};

type BillingPlan =
  | { kind: 'graphql'; body: unknown }
  | { kind: 'http_error'; status: number }
  | { kind: 'network_error' };

function programBilling(plan: BillingPlan) {
  billingFetch.mockReset();
  billingFetch.mockImplementation(async (url: unknown) => {
    const href = String(url);
    if (!href.includes(GRAPHQL_URL_FRAGMENT)) {
      throw new Error(`PROVIDER_NETWORK_ESCAPE_BLOCKED:${href}`);
    }
    if (plan.kind === 'network_error') {
      throw new Error('SHOPIFY_BILLING_TRANSPORT_FAILURE');
    }
    if (plan.kind === 'http_error') {
      return { ok: false, status: plan.status, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => plan.body };
  });
}

// ── canonical fixtures ──────────────────────────────────────────────────────

async function installFreshShop(shopDomain: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k as keyof typeof params]}`)
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

  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [
      `shopify-install+${shopDomain}@lasyncro.internal`,
    ])
  );
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number, shopDomain };
}

async function readOAuthState(userId: number): Promise<string> {
  const row = await systemQuery(
    db('integration_oauth_states')
      .where({ user_id: userId, platform: 'shopify' })
      .orderBy('id', 'desc')
      .first()
  );
  const state = (row as { state?: string } | undefined)?.state;
  expect(typeof state).toBe('string');
  return state as string;
}

async function seedOAuthState(input: {
  userId: number;
  shopDomain: string;
  state: string;
  installSource: 'app_store' | 'reconnect';
}) {
  await systemQuery(
    db('integration_oauth_states').insert({
      user_id: input.userId,
      platform: 'shopify',
      state: input.state,
      shop_domain: input.shopDomain,
      install_source: input.installSource,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    })
  );
}

const callback = (query: Record<string, string>) => {
  const params: Record<string, string> = { timestamp: String(Math.floor(Date.now() / 1000)), ...query };
  const message = Object.keys(params).filter(key => key !== 'hmac').sort()
    .map(key => `${key}=${params[key]}`).join('&');
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message).digest('hex');
  return request(app)
    .get('/api/v1/integrations/oauth/callback/shopify')
    .query({ ...params, hmac })
    .redirects(0);
};

/**
 * Establishes the pre-reconnect commercial reality: a shop already installed
 * (so the reconnect has a real credential to replace) whose local commercial
 * state is deliberately DIFFERENT from whatever Shopify will report.
 */
async function establishInstalledShopAt(
  label: string,
  local: { tier: string; status: string; billingProvider: string }
) {
  const shopDomain = `oauth-billing-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await installFreshShop(shopDomain);

  // First completed OAuth — persists integrations + shopify_app_installations
  // through the real callback, exactly as production reached this state.
  // With the correction in place this callback legitimately reconciles the
  // shop's commercial state too, which is why the reproduction state below is
  // established AFTERWARDS rather than before.
  programAxios(shopDomain);
  programBilling({ kind: 'graphql', body: noActiveSubscriptions });
  const state1 = await readOAuthState(userId);
  const first = await callback({ code: 'code-initial', state: state1, shop: shopDomain });
  expect(first.status).toBe(302);

  /**
   * Establish the pre-reconnect commercial reality under reproduction.
   *
   * All THREE authoritative dimensions are set together — setting tier alone
   * would leave provider/status describing a different commercial world than
   * the tier claims, and the ownership gate reads billing_provider.
   *
   * Read back inside the same tenant transaction: if this write does not land,
   * the failure must point here rather than surfacing later as a confusing
   * assertion about entitlements.
   */
  await withTenant(shopId, async (trx) => {
    await trx('shop_subscriptions').where({ shop_id: shopId }).update({
      tier: local.tier,
      status: local.status,
      billing_provider: local.billingProvider,
      updated_at: new Date(),
    });

    const readBack = await trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'status', 'billing_provider');

    expect(readBack).toMatchObject({
      tier: local.tier,
      status: local.status,
      billing_provider: local.billingProvider,
    });
  });

  return { shopId, userId, shopDomain };
}

/**
 * MAX(id) in the transition ledger for this shop.
 *
 * shop_subscription_transitions is append-only by design (migration 0167 raises
 * from BEFORE UPDATE/DELETE triggers), so fixture rows from installation cannot
 * — and must not — be deleted. A watermark taken immediately before the act
 * scopes provenance assertions to the reconnect's own transitions instead.
 *
 * Read through withTenant: the table carries FORCE ROW LEVEL SECURITY, so a
 * query without tenant context matches nothing at all rather than erroring.
 */
async function ledgerWatermark(shopId: number): Promise<number> {
  const row = await withTenant(shopId, (trx) =>
    trx(LEDGER_TABLE).where({ shop_id: shopId }).max('id as max').first()
  );
  return Number((row as { max?: string | number } | undefined)?.max ?? 0);
}

/** Still-open entitlement rows carrying the historical production sources. */
async function seedOpenPaidEntitlements(shopId: number) {
  /**
   * Paid capability is derived from the INTERSECTION of the two canonical
   * layers, so the seeded grants are ones production genuinely creates and
   * genuinely revokes:
   *
   *   modulesForTier/flagsForTier  — what EFFECTIVE access counts as paid
   *                                  (EntitlementsService.getForUser)
   *   getTierConfig                — what the commercial grant/revoke path
   *                                  actually manages (applyShopifyBillingState
   *                                  seeds and revokes from this table)
   *
   * These two tables currently disagree (see the slice report). Seeding from
   * the access layer alone would invent a grant the commercial path never
   * issues and could never revoke; seeding from the config alone could name a
   * capability effective access does not treat as paid. The intersection is the
   * honest overlap, and it is non-empty for both modules and flags.
   */
  const starterModules = modulesForTier('starter' as never);
  const starterFlagSet = flagsForTier('starter' as never);
  const scaleConfig = getTierConfig('scale');
  const managedModules = new Set(scaleConfig.modules as string[]);
  const managedFlags = new Set(scaleConfig.flags as string[]);

  const paidModules = [...modulesForTier('scale' as never)].filter(
    (m) => !starterModules.has(m) && managedModules.has(m)
  );
  const paidFlags = [...flagsForTier('scale' as never)].filter(
    (f) => !starterFlagSet.has(f) && managedFlags.has(f)
  );
  expect(paidModules.length).toBeGreaterThan(0);
  expect(paidFlags.length).toBeGreaterThan(0);

  const rows: Array<Record<string, unknown>> = [];
  paidModules.forEach((moduleKey, i) => {
    rows.push({
      shop_id: shopId,
      module_key: moduleKey,
      flag_key: null,
      // Historical labels straight from the production finding.
      source: i % 2 === 0 ? 'manual:scale_upgrade' : 'trial:growth',
      valid_from: new Date(Date.now() - 60_000),
      valid_until: null,
    });
  });
  paidFlags.forEach((flagKey, i) => {
    rows.push({
      shop_id: shopId,
      module_key: flagKey.split('.')[0],
      flag_key: flagKey,
      source: i % 2 === 0 ? 'manual:scale_upgrade' : 'trial:growth',
      valid_from: new Date(Date.now() - 60_000),
      valid_until: null,
    });
  });

  // Written through the canonical entitlement writer. Module-level rows are
  // governed by a PARTIAL unique index
  // (shop_id, module_key) WHERE flag_key IS NULL AND valid_until IS NULL,
  // which a hand-rolled onConflict target cannot express — applyFromCommercialGrant
  // already handles exactly that (ISS-C26), so the fixture uses it rather than
  // reimplementing the conflict semantics.
  await withTenant(shopId, (trx) => EntitlementsService.applyFromCommercialGrant(trx, rows as any));

  return { paidModules, paidFlags };
}

async function subscriptionRow(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'status', 'billing_provider', 'trial_ends_at')
  );
}

/** Only the transitions emitted after the watermark — i.e. by the act. */
async function ledgerRowsAfter(shopId: number, afterId: number) {
  return withTenant(shopId, (trx) =>
    trx(LEDGER_TABLE)
      .where({ shop_id: shopId })
      .andWhere('id', '>', afterId)
      .orderBy('id', 'asc')
  );
}

/** The tier claim the OAuth-issued session actually carries. */
function tierClaimFrom(location: string): string | null {
  const token = new URL(location).searchParams.get('token');
  if (!token) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as Record<string, unknown>;
  return (decoded.tier as string) ?? null;
}

function successToken(res: { status: number; headers: Record<string, string> }): string | null {
  if (res.status !== 302) return null;
  const location = String(res.headers.location ?? '');
  if (!location.startsWith(process.env.FRONTEND_URL!)) return null;
  return new URL(location).searchParams.get('token');
}

// ── suite ───────────────────────────────────────────────────────────────────

describe('P0-B3 CORRECTION — Shopify OAuth reconnect reconciles authoritative commercial state', () => {

  beforeAll(() => {
    process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
    process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
    process.env.API_URL = process.env.API_URL || 'https://api.test';
    process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret';
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789abcdef';
    process.env.SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';
    process.env.SHOPIFY_PARTNER_ORG_ID = '123';
    process.env.SHOPIFY_APP_GID = 'gid://shopify/App/320563019777';
    process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN = 'test-partner-token-not-printed';

    billingFetch = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = billingFetch;
  });

  afterAll(() => {
    (global as unknown as { fetch: unknown }).fetch = realFetch;
  });

  afterEach(() => {
    // No provider HTTP may escape to anything but the two mocked Shopify hosts.
    for (const call of axiosPost.mock.calls) {
      const url = String(call[0]);
      expect(url.includes(TOKEN_URL_FRAGMENT) || url.includes(GRAPHQL_URL_FRAGMENT)).toBe(true);
    }
  });

  // GH-1132: supersedes the prior "starter/canceled with no trial" contract.
  // A genuinely fresh Shopify App Store install now automatically receives
  // an app-granted 14-day Growth onboarding trial — never a fabricated
  // Shopify subscription, never Stripe. This is asserted immediately after
  // handleShopifyInstall, before any OAuth callback runs.
  it('install: fresh App Store tenant starts growth/trialing/shopify with a 14-day trial (GH-1132)', async () => {
    const shopDomain = `oauth-billing-install-${Date.now()}.myshopify.com`;
    const beforeInstall = new Date();
    const { shopId, userId } = await installFreshShop(shopDomain);
    const afterInstall = new Date();

    const sub = await subscriptionRow(shopId);
    expect(sub).toMatchObject({
      tier: 'growth',
      status: 'trialing',
      billing_provider: 'shopify',
    });
    expect(sub!.trial_ends_at).not.toBeNull();
    const trialEndsAt = new Date(sub!.trial_ends_at).getTime();
    expect(trialEndsAt).toBeGreaterThanOrEqual(
      beforeInstall.getTime() + 14 * 24 * 60 * 60 * 1000 - 5_000
    );
    expect(trialEndsAt).toBeLessThanOrEqual(
      afterInstall.getTime() + 14 * 24 * 60 * 60 * 1000 + 5_000
    );

    const usage = await withTenant(shopId, (trx) =>
      trx('shop_usage_metrics').where({ shop_id: shopId }).first('tier_at_period_start')
    );
    expect(usage).toMatchObject({ tier_at_period_start: 'growth' });

    // Growth canonical effective entitlement exists, and at least one
    // Growth-only capability (something Starter never grants) is present.
    const access = await EntitlementsService.getForUser(userId);
    expect(access).toBeTruthy();
    expect(access!.modules).toEqual(expect.arrayContaining([...modulesForTier('growth' as never)]));
    const growthOnlyModule = [...modulesForTier('growth' as never)].find(
      (moduleKey) => !modulesForTier('starter' as never).has(moduleKey)
    );
    expect(growthOnlyModule).toBeTruthy();
    expect(access!.modules).toContain(growthOnlyModule);

    // Creation ledger row: NULL -> growth/trialing/shopify, with provenance
    // identifying this as a fresh App Store Growth trial (not a bootstrap
    // with no contract, and not any other source).
    const creationRow = await withTenant(shopId, (trx) =>
      trx(LEDGER_TABLE).where({ shop_id: shopId }).orderBy('id', 'asc').first()
    );
    expect(creationRow).toMatchObject({
      from_tier: null,
      from_status: null,
      from_billing_provider: null,
      to_tier: 'growth',
      to_status: 'trialing',
      to_billing_provider: 'shopify',
      source: 'shopify_app_store_install',
      reason: 'app_store_install_growth_trial',
      actor_type: 'shopify',
    });
  });

  // GH-1132: supersedes the prior "redirects to required billing entry with
  // starter token" contract. A fresh install now has a valid local Growth
  // trial the instant it's created, so the OAuth callback that immediately
  // follows must not force hosted pricing — it issues a Growth session and
  // continues into the normal app path.
  it('install callback: fresh App Store shop with no active Shopify contract issues a Growth session, no billing entry required (GH-1132)', async () => {
    const shopDomain = `oauth-billing-entry-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);
    const trialEndsAtBefore = (await subscriptionRow(shopId))!.trial_ends_at;

    programAxios(shopDomain);
    programBilling({ kind: 'graphql', body: noActiveSubscriptions });

    const state = await readOAuthState(userId);
    const res = await callback({ code: 'code-billing-entry', state, shop: shopDomain });

    expect(res.status).toBe(302);
    const redirect = new URL(String(res.headers.location));
    expect(redirect.origin).toBe(process.env.FRONTEND_URL);
    // Continues into the normal LaSyncro app path — not hosted pricing.
    expect(redirect.pathname).toBe('/');
    expect(redirect.searchParams.get('connect')).toBe('app_store');
    expect(redirect.searchParams.get('billing_entry')).toBeNull();
    expect(redirect.searchParams.get('token')).toBeTruthy();
    expect(String(res.headers.location)).not.toContain('stripe');
    expect(tierClaimFrom(String(res.headers.location))).toBe('growth');

    const after = await subscriptionRow(shopId);
    expect(after).toMatchObject({
      tier: 'growth',
      status: 'trialing',
      billing_provider: 'shopify',
    });
    // Partner reconciliation ran (Partner truth was consulted) but a null
    // Partner subscription must not have disturbed the original trial window.
    expect(new Date(after!.trial_ends_at).toISOString()).toBe(
      new Date(trialEndsAtBefore).toISOString()
    );
  });

  // GH-1132 (6): reconnect must never reset or extend an already-running
  // Growth trial. Fixed trial_ends_at proves exact preservation, not just
  // "still trialing".
  it('reconnect with null Partner subscription preserves the exact original trial_ends_at (GH-1132)', async () => {
    const shopDomain = `oauth-billing-reconnect-trial-${Date.now()}.myshopify.com`;
    const { shopId, userId } = await installFreshShop(shopDomain);

    // First completed OAuth persists the credential the reconnect will
    // later replace, exactly like establishInstalledShopAt's pattern.
    programAxios(shopDomain);
    programBilling({ kind: 'graphql', body: noActiveSubscriptions });
    const state1 = await readOAuthState(userId);
    const first = await callback({ code: 'code-initial', state: state1, shop: shopDomain });
    expect(first.status).toBe(302);

    // Pin an exact, deterministic trial_ends_at so preservation can be
    // proven byte-for-byte rather than merely "still in the future".
    const fixedTrialEndsAt = new Date('2026-10-15T12:00:00.000Z');
    await withTenant(shopId, (trx) =>
      trx('shop_subscriptions').where({ shop_id: shopId }).update({
        trial_ends_at: fixedTrialEndsAt,
        updated_at: new Date(),
      })
    );
    expect(await subscriptionRow(shopId)).toMatchObject({
      tier: 'growth',
      status: 'trialing',
      billing_provider: 'shopify',
    });

    programAxios(shopDomain);
    programBilling({ kind: 'graphql', body: noActiveSubscriptions });
    const state2 = `reconnect-trial-preserve-${Date.now()}`;
    await seedOAuthState({ userId, shopDomain, state: state2, installSource: 'reconnect' });
    const second = await callback({ code: 'code-reconnect', state: state2, shop: shopDomain });
    expect(second.status).toBe(302);

    const after = await subscriptionRow(shopId);
    expect(after).toMatchObject({
      tier: 'growth',
      status: 'trialing',
      billing_provider: 'shopify',
    });
    expect(new Date(after!.trial_ends_at).toISOString()).toBe(fixedTrialEndsAt.toISOString());

    // Second install of the SAME shop domain does not create another trial
    // window or extend the original — reinstall reuses the existing owner.
    // Verified via the known shopId directly: by this point the completed
    // OAuth callbacks above have already replaced the ghost user's
    // @lasyncro.internal placeholder email with the real Shopify identity
    // (see handleOAuthCallback's ghost-email-replacement step), so
    // installFreshShop's ghost-email lookup can no longer resolve this shop.
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = { shop: shopDomain, timestamp };
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k as keyof typeof params]}`)
      .join('&');
    const hmac = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
      .update(message)
      .digest('hex');
    const reinstall = await request(app)
      .get('/api/v1/integrations/shopify/install')
      .query({ ...params, hmac })
      .redirects(0);
    expect(reinstall.status).toBe(302);

    const afterReinstall = await subscriptionRow(shopId);
    expect(afterReinstall).toMatchObject({
      tier: 'growth',
      status: 'trialing',
      billing_provider: 'shopify',
    });
    expect(new Date(afterReinstall!.trial_ends_at).toISOString()).toBe(
      fixedTrialEndsAt.toISOString()
    );
  });

  // ── A. PRODUCTION REPRODUCTION ────────────────────────────────────────────
  it('A: reconnect on a scale/active/stripe tenant with NO live Shopify subscription lands starter/canceled/shopify and closes paid access', async () => {
    const { shopId, userId, shopDomain } = await establishInstalledShopAt('repro', {
      tier: 'scale',
      status: 'active',
      billingProvider: 'stripe',
    });
    const { paidModules, paidFlags } = await seedOpenPaidEntitlements(shopId);

    // ── PREMISE 1: the exact production-reproduction commercial state.
    expect(await subscriptionRow(shopId)).toMatchObject({
      tier: 'scale',
      status: 'active',
      billing_provider: 'stripe',
    });

    // ── PREMISE 2: real paid access exists before the act. Asserted as
    // EFFECTIVE capability, not as a row count — at least one capability the
    // merchant can actually use that Starter does not provide.
    const before = await EntitlementsService.getForUser(userId);
    expect(before).toBeTruthy();

    const starterModuleSet = modulesForTier('starter' as never);
    const effectivePaidBefore = before!.modules.filter((m) => !starterModuleSet.has(m));
    expect(effectivePaidBefore.length).toBeGreaterThan(0);
    expect(before!.modules).toEqual(expect.arrayContaining(paidModules));

    // Live Shopify: no subscription at all — canonically starter/canceled.
    programAxios(shopDomain);
    programBilling({ kind: 'graphql', body: noActiveSubscriptions });

    const state = `reconnect-repro-${Date.now()}`;
    await seedOAuthState({ userId, shopDomain, state, installSource: 'reconnect' });
    const res = await callback({ code: 'code-reconnect', state, shop: shopDomain });

    // Authoritative commercial state must follow Shopify, not the stale row.
    expect(await subscriptionRow(shopId)).toMatchObject({
      tier: 'starter',
      status: 'canceled',
      billing_provider: 'shopify',
    });

    // Effective access: nothing above Starter survives, whatever its historical
    // source label was. This is access truth, not revocation bookkeeping.
    const after = await EntitlementsService.getForUser(userId);
    expect(after).toBeTruthy();
    const starterModules = [...modulesForTier('starter' as never)];
    const starterFlags = [...flagsForTier('starter' as never)];

    for (const paid of paidModules) {
      expect(after!.modules).not.toContain(paid);
    }
    for (const flag of paidFlags) {
      expect(after!.flags).not.toContain(flag);
    }

    // …and legitimate free-tier capability is still there.
    expect(after!.modules).toEqual(expect.arrayContaining(starterModules));
    expect(starterFlags.every((f) => after!.flags.includes(f))).toBe(true);

    // Any session handed back must reflect starter, never stale scale.
    const token = successToken(res);
    if (token) {
      expect(tierClaimFrom(String(res.headers.location))).toBe('starter');
    }
  });

  // ── B. LIVE SHOPIFY SCALE ─────────────────────────────────────────────────
  it('B: reconnect adopts Scale from planHandle when local state is growth', async () => {
    // Local deliberately NOT scale — the expected result cannot be the seed.
    const { shopId, userId, shopDomain } = await establishInstalledShopAt('scale', {
      tier: 'growth',
      status: 'active',
      billingProvider: 'stripe',
    });

    programAxios(shopDomain);
    programBilling({ kind: 'graphql', body: activePlan('scale') });

    const state = `reconnect-scale-${Date.now()}`;
    await seedOAuthState({ userId, shopDomain, state, installSource: 'reconnect' });
    const res = await callback({ code: 'code-scale', state, shop: shopDomain });

    expect(await subscriptionRow(shopId)).toMatchObject({
      tier: 'scale',
      status: 'active',
      billing_provider: 'shopify',
    });

    const token = successToken(res);
    if (token) {
      expect(tierClaimFrom(String(res.headers.location))).toBe('scale');
    }
  });

  // ── C. LIVE SHOPIFY GROWTH ────────────────────────────────────────────────
  it('C: reconnect adopts Growth from planHandle when local state is scale', async () => {
    // Local deliberately NOT growth.
    const { shopId, userId, shopDomain } = await establishInstalledShopAt('growth', {
      tier: 'scale',
      status: 'active',
      billingProvider: 'stripe',
    });

    programAxios(shopDomain);
    programBilling({ kind: 'graphql', body: activePlan('growth') });

    const state = `reconnect-growth-${Date.now()}`;
    await seedOAuthState({ userId, shopDomain, state, installSource: 'reconnect' });
    const res = await callback({ code: 'code-growth', state, shop: shopDomain });

    expect(await subscriptionRow(shopId)).toMatchObject({
      tier: 'growth',
      status: 'active',
      billing_provider: 'shopify',
    });

    const token = successToken(res);
    if (token) {
      expect(tierClaimFrom(String(res.headers.location))).toBe('growth');
    }
  });

  // ── D. RECONCILIATION FAILURE FAILS CLOSED ────────────────────────────────
  it('D: when authoritative Shopify billing resolution fails, no successful session carrying stale paid access is issued', async () => {
    const { shopId, userId, shopDomain } = await establishInstalledShopAt('failclosed', {
      tier: 'scale',
      status: 'active',
      billingProvider: 'stripe',
    });

    programAxios(shopDomain);
    // Token exchange + credential persistence still succeed; only the
    // authoritative billing resolution fails.
    programBilling({ kind: 'network_error' });

    const state = `reconnect-fail-${Date.now()}`;
    await seedOAuthState({ userId, shopDomain, state, installSource: 'reconnect' });
    const res = await callback({ code: 'code-fail', state, shop: shopDomain });

    // The permanent contract is "no successful session", not one exact status.
    const token = successToken(res);
    expect(token).toBeNull();

    // And no session may exist that still asserts the old paid tier.
    if (res.status === 302) {
      const location = String(res.headers.location ?? '');
      if (location.startsWith(process.env.FRONTEND_URL!)) {
        expect(new URL(location).searchParams.get('token')).toBeNull();
      }
    }

    // The tenant must not have been left claiming Shopify-owned paid access on
    // the strength of a reconciliation that never succeeded.
    const sub = await subscriptionRow(shopId);
    expect({
      tier: sub?.tier,
      status: sub?.status,
      billing_provider: sub?.billing_provider,
    }).not.toEqual({ tier: 'scale', status: 'active', billing_provider: 'shopify' });

    expect(userId).toBeGreaterThan(0);
  });

  // ── E. PROVENANCE ─────────────────────────────────────────────────────────
  it('E: a genuine reconnect-driven commercial change is recorded with Shopify provenance and correct before/after state', async () => {
    const { shopId, userId, shopDomain } = await establishInstalledShopAt('prov', {
      tier: 'scale',
      status: 'active',
      billingProvider: 'stripe',
    });

    programAxios(shopDomain);
    programBilling({ kind: 'graphql', body: noActiveSubscriptions });

    // Scope provenance to the act. Installation-time transitions are real
    // history on an append-only ledger and stay where they are.
    const watermark = await ledgerWatermark(shopId);

    const state = `reconnect-prov-${Date.now()}`;
    await seedOAuthState({ userId, shopDomain, state, installSource: 'reconnect' });
    await callback({ code: 'code-prov', state, shop: shopDomain });

    const final = await subscriptionRow(shopId);
    expect(final).toMatchObject({ tier: 'starter', status: 'canceled', billing_provider: 'shopify' });

    const rows = await ledgerRowsAfter(shopId, watermark);
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // Every transition the reconnect emitted is Shopify-attributed.
    for (const row of rows) {
      expect(row.actor_type).toBe('shopify');
    }

    // The chain starts at the real pre-reconnect state…
    expect(rows[0].from_tier).toBe('scale');
    expect(rows[0].from_status).toBe('active');
    expect(rows[0].from_billing_provider).toBe('stripe');

    // …is contiguous — each transition begins where the previous one ended, so
    // no step silently acted on stale state…
    for (let i = 1; i < rows.length; i += 1) {
      expect({
        tier: rows[i].from_tier,
        status: rows[i].from_status,
        provider: rows[i].from_billing_provider,
      }).toEqual({
        tier: rows[i - 1].to_tier,
        status: rows[i - 1].to_status,
        provider: rows[i - 1].to_billing_provider,
      });
    }

    // …and ends exactly at the persisted authoritative state.
    const last = rows[rows.length - 1];
    expect(last.to_tier).toBe(final!.tier);
    expect(last.to_status).toBe(final!.status);
    expect(last.to_billing_provider).toBe(final!.billing_provider);

    // Both real steps of the atomic sequence are recorded with their own
    // provenance: the deliberate ownership takeover, then the authoritative
    // Shopify reconciliation. Both are genuine authoritative changes here, so
    // neither is suppressed by canonical no-op semantics.
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'shopify_oauth_callback',
          reason: 'billing_provider_stamp:reconnect',
          from_tier: 'scale',
          from_billing_provider: 'stripe',
          to_tier: 'scale',
          to_billing_provider: 'shopify',
        }),
        expect.objectContaining({
          source: 'shopify_billing_reconciliation',
          reason: 'shopify_billing_state_applied',
          from_tier: 'scale',
          from_billing_provider: 'shopify',
          to_tier: 'starter',
          to_status: 'canceled',
          to_billing_provider: 'shopify',
        }),
      ])
    );
  });
});

describe('MON-REM-01B-4 — OAuth commercial reconciliation source', () => {
  it('OAuth reconnect reconciliation depends on Partner API activeSubscription truth rather than Admin activeSubscriptions', () => {
    const source = fs.readFileSync(
      path.join(REPO, 'apps/backend/src/services/shopify/shopifyBillingReconciliation.service.ts'),
      'utf8',
    );

    expect(source).toContain('activeSubscription');
    expect(source).not.toContain('currentAppInstallation');
    expect(source).not.toContain('activeSubscriptions');
  });
});
