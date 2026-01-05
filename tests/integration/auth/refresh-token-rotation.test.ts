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

  it('rejects reuse of an old refresh token after rotation', async () => {
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

    expect(replayRes.status).toBe(403);
    expect(replayRes.body).toMatchObject({
      error: 'SESSION_COMPROMISED',
    });
    expect(replayRes.body.accessToken).toBeUndefined();
  });

  it('rejects refresh token if token was revoked', async () => {
    const agent = request.agent(app);

    // 1️⃣ Register user
    const registerRes = await agent
      .post('/api/v1/auth/register')
      .send({
        email: 'revoked@test.com',
        password: 'password123',
        firstName: 'Revoked',
        lastName: 'Token',
      });

    expect(registerRes.status).toBe(201);

    const refreshCookie = extractRefreshCookie(registerRes);

    // 2️⃣ Revoke refresh token directly (simulate logout / admin revoke)
    const tokenHash = require('crypto')
      .createHash('sha256')
      .update(refreshCookie.split('=')[1])
      .digest('hex');

    const revoked = await db('refresh_tokens')
      .where({ token_hash: tokenHash, revoked_at: null })
      .update({ revoked_at: new Date() });

    expect(revoked).toBe(1);

    // 3️⃣ Attempt refresh with revoked token
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh_token')
      .set('Cookie', refreshCookie)
      .send();

    expect(refreshRes.status).toBe(403);
    expect(refreshRes.body?.error).toBe('SESSION_COMPROMISED');
    expect(refreshRes.body?.accessToken).toBeUndefined();
  });

  it('rejects refresh token if token is expired', async () => {
    const agent = request.agent(app);

    // 1️⃣ Register user (creates refresh token)
    const registerRes = await agent
      .post('/api/v1/auth/register')
      .send({
        email: 'expired@test.com',
        password: 'password123',
        firstName: 'Expired',
        lastName: 'Token',
      });

    expect(registerRes.status).toBe(201);

    // 2️⃣ Locate persisted refresh token
    const tokenRow = await db('refresh_tokens').first();
    expect(tokenRow).toBeTruthy();

    // 3️⃣ Force expiry in DB
    await db('refresh_tokens')
      .where({ id: tokenRow.id })
      .update({ expires_at: new Date(Date.now() - 60_000) });

    // 4️⃣ Attempt refresh
    const refreshRes = await agent
      .post('/api/v1/auth/refresh_token')
      .send();

    // 🔒 Invariant: expired token ≠ compromised
    expect(refreshRes.status).toBe(401);
    expect(refreshRes.body.error).toBe('SESSION_EXPIRED');
    expect(refreshRes.body.accessToken).toBeUndefined();
  });

});
