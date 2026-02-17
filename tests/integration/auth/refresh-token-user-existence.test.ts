//tests/integration/auth/refresh-token-user-existence.test.ts

import request from 'supertest';
import db from '@lasyncro/backend-core/db.js';
import app from 'api-server';

describe('Auth invariant: refresh token requires existing user', () => {
  beforeEach(async () => {
    // Clean auth-related state deterministically
    await db('users').del();
    await db('shops').del();
  });

  it('rejects refresh token if user no longer exists', async () => {
    const agent = request.agent(app);

    // 1. Register a user (creates shop + user)
    const registerRes = await agent
      .post('/api/v1/auth/register')
      .send({
        email: 'refresh-test@example.com',
        password: 'password123',
        firstName: 'Refresh',
        lastName: 'Test',
      });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.accessToken).toBeTruthy();

    // 2. Ensure user exists in DB
    const user = await db('users')
      .where({ email: 'refresh-test@example.com' })
      .first();

    expect(user).toBeTruthy();

    // 3. Delete the user (simulates DB reset / uninstall / corruption)
    await db('users').where({ id: user.id }).del();

    // 4. Attempt to refresh token using existing refresh cookie
    const refreshRes = await agent
      .post('/api/v1/auth/refresh_token')
      .send();

    // 🔴 Invariant: refresh MUST fail if user is gone
    expect([401, 403]).toContain(refreshRes.status);
    expect(refreshRes.body.accessToken).toBeUndefined();
  });
});