import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';

const app = createApp();

type Tier = 'starter' | 'core';

function issueTierToken(input: { userId: number; shopId: number; tier: Tier }) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET missing in test env');
  }

  return jwt.sign(
    {
      iss: 'auth.lasyncro.com',
      aud: 'api.lasyncro.com',
      actor_type: 'shop_user',
      user_id: input.userId,
      shop_id: input.shopId,
      shop_roles: ['owner'],
      tier: input.tier,
      scopes: [],
      session_id: `ent-mount-${input.tier}`,
      token_version: 1,
      auth_provider: 'password',
    },
    jwtSecret,
    { expiresIn: '15m' }
  );
}

describe('CONTRACT-ENT-MOUNT-01 products operator-summary entitlement parity', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  });

  it.each([
    ['starter', '/api/v1/products/operator-summary', 403],
    ['starter', '/api/v1/modules/products/operator-summary', 403],
    ['starter', '/api/v1/modules/products/operator-summary?preset=custom&from=garbage&to=garbage', 403],
    ['core', '/api/v1/products/operator-summary', 200],
    ['core', '/api/v1/modules/products/operator-summary', 200],
  ] as const)('%s GET %s -> %i', async (tier, path, expectedStatus) => {
    const token = issueTierToken({ userId: 118001, shopId: 118001, tier });

    const response = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(expectedStatus);
  });
});
