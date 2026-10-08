// tests/integration/billing/subscription-transition-precondition-gh1226.test.ts
//
// GH-1226 / TIER-11 — RED CONTRACT: conditional (expected-current) commercial
// transition.
// ===========================================================================
// Candidate discovery (e.g. list_trialing_tenants() + a pre-lock status read)
// is advisory only. transitionShopSubscription() is the one serialization
// owner: it takes pg_advisory_xact_lock(91002, shopId) and rereads the
// authoritative row. The future contract is that a caller may pass the state
// it believed current (`expectedCurrent`), and the service checks it AFTER the
// lock + reread. A mismatch is a successful no-op: no subscription mutation,
// no field mutation, no transition-ledger row.
//
// The expectedCurrent input does not exist on SubscriptionTransitionInput yet.
// It is expressed here through a narrow test-only type and a cast — production
// types are deliberately untouched in the RED phase.
//
// P1 — matching candidate control: PASS today and after the fix.
// P2 — stale candidate no-op:      EXPECTED RED today (expectedCurrent ignored).
//
// Real disposable Postgres, real withTenant / systemTransaction /
// setTenantContext, real transitionShopSubscription(). Nothing is mocked.

import crypto from 'crypto';
import db, {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import type { SubscriptionTransitionInput } from 'api-src/services/billing/subscriptionTransition.service';

/** GH-1226 future input shape under test (test-only; not a production type). */
type ExpectedCurrent = {
  tier?: string;
  status?: string;
  billingProvider?: string;
  trialEndsAt?: Date | null;
};

type PreconditionTransitionInput = SubscriptionTransitionInput & {
  expectedCurrent?: ExpectedCurrent;
};

function transitionWithExpectedCurrent(
  input: PreconditionTransitionInput,
  trx: Parameters<typeof transitionShopSubscription>[1],
) {
  return transitionShopSubscription(input as SubscriptionTransitionInput, trx);
}

// Future-dated trial windows: these fixtures must never be discovered as
// expired by any trial-expiry cycle sharing the same disposable DB, and sit
// outside the D-3 / D-1 reminder windows.
const DAY_MS = 24 * 60 * 60 * 1000;

async function createShop(label: string): Promise<number> {
  const suffix = crypto.randomBytes(5).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1226-precondition-${label}-${suffix}`);
    await setTenantContext(trx, id);
    return id;
  });
}

/** Authoritative growth/trialing/shopify trial, created via the canonical service. */
async function seedGrowthTrial(shopId: number, trialEndsAt: Date): Promise<void> {
  await withTenant(shopId, (trx) =>
    transitionShopSubscription(
      {
        shopId,
        to: { tier: 'growth', status: 'trialing', billingProvider: 'shopify' },
        fields: { trial_ends_at: trialEndsAt },
        source: 'gh1226_test_fixture',
        reason: 'growth_trial_fixture',
        actorType: 'system',
        actorId: 'gh1226-test',
        actingProvider: 'shopify',
      },
      trx,
    ),
  );
}

async function subscription(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'status', 'billing_provider', 'trial_ends_at'),
  );
}

async function ledger(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('shop_subscription_transitions')
      .where({ shop_id: shopId })
      .orderBy('id', 'asc')
      .select(
        'id',
        'from_tier',
        'from_status',
        'from_billing_provider',
        'to_tier',
        'to_status',
        'to_billing_provider',
        'source',
        'reason',
      ),
  );
}

function iso(value: unknown): string | null {
  return value == null ? null : new Date(value as string | Date).toISOString();
}

function candidateExpiryInput(shopId: number, expectedCurrent: ExpectedCurrent): PreconditionTransitionInput {
  return {
    shopId,
    expectedCurrent,
    to: { tier: 'starter', status: 'active' },
    fields: { trial_ends_at: null },
    source: 'gh1226_precondition_test',
    reason: 'candidate_trial_expiry',
    actorType: 'worker',
    actorId: 'gh1226-test',
  };
}

afterAll(async () => {
  await db.destroy();
});

describe('GH-1226 — transitionShopSubscription expectedCurrent precondition (after-lock)', () => {
  it('P1 — matching candidate control: a matching expectedCurrent applies the transition', async () => {
    const shopId = await createShop('p1');
    const trialEndsAtA = new Date(Date.now() + 7 * DAY_MS);
    await seedGrowthTrial(shopId, trialEndsAtA);

    const ledgerBefore = await ledger(shopId);

    const result = await withTenant(shopId, (trx) =>
      transitionWithExpectedCurrent(
        candidateExpiryInput(shopId, {
          tier: 'growth',
          status: 'trialing',
          billingProvider: 'shopify',
          trialEndsAt: trialEndsAtA,
        }),
        trx,
      ),
    );

    expect(result.applied).toBe(true);

    const persisted = await subscription(shopId);
    expect(persisted).toMatchObject({
      tier: 'starter',
      status: 'active',
      billing_provider: 'shopify',
    });
    expect(persisted.trial_ends_at).toBeNull();

    const ledgerAfter = await ledger(shopId);
    const added = ledgerAfter.filter(
      (row: { id: string | number }) => !ledgerBefore.some((b: { id: string | number }) => String(b.id) === String(row.id)),
    );
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      from_tier: 'growth',
      from_status: 'trialing',
      from_billing_provider: 'shopify',
      to_tier: 'starter',
      to_status: 'active',
      to_billing_provider: 'shopify',
      source: 'gh1226_precondition_test',
    });
  });

  it('P2 — stale candidate: an expectedCurrent that no longer matches after the lock is a zero-mutation no-op', async () => {
    const shopId = await createShop('p2');
    const trialEndsAtA = new Date(Date.now() + 7 * DAY_MS);
    const trialEndsAtB = new Date(Date.now() + 14 * DAY_MS);
    await seedGrowthTrial(shopId, trialEndsAtA);

    // The candidate was discovered at A. Before it is acted on, ONLY the
    // trial window moves to B (a non-authoritative field; no ledger row).
    await withTenant(shopId, (trx) =>
      trx('shop_subscriptions')
        .where({ shop_id: shopId })
        .update({ trial_ends_at: trialEndsAtB }),
    );

    const before = await subscription(shopId);
    expect(before).toMatchObject({ tier: 'growth', status: 'trialing', billing_provider: 'shopify' });
    expect(iso(before.trial_ends_at)).toBe(trialEndsAtB.toISOString());
    const ledgerBefore = await ledger(shopId);

    // Stale expectedCurrent captured at discovery time (A).
    const result = await withTenant(shopId, (trx) =>
      transitionWithExpectedCurrent(
        candidateExpiryInput(shopId, {
          tier: 'growth',
          status: 'trialing',
          billingProvider: 'shopify',
          trialEndsAt: trialEndsAtA,
        }),
        trx,
      ),
    );

    process.stdout.write(
      `\n[GH1226_P2_EVIDENCE] ${JSON.stringify({ shopId, result, after: await subscription(shopId) })}\n`,
    );

    expect(result.applied).toBe(false);

    // Future mismatch signal: asserted only if the implementation exposes it.
    const mismatchSignal = (result as unknown as { preconditionMatched?: boolean }).preconditionMatched;
    if (mismatchSignal !== undefined) {
      expect(mismatchSignal).toBe(false);
    }

    const after = await subscription(shopId);
    expect(after).toMatchObject({ tier: 'growth', status: 'trialing', billing_provider: 'shopify' });
    expect(iso(after.trial_ends_at)).toBe(trialEndsAtB.toISOString());

    const ledgerAfter = await ledger(shopId);
    expect(ledgerAfter).toEqual(ledgerBefore);
  });
});
