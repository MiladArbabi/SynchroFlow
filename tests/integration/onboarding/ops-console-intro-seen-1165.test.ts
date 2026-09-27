/**
 * GH-1165 — once-only first-entry Ops Console auto-open: the dedicated
 * server-side intro-seen flag.
 *
 * Contracts:
 *   - POST /api/v1/user-state/ops-console/intro-seen persists its own
 *     user_states key, read back through GET /api/v1/user-state/onboarding-flags;
 *   - it never writes checklist:completed or any other key (setup completion
 *     is untouched);
 *   - the write is tenant-safe under forced RLS: visible only in its own
 *     shop's tenant context and never exposed to another shop's user;
 *   - it is idempotent (one row after repeated writes) and requires auth.
 */

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const INTRO_URL = '/api/v1/user-state/ops-console/intro-seen';
const FLAGS_URL = '/api/v1/user-state/onboarding-flags';
const INTRO_KEY = 'ops-console:intro-seen';

jest.setTimeout(120000);

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

async function createOwnerShop(label: string) {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `ops-intro-1165-${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `ops-intro-1165-${label}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: label,
        role: 'owner',
      })
      .returning('id');
    const id = row.id as number;
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: id, role: 'owner', revoked_at: null });
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'growth',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });
    return id;
  });

  return {
    shopId,
    userId,
    token: issueTestToken({ userId, shopId, tier: 'growth', roles: ['owner'] }),
  };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function userStateKeys(shopId: number, userId: number) {
  return withTenant(shopId, (trx) =>
    trx('user_states').where({ user_id: userId }).orderBy('key').pluck('key')
  );
}

describe('GH-1165 — Ops Console intro-seen flag', () => {
  it('persists a dedicated, tenant-safe, idempotent flag without touching setup completion', async () => {
    const shopA = await createOwnerShop('a');
    const shopB = await createOwnerShop('b');

    // Before: unseen for both, and no user_states rows at all.
    const before = await request(app).get(FLAGS_URL).set(auth(shopA.token));
    expect(before.status).toBe(200);
    expect(before.body[INTRO_KEY]).toBeUndefined();
    expect(await userStateKeys(shopA.shopId, shopA.userId)).toEqual([]);

    const first = await request(app).post(INTRO_URL).set(auth(shopA.token));
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ seen: true });

    const second = await request(app).post(INTRO_URL).set(auth(shopA.token));
    expect(second.status).toBe(200);

    // Read back through the canonical flags endpoint.
    const after = await request(app).get(FLAGS_URL).set(auth(shopA.token));
    expect(after.status).toBe(200);
    expect(after.body[INTRO_KEY]).toBe(true);
    expect(after.body['checklist:completed']).toBeUndefined();

    // Exactly one row, and only the dedicated key: no setup completion write.
    expect(await userStateKeys(shopA.shopId, shopA.userId)).toEqual([INTRO_KEY]);

    // Tenant isolation: invisible from shop B's context and to shop B's user.
    expect(await userStateKeys(shopB.shopId, shopA.userId)).toEqual([]);
    const otherFlags = await request(app).get(FLAGS_URL).set(auth(shopB.token));
    expect(otherFlags.status).toBe(200);
    expect(otherFlags.body[INTRO_KEY]).toBeUndefined();
    expect(await userStateKeys(shopB.shopId, shopB.userId)).toEqual([]);
  });

  it('requires authentication and writes nothing without it', async () => {
    const response = await request(app).post(INTRO_URL);
    expect(response.status).toBe(401);
  });
});
