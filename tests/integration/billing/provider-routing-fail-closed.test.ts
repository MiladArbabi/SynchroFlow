import crypto from 'crypto';
import request from 'supertest';
// W1-A D4: SDK boundary installed before importing the real app.
const mockCheckout = jest.fn();
const mockPortal = jest.fn();
const mockSeat = jest.fn();
const mockCustomer = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({
  checkout: { sessions: { create: (...args: any[]) => mockCheckout(...args) } },
  billingPortal: { sessions: { create: (...args: any[]) => mockPortal(...args) } },
  subscriptionItems: { create: (...args: any[]) => mockSeat(...args) },
  customers: { create: (...args: any[]) => mockCustomer(...args) },
})) }));
jest.mock('api-src/utils/analytics', () => ({ captureEvent: jest.fn() }));

import { createApp } from 'api-src/bootstrap/express';
import db, {
  systemTransaction,
  setTenantContext,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

const originalStripeKey = process.env.STRIPE_SECRET_KEY;

beforeAll(() => {
  // Safety: RED must never reach Stripe over the network.
  delete process.env.STRIPE_SECRET_KEY;
});

afterAll(async () => {
  if (originalStripeKey !== undefined) {
    process.env.STRIPE_SECRET_KEY = originalStripeKey;
  }
  await db.destroy();
});

async function unresolvedProviderFixture() {
  const suffix = crypto.randomBytes(5).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `provider-unresolved-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });

  const ownerId = await withTenant(shopId, async (trx) => {
    const [owner] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `owner-${suffix}@test.example`,
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

    for (const action of ['billing:read', 'billing:write']) {
      await trx('shop_role_permissions')
        .insert({
          shop_id: shopId,
          action,
          role: 'owner',
          granted: true,
        })
        .onConflict(['shop_id', 'action', 'role'])
        .merge({ granted: true });
    }

    return Number(owner.id);
  });

  return {
    shopId,
    token: issueTestToken({
      userId: ownerId,
      shopId,
      tier: 'starter',
      roles: ['owner'],
    }),
  };
}

describe('MON-REM-01B-4 — billing provider routing fails closed', () => {
  it('D4: Shopify-owned routes reject before SDK calls; eligible Stripe routes use only local SDK stubs', async () => {
    const shopify = await unresolvedProviderFixture();
    const stripe = await unresolvedProviderFixture();
    for (const f of [shopify, stripe]) {
      await withTenant(f.shopId, trx => trx('shop_subscriptions').insert({ shop_id: f.shopId, tier: 'growth', status: 'active', billing_provider: f === shopify ? 'shopify' : 'stripe', stripe_customer_id: `cus_w1_${f.shopId}`, stripe_subscription_id: `sub_w1_${f.shopId}`, billing_currency: 'USD' }));
    }
    const previousKey = process.env.STRIPE_SECRET_KEY;
    const envKeys = ['STRIPE_PRICE_SELF_SERVE_CORE_MONTHLY_USD', 'STRIPE_PRICE_SEAT_ADDON_GROWTH_USD'];
    const previousPrices = envKeys.map(key => process.env[key]);
    process.env.STRIPE_SECRET_KEY = 'sk_test_w1_local_stub_only';
    process.env.STRIPE_PRICE_SELF_SERVE_CORE_MONTHLY_USD = 'price_w1_core';
    process.env.STRIPE_PRICE_SEAT_ADDON_GROWTH_USD = 'price_w1_seat_growth';
    mockCheckout.mockReset().mockResolvedValue({ id: 'cs_w1_local', url: 'https://example.test/checkout' });
    mockPortal.mockReset().mockResolvedValue({ url: 'https://example.test/portal' });
    mockSeat.mockReset().mockResolvedValue({ id: 'si_w1_local' });
    mockCustomer.mockReset();
    try {
      const routes = [
        { path: '/api/v1/billing/checkout', body: { tier: 'core', interval: 'monthly' } },
        { path: '/api/v1/billing/setup-payment-method', body: {} },
        { path: '/api/v1/billing/portal', body: {} },
        { path: '/api/v1/billing/add-seats', body: { quantity: 1 } },
      ];
      for (const route of routes) {
        const rejected = await request(app).post(route.path).set('Authorization', `Bearer ${shopify.token}`).send(route.body);
        expect(rejected.status).toBe(403);
        expect(rejected.body).toEqual({ error: 'APP_STORE_MERCHANT' });
      }
      for (const mock of [mockCheckout, mockPortal, mockSeat, mockCustomer]) expect(mock).not.toHaveBeenCalled();
      for (const route of routes) {
        const accepted = await request(app).post(route.path).set('Authorization', `Bearer ${stripe.token}`).send(route.body);
        expect(accepted.status).toBe(200);
      }
      expect(mockCheckout).toHaveBeenCalledTimes(2);
      expect(mockPortal).toHaveBeenCalledTimes(1);
      expect(mockSeat).toHaveBeenCalledTimes(1);
      expect(mockCustomer).not.toHaveBeenCalled();
    } finally {
      if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousKey;
      envKeys.forEach((key, i) => { if (previousPrices[i] === undefined) delete process.env[key]; else process.env[key] = previousPrices[i]; });
    }
  });
  it('does not manufacture Stripe ownership when no subscription exists', async () => {
    const f = await unresolvedProviderFixture();

    const res = await request(app)
      .get('/api/v1/billing/subscription')
      .set('Authorization', `Bearer ${f.token}`);

    expect(res.status).toBe(200);
    expect(res.body.billing_provider).toBeNull();
    expect(res.body.manage_billing_url).toBeNull();
  });

  it.each([
    {
      name: 'checkout',
      path: '/api/v1/billing/checkout',
      body: { tier: 'core', interval: 'monthly' },
    },
    {
      name: 'setup payment method',
      path: '/api/v1/billing/setup-payment-method',
      body: {},
    },
    {
      name: 'portal',
      path: '/api/v1/billing/portal',
      body: {},
    },
    {
      name: 'add seats',
      path: '/api/v1/billing/add-seats',
      body: { quantity: 1 },
    },
  ])('$name fails closed before Stripe when provider is unresolved', async ({ path, body }) => {
    const f = await unresolvedProviderFixture();

    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${f.token}`)
      .send(body);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'BILLING_PROVIDER_UNRESOLVED',
    });
  });
});
