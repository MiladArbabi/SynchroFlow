//apps/backend/src/api/auth/token.service.ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../../db';

const hashRefreshToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export async function issueAuthTokens(
  userId: number
): Promise<{ accessToken: string; refreshToken: string }> {
  if (!Number.isInteger(userId)) {
    throw new Error('AUTH_INVARIANT_VIOLATION: invalid userId');
  }

  const jwtSecret = process.env.JWT_SECRET;
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || jwtSecret;

  if (!jwtSecret || !jwtRefreshSecret) {
    throw new Error('JWT secrets are not set');
  }

  // 🔒 Invariant: user must exist
  const userExists = await db('users')
    .where({ id: userId })
    .first('id');

  if (!userExists) {
    throw new Error('AUTH_INVARIANT_VIOLATION: user does not exist');
  }

  const accessToken = jwt.sign(
    { userId },
    jwtSecret,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { userId },
    jwtRefreshSecret,
    { expiresIn: '7d' }
  );

  const tokenHash = hashRefreshToken(refreshToken);

  const inserted = await db('refresh_tokens').insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }).returning('id');

  if (!inserted || inserted.length === 0) {
    throw new Error('AUTH_INVARIANT_VIOLATION: refresh token not persisted');
  }

  return {
    accessToken,
    refreshToken,
  };
}