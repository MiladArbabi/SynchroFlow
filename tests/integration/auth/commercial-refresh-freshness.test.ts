// tests/integration/auth/commercial-refresh-freshness.test.ts
//
// GH-1136 — SESSION FRESHNESS CONTRACT (refresh path).
// ===========================================================================
// Proves that refreshing a session after an authoritative commercial
// downgrade cannot mint a new access token carrying the superseded paid
// tier. issueAuthTokens() resolves `tier` fresh via resolveTierForShop() on
// every call, including the one the real POST /api/v1/auth/refresh_token
// route makes — so a refresh performed after an authoritative downgrade must
// return a NEW access token carrying the CURRENT tier, never the tier the
// original (pre-downgrade) token was minted with.
//
// Real Express app (createApp(), never server.ts/api-server). Real
// disposable Postgres. Real issueAuthTokens() — not issueTestToken — so the
// refresh token is persisted exactly as production expects. No worker
// started. No Stripe/Shopify call in this file or its code path.

import request from 'supertest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { issueAuthTokens } from 'api-src/api/auth/token.service';

const app = createApp();

const FLOOR_PLANNING_ROUTE = '/api/v1/floor-planning/layout';

let SHOP_ID: number;
let USER_ID: number;

/**
 * Same fixture shape as commercial-state-freshness.test.ts's seedFt2Shop():
 * fresh tenant shop, owner user, owner membership, and the FT2 lifecycle
 * snapshot the representative route depends on.
 */
async function seedFt2Shop(): Promise<void> {
  const unique = crypto.randomBytes(6).toString('hex');

  SHOP_ID = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `auth-refresh-freshness-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  USER_ID = await withTenant(SHOP_ID, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: SHOP_ID,
        email: `auth-refresh-freshness+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return row.id as number;
  });

  await withTenant(SHOP_ID, (trx) =>
    trx('shop_memberships').insert({ shop_id: SHOP_ID, user_id: USER_ID, role: 'owner' }),
  );

  // requireFt2 -> LifecycleService.resolveForUser must return 'FT2'.
  await withTenant(SHOP_ID, (trx) =>
    trx('user_lifecycle_snapshot').insert({
      shop_id: SHOP_ID,
      user_id: USER_ID,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    }),
  );
}

afterAll(async () => {
  await db.destroy();
});

describe('GH-1136 — refresh after an authoritative commercial downgrade cannot mint a stale-tier access token', () => {
  it('a refresh performed after growth -> starter downgrade returns a NEW access token carrying starter, never growth', async () => {
    await seedFt2Shop();

    const jwtSecret = process.env.JWT_SECRET as string;
    expect(jwtSecret).toBeTruthy();

    // Authoritative commercial state: growth/active/shopify — established
    // through the canonical transition service, never a direct
    // shop_subscriptions UPDATE.
    await withTenant(SHOP_ID, (trx) =>
      transitionShopSubscription(
        {
          shopId: SHOP_ID,
          to: { tier: 'growth', status: 'active', billingProvider: 'shopify' },
          source: 'auth_freshness_test',
          reason: 'initial_growth_state',
          actorType: 'shopify',
          actingProvider: 'shopify',
        },
        trx,
      ),
    );

    // REAL auth token pair — persists the refresh token exactly as
    // production expects (issueTestToken does not persist anything).
    const initialTokens = await issueAuthTokens({
      userId: USER_ID,
      shopId: SHOP_ID,
      actorType: 'shop_user',
      authProvider: 'password',
      shopRoles: ['owner'],
      scopes: [],
      tokenVersion: 1,
    });

    // Verify the initial access JWT actually carries tier=growth.
    const initialDecoded = jwt.verify(initialTokens.accessToken, jwtSecret) as jwt.JwtPayload;
    expect(initialDecoded.tier).toBe('growth');
    expect(initialDecoded.shop_id).toBe(SHOP_ID);
    expect(initialDecoded.user_id).toBe(USER_ID);

    const originalRefreshToken = initialTokens.refreshToken;

    // Authoritative downgrade, inside a tenant-scoped transaction, through
    // the same canonical transition service — never a direct UPDATE.
    await withTenant(SHOP_ID, (trx) =>
      transitionShopSubscription(
        {
          shopId: SHOP_ID,
          to: { tier: 'starter', status: 'canceled', billingProvider: 'shopify' },
          source: 'auth_freshness_test',
          reason: 'refresh_after_authoritative_downgrade',
          actorType: 'shopify',
          actingProvider: 'shopify',
        },
        trx,
      ),
    );

    // Real refresh endpoint, sending the ORIGINAL persisted refresh token.
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh_token')
      .set('Cookie', `refreshToken=${originalRefreshToken}`)
      .send();

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body?.accessToken).toBeTruthy();

    const refreshedDecoded = jwt.verify(refreshRes.body.accessToken, jwtSecret) as jwt.JwtPayload;

    // CRITICAL INVARIANT — the refreshed token must NOT carry the
    // superseded tier.
    expect(refreshedDecoded.tier).not.toBe('growth');
    expect(refreshedDecoded.tier).toBe('starter');
    expect(refreshedDecoded.shop_id).toBe(SHOP_ID);
    expect(refreshedDecoded.user_id).toBe(USER_ID);

    // Secondary assertion — the new (starter) access token is commercially
    // denied on a Growth-only representative route. GH-1136's
    // authenticateToken independently re-resolves the current DB tier, so
    // this is corroborating, not primary, evidence.
    const denied = await request(app)
      .get(FLOOR_PLANNING_ROUTE)
      .set('Authorization', `Bearer ${refreshRes.body.accessToken}`);

    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({
      error: 'COMMERCIAL_ACCESS_DENIED',
      capabilityId: 'warehouse.floor_planning',
      currentTier: 'starter',
      reason: 'TIER_TOO_LOW',
    });
  });
});
