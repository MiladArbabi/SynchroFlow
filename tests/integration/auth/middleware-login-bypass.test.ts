//tests/integration/auth/middleware-login-bypass.test.ts
import request from 'supertest';
import db from '@lasyncro/backend-core/db.js';
import app from 'api-server';

describe('Auth middleware invariant: login bypasses stale auth state', () => {
  beforeEach(async () => {
    await db('refresh_tokens').del();
    await db('users').del();
    await db('shops').del();
  });

  it('allows login even when Authorization header contains expired or invalid JWT', async () => {
    // 1️⃣ Register user normally
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'middleware@test.com',
        password: 'password123',
        firstName: 'Middleware',
        lastName: 'Bypass',
      });

    expect(registerRes.status).toBe(201);

    // 2️⃣ Attempt login WITH A BROKEN JWT HEADER
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('Authorization', 'Bearer totally.invalid.jwt')
      .send({
        email: 'middleware@test.com',
        password: 'password123',
      });

    // 🔒 HARD ASSERTIONS
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.accessToken).toBeTruthy();
    expect(loginRes.body.user).toBeTruthy();
  });
});