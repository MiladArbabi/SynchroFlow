// apps/backend/src/api/auth/token.service.ts

/**
 * Auth Token Issuance Service
 * ==========================
 *
 * This file is the SINGLE authority for issuing authentication tokens
 * in LaSyncro.
 *
 * 🔒 Contract-bound to:
 *   - Auth & Permissions Contract v1
 *   - auth.middleware identity enforcement
 *   - frontend single-flight refresh semantics
 *
 * Any change here MUST be reflected in:
 *   - auth middleware tests
 *   - refresh token handling
 *   - Auth contract versioning
 *
 * Violating identity invariants here can cause:
 *   - user identity loss
 *   - forced re-registration bugs
 *   - cross-session corruption
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../../db';

/**
 * Hash refresh tokens before persistence.
 * Raw refresh tokens are NEVER stored.
 */
const hashRefreshToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

/**
 * Parameters required to issue auth tokens.
 * This shape is LOCKED by Auth Contract v1.
 */
export interface IssueAuthTokensParams {
  // 🔒 HARD INVARIANT
  userId: number;

  // ── Optional, context-dependent ──
  shopId?: number;
  actorType?: 'shop_user' | 'system_service' | 'support_admin';
  authProvider?: 'password' | 'shopify' | 'sso' | 'service';

  shopRoles?: string[];
  scopes?: string[];

  // Defaults to 1 if omitted
  tokenVersion?: number;
}

// ─────────────────────────────────────────────────────────────
// 🔌 Persistence boundary (TESTABLE SEAM)
// ─────────────────────────────────────────────────────────────
export async function persistRefreshToken(record: {
  user_id: number;
  shop_id?: number;
  session_id: string;
  token_version?: number;
  token_hash: string;
  expires_at: Date;
}): Promise<{ id: number }[]> {
  return db('refresh_tokens')
    .insert(record)
    .returning('id');
}

/**
 * Issue a new access token + refresh token pair.
 *
 * Guarantees:
 * - Canonical identity claims are ALWAYS present
 * - session_id is unique per issuance
 * - refresh tokens are bound to session + token_version
 * - refresh tokens are persistently stored before returning
 *
 * @throws AUTH_INVARIANT_VIOLATION on any identity or persistence failure
 */

// ─────────────────────────────────────────────────────────────
// 🔌 Persistence dependencies (overrideable for tests)
// ─────────────────────────────────────────────────────────────
export const tokenPersistence = {
  persistRefreshToken,
};

export async function issueAuthTokens(
  params: IssueAuthTokensParams
): Promise<{ accessToken: string; refreshToken: string }> {
  const {
    userId,
    shopId,
    actorType,
    authProvider,
    shopRoles,
    scopes,
    tokenVersion,
  } = params;

  // ─────────────────────────────────────────────────────────────
  // 🔒 Identity invariants (HARD FAILURES)
  // ─────────────────────────────────────────────────────────────

  if (!Number.isInteger(userId)) {
    throw new Error('AUTH_INVARIANT_VIOLATION: invalid userId');
  }

  if (actorType === 'shop_user' && !Number.isInteger(shopId)) {
    throw new Error('AUTH_INVARIANT_VIOLATION: shop_user missing shopId');
  }

  // ─────────────────────────────────────────────────────────────
  // 🔐 Secrets validation
  // ─────────────────────────────────────────────────────────────

  const jwtSecret = process.env.JWT_SECRET;
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || jwtSecret;

  if (!jwtSecret || !jwtRefreshSecret) {
    throw new Error('AUTH_INVARIANT_VIOLATION: JWT secrets are not set');
  }

  // ─────────────────────────────────────────────────────────────
  // 🔒 User existence invariant
  // ─────────────────────────────────────────────────────────────

  const userExists = await db('users')
    .where({ id: userId })
    .first('id');

  if (!userExists) {
    throw new Error('AUTH_INVARIANT_VIOLATION: user does not exist');
  }

  // ─────────────────────────────────────────────────────────────
  // 🔐 Session anchor
  // ─────────────────────────────────────────────────────────────

  const sessionId = crypto.randomUUID();

  // ─────────────────────────────────────────────────────────────
  // 🔐 Access Token (JWT)
  // ─────────────────────────────────────────────────────────────
  // Short-lived, identity-rich, strictly validated by middleware

  const accessToken = jwt.sign(
    {
      iss: 'auth.lasyncro.com',
      aud: 'api.lasyncro.com',

      actor_type: actorType,
      user_id: userId,
      shop_id: shopId,

      shop_roles: shopRoles,
      scopes,

      session_id: sessionId,
      token_version: tokenVersion,
      auth_provider: authProvider,
    },
    jwtSecret,
    {
      expiresIn: '15m',
    }
  );

  // ─────────────────────────────────────────────────────────────
  // 🔁 Refresh Token (Opaque to clients)
  // ─────────────────────────────────────────────────────────────
  // Used ONLY by Auth service. Bound to session + token_version.

  const refreshToken = jwt.sign(
    {
      user_id: userId,
      session_id: sessionId,
      token_version: tokenVersion,
    },
    jwtRefreshSecret,
    {
      expiresIn: '7d',
    }
  );

  // ─────────────────────────────────────────────────────────────
  // 💾 Persist refresh token (server-side truth)
  // ─────────────────────────────────────────────────────────────

  const tokenHash = hashRefreshToken(refreshToken);

  let inserted: { id: number }[];

    try {
      inserted = await tokenPersistence.persistRefreshToken({
        user_id: userId,
        shop_id: shopId,
        session_id: sessionId,
        token_version: tokenVersion,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    } catch {
      throw new Error('AUTH_INVARIANT_VIOLATION: refresh token not persisted');
    }

    if (!inserted.length) {
      throw new Error('AUTH_INVARIANT_VIOLATION: refresh token not persisted');
    }


  // ─────────────────────────────────────────────────────────────
  // ✅ Success
  // ─────────────────────────────────────────────────────────────

  return {
    accessToken,
    refreshToken,
  };
}