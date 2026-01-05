// tests/unit/backend/auth/token.service.issueAuthTokens.test.ts
import jwt from 'jsonwebtoken';
import db from 'api-db';
import { issueAuthTokens } from 'api-src/api/auth/token.service';
import * as TokenService from 'api-src/api/auth/token.service';

const JWT_SECRET = 'test-jwt-secret';
const JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';

describe('token.service — issueAuthTokens()', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = JWT_REFRESH_SECRET;
  });

  beforeEach(async () => {
    // Clean slate
    await db('refresh_tokens').del();
    await db('users').del();

    // Seed a valid user
    await db('users').insert({
      id: 1,
      email: 'test@lasyncro.com',
      password_hash: 'hash',
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('rejects non-integer userId', async () => {
    await expect(
      issueAuthTokens({ userId: '1' as any })
    ).rejects.toThrow(/invalid userId/i);
  });

  it('rejects non-existent user', async () => {
    await expect(
      issueAuthTokens({ userId: 999 })
    ).rejects.toThrow(/user does not exist/i);
  });

  it('issues a valid access token with userId claim', async () => {
    const { accessToken } = await issueAuthTokens({ userId: 1 })

    const decoded = jwt.verify(accessToken, JWT_SECRET) as any;

   expect(decoded).toHaveProperty('user_id', 1);
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  it('issues and persists a refresh token hash', async () => {
    const { refreshToken } = await issueAuthTokens({ userId: 1 })

    const rows = await db('refresh_tokens').select('*');

    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveProperty('user_id', 1);
    expect(rows[0]).toHaveProperty('token_hash');
    expect(rows[0].revoked_at).toBeNull();
  });

  it('never stores the raw refresh token', async () => {
    const { refreshToken } = await issueAuthTokens({ userId: 1 })

    const rows = await db('refresh_tokens').select('*');

    expect(rows[0].token_hash).not.toEqual(refreshToken);
  });

  it('fails hard if refresh token persistence fails', async () => {
    jest
        .spyOn(TokenService.tokenPersistence, 'persistRefreshToken')
        .mockRejectedValueOnce(new Error('DB_WRITE_FAILED'));

    await expect(
        issueAuthTokens({ userId: 1 })
    ).rejects.toThrow(/refresh token not persisted/i);
  });
});