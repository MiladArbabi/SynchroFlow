import crypto from 'crypto';
import request from 'supertest';

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
