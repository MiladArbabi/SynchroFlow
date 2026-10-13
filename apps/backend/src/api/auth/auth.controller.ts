// apps/backend/src/api/auth/auth.controller.ts
import { Request, Response } from 'express';
import db, {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import {
  authEmailExists,
  createTenantShop,
  resolveAuthUserByEmail,
  resolveEmailVerificationUser,
  resolvePasswordResetUser,
  resolveRefreshToken as resolvePersistedRefreshToken,
} from '@lasyncro/backend-core/services/pre-tenant.service.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { issueAuthTokens, lockAuthUser } from './token.service.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { TIERS } from '@lasyncro/backend-core/config/tiers.js';
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { ResolvedShopContext, requireShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { detectBillingCurrency } from '@lasyncro/backend-core/config/pricing.config.js';
import { audit } from '../../utils/audit.js';
import { rateLimit } from '../../utils/rateLimit.js';
import { User } from '../../types.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../../services/email/email.service.js';
import { captureEvent } from '../../utils/analytics.js';
import { transitionShopSubscription } from '../../services/billing/subscriptionTransition.service.js';

const SALT_ROUNDS = 10; // Standard for bcrypt

const hashRefreshToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export const registerUser = async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body;

  // --- Basic Validation ---
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    // Creation policy is enforced server-side so bypassing the UI cannot create weak passwords.
    return res.status(400).json({ error: 'Password must be 8–72 characters.' });
  }

  try {
    // --- Check if user already exists ---
    if (await authEmailExists(email)) {
      return res.status(409).json({ error: 'Email already in use.' }); // 409 Conflict
    }

    // --- Hash the password ---
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Registration starts pre-tenant only long enough to create the tenant root.
    // Every dependent write adopts that shop on the same restricted transaction.
    const { user: newUser, shopId } = await systemTransaction<{ user: User; shopId: number }>(async trx => {
    
    // 1️⃣ Create shop
    
    const shopId = await createTenantShop(trx, `${firstName || email}'s Shop`);
    await setTenantContext(trx, shopId);

    const rootLocationCode = `WH-${shopId}-ROOT`;

    const [warehouse] = await trx('warehouses')
      .insert({
        shop_id: shopId,
        name: 'Main warehouse',
        root_location_code: rootLocationCode,
        is_default: true,
        active: true,
      })
      .returning(['warehouse_id']);

    if (!warehouse?.warehouse_id) {
      throw new Error('WAREHOUSE_BOOTSTRAP_FAILED');
    }

    await trx('warehouse_locations').insert({
      shop_id: shopId,
      warehouse_id: warehouse.warehouse_id,
      location_code: rootLocationCode,
      type: 'warehouse',
      parent_location_code: null,
      active: true,
    });

    console.info('[AUTH_WAREHOUSE_BOOTSTRAPPED]', {
      shopId,
      warehouseId: warehouse.warehouse_id,
      rootLocationCode,
    });

    // ISSUE-12 / REG-PROV-01: shop_wms_settings was provisioned at Shopify
    // install (integration.controller.ts:807) but never at registration, so
    // every organic signup hit "[PICK_BATCH_SERVICE] shop_wms_settings missing"
    // and failed its first batch release. Mirrors the install path exactly.
    // GH-1145-A1: a genuinely new tenant — opening Shopify inventory is an
    // expectation only (bootstrap_model has no default; migration 0193).
    await trx('shop_wms_settings')
      .insert({ shop_id: shopId, bootstrap_model: 'reconcile_opening_expectation_v2' })
      .onConflict('shop_id')
      .ignore();

    // 3️⃣ Create user
    const [createdUser] = await trx<User>('users')
      .insert({
        shop_id: shopId,
        email: email.toLowerCase(),
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
      })
      .returning('*');

    // 4️⃣ Membership
    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: createdUser.id,
      role: 'owner',
    });

    const { LifecycleProjectionService } = await import(
      '../../services/lifecycle-projection.service.js'
    );

    await LifecycleProjectionService.projectForMembership(
      {
        shopId,
        userId: createdUser.id,
      },
      trx
    );

    // --- 14-day Growth trial assignment (MON-07) ---
    // Every new shop gets Growth-tier entitlements for 14 days.
    // Converts to Starter automatically at trial_ends_at if no payment added.
    // Reminder emails sent at D-3 and D-1 (see trial expiry job, MON-07).
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // BILL-ENTITLEMENT-01: subscription creation establishes entitlement-
    // authoritative state (tier + status), so it routes through the canonical
    // transition service, which records it as a creation transition with NULL
    // from_* values. The Growth trial grant itself is unchanged.
    //
    // billing_provider is intentionally NOT passed: this direct-signup path
    // never set it, relying on the shop_subscriptions column default 'stripe'
    // (migration 0090). The service applies that same default on creation.
    await transitionShopSubscription(
      {
        shopId,
        to: {
          tier: 'growth' satisfies typeof TIERS[number], // Trial tier (MON-07). 'satisfies' ensures compile-time validation against Tier union.
          status: 'trialing',
        },
        fields: {
          billing_interval: 'monthly',
          billing_currency: detectBillingCurrency(req.headers['accept-language']),
          trial_ends_at: trialEndsAt,
        },
        source: 'auth_registration',
        reason: 'signup_growth_trial_grant',
        actorType: 'user',
        actorId: String(createdUser.id),
      },
      trx
    );

    // Open billing period for usage tracking (MON-05)
    // Must exist before first order ingestion — cap enforcement and shipped order
    // overage both read from the open period row.
    await trx('shop_usage_metrics')
      .insert({
        shop_id: shopId,
        tier_at_period_start: 'growth',
        period_starts_at: new Date(),
        period_ends_at: null,
      });

    await trx('shop_operational_settings')
    .insert({
      shop_id: shopId,
      fulfillment_sla_hours: 24,
      monthly_overhead_amount: 0,
      starting_cash_balance: 0,
    })
    .onConflict('shop_id')
    .ignore();

    const moduleRows = [...modulesForTier('growth')].map((moduleKey) => ({
      shop_id: shopId,
      module_key: moduleKey,
      flag_key: null as string | null,
      source: 'trial:growth',
    }));

    const flagRows = [...flagsForTier('growth')].map((flagKey) => ({
      shop_id: shopId,
      module_key: flagKey.split('.')[0],
      flag_key: flagKey,
      source: 'trial:growth',
    }));

    await EntitlementsService.applyFromCommercialGrant(trx, [...moduleRows, ...flagRows]);

    console.log('[auth][register] Growth trial assigned', {
      shopId,
      trialEndsAt,
    });

    /**
     * PH-03: trial_started — fires once per shop at registration.
     * Fire-and-forget outside transaction — never block registration.
     * Called after transaction commits so shopId is guaranteed to exist.
     */
    captureEvent({
      shopId,
      event: 'trial_started',
      properties: {
        tier: 'growth',
        trial_ends_at: trialEndsAt.toISOString(),
      },
    });

    // AUTH-006: return shopId so we can issue tokens without a second DB lookup
    return { user: createdUser, shopId };
  });

    const { password_hash, ...publicUser } = newUser;

    // AUTH-006: issue tokens immediately after registration so frontend
    // can auto-login and proceed to connect-store step without a second login call.
    const { accessToken, refreshToken: newRefreshToken } = await issueAuthTokens({
      userId: newUser.id,
      shopId,
      actorType: 'shop_user',
      authProvider: 'password',
      shopRoles: ['owner'],
      scopes: [],
      tokenVersion: 1,
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // AUTH-007: generate verification token and send email
    // Non-fatal — registration succeeds even if email delivery fails.
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await withTenant(shopId, (trx) =>
      trx('users')
        .where({ id: newUser.id, shop_id: shopId })
        .update({
          email_verification_token: verificationToken,
          email_verification_expires_at: expiresAt,
        })
    );

    sendVerificationEmail({
      toEmail: newUser.email,
      firstName: newUser.first_name ?? '',
      verificationToken,
    }).catch((err) => {
      console.error('[AUTH][REGISTER] verification email failed (non-fatal):', err);
    });

    res.status(201).json({
      user: publicUser,
      accessToken,
    });

  } catch (error) {

    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
};

export const loginUser = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await resolveAuthUserByEmail(email);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    let shopContext: ResolvedShopContext;
    try {
      shopContext = await requireShopContextForUser(user.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'SHOP_RESOLUTION_FAILED';

      if (msg.includes('SHOP_CONTEXT_REQUIRED')) {
        return res.status(403).json({
          error: 'NO_ACTIVE_SHOP_MEMBERSHIP',
        });
      }

      return res.status(500).json({
        error: msg,
      });
    }

    // Reset and issue under the same user lock as refresh and logout.
    const { accessToken, refreshToken } = await withTenant(shopContext.shopId, async (trx) => {
      await lockAuthUser(trx, shopContext.shopId, user.id);
      await trx('refresh_tokens')
        .where({ shop_id: shopContext.shopId, user_id: user.id, revoked_at: null })
        .update({ revoked_at: new Date() });
      return issueAuthTokens({
        userId: user.id, shopId: shopContext.shopId, actorType: 'shop_user',
        authProvider: 'password', shopRoles: [shopContext.role], scopes: [],
        tokenVersion: 1, transaction: trx,
      });
    });
    audit({ level: 'INFO', event: 'login_session_reset', userId: user.id,
      metadata: { reason: 'explicit_login' } });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const { password_hash, ...publicUser } = user;
    return res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        ...publicUser,
        role: shopContext.role,
      },
    });

  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
};

