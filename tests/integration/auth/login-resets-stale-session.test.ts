//tests/integration/auth/login-resets-stale-session.test.ts

import request from 'supertest';
import db from '@lasyncro/backend-core/db.js';
import app from 'api-server';

function extractRefreshCookie(res: request.Response): string {
  const cookies = res.headers['set-cookie'];
  if (!Array.isArray(cookies)) throw new Error('No cookies');
  const refresh = cookies.find(c => c.startsWith('refreshToken='));
  if (!refresh) throw new Error('No refreshToken');
  return refresh.split(';')[0];
}

describe('Auth regression: login resurrects user after stale session', () => {
  beforeEach(async () => {
    await db('refresh_tokens').del();
    await db('users').del();
    await db('shops').del();
  });

  it('allows login to recover user after refresh token failure', async () => {
    const agent = request.agent(app);

    // 1️⃣ Register user
    const registerRes = await agent
      .post('/api/v1/auth/register')
      .send({
        email: 'resurrect@test.com',
        password: 'password123',
        firstName: 'Resurrect',
        lastName: 'User',
      });

    expect(registerRes.status).toBe(201);
    const userId = registerRes.body.user.id;
    const originalRefresh = extractRefreshCookie(registerRes);

    // 2️⃣ Simulate session corruption (revoke refresh token)
    const tokenHash = require('crypto')
      .createHash('sha256')
      .update(originalRefresh.split('=')[1])
      .digest('hex');

    await db('refresh_tokens')
      .where({ token_hash: tokenHash })
      .update({ revoked_at: new Date() });

    // 3️⃣ Refresh must now FAIL
    const refreshFail = await agent
      .post('/api/v1/auth/refresh_token')
      .send();

    expect(refreshFail.status).toBeGreaterThanOrEqual(401);

    // 4️⃣ LOGIN must still work (THIS IS THE FIX)
    const loginRes = await agent
      .post('/api/v1/auth/login')
      .send({
        email: 'resurrect@test.com',
        password: 'password123',
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.accessToken).toBeTruthy();
    expect(loginRes.body.user.id).toBe(userId);

    const newRefresh = extractRefreshCookie(loginRes);
    expect(newRefresh).not.toEqual(originalRefresh);

    // 5️⃣ New refresh token MUST work
    const refreshOk = await agent
      .post('/api/v1/auth/refresh_token')
      .send();

    expect(refreshOk.status).toBe(200);
    expect(refreshOk.body.accessToken).toBeTruthy();
  });
});