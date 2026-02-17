import request from 'supertest';
import app from 'api-server';
import db from '@lasyncro/backend-core/db.js'

describe('Auth registration → no auth side-effects (regression guard)', () => {
  beforeEach(async () => {
    await db('refresh_tokens').del();
    await db('shop_memberships').del();
    await db('users').del();
    await db('shops').del();
  });

  it('does not issue tokens, cookies, or refresh sessions on registration', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'owner@test.com',
        password: 'StrongPassword123!',
        firstName: 'Owner',
        lastName: 'User',
      });

    expect(res.status).toBe(201);

    // ❌ No auth response
    expect(res.body.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();

    // 🔍 User exists
    const user = await db('users')
      .where({ email: 'owner@test.com' })
      .first();
    expect(user).toBeDefined();

    // 🔍 Exactly one membership, OWNER
    const memberships = await db('shop_memberships')
      .where({ user_id: user.id });

    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');

    // 🔒 No refresh tokens created
    const refreshTokens = await db('refresh_tokens')
      .where({ user_id: user.id });

    expect(refreshTokens).toHaveLength(0);
  });
});