import request from 'supertest';
import db from 'api-db';
import app from 'api-server';

function extractRefreshCookie(res: request.Response): string {
  const cookies = res.headers['set-cookie'];
  if (!Array.isArray(cookies)) throw new Error('No cookies');
  const refresh = cookies.find(c => c.startsWith('refreshToken='));
  if (!refresh) throw new Error('No refreshToken');
  return refresh.split(';')[0];
}

describe('Auth invariant: refresh token rotation & replay protection', () => {
  beforeEach(async () => {
    await db('refresh_tokens').del();
    await db('users').del();
    await db('shops').del();
  });

  it.skip('rejects reuse of an old refresh token after rotation', async () => {
    // TODO: Add integration test for refresh-token replay once
    const agent = request.agent(app);

    // 1️⃣ Register (cookie A stored internally by agent)
    const registerRes = await agent
      .post('/api/v1/auth/register')
      .send({
        email: 'rotate@test.com',
        password: 'password123',
        firstName: 'Rotate',
        lastName: 'Test',
      });

    expect(registerRes.status).toBe(201);

    const cookieA = extractRefreshCookie(registerRes);

    // 2️⃣ First refresh — MUST use agent
    const refreshRes1 = await agent
      .post('/api/v1/auth/refresh_token')
      .send();

    expect(refreshRes1.status).toBe(200);

    const cookieB = extractRefreshCookie(refreshRes1);
    expect(cookieB).not.toEqual(cookieA);

    // 3️⃣ Replay attack — raw request with OLD cookie
    const replayRes = await request(app)
      .post('/api/v1/auth/refresh_token')
      .set('Cookie', cookieA)
      .send();

    expect([401, 403]).toContain(replayRes.status);
    expect(replayRes.body?.accessToken).toBeUndefined();
  });
});
