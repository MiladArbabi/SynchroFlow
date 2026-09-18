// tests/integration/entitlements/trial-expiry-commercial-state-freshness.test.ts
//
// GH-1136 — REAL TRIAL-EXPIRY STALE-SESSION REGRESSION.
// ===========================================================================
// A Growth access token is minted once, before real trial expiry, and carries
// a `tier` claim frozen at that moment. This test proves that once the real
// production expiry entry point — runTrialExpiryCycle() — authoritatively
// downgrades the shop from growth/trialing to starter/active, that same
// still-unexpired JWT immediately loses warehouse.floor_planning access,
// because authorization re-resolves the current authoritative
// shop_subscriptions tier on every request rather than trusting the stale
// JWT claim.
//
// Real Express app (createApp(), never server.ts). Real disposable Postgres.
// Real runTrialExpiryCycle() / transitionShopSubscription() /
// authenticateToken / requireCapability path — none of those are mocked.
//
// Fixture pattern (fresh tenant shop, owner user, owner shop_membership, FT2
// lifecycle snapshot) mirrors
// tests/integration/entitlements/commercial-state-freshness.test.ts.

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
import { runTrialExpiryCycle } from 'api-src/services/trial-expiry.service';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

const FLOOR_PLANNING_ROUTE = '/api/v1/floor-planning/layout';

// Growth-only module backing warehouse.floor_planning (minimumTier: 'growth'
// in @lasyncro/commercial-policy) — used to seed one explicit persisted
// entitlement row so the worker's revocation step has something to revoke.
const GROWTH_ONLY_MODULE = 'floor-planning';

let SHOP_ID: number;
let USER_ID: number;

/**
 * Same fixture shape as commercial-state-freshness.test.ts's seedFt2Shop():
 * fresh tenant shop, owner user, owner membership, and the FT2 lifecycle
 * snapshot requireFt2 depends on.
 */
async function seedFt2Shop(): Promise<void> {
  const unique = crypto.randomBytes(6).toString('hex');

  SHOP_ID = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `trial-expiry-freshness-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  USER_ID = await withTenant(SHOP_ID, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: SHOP_ID,
        email: `trial-expiry-freshness+${unique}@test.example`,
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
 * commercial-state-freshness.test.ts / representative-route-commercial-gate.test.ts. */
function commercialGatePassed(res: request.Response): boolean {
  return !(res.status === 403 && res.body?.error === 'COMMERCIAL_ACCESS_DENIED');
}

describe('GH-1136 — real trial expiry must invalidate a pre-expiry Growth JWT', () => {
  it('a pre-expiry Growth token loses warehouse.floor_planning access the instant runTrialExpiryCycle() authoritatively downgrades the shop to Starter', async () => {
    await seedFt2Shop();

    // 3. Authoritative pre-expiry subscription — established ONLY through the
    // canonical transition service, never a direct shop_subscriptions UPDATE.
    // trial_ends_at is already in the past so the real worker discovers and
    // expires this shop on its own.
    const expiredTrialEndsAt = new Date(Date.now() - 60_000);

    await withTenant(SHOP_ID, (trx) =>
      transitionShopSubscription(
        {
          shopId: SHOP_ID,
          to: { tier: 'growth', status: 'trialing', billingProvider: 'shopify' },
          fields: { trial_ends_at: expiredTrialEndsAt },
          source: 'auth_freshness_test',
          reason: 'expired_growth_trial_fixture',
          actorType: 'system',
          actorId: 'gh-1136-test',
          actingProvider: 'shopify',
        },
        trx,
      ),
    );

    // 4. Seed one explicit Growth-only entitlement row through the canonical
    // sealed entitlement writer (the same one trial-expiry.service.ts itself
    // uses to seed Starter entitlements), so the worker's revocation step
    // (valid_until close-out) has a persisted row to act on for the
    // secondary assertion below. Tier-floor access itself does not depend on
    // this row.
    await withTenant(SHOP_ID, (trx) =>
      EntitlementsService.applyFromCommercialGrant(trx, [
        {
          shop_id: SHOP_ID,
          module_key: GROWTH_ONLY_MODULE,
          flag_key: null,
          source: 'auth_freshness_test',
        },
      ]),
    );

    // 5. ONE pre-expiry access token, minted once, reused verbatim for both
    // requests below — never re-minted.
    const preExpiryToken = issueTestToken({
      userId: USER_ID,
      shopId: SHOP_ID,
      tier: 'growth',
      roles: ['owner'],
    });

    // 6. PRECONDITION — the Growth token clears the commercial gate before
    // expiry. Not asserting a domain 200: only that the commercial
    // middleware did not turn it away.
    const before = await request(app)
      .get(FLOOR_PLANNING_ROUTE)
      .set('Authorization', `Bearer ${preExpiryToken}`);
    expect(commercialGatePassed(before)).toBe(true);
    expect(before.body?.error).not.toBe('COMMERCIAL_ACCESS_DENIED');

    // 7. Execute the REAL production expiry entry point. The service must
    // discover this shop itself via list_trialing_tenants() — no manual
    // transitionShopSubscription() call for the expiry step.
    await runTrialExpiryCycle();

    // 8. Authoritative persisted state after the cycle.
    const postExpirySubscription = await withTenant(SHOP_ID, (trx) =>
      trx('shop_subscriptions').where({ shop_id: SHOP_ID }).first(
        'tier',
        'status',
        'billing_provider',
        'trial_ends_at',
      ),
    );

    expect(postExpirySubscription).toMatchObject({
      tier: 'starter',
      status: 'active',
      billing_provider: 'shopify',
      trial_ends_at: null,
    });

    // 9. The transition ledger must contain the ACTUAL worker transition row
    // — produced by runTrialExpiryCycle(), not a manually inserted fixture.
    const workerTransition = await withTenant(SHOP_ID, (trx) =>
      trx('shop_subscription_transitions')
        .where({ shop_id: SHOP_ID, source: 'trial_expiry_worker' })
        .orderBy('occurred_at', 'desc')
        .first(
          'from_tier',
          'from_status',
          'to_tier',
          'to_status',
          'source',
          'reason',
          'actor_type',
          'actor_id',
        ),
    );

    expect(workerTransition).toMatchObject({
      from_tier: 'growth',
      from_status: 'trialing',
      to_tier: 'starter',
      to_status: 'active',
      source: 'trial_expiry_worker',
      reason: 'trial_expired',
      actor_type: 'worker',
      actor_id: 'trial-expiry',
    });

    // 10. Reuse the EXACT SAME pre-expiry Growth JWT — no new token is
    // minted. It still carries tier=growth even though the authoritative
    // subscription row is now starter/active. PRIMARY GH-1136 acceptance
    // assertion.
    const after = await request(app)
      .get(FLOOR_PLANNING_ROUTE)
      .set('Authorization', `Bearer ${preExpiryToken}`);

    expect(after.status).toBe(403);
    expect(after.body).toMatchObject({
      error: 'COMMERCIAL_ACCESS_DENIED',
      capabilityId: 'warehouse.floor_planning',
      currentTier: 'starter',
      reason: 'TIER_TOO_LOW',
    });

    // 11. Secondary — the seeded Growth-only entitlement row is no longer
    // active after the real expiry cycle. Not asserting every entitlement
    // row, only the one this fixture seeded.
    const revokedEntitlement = await withTenant(SHOP_ID, (trx) =>
      trx('shop_module_entitlements')
        .where({ shop_id: SHOP_ID, module_key: GROWTH_ONLY_MODULE })
        .first('valid_until'),
    );

    expect(revokedEntitlement?.valid_until).not.toBeNull();
  });
});
