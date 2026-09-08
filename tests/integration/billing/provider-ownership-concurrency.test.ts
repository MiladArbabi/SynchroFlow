// tests/integration/billing/provider-ownership-concurrency.test.ts
//
// BILL-ENTITLEMENT-01 / P0-B3 — OWNER-04: concurrent foreign-provider events.
// PERMANENT regression contract, authored RED.
// ===========================================================================
// WHY THIS EXISTS SEPARATELY
//   P0-B2's concurrency suite proves two LEGITIMATE transitions serialize into
//   a coherent chain. It says nothing about a legitimate transition racing a
//   FOREIGN-provider one. Provider ownership checked before a lock, or checked
//   against a stale read, would let the foreign write land in the gap — the
//   classic check-then-act race.
//
//   The overlap here is real: both calls are issued before either is awaited,
//   each on its own tenant transaction, and neither is retried.
//
// THE CONTRACT
//   A Shopify-owned tenant, hit simultaneously by its own legitimate Shopify
//   transition and by a foreign Stripe transition, must end with:
//     - billing_provider still 'shopify'
//     - exactly one ledger row, written by the Shopify transition
//     - no row whose provenance is the rejected Stripe event
//     - persisted tier equal to that single row's to_tier
//
// RED EXPECTATION
//   transitionShopSubscription has no provider-ownership enforcement, so the
//   foreign Stripe transition currently succeeds.

import crypto from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';

const LEDGER_TABLE = 'shop_subscription_transitions';

async function createShopifyOwnedShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'growth',
      status: 'active',
      billing_provider: 'shopify',
    })
  );
  return shopId;
}

describe('P0-B3 — provider ownership under concurrency', () => {
  // ── OWNER-04 ────────────────────────────────────────────────────────────
  describe('OWNER-04: a foreign-provider event racing a legitimate one cannot land', () => {
    it('leaves a single coherent Shopify-owned chain with no Stripe-sourced row', async () => {
      const shopId = await createShopifyOwnedShop('p0b3own04');

      // Both issued before either is awaited — genuine overlap, never serialized
      // by this test.
      const legitimateShopify = withTenant(shopId, (trx) =>
        transitionShopSubscription(
          {
            shopId,
            to: { tier: 'scale', status: 'active', billingProvider: 'shopify' },
            source: 'shopify_billing_reconciliation',
            reason: 'shopify_billing_state_applied',
            actorType: 'shopify',
            actingProvider: 'shopify',
          } as any,
          trx
        )
      );

      const foreignStripe = withTenant(shopId, (trx) =>
        transitionShopSubscription(
          {
            shopId,
            to: { tier: 'starter', status: 'canceled' },
            source: 'stripe_webhook',
            reason: 'customer.subscription.deleted',
            actorType: 'stripe',
            actingProvider: 'stripe',
          } as any,
          trx
        )
      );

      const [legit, foreign] = await Promise.allSettled([legitimateShopify, foreignStripe]);

      // The tenant's own provider must succeed; the foreign one must not.
      expect(legit.status).toBe('fulfilled');
      expect(foreign.status).toBe('rejected');

      const rows = await withTenant(shopId, (trx) =>
        trx(LEDGER_TABLE)
          .where({ shop_id: shopId })
          .orderBy([{ column: 'created_at' }, { column: 'id' }])
      );

      // Exactly one transition, and it is the Shopify one.
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_type).toBe('shopify');
      expect(rows[0].to_tier).toBe('scale');

      // No provenance from the rejected foreign event may survive.
      expect(rows.filter((r: any) => r.source === 'stripe_webhook')).toHaveLength(0);

      const sub = await withTenant(shopId, (trx) =>
        trx('shop_subscriptions')
          .where({ shop_id: shopId })
          .first('tier', 'status', 'billing_provider')
      );

      expect(sub?.billing_provider).toBe('shopify');
      expect(sub?.tier).toBe(rows[0].to_tier);
      expect(sub?.status).toBe(rows[0].to_status);
    });
  });
});
