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
import { withTenant } from '@lasyncro/backend-core/db.js';
import { resolveTierForShop } from '@lasyncro/backend-core/services/shop-resolution.service.js';

console.log('[AUTH][ENV_CHECK]', {
  JWT_SECRET: !!process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: !!process.env.JWT_REFRESH_SECRET,
  NODE_ENV: process.env.NODE_ENV,
});

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

  /**
   * REQUIRED for all persisted tokens.
   * DB enforces NOT NULL → contract must match persistence layer.
   */
  shopId: number;
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
  /**
   * MUST always be present.
   * Mirrors DB invariant: refresh_tokens.shop_id NOT NULL
   */
  shop_id: number;
  session_id: string;
  token_version?: number;
  token_hash: string;
  expires_at: Date;
}): Promise<{ id: number }[]> {
  return withTenant(record.shop_id, (trx) =>
    trx('refresh_tokens')
      .insert(record)
      .returning('id')
  );
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
    shopRoles = [],
    scopes = [],
    tokenVersion = 1,
  } = params;

  // ─────────────────────────────────────────────────────────────
  // 🔒 Identity invariants (HARD FAILURES)
  // ─────────────────────────────────────────────────────────────

  if (!Number.isInteger(userId)) {
    throw new Error('AUTH_INVARIANT_VIOLATION: invalid userId');
  }

  /**
   * 🔒 CRITICAL: Persistence invariant
   * DB requires shop_id NOT NULL for ALL tokens.
   * No token may be issued without tenant ownership.
   */
  if (!Number.isInteger(shopId)) {
    throw new Error('AUTH_INVARIANT_VIOLATION: shopId required for token persistence');
  }

  if (!actorType) {
    throw new Error('AUTH_INVARIANT_VIOLATION: missing actorType');
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

  const userExists = await withTenant(shopId, (trx) =>
    trx('users')
      .where({ id: userId, shop_id: shopId })
      .first('id', 'email', 'first_name')
  );

  if (!userExists) {
    throw new Error('AUTH_INVARIANT_VIOLATION: user does not exist');
  }

  // ─────────────────────────────────────────────────────────────
  // 🔐 Session anchor
  // ─────────────────────────────────────────────────────────────

  const sessionId = crypto.randomUUID();

  // Resolve subscription tier for JWT claim (MON-03)
  // Falls back to 'starter' — never blocks token issuance
  const tier = await resolveTierForShop(shopId);

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

      email: userExists.email,
      first_name: userExists.first_name ?? null,

      shop_roles: shopRoles,
      tier,
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
