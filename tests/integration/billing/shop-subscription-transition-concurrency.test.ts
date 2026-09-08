// tests/integration/billing/shop-subscription-transition-concurrency.test.ts
//
// BILL-ENTITLEMENT-01 / P0-B2 — concurrent commercial transitions must
// serialize into a coherent history. PERMANENT regression contract, RED.
// ===========================================================================
// WHY THIS EXISTS SEPARATELY
//   The ledger suite proves a single transition records correct before/after
//   state. It cannot prove that two transitions racing on the SAME shop
//   produce a truthful history. Two Stripe webhooks, or a webhook racing the
//   Shopify reconciliation sweep, are ordinary production events.
//
// THE CONTRACT
//   Given a shop at authoritative state A, two competing transitions to B and
//   to C must produce a strictly serial chain:
//        A -> B  then  B -> C
//     OR A -> C  then  C -> B
//   Which order wins depends on lock acquisition and is NOT asserted.
//
//   What IS asserted, and what a missing row lock would break:
//     - both transitions are recorded (neither is silently lost)
//     - the second row's from-state equals the first row's to-state
//     - NO two rows both claim the stale start state A as their from-state
//     - shop_subscriptions equals the LAST row's to-state
//
//   The overlap is real: both calls are issued before either is awaited, each
//   on its own tenant transaction. They are never serialized by the test.
//
// RED EXPECTATION
//   Fails until the ledger table and the canonical service exist.

import crypto from 'crypto';
import type { Knex } from 'knex';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

const LEDGER_TABLE = 'shop_subscription_transitions';
const SERVICE_MODULE = 'api-src/services/billing/subscriptionTransition.service';

type Tier = 'starter' | 'core' | 'growth' | 'scale';
type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
type Provider = 'stripe' | 'shopify';

interface TransitionInput {
  shopId: number;
  to: { tier?: Tier; status?: SubStatus; billingProvider?: Provider };
  source: string;
  reason: string;
  actorType: string;
  idempotencyKey?: string | null;
}

type TransitionFn = (input: TransitionInput, trx: Knex.Transaction) => Promise<unknown>;

function loadTransitionService(): TransitionFn {
  let mod: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('api-src/services/billing/subscriptionTransition.service');
  } catch (err) {
    throw new Error(
      `[BILL-ENTITLEMENT-01] canonical subscription transition service is absent: ` +
        `${SERVICE_MODULE} (expected export transitionShopSubscription). ` +
        `Underlying resolution error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const fn = mod.transitionShopSubscription;
  if (typeof fn !== 'function') {
    throw new Error(
      `[BILL-ENTITLEMENT-01] ${SERVICE_MODULE} does not export transitionShopSubscription`
    );
  }
  return fn as TransitionFn;
}

async function createFixtureShop(namePrefix: string, seed: {
  tier: Tier;
  status: SubStatus;
  billingProvider: Provider;
}): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: seed.tier,
      status: seed.status,
      billing_provider: seed.billingProvider,
    })
  );

  return shopId;
}

describe('BILL-ENTITLEMENT-01 — concurrent subscription transitions', () => {
  // ── CONCURRENCY-01 ──────────────────────────────────────────────────────
  describe('CONCURRENCY-01: two competing transitions form one coherent serial chain', () => {
    it('never records two transitions that both claim the same stale from-state', async () => {
      const START: { tier: Tier; status: SubStatus; billingProvider: Provider } = {
        tier: 'growth',
        status: 'active',
        billingProvider: 'stripe',
      };
      const shopId = await createFixtureShop('concurrency01', START);
      const fn = loadTransitionService();

      // Both calls are issued before either is awaited — the overlap is real
      // and is never serialized by this test.
      const toScale = withTenant(shopId, (trx) =>
        fn(
          {
            shopId,
            to: { tier: 'scale' },
            source: 'stripe_webhook',
            reason: 'customer.subscription.updated',
            actorType: 'system',
            idempotencyKey: `race_scale_${crypto.randomBytes(6).toString('hex')}`,
          },
          trx as Knex.Transaction
        )
      );
      const toStarter = withTenant(shopId, (trx) =>
        fn(
          {
            shopId,
            to: { tier: 'starter' },
            source: 'shopify_billing_reconciliation_sweep',
            reason: 'reconciled_to_shopify_state',
            actorType: 'system',
            idempotencyKey: `race_starter_${crypto.randomBytes(6).toString('hex')}`,
          },
          trx as Knex.Transaction
        )
      );

      await Promise.all([toScale, toStarter]);

      const rows = await withTenant(shopId, (trx) =>
        trx(LEDGER_TABLE)
          .where({ shop_id: shopId })
          .orderBy([{ column: 'created_at' }, { column: 'id' }])
      );

      // Neither competing transition may be silently lost.
      expect(rows).toHaveLength(2);

      const [first, second] = rows;

      // The chain must be serial: the loser observed the winner's result.
      expect(first.from_tier).toBe(START.tier);
      expect(second.from_tier).toBe(first.to_tier);
      expect(second.from_status).toBe(first.to_status);
      expect(second.from_billing_provider).toBe(first.to_billing_provider);

      // The specific interleaving is not asserted, only that it is one of the
      // two legal serial orders.
      expect([
        [START.tier, 'scale', 'starter'],
        [START.tier, 'starter', 'scale'],
      ]).toContainEqual([first.from_tier, first.to_tier, second.to_tier]);

      // A lost update would show two rows both claiming stale state A.
      const rowsClaimingStartTier = rows.filter((r: any) => r.from_tier === START.tier);
      expect(rowsClaimingStartTier).toHaveLength(1);

      // Persisted state must equal the end of the chain, not either racer's
      // independently computed result.
      const sub = await withTenant(shopId, (trx) =>
        trx('shop_subscriptions')
          .where({ shop_id: shopId })
          .first('tier', 'status', 'billing_provider')
      );
      expect(sub?.tier).toBe(second.to_tier);
      expect(sub?.status).toBe(second.to_status);
      expect(sub?.billing_provider).toBe(second.to_billing_provider);
    });
  });
});