class SessionFailure extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

function auditRefresh(entry: Parameters<typeof audit>[0]): void {
  try { audit(entry); } catch { /* Observability must not affect session mutations or responses. */ }
}

function sessionCredential(req: Request): { token: string | null; bodyClient: boolean } {
  const cookie = req.cookies?.refreshToken;
  const body = req.body?.refreshToken;
  if (cookie && body && cookie !== body) throw new SessionFailure(400, 'REFRESH_TOKEN_CONFLICT');
  const token = body ?? cookie;
  return { token: typeof token === 'string' && token ? token : null, bodyClient: !!body };
}

export const refreshToken = async (req: Request, res: Response) => {
  let auditIdentity: { userId?: number; sessionId?: string } = {};
  try {
    const { token, bodyClient } = sessionCredential(req);
    const ip = req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress || 'unknown';
    if (!rateLimit(`refresh:${ip}`, 10, 60_000)) {
      return res.status(429).json({ error: 'TOO_MANY_REQUESTS', retryAfter: 60 });
    }
    if (!token) throw new SessionFailure(401, 'SESSION_EXPIRED');
    const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT refresh secret missing');
    let decoded: JwtPayload;
    try { decoded = jwt.verify(token, secret) as JwtPayload; }
    catch { throw new SessionFailure(401, 'SESSION_EXPIRED'); }
    const { user_id: userId, session_id: sessionId, token_version: version = 1 } = decoded;
    if (!Number.isInteger(userId) || typeof sessionId !== 'string') {
      throw new SessionFailure(401, 'SESSION_EXPIRED');
    }
    auditIdentity = { userId, sessionId };
    const hash = hashRefreshToken(token);
    const persisted = await resolvePersistedRefreshToken({ tokenHash: hash, sessionId, tokenVersion: version });
    if (!persisted) throw new SessionFailure(401, 'SESSION_EXPIRED');
    let context: ResolvedShopContext;
    try { context = await requireShopContextForUser(userId); }
    catch { throw new SessionFailure(403, 'SHOP_CONTEXT_REQUIRED'); }
    if (persisted.user_id !== userId || persisted.shop_id !== context.shopId ||
        (decoded.shop_id !== undefined && decoded.shop_id !== context.shopId)) {
      throw new SessionFailure(403, 'SHOP_CONTEXT_MISMATCH');
    }
    const outcome = await withTenant(context.shopId, async (trx) => {
      await lockAuthUser(trx, context.shopId, userId);
      const original = await trx('refresh_tokens').where({
        id: persisted.id, shop_id: context.shopId, user_id: userId,
        session_id: sessionId, token_hash: hash, token_version: version,
      }).forUpdate().first();
      if (!original || new Date(original.expires_at) <= new Date()) {
        throw new SessionFailure(401, 'SESSION_EXPIRED');
      }
      const containReplay = async () => {
        await trx('refresh_tokens').where({ shop_id: context.shopId, user_id: userId,
          session_id: sessionId, revoked_at: null }).update({ revoked_at: new Date() });
        // Return normally so containment commits instead of rolling back.
        return { kind: 'compromised' as const };
      };
      if (original.revoked_at) return containReplay();
      // Revalidate JWT expiry after waiting for the shared mutation lock.
      try { jwt.verify(token, secret); }
      catch { throw new SessionFailure(401, 'SESSION_EXPIRED'); }
      const claimed = await trx('refresh_tokens').where({ id: original.id, shop_id: context.shopId,
        revoked_at: null }).update({ revoked_at: new Date() });
      if (claimed !== 1) return containReplay();
      const tokens = await issueAuthTokens({ userId, shopId: context.shopId, actorType: 'shop_user',
        authProvider: 'password', shopRoles: [context.role], scopes: [], tokenVersion: version,
        sessionId, transaction: trx });
      return { kind: 'rotated' as const, tokens,
        ipDrift: !!original.ip_address && original.ip_address !== ip,
        uaDrift: !!original.user_agent && !!req.headers['user-agent'] &&
          original.user_agent !== req.headers['user-agent'],
      };
    });
    // Replay containment must commit before its terminal response is returned.
    if (outcome.kind === 'compromised') {
      return res.status(403).json({ error: 'SESSION_COMPROMISED', action: 'LOGOUT_REQUIRED' });
    }
    const { tokens } = outcome;
    // Audit only committed rotations; never log raw headers or credentials.
    // Legacy drift signals remain conditional on persisted comparison metadata.
    if (outcome.ipDrift) auditRefresh({ level: 'WARN', event: 'refresh_token_ip_drift',
      userId, metadata: { sessionId } });
    if (outcome.uaDrift) auditRefresh({ level: 'WARN', event: 'refresh_token_ua_drift',
      userId, metadata: { sessionId } });
    // withTenant has committed before any credential is exposed.
    if (!bodyClient) res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.status(200).json(bodyClient ? tokens : { accessToken: tokens.accessToken });
  } catch (error) {
    if (error instanceof SessionFailure) {
      return res.status(error.status).json(error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_COMPROMISED'
        ? { error: error.code, action: 'LOGOUT_REQUIRED' } : { error: error.code });
    }
    auditRefresh({ level: 'WARN', event: 'refresh_token_transient_failure',
      userId: auditIdentity.userId,
      metadata: { sessionId: auditIdentity.sessionId, reason: 'REFRESH_TEMPORARILY_UNAVAILABLE' } });
    console.error('[auth][refresh] persistence failure');
    return res.status(503).json({ error: 'REFRESH_TEMPORARILY_UNAVAILABLE', retryable: true });
  }
};

