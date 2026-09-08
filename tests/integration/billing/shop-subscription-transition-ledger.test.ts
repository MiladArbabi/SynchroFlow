// tests/integration/billing/shop-subscription-transition-ledger.test.ts
//
// BILL-ENTITLEMENT-01 / P0-B2 — durable commercial subscription transition
// provenance. PERMANENT regression contract, authored RED.
// ===========================================================================
// WHAT THIS PROTECTS
//   Every change to entitlement-authoritative subscription state
//   (tier, status, billing_provider) must be applied through ONE canonical
//   service and must leave a durable, append-only provenance row describing
//   the exact before -> after transition and who/what caused it.
//
// FROZEN BOUNDARY (the only implementation detail this file may depend on)
//   ledger table  : shop_subscription_transitions
//   service file  : apps/backend/src/services/billing/subscriptionTransition.service.ts
//   operation     : transitionShopSubscription
//
// ASSUMED CALL CONTRACT
//   The frozen boundary names the table, the file and the operation, but not
//   the argument shape. This suite declares the minimum shape the contracts
//   below require, and nothing more:
//
//     await transitionShopSubscription(
//       {
//         shopId,
//         to: { tier?, status?, billingProvider? },   // requested after-state
//         fields?: { ... },                           // accompanying non-authoritative columns
//         source, reason, actorType,                  // NOT NULL provenance
//         actorId?, externalEventId?, idempotencyKey?, metadata?, occurredAt?,
//       },
//       trx,
//     )
//
//   Omitted `to` keys mean "leave that authoritative dimension unchanged".
//   A ledger row is written ONLY when at least one authoritative dimension
//   actually changes value.
//
// RED EXPECTATION
//   Until both the ledger migration and the canonical service exist, every
//   behavioural test here fails. `loadTransitionService()` fails with an
//   explicit absence message rather than collapsing the whole file at import
//   time, so each contract reports its own failure.
//
// HARNESS
//   Real disposable PostgreSQL via `npm run test:integration`
//   (scripts/with-test-db.js). Real tenant bootstrap via create_tenant_shop()
//   — the same SECURITY DEFINER path production install code uses. No global
//   seed, no Stripe call, no Shopify call.

import crypto from 'crypto';
import type { Knex } from 'knex';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

const LEDGER_TABLE = 'shop_subscription_transitions';
const SERVICE_MODULE = 'api-src/services/billing/subscriptionTransition.service';

type Tier = 'starter' | 'core' | 'growth' | 'scale';
type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
type Provider = 'stripe' | 'shopify';

export interface TransitionInput {
  shopId: number;
  to: { tier?: Tier; status?: SubStatus; billingProvider?: Provider };
  fields?: Record<string, unknown>;
  source: string;
  reason: string;
  actorType: string;
  actorId?: string | null;
  externalEventId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
}

type TransitionFn = (input: TransitionInput, trx: Knex.Transaction) => Promise<unknown>;

/**
 * Loads the canonical service lazily so an absent service produces ONE
 * explicit per-test failure reason instead of a module-resolution error that
 * would hide which contracts exist.
 */
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

async function transition(input: TransitionInput): Promise<unknown> {
  const fn = loadTransitionService();
  return withTenant(input.shopId, (trx) => fn(input, trx as Knex.Transaction));
}

interface SubscriptionSeed {
  tier: Tier;
  status: SubStatus;
  billingProvider: Provider;
}

/**
 * Isolated shop + optional shop_subscriptions row.
 *
 * shops has FORCE ROW LEVEL SECURITY keyed on the row's own id, so a plain
 * insert cannot satisfy the WITH CHECK policy for a not-yet-existing id.
 * create_tenant_shop() is the canonical sf_app-granted bootstrap the real
 * install path uses (integration.controller.ts:870) — reused, not duplicated.
 */
async function createFixtureShop(
  namePrefix: string,
  seed: SubscriptionSeed | null
): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  if (seed !== null) {
    await withTenant(shopId, (trx) =>
      trx('shop_subscriptions').insert({
        shop_id: shopId,
        tier: seed.tier,
        status: seed.status,
        billing_provider: seed.billingProvider,
      })
    );
  }

  return shopId;
}

async function readSubscription(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier', 'status', 'billing_provider')
  );
}

async function readLedger(shopId: number): Promise<any[]> {
  return withTenant(shopId, (trx) =>
    trx(LEDGER_TABLE).where({ shop_id: shopId }).orderBy([{ column: 'created_at' }, { column: 'id' }])
  );
}

