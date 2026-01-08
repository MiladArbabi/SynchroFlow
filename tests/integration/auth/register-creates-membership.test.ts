import request from 'supertest';
import app from 'api-server';
import db from 'api-db';

describe('Auth registration → membership creation invariants', () => {
  beforeEach(async () => {
    await db('shop_memberships').del();
    await db('users').del();
    await db('shops').del();
  });

  it('creates exactly one shop and one OWNER membership and does not authenticate', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'owner@test.com',
        password: 'StrongPassword123!',
        firstName: 'Owner',
        lastName: 'User',
      });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();

    const users = await db('users').where({ email: 'owner@test.com' });
    expect(users).toHaveLength(1);

    const shops = await db('shops');
    expect(shops).toHaveLength(1);

    const memberships = await db('shop_memberships').where({
      user_id: users[0].id,
      shop_id: shops[0].id,
    });

    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');
  });
});