export const logoutUser = async (req: Request, res: Response) => {
  // Clear the browser cookie even when server-side revocation is unconfirmed.
  res.cookie('refreshToken', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict', expires: new Date(0), maxAge: 0 });
  try {
    const { token } = sessionCredential(req);
    if (token) {
      // Exact persisted hash proves credential ownership; expired ancestors may log out.
      const decoded = jwt.decode(token) as JwtPayload | null;
      if (decoded && typeof decoded.session_id === 'string') {
        const persisted = await resolvePersistedRefreshToken({ tokenHash: hashRefreshToken(token),
          sessionId: decoded.session_id, tokenVersion: decoded.token_version ?? 1 });
        if (persisted) await withTenant(persisted.shop_id, async (trx) => {
          await lockAuthUser(trx, persisted.shop_id, persisted.user_id);
          await trx('refresh_tokens').where({ shop_id: persisted.shop_id, user_id: persisted.user_id,
            session_id: persisted.session_id, revoked_at: null }).update({ revoked_at: new Date() });
        });
      }
    }
    return res.status(204).send();
  } catch (error) {
    if (error instanceof SessionFailure) return res.status(error.status).json({ error: error.code });
    console.error('[AUTH][LOGOUT] refresh token revocation failed', error instanceof Error ? error.message : 'unknown');
    return res.status(503).json({ error: 'LOGOUT_TEMPORARILY_UNAVAILABLE', retryable: true });
  }
};

export const getDevToken = async (req: Request, res: Response) => {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  try {
    // Dev token: resolve real shop context for user 1 so shop_roles claim is present.
    // Without shop_roles, requireRole middleware returns 401 on all WMS routes.
    const shopContext = await requireShopContextForUser(1);
    const { accessToken } = await issueAuthTokens({
      userId: 1,
      shopId: shopContext.shopId,
      actorType: 'shop_user',
      authProvider: 'password',
      shopRoles: [shopContext.role],
      scopes: [],
      tokenVersion: 1,
    });
    res.json({
      token: accessToken,
      shopId: shopContext.shopId,
      role: shopContext.role,
      message: 'Dev token for user 1. Use as: Authorization: Bearer <token>',
    });
  } catch (error) {
    console.error('[AuthController] getDevToken failed:', error);
    res.status(500).json({ error: 'Failed to generate dev token' });
  }
};

// ─────────────────────────────────────────────
// AUTH-007: Email verification endpoints
// ─────────────────────────────────────────────

/**
 * verifyEmail
 * -----------
 * GET /api/v1/auth/verify-email?token=<hex>
 * Validates token, marks email as verified, redirects to app.
 * Public — no auth required (user may not be logged in yet).
 */
export const verifyEmail = async (req: Request, res: Response) => {
  const { token } = req.query as { token?: string };

  if (!token) {
    return res.status(400).json({ error: 'Missing verification token.' });
  }

  const user = await resolveEmailVerificationUser(token);

  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired verification link.' });
  }

  if (user.email_verified_at) {
    return res.status(200).json({ message: 'Already verified.', alreadyVerified: true });
  }

  if (!user.email_verification_expires_at || new Date() > new Date(user.email_verification_expires_at)) {
    return res.status(400).json({ error: 'Verification link has expired. Please request a new one.' });
  }

  await withTenant(user.shop_id, (trx) =>
    trx('users')
      .where({ id: user.id, shop_id: user.shop_id })
      .update({
        email_verified_at: new Date(),
        email_verification_token: null,
        email_verification_expires_at: null,
      })
  );

  console.info('[AUTH][VERIFY_EMAIL] verified', { userId: user.id });

  return res.status(200).json({ message: 'Email verified successfully.' });
};