describe('BILL-ENTITLEMENT-01 — shop_subscription_transitions ledger', () => {
  // ── LEDGER-01 ───────────────────────────────────────────────────────────
  describe('LEDGER-01: a tier transition records exactly one row with exact before/after state', () => {
    it('growth/active/stripe -> scale/active/stripe writes one transition and the new tier', async () => {
      const shopId = await createFixtureShop('ledger01', {
        tier: 'growth',
        status: 'active',
        billingProvider: 'stripe',
      });

      await transition({
        shopId,
        to: { tier: 'scale', status: 'active', billingProvider: 'stripe' },
        source: 'stripe_webhook',
        reason: 'customer.subscription.updated',
        actorType: 'system',
      });

      const sub = await readSubscription(shopId);
      expect(sub?.tier).toBe('scale');
      expect(sub?.status).toBe('active');
      expect(sub?.billing_provider).toBe('stripe');

      const rows = await readLedger(shopId);
      expect(rows).toHaveLength(1);

      const row = rows[0];
      expect(row.from_tier).toBe('growth');
      expect(row.to_tier).toBe('scale');
      expect(row.from_status).toBe('active');
      expect(row.to_status).toBe('active');
      expect(row.from_billing_provider).toBe('stripe');
      expect(row.to_billing_provider).toBe('stripe');
      expect(row.source).toBe('stripe_webhook');
      expect(row.reason).toBe('customer.subscription.updated');
      expect(row.actor_type).toBe('system');
      expect(row.occurred_at).toBeInstanceOf(Date);
      expect(row.created_at).toBeInstanceOf(Date);
    });
  });

  // ── LEDGER-02 ───────────────────────────────────────────────────────────
  describe('LEDGER-02: creation records NULL from_* and the created to_* state', () => {
    it('a shop with no subscription row gets one, with a NULL-from creation transition', async () => {
      const shopId = await createFixtureShop('ledger02', null);
      expect(await readSubscription(shopId)).toBeUndefined();

      await transition({
        shopId,
        to: { tier: 'growth', status: 'trialing', billingProvider: 'shopify' },
        source: 'shopify_install',
        reason: 'app_store_install_trial_grant',
        actorType: 'system',
      });

      const sub = await readSubscription(shopId);
      expect(sub?.tier).toBe('growth');
      expect(sub?.status).toBe('trialing');
      expect(sub?.billing_provider).toBe('shopify');

      const rows = await readLedger(shopId);
      expect(rows).toHaveLength(1);
      expect(rows[0].from_tier).toBeNull();
      expect(rows[0].from_status).toBeNull();
      expect(rows[0].from_billing_provider).toBeNull();
      expect(rows[0].to_tier).toBe('growth');
      expect(rows[0].to_status).toBe('trialing');
      expect(rows[0].to_billing_provider).toBe('shopify');
    });
  });

  // ── LEDGER-03 ───────────────────────────────────────────────────────────
  describe('LEDGER-03: a status-only change is an authoritative transition', () => {
    it('active -> past_due records a transition with tier and provider unchanged', async () => {
      const shopId = await createFixtureShop('ledger03', {
        tier: 'growth',
        status: 'active',
        billingProvider: 'stripe',
      });

      await transition({
        shopId,
        to: { status: 'past_due' },
        source: 'stripe_webhook',
        reason: 'invoice.payment_failed',
        actorType: 'system',
      });

      const sub = await readSubscription(shopId);
      expect(sub?.status).toBe('past_due');
      expect(sub?.tier).toBe('growth');

      const rows = await readLedger(shopId);
      expect(rows).toHaveLength(1);
      expect(rows[0].from_status).toBe('active');
      expect(rows[0].to_status).toBe('past_due');
      expect(rows[0].from_tier).toBe('growth');
      expect(rows[0].to_tier).toBe('growth');
      expect(rows[0].from_billing_provider).toBe('stripe');
      expect(rows[0].to_billing_provider).toBe('stripe');
    });
  });

  // ── LEDGER-04 ───────────────────────────────────────────────────────────
  describe('LEDGER-04: a billing_provider-only change is an authoritative transition', () => {
    it('stripe -> shopify records a transition with tier and status unchanged', async () => {
      const shopId = await createFixtureShop('ledger04', {
        tier: 'growth',
        status: 'trialing',
        billingProvider: 'stripe',
      });

      await transition({
        shopId,
        to: { billingProvider: 'shopify' },
        source: 'shopify_oauth_callback',
        reason: 'app_store_billing_provider_stamp',
        actorType: 'system',
      });

      const sub = await readSubscription(shopId);
      expect(sub?.billing_provider).toBe('shopify');
      expect(sub?.tier).toBe('growth');
      expect(sub?.status).toBe('trialing');

      const rows = await readLedger(shopId);
      expect(rows).toHaveLength(1);
      expect(rows[0].from_billing_provider).toBe('stripe');
      expect(rows[0].to_billing_provider).toBe('shopify');
      expect(rows[0].from_tier).toBe('growth');
      expect(rows[0].to_tier).toBe('growth');
      expect(rows[0].from_status).toBe('trialing');
      expect(rows[0].to_status).toBe('trialing');
    });
  });

  // ── LEDGER-05 ───────────────────────────────────────────────────────────
  describe('LEDGER-05: re-applying identical authoritative state writes no transition', () => {
    it('a no-op transition leaves the ledger empty', async () => {
      const shopId = await createFixtureShop('ledger05', {
        tier: 'core',
        status: 'active',
        billingProvider: 'stripe',
      });

      await transition({
        shopId,
        to: { tier: 'core', status: 'active', billingProvider: 'stripe' },
        source: 'shopify_billing_reconciliation_sweep',
        reason: 'periodic_reconcile',
        actorType: 'system',
      });

      const sub = await readSubscription(shopId);
      expect(sub?.tier).toBe('core');
      expect(sub?.status).toBe('active');
      expect(sub?.billing_provider).toBe('stripe');

      expect(await readLedger(shopId)).toHaveLength(0);
    });
  });

  // ── LEDGER-06 ───────────────────────────────────────────────────────────
  describe('LEDGER-06: a rejected ledger write rolls back the authoritative mutation', () => {
    it('a provenance violation leaves shop_subscriptions and the ledger untouched', async () => {
      const shopId = await createFixtureShop('ledger06', {
        tier: 'growth',
        status: 'active',
        billingProvider: 'stripe',
      });

      await expect(
        transition({
          shopId,
          to: { tier: 'scale' },
          source: 'stripe_webhook',
          // reason is NOT NULL provenance — a null must abort the whole
          // operation, not silently persist an unprovenanced tier change.
          reason: null as unknown as string,
          actorType: 'system',
        })
      ).rejects.toBeDefined();

      const sub = await readSubscription(shopId);
      expect(sub?.tier).toBe('growth');
      expect(sub?.status).toBe('active');
      expect(sub?.billing_provider).toBe('stripe');

      expect(await readLedger(shopId)).toHaveLength(0);
    });
  });

  // ── LEDGER-07 ───────────────────────────────────────────────────────────
  describe('LEDGER-07: a non-null idempotency key applies a transition at most once', () => {
    it('replaying the same key does not produce a second transition or a second state change', async () => {
      const shopId = await createFixtureShop('ledger07', {
        tier: 'growth',
        status: 'active',
        billingProvider: 'stripe',
      });
      const idempotencyKey = `evt_${crypto.randomBytes(8).toString('hex')}`;

      const input: TransitionInput = {
        shopId,
        to: { tier: 'scale' },
        source: 'stripe_webhook',
        reason: 'customer.subscription.updated',
        actorType: 'system',
        externalEventId: idempotencyKey,
        idempotencyKey,
      };

      await transition(input);
      // Replay of the identical delivery. Whether the service short-circuits
      // or the DB rejects the duplicate, the observable end state is the same:
      // exactly one transition, applied exactly once.
      await transition(input).catch(() => undefined);

      const rows = await readLedger(shopId);
      expect(rows).toHaveLength(1);
      expect(rows[0].idempotency_key).toBe(idempotencyKey);
      expect(rows[0].from_tier).toBe('growth');
      expect(rows[0].to_tier).toBe('scale');

      const sub = await readSubscription(shopId);
      expect(sub?.tier).toBe('scale');
    });
  });

  // ── LEDGER-08 ───────────────────────────────────────────────────────────
  describe('LEDGER-08: supplied provenance context is persisted verbatim', () => {
    it('metadata, external_event_id and actor_id survive the transition', async () => {
      const shopId = await createFixtureShop('ledger08', {
        tier: 'growth',
        status: 'trialing',
        billingProvider: 'stripe',
      });
      const externalEventId = `evt_${crypto.randomBytes(8).toString('hex')}`;
      const metadata = { stripe_subscription_id: 'sub_test_123', invoice_attempt: 2 };

      await transition({
        shopId,
        to: { tier: 'starter', status: 'active' },
        source: 'trial_expiry_worker',
        reason: 'trial_expired',
        actorType: 'worker',
        actorId: 'trial-expiry',
        externalEventId,
        metadata,
      });

      const rows = await readLedger(shopId);
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('trial_expiry_worker');
      expect(rows[0].reason).toBe('trial_expired');
      expect(rows[0].actor_type).toBe('worker');
      expect(rows[0].actor_id).toBe('trial-expiry');
      expect(rows[0].external_event_id).toBe(externalEventId);
      expect(rows[0].metadata).toEqual(metadata);
    });
  });
});
