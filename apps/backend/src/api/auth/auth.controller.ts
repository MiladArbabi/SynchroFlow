// apps/backend/src/api/auth/auth.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { issueAuthTokens } from './token.service.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { TIERS, getTierConfig } from '@lasyncro/backend-core/config/tiers.js';
import { ResolvedShopContext, requireShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { audit } from '../../utils/audit.js';
import { rateLimit } from '../../utils/rateLimit.js';
import { User } from '../../types.js';

const SALT_ROUNDS = 10; // Standard for bcrypt

const hashRefreshToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export const registerUser = async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body;

  // --- Basic Validation ---
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // --- Check if user already exists ---
    const existingUser = await db<User>('users')
      .where({ email: email.toLowerCase() })
      .first();
    if (existingUser) {
      return res.status(409).json({ error: 'Email already in use.' }); // 409 Conflict
    }

    // --- Hash the password ---
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = await db.transaction<User>(async trx => {

    // 1️⃣ Create shop
    const [newShop] = await trx('shops')
      .insert({
        name: `${firstName || email}'s Shop`,
      })
      .returning('*');

    // 2️⃣ Bootstrap root warehouse
    await trx('warehouse_locations').insert({
      shop_id: newShop.id,
      location_code: `WH-${newShop.id}-ROOT`,
      type: 'warehouse',
      parent_location_code: null,
      active: true,
    });

    // 3️⃣ Create user
    const [createdUser] = await trx<User>('users')
      .insert({
        shop_id: newShop.id,
        email: email.toLowerCase(),
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
      })
      .returning('*');

    // 4️⃣ Membership
    await trx('shop_memberships').insert({
      shop_id: newShop.id,
      user_id: createdUser.id,
      role: 'owner',
    });

    const { LifecycleProjectionService } = await import(
      '../../services/lifecycle-projection.service.js'
    );

    await LifecycleProjectionService.projectForMembership(
      {
        shopId: newShop.id,
        userId: createdUser.id,
      },
      trx
    );

    // --- 14-day Growth trial assignment (MON-07) ---
    // Every new shop gets Growth-tier entitlements for 14 days.
    // Converts to Starter automatically at trial_ends_at if no payment added.
    // Reminder emails sent at D-3 and D-1 (see trial expiry job, MON-07).
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await trx('shop_subscriptions').insert({
      shop_id: newShop.id,
      tier: 'growth' satisfies typeof TIERS[number], // Trial tier (MON-07). 'satisfies' ensures compile-time validation against Tier union.
      billing_interval: 'monthly',
      status: 'trialing',
      trial_ends_at: trialEndsAt,
    });

    const growthConfig = getTierConfig('growth');
    const moduleRows = growthConfig.modules.map((moduleKey) => ({
      shop_id: newShop.id,
      module_key: moduleKey,
      flag_key: null as string | null,
      source: 'trial:growth',
    }));

    const flagRows = growthConfig.flags.map((flagKey) => ({
      shop_id: newShop.id,
      module_key: flagKey.split('.')[0],
      flag_key: flagKey,
      source: 'trial:growth',
    }));

    await EntitlementsService.applyFromCommercialGrant(trx, [...moduleRows, ...flagRows]);

    console.log('[auth][register] Growth trial assigned', {
      shopId: newShop.id,
      trialEndsAt,
    });

    return createdUser;
  });

    const { password_hash, ...publicUser } = newUser;
    
    res.status(201).json({
      user: publicUser
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
    const user = await db<User>('users')
      .where({ email: email.toLowerCase() })
      .first();

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

    // 🔥 HARD SESSION RESET (THE FIX)
    await db('refresh_tokens')
      .where({ user_id: user.id, revoked_at: null })
      .update({ revoked_at: new Date() });

    audit({
      level: 'INFO',
      event: 'login_session_reset',
      userId: user.id,
      metadata: {
        reason: 'explicit_login',
      },
    });

    // SINGLE AUTHORITY FOR TOKEN ISSUANCE
    const { accessToken, refreshToken } = await issueAuthTokens({
      userId: user.id,
      shopId: shopContext.shopId,
      actorType: 'shop_user',
      authProvider: 'password',
      shopRoles: [shopContext.role],
      scopes: [],
      tokenVersion: 1,
    });

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

export const refreshToken = async (req: Request, res: Response) => {

  const ip =
   req.headers['x-forwarded-for']?.toString() ||
   req.socket.remoteAddress ||
   'unknown';

  const allowed = rateLimit(
    `refresh:${ip}`,
    10,              // max 10 attempts
    60_000,          // per 1 minute
  );

  if (!allowed) {
    return res.status(429).json({
      error: 'TOO_MANY_REQUESTS',
      retryAfter: 60,
    });
  }
  // 1. Get refresh token from HttpOnly cookie (web) or request body (mobile)
  const incomingRefreshToken = req.cookies.refreshToken ?? req.body?.refreshToken;
  if (!incomingRefreshToken) {
    return res.status(401).json({
      error: 'SESSION_EXPIRED',
      action: 'LOGOUT_REQUIRED',
    });
  }

  // 2. Verify the refresh token
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
  if (!jwtRefreshSecret) {
    console.error('JWT Refresh Secret is not set!');
    return res.status(500).json({ error: 'Internal server error: JWT secret missing.' });
  }

  try {
    const decoded = jwt.verify(incomingRefreshToken, jwtRefreshSecret) as JwtPayload;

    const {
      user_id,
      session_id,
      token_version,
    } = decoded as {
      user_id: number;
      session_id: string;
      token_version?: number;
    };

    const incomingHash = hashRefreshToken(incomingRefreshToken);
 
    const existingToken = await db('refresh_tokens')
      .where({
        token_hash: incomingHash,
        session_id,
        token_version,
      })
      .first();

    // 🔒 No record → expired or invalid
    if (!existingToken) {
      return res.status(503).json({
        error: 'REFRESH_TEMPORARILY_UNAVAILABLE',
        retryable: true,
      });
    }

    // 🔒 Explicit expiry check
    if (existingToken.expires_at <= new Date()) {
      return res.status(401).json({
        error: 'SESSION_EXPIRED',
        action: 'LOGOUT_REQUIRED',
      });
    }

    // 🔒 Revoked token → replay / compromise
    if (existingToken.revoked_at) {
      return res.status(403).json({
        error: 'SESSION_COMPROMISED',
        action: 'LOGOUT_REQUIRED',
      });
    }

    // 🔍 Anomaly detection (audit-only)
    const currentIp =
      req.headers['x-forwarded-for']?.toString() ||
      req.socket.remoteAddress ||
      'unknown';

    const currentUa = req.headers['user-agent'];

    if (
      existingToken.ip_address &&
      existingToken.ip_address !== currentIp
    ) {
      audit({
        level: 'WARN',
        event: 'refresh_token_ip_drift',
        userId: user_id,
        metadata: {
          sessionId: session_id,
          issuedFrom: existingToken.ip_address,
          usedFrom: currentIp,
        },
      });
    }

    if (
      existingToken.user_agent &&
      currentUa &&
      existingToken.user_agent !== currentUa
    ) {
      audit({
        level: 'WARN',
        event: 'refresh_token_ua_drift',
        userId: user_id,
        metadata: {
          sessionId: session_id,
          issuedFrom: existingToken.user_agent,
          usedFrom: currentUa,
        },
      });
    };

    const userExists = await db('users')
      .where({ id: user_id })
      .first();

    if (!userExists) {
      return res.status(401).json({
        error: 'Unauthorized: User no longer exists.'
      });
    }
    
    let newTokens: { refreshToken: any; accessToken: any; };

    try {
      let shopContext: ResolvedShopContext;
        try {
          shopContext = await requireShopContextForUser(user_id);
        } catch {
          return res.status(403).json({
            error: 'SHOP_CONTEXT_REQUIRED',
          });
        }

        newTokens = await issueAuthTokens({
          userId: user_id,
          shopId: shopContext.shopId,
          actorType: 'shop_user',
          authProvider: 'password',
          shopRoles: [shopContext.role],
          scopes: [],
          tokenVersion: token_version ?? 1,
        });
    } catch (err) {

      audit({
        level: 'WARN',
        event: 'refresh_token_transient_failure',
        userId: user_id,
        metadata: {
          sessionId: session_id,
          reason: err instanceof Error ? err.message : 'unknown',
        },
      });

      // 🔁 Transient failure → SAFE RETRY
      return res.status(503).json({
        error: 'REFRESH_TEMPORARILY_UNAVAILABLE',
        retryable: true,
      });
    }

    // 2️⃣ Now revoke OLD token (must succeed)
    const revoked = await db('refresh_tokens')
      .where({ id: existingToken.id, revoked_at: null })
      .update({ revoked_at: new Date() });

    if (revoked !== 1) {
      return res.status(403).json({
        error: 'SESSION_COMPROMISED',
        action: 'LOGOUT_REQUIRED',
      });
    }

    // 3️⃣ Set new refresh cookie
    res.cookie('refreshToken', newTokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // 4️⃣ Return access token
    return res.status(200).json({ accessToken: newTokens.accessToken });

  } catch (err) {
    console.error(
      '[auth][refresh] transient failure',
      err instanceof Error ? err.message : err
    );

    return res.status(503).json({
      error: 'REFRESH_TEMPORARILY_UNAVAILABLE',
      retryable: true,
    });
  }
};

export const logoutUser = (req: Request, res: Response) => {

  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    const hash = hashRefreshToken(refreshToken);
    db('refresh_tokens')
      .where({ token_hash: hash, revoked_at: null })
      .update({ revoked_at: new Date() })
      .catch(() => {});
  }

  // Clear the refresh token cookie
  res.cookie('refreshToken', '', { // Set value to empty string
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0), // Set expiry date to the past
    maxAge: 0 // Explicitly set maxAge to 0
  });
  res.status(204).send(); // Send 204 No Content
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