/**
 * resendVerificationEmail
 * -----------------------
 * POST /api/v1/auth/resend-verification
 * Requires auth token — user must be logged in.
 * Rate-limited: one resend per minute per user.
 */
export const resendVerificationEmail = async (req: Request, res: Response) => {
  // auth.middleware sets req.user.userId (camelCase) — matches JWT contract
  const userId = (req as any).user?.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const shopId = req.user?.shopId;
  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const user = await withTenant(shopId, (trx) =>
    trx<User>('users').where({ id: userId, shop_id: shopId }).first()
  );

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (user.email_verified_at) {
    return res.status(400).json({ error: 'Email already verified.' });
  }

  // Rate limit: one resend per minute per user
  const allowed = rateLimit(`resend-verification:${userId}`, 1, 60_000);
  if (!allowed) {
    return res.status(429).json({ error: 'Please wait before requesting another verification email.' });
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await withTenant(shopId, (trx) =>
    trx('users')
      .where({ id: userId, shop_id: shopId })
      .update({
        email_verification_token: verificationToken,
        email_verification_expires_at: expiresAt,
      })
  );

  sendVerificationEmail({
    toEmail: user.email,
    firstName: user.first_name ?? '',
    verificationToken,
  }).catch((err) => {
    console.error('[AUTH][RESEND_VERIFICATION] email failed (non-fatal):', err);
  });

  return res.status(200).json({ message: 'Verification email sent.' });
};

// ─────────────────────────────────────────────
// Forgot password / reset password endpoints
// ─────────────────────────────────────────────

/**
 * forgotPassword
 * --------------
 * POST /api/v1/auth/forgot-password  — public, no auth required
 * Always returns 200 to prevent email enumeration.
 * Rate-limited: 3 requests per 15 minutes per IP.
 */
export const forgotPassword = async (req: Request, res: Response) => {
  const ip = req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress || 'unknown';
  const allowed = rateLimit(`forgot-password:${ip}`, 3, 15 * 60_000);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  // Always return 200 — never reveal whether email exists
  try {
    const user = await resolveAuthUserByEmail(email);

    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await withTenant(user.shop_id, (trx) =>
        trx('users')
          .where({ id: user.id, shop_id: user.shop_id })
          .update({
            password_reset_token: resetToken,
            password_reset_expires_at: expiresAt,
          })
      );

      sendPasswordResetEmail({
        toEmail: user.email,
        firstName: user.first_name ?? '',
        resetToken,
      }).catch((err) => {
        console.error('[AUTH][FORGOT_PASSWORD] email failed (non-fatal):', err);
      });

      console.info('[AUTH][FORGOT_PASSWORD] reset token issued', { userId: user.id });
    }
  } catch (err) {
    console.error('[AUTH][FORGOT_PASSWORD] error:', err);
  }

  // Always 200 — no enumeration
  return res.status(200).json({ message: 'If that email exists, a reset link is on its way.' });
};

