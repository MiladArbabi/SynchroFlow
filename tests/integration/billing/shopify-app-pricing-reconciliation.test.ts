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
    token: issueTestToken({ userId, shopId, tier: 'starter', roles: ['owner'] }),
  };
}

async function subscription(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'status', 'billing_provider', 'current_period_end'),
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
