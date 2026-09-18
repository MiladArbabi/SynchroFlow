// tests/integration/entitlements/commercial-state-freshness.test.ts
//
// GH-1136 — REGRESSION-FIRST RED TEST ONLY.
// ===========================================================================
// A JWT is minted once, at login, and carries a `tier` claim frozen at that
// moment. representative-route-commercial-gate.test.ts's own header comment
// says it plainly: "requireCapability resolves tier from the JWT claim
// (resolveTier(req) -> req.user.tier) ... No shop_subscriptions row is needed
// for the commercial gate itself." That is exactly the staleness hazard this
// test proves: nothing re-checks the AUTHORITATIVE shop_subscriptions row
// (the one transitionShopSubscription() writes) once the token has been
// issued, so a shop downgraded mid-session keeps Growth-only API access for
// as long as that stale token remains valid.
//
// Real Express app (createApp(), never server.ts). Real disposable Postgres.
// No worker started. No Stripe/Shopify call in this file or its code path.
//
// This test is EXPECTED TO BE RED on current main: production authorization
// still trusts req.user.tier from the JWT rather than re-resolving tier from
// the authoritative shop_subscriptions row on every request. Do not fix it
// here.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

const FLOOR_PLANNING_ROUTE = '/api/v1/floor-planning/layout';

let SHOP_ID: number;
let USER_ID: number;

/**
 * Same fixture shape as representative-route-commercial-gate.test.ts's
 * seedFt2Shop(): fresh tenant shop, owner user, owner membership, and the
 * FT2 lifecycle snapshot requireFt2 depends on.
 */
async function seedFt2Shop(): Promise<void> {
  const unique = crypto.randomBytes(6).toString('hex');

  SHOP_ID = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `auth-freshness-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  USER_ID = await withTenant(SHOP_ID, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: SHOP_ID,
        email: `auth-freshness+${unique}@test.example`,
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

/** True unless the response is a commercial-gate denial — same helper as
 * representative-route-commercial-gate.test.ts. */
function commercialGatePassed(res: request.Response): boolean {
  return !(res.status === 403 && res.body?.error === 'COMMERCIAL_ACCESS_DENIED');
}

describe('GH-1136 — authoritative commercial downgrade must invalidate a still-valid Growth JWT', () => {
  it('a pre-downgrade Growth token loses warehouse.floor_planning access the instant the shop is authoritatively downgraded to Starter', async () => {
    await seedFt2Shop();

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

    // ONE token, minted once, before the downgrade. It is reused verbatim
    // for both requests below — never re-minted.
    const preDowngradeToken = issueTestToken({
      userId: USER_ID,
      shopId: SHOP_ID,
      tier: 'growth',
      roles: ['owner'],
    });

    // PRECONDITION — the Growth token clears the commercial gate on a
    // Growth-only representative route (same route
    // representative-route-commercial-gate.test.ts uses for
    // warehouse.floor_planning). Not asserting a domain 200: only that the
    // commercial middleware did not turn it away.
    const before = await request(app)
      .get(FLOOR_PLANNING_ROUTE)
      .set('Authorization', `Bearer ${preDowngradeToken}`);
    expect(commercialGatePassed(before)).toBe(true);
    expect(before.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');

    // Authoritative downgrade, inside a tenant-scoped transaction, through
    // the same canonical transition service — never a direct UPDATE.
    await withTenant(SHOP_ID, (trx) =>
      transitionShopSubscription(
        {
          shopId: SHOP_ID,
          to: { tier: 'starter', status: 'canceled', billingProvider: 'shopify' },
          source: 'auth_freshness_test',
          reason: 'authoritative_downgrade',
          actorType: 'shopify',
          actingProvider: 'shopify',
        },
        trx,
      ),
    );

    // Reuse the EXACT SAME pre-downgrade JWT — no new token is minted. It
    // still carries tier=growth even though the authoritative subscription
    // row is now starter/canceled.
    const after = await request(app)
      .get(FLOOR_PLANNING_ROUTE)
      .set('Authorization', `Bearer ${preDowngradeToken}`);

    // EXPECTED CONTRACT (currently RED — production still trusts the stale
    // JWT tier claim, so this request is wrongly allowed today).
    expect(after.status).toBe(403);
    expect(after.body).toMatchObject({
      error: 'COMMERCIAL_ACCESS_DENIED',
      capabilityId: 'warehouse.floor_planning',
      currentTier: 'starter',
      reason: 'TIER_TOO_LOW',
    });
  });
});