/**
 * resetPassword
 * -------------
 * POST /api/v1/auth/reset-password  — public, no auth required
 * Validates token, updates password, clears token.
 */
export const resetPassword = async (req: Request, res: Response) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required.' });
  }

  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    // Keep reset-password aligned with register policy and bcrypt-safe password length.
    return res.status(400).json({ error: 'Password must be 8–72 characters.' });
  }

  const user = await resolvePasswordResetUser(token);

  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired reset link.' });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Pre-tenant resolution discovers identity only. Authorize consumption after
  // the shared user lock, against the current credential and PostgreSQL time.
  const outcome = await withTenant(user.shop_id, async (trx) => {
    await lockAuthUser(trx, user.shop_id, user.id);
    const current = await trx('users')
      .where({ id: user.id, shop_id: user.shop_id })
      .first('password_reset_token');
    if (current?.password_reset_token !== token) return 'invalid' as const;

    const consumed = await trx('users')
      .where({ id: user.id, shop_id: user.shop_id, password_reset_token: token })
      .whereRaw('password_reset_expires_at > clock_timestamp()')
      .update({
        password_hash: passwordHash,
        password_reset_token: null,
        password_reset_expires_at: null,
      });
    if (consumed !== 1) return 'expired' as const;

    // Revoke all active sessions on password reset — security best practice
    await trx('refresh_tokens')
      .where({ shop_id: user.shop_id, user_id: user.id, revoked_at: null })
      .update({ revoked_at: new Date() });
    return 'consumed' as const;
  }).catch(() => null);

  if (outcome === null) {
    return res.status(500).json({ error: 'Internal server error during password reset.' });
  }

  if (outcome !== 'consumed') {
    return res.status(400).json({ error: outcome === 'invalid'
      ? 'Invalid or expired reset link.'
      : 'Reset link has expired. Please request a new one.' });
  }

  console.info('[AUTH][RESET_PASSWORD] password reset successful', { userId: user.id });

  return res.status(200).json({ message: 'Password reset successfully. Please sign in.' });
};
