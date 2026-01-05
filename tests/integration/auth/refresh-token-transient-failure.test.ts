import request from 'supertest';
import db from 'api-db';
import app from 'api-server';

describe('Auth invariant: transient refresh failure does not destroy session', () => {
  beforeEach(async () => {
    jest.resetModules(); // 🔑 critical
    await db('refresh_tokens').del();
    await db('users').del();
    await db('shops').del();
  });

  it('allows retry after transient refresh failure without forcing logout', async () => {
    const agent = request.agent(app);

    // 1️⃣ Register user (REAL token issuance)
    const registerRes = await agent
      .post('/api/v1/auth/register')
      .send({
        email: 'transient@test.com',
        password: 'password123',
        firstName: 'Transient',
        lastName: 'Failure',
      });

    expect(registerRes.status).toBe(201);

    // 2️⃣ NOW mock issueAuthTokens
    jest.doMock('api-src/api/auth/token.service', () => {
      const actual = jest.requireActual('api-src/api/auth/token.service');
      return {
        ...actual,
        issueAuthTokens: jest
          .fn()
          .mockImplementationOnce(() => {
            throw new Error('Transient signing failure');
          })
          .mockImplementation(actual.issueAuthTokens),
      };
    });

    // Re-import app so controller picks up mock
    const { default: mockedApp } = await import('api-server');

    const failingAgent = request.agent(mockedApp);

    // Copy cookies
    failingAgent.jar.setCookie(
      registerRes.headers['set-cookie'][0]
    );

    // 3️⃣ First refresh → TRANSIENT FAILURE
    const transientRes = await failingAgent
      .post('/api/v1/auth/refresh_token')
      .send();

    expect(transientRes.status).toBe(503);
    expect(transientRes.body).toMatchObject({
      error: 'REFRESH_TEMPORARILY_UNAVAILABLE',
      retryable: true,
    });

    // 🔒 Token NOT revoked
    const tokenAfterFailure = await db('refresh_tokens').first();
    expect(tokenAfterFailure).toBeTruthy();
    expect(tokenAfterFailure.revoked_at).toBeNull();

    // 4️⃣ Retry refresh → MUST SUCCEED
    const retryRes = await failingAgent
      .post('/api/v1/auth/refresh_token')
      .send();

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.accessToken).toBeTruthy();
  });
});