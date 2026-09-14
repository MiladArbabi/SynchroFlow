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

async function fixture() {
  const suffix = crypto.randomBytes(5).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `surface-${suffix}`);
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

    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      status: 'active',
      billing_interval: 'monthly',
      billing_currency: 'USD',
      billing_provider: 'stripe',
      allow_overage: true,
      extra_seats: 0,
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
      tier: 'core',
      roles: ['owner'],
    }),
  };
}

afterAll(async () => {
  await db.destroy();
});

describe('MON-REM-01B-4 — merchant billing API surface', () => {
  it('subscription response does not expose allow_overage', async () => {
    const f = await fixture();

    const res = await request(app)
      .get('/api/v1/billing/subscription')
      .set('Authorization', `Bearer ${f.token}`);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('allow_overage');
  });

  it('obsolete overage preference mutation is not routable', async () => {
    const f = await fixture();

    const res = await request(app)
      .patch('/api/v1/billing/overage')
      .set('Authorization', `Bearer ${f.token}`)
      .send({ allow_overage: false });

    expect(res.status).toBe(404);
  });
});
