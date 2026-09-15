import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';

import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

type Tier = 'starter' | 'core' | 'growth' | 'scale';

const app = createApp();

afterAll(async () => {
  await db.destroy();
});

async function createFixture(input: {
  tier: Tier;
  extraSeats?: number;
  activeNonOwnerSeats?: number;
  revokedNonOwnerSeats?: number;
}) {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(
      trx,
      `seat-read-${input.tier}-${unique}`,
    );
    await setTenantContext(trx, id);
    return id;
  });

  const ownerId = await withTenant(shopId, async (trx) => {
    const [owner] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `owner-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
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
      tier: input.tier,
      status: 'active',
      extra_seats: input.extraSeats ?? 0,
    });

    await trx('shop_role_permissions')
      .insert({
        shop_id: shopId,
        action: 'members:read',
        role: 'owner',
        granted: true,
      })
      .onConflict(['shop_id', 'action', 'role'])
      .merge({ granted: true });

    for (let i = 0; i < (input.activeNonOwnerSeats ?? 0); i += 1) {
      const [member] = await trx('users')
        .insert({
          shop_id: shopId,
          email: `active-${i}-${unique}@test.example`,
          password_hash: 'not_a_real_hash',
          first_name: `Active ${i}`,
          role: 'operator',
        })
        .returning('id');

      await trx('shop_memberships').insert({
        shop_id: shopId,
        user_id: member.id,
        role: 'operator',
      });
    }

    for (let i = 0; i < (input.revokedNonOwnerSeats ?? 0); i += 1) {
      const [member] = await trx('users')
        .insert({
          shop_id: shopId,
          email: `revoked-${i}-${unique}@test.example`,
          password_hash: 'not_a_real_hash',
          first_name: `Revoked ${i}`,
          role: 'operator',
        })
        .returning('id');

      await trx('shop_memberships').insert({
        shop_id: shopId,
        user_id: member.id,
        role: 'operator',
        revoked_at: new Date(),
      });
    }

    return Number(owner.id);
  });

  const token = issueTestToken({
    userId: ownerId,
    shopId,
    tier: input.tier,
    roles: ['owner'],
  });

  return { shopId, ownerId, token };
}

describe('FINAL-RECON-01B — member seat-capacity read model', () => {
  it('returns authoritative Growth capacity excluding owner/revoked seats and including add-ons', async () => {
    const fixture = await createFixture({
      tier: 'growth',
      extraSeats: 2,
      activeNonOwnerSeats: 2,
      revokedNonOwnerSeats: 1,
    });

    const res = await request(app)
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);

    // Owner + 2 active non-owner memberships are visible.
    // Revoked membership is absent.
    expect(res.body.members).toHaveLength(3);

    expect(res.body.seat_capacity).toEqual({
      tier: 'growth',
      current: 2,
      base_limit: 10,
      extra_seats: 2,
      limit: 12,
    });
  });

  it('keeps Scale finite and ignores legacy extra_seats', async () => {
    const fixture = await createFixture({
      tier: 'scale',
      extraSeats: 99,
      activeNonOwnerSeats: 3,
    });

    const res = await request(app)
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);

    expect(res.body.seat_capacity).toEqual({
      tier: 'scale',
      current: 3,
      base_limit: 25,
      extra_seats: 0,
      limit: 25,
    });
  });
});
