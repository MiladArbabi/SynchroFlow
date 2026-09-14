// MON-REM-01B-3 — seat-capacity commercial enforcement
//
// Real POST /api/v1/members route + disposable PostgreSQL.
// Commercial capacity must come from live shop_subscriptions, never JWT tier.
// Active non-owner memberships consume seats; owners and revoked memberships do not.

import crypto from 'crypto';
import request from 'supertest';
import bcrypt from 'bcrypt';

import { createApp } from 'api-src/bootstrap/express';
import * as emailService from 'api-src/services/email/email.service';

import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';

import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

type Tier = 'starter' | 'core' | 'growth' | 'scale';

type Fixture = {
  shopId: number;
  ownerId: number;
  token: string;
  memberIds: number[];
};

const app = createApp();

beforeAll(() => {
  jest
    .spyOn(emailService, 'sendOperatorInviteEmail')
    .mockResolvedValue(undefined);
});

afterAll(async () => {
  jest.restoreAllMocks();
  await db.destroy();
});

async function createFixture(input: {
  tier: Tier;
  jwtTier?: Tier;
  extraSeats?: number;
  activeSeats?: number;
}): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `seat-${input.tier}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const { ownerId, memberIds } = await withTenant(shopId, async (trx) => {
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

    // Keep the route permission deterministic and independent of seed state.
    await trx('shop_role_permissions')
      .insert({
        shop_id: shopId,
        action: 'members:write',
        role: 'owner',
        granted: true,
      })
      .onConflict(['shop_id', 'action', 'role'])
      .merge({ granted: true });

    const memberIds: number[] = [];

    for (let i = 0; i < (input.activeSeats ?? 0); i += 1) {
      const [user] = await trx('users')
        .insert({
          shop_id: shopId,
          email: `member-${i}-${unique}@test.example`,
          password_hash: 'not_a_real_hash',
          first_name: `Member ${i}`,
          role: 'operator',
        })
        .returning('id');

      memberIds.push(Number(user.id));

      await trx('shop_memberships').insert({
        shop_id: shopId,
        user_id: user.id,
        role: 'operator',
      });
    }

    return {
      ownerId: Number(owner.id),
      memberIds,
    };
  });

  const token = issueTestToken({
    userId: ownerId,
    shopId,
    tier: input.jwtTier ?? input.tier,
    roles: ['owner'],
  });

  return { shopId, ownerId, token, memberIds };
}

function invite(token: string, email: string) {
  return request(app)
    .post('/api/v1/members')
    .set('Authorization', `Bearer ${token}`)
    .send({
      email,
      first_name: 'New',
      last_name: 'Operator',
      role: 'operator',
    });
}

async function activeNonOwnerSeats(shopId: number): Promise<number> {
  const row = await withTenant(shopId, (trx) =>
    trx('shop_memberships')
      .where({ shop_id: shopId })
      .whereNull('revoked_at')
      .whereNot('role', 'owner')
      .count('id as count')
      .first()
  );

  return Number(row?.count ?? 0);
}

describe('MON-REM-01B-3 — member seat commercial enforcement', () => {
  it('EXPECTED RED: live Starter subscription wins over stale Scale JWT', async () => {
    const fixture = await createFixture({
      tier: 'starter',
      jwtTier: 'scale',
    });

    const res = await invite(
      fixture.token,
      `stale-scale-${crypto.randomUUID()}@test.example`
    );

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: 'SEAT_LIMIT_REACHED',
      current: 0,
      limit: 0,
      tier: 'starter',
    });

    expect(await activeNonOwnerSeats(fixture.shopId)).toBe(0);
  });

  it('EXPECTED RED: live Core subscription wins over stale Starter JWT', async () => {
    const fixture = await createFixture({
      tier: 'core',
      jwtTier: 'starter',
    });

    const res = await invite(
      fixture.token,
      `stale-starter-${crypto.randomUUID()}@test.example`
    );

    expect(res.status).toBe(201);
    expect(await activeNonOwnerSeats(fixture.shopId)).toBe(1);
  });

  it('EXPECTED RED: concurrent invites cannot consume the same last Core seat', async () => {
    const fixture = await createFixture({
      tier: 'core',
      activeSeats: 2,
    });

    // Deterministically expose today's race:
    // both requests must reach password hashing before either can continue.
    // Today hashing happens AFTER the separate quota read, so both requests
    // have already observed the same final available seat.
    //
    // Correct implementation may hash before entering the serialized quota
    // transaction; this barrier remains valid and avoids holding a DB lock
    // during bcrypt work.
    let entered = 0;
    let release!: () => void;

    const bothAtHash = new Promise<void>((resolve) => {
      release = resolve;
    });

    const hashSpy = jest
      .spyOn(bcrypt, 'hash')
      .mockImplementation(async () => {
        entered += 1;
        if (entered === 2) release();

        await bothAtHash;
        return 'deterministic_test_hash';
      });

    try {
      const [a, b] = await Promise.all([
        invite(
          fixture.token,
          `race-a-${crypto.randomUUID()}@test.example`
        ),
        invite(
          fixture.token,
          `race-b-${crypto.randomUUID()}@test.example`
        ),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 403]);

      const denied = [a, b].find((r) => r.status === 403);
      expect(denied?.body?.error).toBe('SEAT_LIMIT_REACHED');

      expect(await activeNonOwnerSeats(fixture.shopId)).toBe(3);
    } finally {
      hashSpy.mockRestore();
    }
  });

  it('GREEN CONTROL: Starter has zero non-owner seats', async () => {
    const fixture = await createFixture({ tier: 'starter' });

    const res = await invite(
      fixture.token,
      `starter-${crypto.randomUUID()}@test.example`
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('SEAT_LIMIT_REACHED');
    expect(res.body.limit).toBe(0);
  });

  it.each([
    ['core', 3],
    ['growth', 10],
    ['scale', 25],
  ] as const)(
    'GREEN CONTROL: %s permits final included seat then rejects N+1',
    async (tier, limit) => {
      const fixture = await createFixture({
        tier,
        activeSeats: limit - 1,
      });

      const atBoundary = await invite(
        fixture.token,
        `${tier}-boundary-${crypto.randomUUID()}@test.example`
      );

      expect(atBoundary.status).toBe(201);
      expect(await activeNonOwnerSeats(fixture.shopId)).toBe(limit);

      const beyond = await invite(
        fixture.token,
        `${tier}-beyond-${crypto.randomUUID()}@test.example`
      );

      expect(beyond.status).toBe(403);
      expect(beyond.body).toMatchObject({
        error: 'SEAT_LIMIT_REACHED',
        current: limit,
        limit,
        tier,
      });
    }
  );

  it.each([
    ['core', 3],
    ['growth', 10],
  ] as const)(
    'GREEN CONTROL: %s purchased extra_seats extend finite capacity',
    async (tier, baseLimit) => {
      const fixture = await createFixture({
        tier,
        extraSeats: 2,
        activeSeats: baseLimit + 1,
      });

      const finalSeat = await invite(
        fixture.token,
        `${tier}-extra-final-${crypto.randomUUID()}@test.example`
      );

      expect(finalSeat.status).toBe(201);
      expect(await activeNonOwnerSeats(fixture.shopId)).toBe(baseLimit + 2);

      const beyond = await invite(
        fixture.token,
        `${tier}-extra-beyond-${crypto.randomUUID()}@test.example`
      );

      expect(beyond.status).toBe(403);
      expect(beyond.body.limit).toBe(baseLimit + 2);
      expect(beyond.body.extra_seats).toBe(2);
    }
  );

  it('GREEN CONTROL: Scale remains finite and ignores legacy extra_seats', async () => {
    const fixture = await createFixture({
      tier: 'scale',
      extraSeats: 99,
      activeSeats: 25,
    });

    const res = await invite(
      fixture.token,
      `scale-finite-${crypto.randomUUID()}@test.example`
    );

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: 'SEAT_LIMIT_REACHED',
      current: 25,
      limit: 25,
      base_limit: 25,
      extra_seats: 0,
      tier: 'scale',
    });
  });

  it('GREEN CONTROL: revoked non-owner membership releases capacity', async () => {
    const fixture = await createFixture({
      tier: 'core',
      activeSeats: 3,
    });

    await withTenant(fixture.shopId, (trx) =>
      trx('shop_memberships')
        .where({
          shop_id: fixture.shopId,
          user_id: fixture.memberIds[0],
        })
        .update({
          revoked_at: new Date(),
          updated_at: new Date(),
        })
    );

    expect(await activeNonOwnerSeats(fixture.shopId)).toBe(2);

    const res = await invite(
      fixture.token,
      `after-revoke-${crypto.randomUUID()}@test.example`
    );

    expect(res.status).toBe(201);
    expect(await activeNonOwnerSeats(fixture.shopId)).toBe(3);
  });

  it('GREEN CONTROL: owner membership never consumes a non-owner seat', async () => {
    const fixture = await createFixture({
      tier: 'core',
      activeSeats: 2,
    });

    // Fixture already contains one active owner plus two non-owner seats.
    expect(await activeNonOwnerSeats(fixture.shopId)).toBe(2);

    const res = await invite(
      fixture.token,
      `owner-not-seat-${crypto.randomUUID()}@test.example`
    );

    expect(res.status).toBe(201);
    expect(await activeNonOwnerSeats(fixture.shopId)).toBe(3);
  });
});
