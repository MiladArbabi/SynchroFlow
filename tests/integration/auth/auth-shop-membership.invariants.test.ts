// tests/integration/auth/auth-shop-membership.invariants.test.ts

import request from 'supertest';
import app from 'api-server';
import db from '@lasyncro/backend-core/db.js';
import bcrypt from 'bcrypt';

describe('Auth invariants: shop membership resolution', () => {
  const password = 'StrongPassword123!';

  beforeEach(async () => {
    await db('refresh_tokens').del();
    await db('shop_memberships').del();
    await db('users').del();
    await db('shops').del();
  });

  async function createUser(email: string) {
    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db('users')
      .insert({
        email,
        password_hash: passwordHash,
      })
      .returning('*');

    return user;
  }

  async function createShop(name = 'Test Shop') {
    const [shop] = await db('shops')
      .insert({
        name,
        contact_email: 'shop@test.com',
        auth_secret: 'test-secret',
        primary_erp_type: 'none',
        primary_ecomm_type: 'none',
      })
      .returning('*');

    return shop;
  }

  it('fails login if user has NO active shop membership', async () => {
    const user = await createUser('no-membership@test.com');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });

    expect(res.status).toBe(403);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.error).toBe('NO_ACTIVE_SHOP_MEMBERSHIP');
  });

  it('fails login if user has MULTIPLE active shop memberships', async () => {
    const user = await createUser('multi-membership@test.com');

    const shopA = await createShop('Shop A');
    const shopB = await createShop('Shop B');

    await db('shop_memberships').insert([
      { user_id: user.id, shop_id: shopA.id, role: 'owner' },
      { user_id: user.id, shop_id: shopB.id, role: 'admin' },
    ]);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });

    // Current implementation WILL NOT enforce this → test should fail
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.accessToken).toBeUndefined();
    expect(
      String(res.body.error || '')
    ).toContain('SHOP_RESOLUTION_INVARIANT_VIOLATION');
  });

  it('allows login if user has EXACTLY ONE active shop membership', async () => {
    const user = await createUser('single-membership@test.com');
    const shop = await createShop('Single Shop');

    await db('shop_memberships').insert({
      user_id: user.id,
      shop_id: shop.id,
      role: 'owner',
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.id).toBe(user.id);
  });

  it('fails refresh token if shop membership was revoked', async () => {
    // 1️⃣ Register user (creates shop + membership + refresh token)
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'revoked-membership@test.com',
        password,
        firstName: 'Revoked',
        lastName: 'User',
      });

    expect(registerRes.status).toBe(201);

    const cookies = registerRes.headers['set-cookie'];
    const refreshCookie = cookies.find((c: string) =>
      c.startsWith('refreshToken=')
    );
    expect(refreshCookie).toBeTruthy();

    const user = await db('users')
      .where({ email: 'revoked-membership@test.com' })
      .first();

    // 2️⃣ Revoke membership
    await db('shop_memberships')
      .where({ user_id: user.id })
      .update({ revoked_at: new Date() });

    // 3️⃣ Attempt refresh
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh_token')
      .set('Cookie', refreshCookie);

    // This WILL currently FAIL — refresh does not re-check membership
    expect(refreshRes.status).toBe(403);
    expect(refreshRes.body.accessToken).toBeUndefined();
  });
});