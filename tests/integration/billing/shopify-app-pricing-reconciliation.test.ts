import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import db, {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { applyShopifyBillingState } from 'api-src/services/shopify/applyShopifyBillingState.service';

const app = createApp();
const realFetch = global.fetch;
let partnerFetch: jest.Mock;

async function fixture() {
  const suffix = crypto.randomBytes(5).toString('hex');
  const shopGid = `gid://shopify/Shop/${Date.now()}${crypto.randomInt(1000, 9999)}`;
  const shopDomain = `shopify-app-pricing-${suffix}.myshopify.com`;

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `shopify-app-pricing-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [owner] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `shopify-app-pricing-${suffix}@test.example`,
        password_hash: 'test',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: owner.id,
      role: 'owner',
    });

    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'starter',
      status: 'canceled',
      billing_interval: 'monthly',
      billing_currency: 'USD',
      billing_provider: 'shopify',
      allow_overage: true,
      extra_seats: 0,
    });

    await trx('shopify_app_installations').insert({
      shop_id: shopId,
      shop_domain: shopDomain,
      shop_gid: shopGid,
      access_token: 'test-admin-token-not-used-for-partner-billing',
      scopes: 'read_products',
      installed_at: new Date(),
      uninstalled_at: null,
    });

    for (const action of ['billing:read', 'billing:write']) {
      await trx('shop_role_permissions')
        .insert({ shop_id: shopId, action, role: 'owner', granted: true })
        .onConflict(['shop_id', 'action', 'role'])
        .merge({ granted: true });
    }

    return Number(owner.id);
  });

  return {
    shopId,
    shopGid,
    userId,
    token: issueTestToken({ userId, shopId, tier: 'starter', roles: ['owner'] }),
  };
}

async function subscription(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'status', 'billing_provider', 'current_period_end', 'trial_ends_at'),
  );
}

/**
 * GH-1132 — seeds the exact local state an app-granted Growth onboarding
 * trial leaves behind: growth/trialing/shopify with a trial_ends_at, plus
 * the Growth entitlement rows handleShopifyInstall would have seeded.
 */
async function seedGrowthTrial(shopId: number, trialEndsAt: Date) {
  await withTenant(shopId, async (trx) => {
    await trx('shop_subscriptions').where({ shop_id: shopId }).update({
      tier: 'growth',
      status: 'trialing',
      billing_provider: 'shopify',
      trial_ends_at: trialEndsAt,
      updated_at: new Date(),
    });

    const moduleRows = [...modulesForTier('growth' as never)].map((moduleKey) => ({
      shop_id: shopId,
      module_key: moduleKey,
      flag_key: null as string | null,
      source: 'shopify_app_store_install:growth',
    }));
    const flagRows = [...flagsForTier('growth' as never)].map((flagKey) => ({
      shop_id: shopId,
      module_key: flagKey.split('.')[0],
      flag_key: flagKey,
      source: 'shopify_app_store_install:growth',
    }));
    await EntitlementsService.applyFromCommercialGrant(trx, [...moduleRows, ...flagRows]);
  });
}

/** The production condition: merchant has no live Shopify subscription. */
function programPartnerNoActiveSubscription() {
  partnerFetch.mockImplementation(async (url: unknown) => {
    const href = String(url);
    if (href !== 'https://partners.shopify.com/123/api/2026-07/graphql.json') {
      throw new Error(`PROVIDER_NETWORK_ESCAPE_BLOCKED:${href}`);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { activeSubscription: null } }),
    };
  });
}

async function ledgerRow(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('shop_subscription_transitions')
      .where({ shop_id: shopId })
      .orderBy('id', 'desc')
      .first('from_tier', 'from_status', 'from_billing_provider', 'to_tier', 'to_status', 'to_billing_provider'),
  );
}

describe('MON-REM-01B-4 — Shopify App Pricing redirect reconciliation API', () => {
  beforeAll(() => {
    partnerFetch = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = partnerFetch;
  });

  afterAll(async () => {
    (global as unknown as { fetch: unknown }).fetch = realFetch;
    await db.destroy();
  });

  beforeEach(() => {
    process.env.SHOPIFY_PARTNER_ORG_ID = '123';
    process.env.SHOPIFY_APP_GID = 'gid://shopify/App/320563019777';
    process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN = 'test-partner-token-not-printed';
    partnerFetch.mockReset();
  });

  it('uses Partner API truth, not redirect plan_handle, when reconciling a Shopify return', async () => {
    const f = await fixture();
    programPartnerActiveSubscription({ shopGid: f.shopGid, commercialHandle: 'core' });

    const res = await request(app)
      .post('/api/v1/billing/shopify/reconcile')
      .set('Authorization', `Bearer ${f.token}`)
      .send({ expected_plan_handle: 'growth' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tier: 'core',
      status: 'active',
      billing_provider: 'shopify',
      expected_plan_handle: 'growth',
      authoritative_plan_handle: 'core',
    });
    const persisted = await subscription(f.shopId);

    expect(persisted).toMatchObject({
      tier: 'core',
      status: 'active',
      billing_provider: 'shopify',
    });

    expect(new Date(persisted.current_period_end).toISOString())
      .toBe('2026-10-01T00:00:00.000Z');
  });

  it('preserves a known period end when Partner API omits the cycle boundary', async () => {
    const f = await fixture();
    const knownPeriodEnd = new Date('2026-10-15T00:00:00.000Z');

    await withTenant(f.shopId, (trx) =>
      trx('shop_subscriptions')
        .where({ shop_id: f.shopId })
        .update({ current_period_end: knownPeriodEnd }),
    );

    programPartnerActiveSubscription({
      shopGid: f.shopGid,
      commercialHandle: 'core',
      currentBillingCycleEnd: null,
    });

    const res = await request(app)
      .post('/api/v1/billing/shopify/reconcile')
      .set('Authorization', `Bearer ${f.token}`)
      .send({ expected_plan_handle: 'core' });

    expect(res.status).toBe(200);

    const persisted = await subscription(f.shopId);

    expect(persisted).toMatchObject({
      tier: 'core',
      status: 'active',
      billing_provider: 'shopify',
    });

    expect(new Date(persisted.current_period_end).toISOString())
      .toBe(knownPeriodEnd.toISOString());
  });

  // GH-1128: `early-access` was a pre-launch Shopify public plan, since
  // deleted from the Partner Dashboard. LaSyncro has not launched — there is
  // no subscriber to migrate — so it must not remain a valid commercial
  // provider fact. Prove Partner API truth reporting `early-access` is
  // rejected fail-closed, and that authoritative commercial state is left
  // untouched by the rejected fact.
  it('rejects Partner API truth reporting the retired early-access handle (GH-1128)', async () => {
    const f = await fixture();
    programPartnerActiveSubscription({ shopGid: f.shopGid, commercialHandle: 'early-access' });

    const before = await subscription(f.shopId);
    const transitionsBefore = await withTenant(f.shopId, (trx) =>
      trx('shop_subscription_transitions').where({ shop_id: f.shopId }).count('* as count').first(),
    );

    const res = await request(app)
      .post('/api/v1/billing/shopify/reconcile')
      .set('Authorization', `Bearer ${f.token}`)
      .send({ expected_plan_handle: 'early-access' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'SHOPIFY_PARTNER_PLAN_UNRESOLVED' });

    const after = await subscription(f.shopId);
    expect(after).toEqual(before);

    const transitionsAfter = await withTenant(f.shopId, (trx) =>
      trx('shop_subscription_transitions').where({ shop_id: f.shopId }).count('* as count').first(),
    );
    expect(Number(transitionsAfter?.count)).toBe(Number(transitionsBefore?.count));
  });

  // GH-1132 (2): a null Partner commercial plan is the EXPECTED state for a
  // merchant on an app-granted trial who has not yet purchased a real
  // Shopify App Pricing plan — it must not revoke a still-valid local trial.
  it('preserves a valid local Growth trial when Partner reports no active subscription (GH-1132)', async () => {
    const f = await fixture();
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await seedGrowthTrial(f.shopId, trialEndsAt);
    programPartnerNoActiveSubscription();

    const before = await subscription(f.shopId);
    expect(before).toMatchObject({ tier: 'growth', status: 'trialing', billing_provider: 'shopify' });

    await withTenant(f.shopId, (trx) => applyShopifyBillingState(f.shopId, trx));

    const after = await subscription(f.shopId);
    expect(after).toMatchObject({ tier: 'growth', status: 'trialing', billing_provider: 'shopify' });
    expect(new Date(after.trial_ends_at).toISOString()).toBe(trialEndsAt.toISOString());

    const access = await EntitlementsService.getForUser(f.userId);
    expect(access!.modules).toEqual(expect.arrayContaining([...modulesForTier('growth' as never)]));

    // Repeated reconciliation remains stable — no drift on replay.
    await withTenant(f.shopId, (trx) => applyShopifyBillingState(f.shopId, trx));
    const afterAgain = await subscription(f.shopId);
    expect(afterAgain).toEqual(after);
  });

  // GH-1132 (4): a real Shopify commercial plan becoming active must
  // supersede the local trial immediately, clear trial_ends_at, and revoke
  // Growth-only grants Core does not provide.
  it('an active Shopify Core plan supersedes the local Growth trial (GH-1132)', async () => {
    const f = await fixture();
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await seedGrowthTrial(f.shopId, trialEndsAt);

    const growthOnlyModule = [...modulesForTier('growth' as never)].find(
      (m) => !modulesForTier('core' as never).has(m)
    );
    expect(growthOnlyModule).toBeTruthy();
    const before = await EntitlementsService.getForUser(f.userId);
    expect(before!.modules).toContain(growthOnlyModule);

    programPartnerActiveSubscription({ shopGid: f.shopGid, commercialHandle: 'core' });

    const res = await request(app)
      .post('/api/v1/billing/shopify/reconcile')
      .set('Authorization', `Bearer ${f.token}`)
      .send({ expected_plan_handle: 'core' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tier: 'core', status: 'active', billing_provider: 'shopify' });

    const persisted = await subscription(f.shopId);
    expect(persisted).toMatchObject({ tier: 'core', status: 'active', billing_provider: 'shopify' });
    expect(persisted.trial_ends_at).toBeNull();

    const after = await EntitlementsService.getForUser(f.userId);
    expect(after!.modules).toEqual(expect.arrayContaining([...modulesForTier('core' as never)]));
    expect(after!.modules).not.toContain(growthOnlyModule);

    expect(await ledgerRow(f.shopId)).toMatchObject({
      from_tier: 'growth',
      from_status: 'trialing',
      from_billing_provider: 'shopify',
      to_tier: 'core',
      to_status: 'active',
      to_billing_provider: 'shopify',
    });
  });

  // GH-1132 (5): a null Partner subscription only preserves a FUTURE valid
  // trial. An already-expired trial must fall back to Starter like any
  // other no-contract state, with Growth-only entitlements revoked.
  it('an expired local Growth trial with no Shopify plan falls back to Starter (GH-1132)', async () => {
    const f = await fixture();
    const expiredTrialEndsAt = new Date(Date.now() - 60_000);
    await seedGrowthTrial(f.shopId, expiredTrialEndsAt);
    programPartnerNoActiveSubscription();

    const growthOnlyModule = [...modulesForTier('growth' as never)].find(
      (m) => !modulesForTier('starter' as never).has(m)
    );
    expect(growthOnlyModule).toBeTruthy();

    await withTenant(f.shopId, (trx) => applyShopifyBillingState(f.shopId, trx));

    const after = await subscription(f.shopId);
    expect(after).toMatchObject({ tier: 'starter', status: 'canceled', billing_provider: 'shopify' });
    expect(after.trial_ends_at).toBeNull();

    const access = await EntitlementsService.getForUser(f.userId);
    expect(access!.modules).not.toContain(growthOnlyModule);
    expect(access!.modules).toEqual(expect.arrayContaining([...modulesForTier('starter' as never)]));
  });
});

function programPartnerActiveSubscription(input: {
  shopGid: string;
  commercialHandle: 'core' | 'growth' | 'scale' | 'starter' | 'early-access';
  currentBillingCycleEnd?: string | null;
}) {
  partnerFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (href !== 'https://partners.shopify.com/123/api/2026-07/graphql.json') {
      throw new Error(`PROVIDER_NETWORK_ESCAPE_BLOCKED:${href}`);
    }

    const headers = new Headers(init?.headers);
    expect(headers.get('X-Shopify-Access-Token')).toBe('test-partner-token-not-printed');

    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          activeSubscription: {
            shop: { id: input.shopGid },
            billingPeriod: 'EVERY_30_DAYS',
            cancelAtEndOfCycle: false,
            trialEndsAt: null,
            currentBillingCycle: {
              startTime: '2026-09-01T00:00:00Z',
              endTime:
                input.currentBillingCycleEnd === undefined
                  ? '2026-10-01T00:00:00Z'
                  : input.currentBillingCycleEnd,
            },
            items: [
              {
                handle: input.commercialHandle,
                description: 'Core',
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
            legacySubscriptionId: 'gid://shopify/AppSubscription/partner-core',
          },
        },
      }),
    };
  });
}
