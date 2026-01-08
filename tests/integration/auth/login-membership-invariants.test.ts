import request from 'supertest';
import app from 'api-server';
import db from 'api-db';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

describe('Auth login → membership invariants', () => {
  beforeEach(async () => {
    await db('refresh_tokens').del();
    await db('shop_memberships').del();
    await db('users').del();
    await db('shops').del();
  });

  it('rejects login when user has NO active shop membership', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    await db('users').insert({
      email: 'no-membership@test.com',
      password_hash: passwordHash,
      first_name: 'No',
      last_name: 'Membership',
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'no-membership@test.com',
        password: 'Password123!',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NO_ACTIVE_SHOP_MEMBERSHIP');
    expect(res.body.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects login when user has MULTIPLE active shop memberships', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    const [shopA] = await db('shops')
    .insert({
        name: 'Shop A',
        contact_email: 'a@test.com',
        auth_secret: crypto.randomBytes(32).toString('hex'),
        primary_erp_type: 'none',
        primary_ecomm_type: 'none',
    })
    .returning('id');

    const [shopB] = await db('shops')
    .insert({
        name: 'Shop B',
        contact_email: 'b@test.com',
        auth_secret: crypto.randomBytes(32).toString('hex'),
        primary_erp_type: 'none',
        primary_ecomm_type: 'none',
    })
    .returning('id');

    const [user] = await db('users')
      .insert({
        email: 'multi@test.com',
        password_hash: passwordHash,
        first_name: 'Multi',
        last_name: 'Member',
      })
      .returning('*');

    await db('shop_memberships').insert([
      { shop_id: shopA.id, user_id: user.id, role: 'owner' },
      { shop_id: shopB.id, user_id: user.id, role: 'owner' },
    ]);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'multi@test.com',
        password: 'Password123!',
      });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('SHOP_RESOLUTION_INVARIANT_VIOLATION');
    expect(res.body.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});