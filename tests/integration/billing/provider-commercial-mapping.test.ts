// tests/integration/billing/provider-commercial-mapping.test.ts
//
// BILL-ENTITLEMENT-01 / P0-B3 — provider mapping + provider ownership, proven
// against real PostgreSQL through the real runtime path.
// PERMANENT regression contract, authored RED.
// ===========================================================================
// WHY THIS EXISTS ALONGSIDE THE UNIT SUITES
//   The unit suites prove the resolvers compute the right answer. They cannot
//   prove the WEBHOOK HANDLER uses them, nor that the authoritative column
//   ends up correct, nor that a foreign provider is refused. Those are
//   persistence facts and belong on a real database.
//
// FROZEN BOUNDARY additions beyond P0-B2
//   transitionShopSubscription(input, trx) gains:
//     actingProvider?: 'stripe' | 'shopify'
//     allowProviderSwitch?: boolean
//
//   When actingProvider is supplied and disagrees with the shop's current
//   billing_provider, the transition is REJECTED unless allowProviderSwitch is
//   explicitly true. Omitting actingProvider preserves P0-B2 behaviour exactly,
//   so no existing P0-B2 contract is weakened.
//
// RED EXPECTATION
//   Two independent causes:
//     - the Stripe handler still derives tier from sub.metadata.tier
//     - transitionShopSubscription has no provider-ownership enforcement
//
// HARNESS
//   Real disposable PostgreSQL via `npm run test:integration`. Real tenant
//   bootstrap via create_tenant_shop(). No Stripe call, no Shopify call, no
//   network: the Stripe subscription object is a local fixture, exactly as the
//   webhook adapter would hand it over.

import crypto from 'crypto';
import type { Knex } from 'knex';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';

const LEDGER_TABLE = 'shop_subscription_transitions';

type Tier = 'starter' | 'core' | 'growth' | 'scale';
type Provider = 'stripe' | 'shopify';

// Deterministic synthetic price ids — never a real Stripe price.
const BASE_PRICE = {
  scale_monthly_usd: 'price_test_base_scale_monthly_USD',
  growth_monthly_usd: 'price_test_base_growth_monthly_USD',
};
const SEAT_PRICE_GROWTH_USD = 'price_test_seat_growth_USD';

const PRICE_ENV: Record<string, string> = {
  STRIPE_PRICE_CORE_MONTHLY_USD: 'price_test_base_core_monthly_USD',
  STRIPE_PRICE_CORE_ANNUAL_USD: 'price_test_base_core_annual_USD',
  STRIPE_PRICE_GROWTH_MONTHLY_USD: BASE_PRICE.growth_monthly_usd,
  STRIPE_PRICE_GROWTH_ANNUAL_USD: 'price_test_base_growth_annual_USD',
  STRIPE_PRICE_SCALE_MONTHLY_USD: BASE_PRICE.scale_monthly_usd,
  STRIPE_PRICE_SCALE_ANNUAL_USD: 'price_test_base_scale_annual_USD',
  STRIPE_PRICE_SEAT_ADDON_GROWTH_USD: SEAT_PRICE_GROWTH_USD,
  STRIPE_PRICE_SEAT_ADDON_CORE_USD: 'price_test_seat_core_USD',
};

const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [k, v] of Object.entries(PRICE_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
});

afterAll(() => {
  for (const k of Object.keys(PRICE_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function createFixtureShop(
  namePrefix: string,
  seed: { tier: Tier; status: string; billingProvider: Provider } | null
): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  if (seed) {
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
      .first('tier', 'status', 'billing_provider', 'billing_interval', 'extra_seats')
  );
}

async function readLedger(shopId: number): Promise<any[]> {
  return withTenant(shopId, (trx) =>
    trx(LEDGER_TABLE).where({ shop_id: shopId }).orderBy([{ column: 'created_at' }, { column: 'id' }])
  );
}

/** Stripe subscription object as StripeWebhookAdapter unwraps it. */
function stripeSubscriptionPayload(opts: {
  shopId: number;
  items: Array<{ priceId: string; quantity?: number; interval?: 'month' | 'year' }>;
  metadataTier?: string;
  status?: string;
}) {
  return {
    id: `sub_test_${crypto.randomBytes(4).toString('hex')}`,
    customer: `cus_test_${crypto.randomBytes(4).toString('hex')}`,
    status: opts.status ?? 'active',
    metadata: {
      shopId: String(opts.shopId),
      ...(opts.metadataTier ? { tier: opts.metadataTier } : {}),
    },
    items: {
      data: opts.items.map((i) => ({
        price: { id: i.priceId },
        quantity: i.quantity ?? 1,
        plan: { interval: i.interval ?? 'month' },
        current_period_start: 1767225600,
        current_period_end: 1769904000,
      })),
    },
  };
}

function envelopeFor(shopId: number, payload: any, eventType = 'customer.subscription.updated') {
  return {
    integration: 'stripe',
    eventId: `evt_test_${crypto.randomBytes(6).toString('hex')}`,
    eventType,
    verified: true as const,
    receivedAt: new Date(),
    rawPayload: payload,
    shopId,
  };
}

/** Loaded lazily so the price env above is in place first. */
function loadUpsertHandler() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('api-src/api/billing/handlers/handleSubscriptionUpsert')
    .handleSubscriptionUpsert as (envelope: any, trx: Knex.Transaction) => Promise<void>;
}

describe('P0-B3 — provider commercial mapping (real DB)', () => {
  // ── MAPPING-01 (STRIPE-05 at the persistence boundary) ──────────────────
  describe('MAPPING-01: the purchased Stripe price decides the persisted tier', () => {
    it('a Scale price with metadata.tier=growth persists tier=scale', async () => {
      const shopId = await createFixtureShop('p0b3map01', {
        tier: 'core',
        status: 'active',
        billingProvider: 'stripe',
      });
      const handle = loadUpsertHandler();

      const payload = stripeSubscriptionPayload({
        shopId,
        items: [{ priceId: BASE_PRICE.scale_monthly_usd }],
        metadataTier: 'growth', // stale/incorrect metadata
      });

      await withTenant(shopId, (trx) => handle(envelopeFor(shopId, payload), trx as Knex.Transaction));

      const sub = await readSubscription(shopId);
      expect(sub?.tier).toBe('scale');

      // Provenance must record what actually decided the tier.
      const rows = await readLedger(shopId);
      expect(rows).toHaveLength(1);
      expect(rows[0].to_tier).toBe('scale');
      expect(rows[0].from_tier).toBe('core');
    });
  });

  // ── MAPPING-02 (STRIPE-04 at the persistence boundary) ──────────────────
  describe('MAPPING-02: a known price resolves with no metadata.tier present', () => {
    it('persists the price-derived tier when metadata carries only shopId', async () => {
      const shopId = await createFixtureShop('p0b3map02', {
        tier: 'starter',
        status: 'active',
        billingProvider: 'stripe',
      });
      const handle = loadUpsertHandler();

      const payload = stripeSubscriptionPayload({
        shopId,
        items: [{ priceId: BASE_PRICE.growth_monthly_usd }],
        // no metadata.tier at all — today this throws "invalid tier"
      });

      await withTenant(shopId, (trx) => handle(envelopeFor(shopId, payload), trx as Knex.Transaction));

      const sub = await readSubscription(shopId);
      expect(sub?.tier).toBe('growth');
      expect(sub?.billing_interval).toBe('monthly');
    });
  });

  // ── MAPPING-03 (STRIPE-03/06 at the persistence boundary) ───────────────
  describe('MAPPING-03: an unrecognized purchase never mutates authoritative state', () => {
    it('an unknown base price is rejected and leaves tier untouched', async () => {
      const shopId = await createFixtureShop('p0b3map03', {
        tier: 'core',
        status: 'active',
        billingProvider: 'stripe',
      });
      const handle = loadUpsertHandler();

      const payload = stripeSubscriptionPayload({
        shopId,
        items: [{ priceId: 'price_not_configured_anywhere' }],
        metadataTier: 'scale', // must NOT rescue the unknown price
      });

      await expect(
        withTenant(shopId, (trx) => handle(envelopeFor(shopId, payload), trx as Knex.Transaction))
      ).rejects.toBeDefined();

      const sub = await readSubscription(shopId);
      expect(sub?.tier).toBe('core');
      expect(await readLedger(shopId)).toHaveLength(0);
    });
  });

  // ── OWNER-01 ────────────────────────────────────────────────────────────
  describe('OWNER-01: a Stripe event cannot change a Shopify-billed tenant', () => {
    it('rejects the transition and leaves tier, status and provider untouched', async () => {
      const shopId = await createFixtureShop('p0b3own01', {
        tier: 'growth',
        status: 'active',
        billingProvider: 'shopify',
      });

      await expect(
        withTenant(shopId, (trx) =>
          transitionShopSubscription(
            {
              shopId,
              to: { tier: 'scale', status: 'active' },
              source: 'stripe_webhook',
              reason: 'customer.subscription.updated',
              actorType: 'stripe',
              actingProvider: 'stripe',
            } as any,
            trx
          )
        )
      ).rejects.toBeDefined();

      const sub = await readSubscription(shopId);
      expect(sub?.tier).toBe('growth');
      expect(sub?.status).toBe('active');
      expect(sub?.billing_provider).toBe('shopify');
      expect(await readLedger(shopId)).toHaveLength(0);
    });
  });

  // ── OWNER-02 ────────────────────────────────────────────────────────────
  describe('OWNER-02: Shopify state cannot silently take over a Stripe tenant', () => {
    it('rejects a shopify-acting transition against a stripe-owned tenant', async () => {
      const shopId = await createFixtureShop('p0b3own02', {
        tier: 'growth',
        status: 'active',
        billingProvider: 'stripe',
      });

      await expect(
        withTenant(shopId, (trx) =>
          transitionShopSubscription(
            {
              shopId,
              to: { tier: 'starter', status: 'canceled', billingProvider: 'shopify' },
              source: 'shopify_billing_reconciliation',
              reason: 'shopify_billing_state_applied',
              actorType: 'shopify',
              actingProvider: 'shopify',
            } as any,
            trx
          )
        )
      ).rejects.toBeDefined();

      const sub = await readSubscription(shopId);
      expect(sub?.tier).toBe('growth');
      expect(sub?.billing_provider).toBe('stripe');
      expect(await readLedger(shopId)).toHaveLength(0);
    });

    it('an explicitly authorized provider switch is still possible', async () => {
      const shopId = await createFixtureShop('p0b3own02b', {
        tier: 'growth',
        status: 'active',
        billingProvider: 'stripe',
      });

      await withTenant(shopId, (trx) =>
        transitionShopSubscription(
          {
            shopId,
            to: { tier: 'growth', status: 'active', billingProvider: 'shopify' },
            source: 'commercial_migration',
            reason: 'authorized_provider_switch',
            actorType: 'system',
            actingProvider: 'shopify',
            allowProviderSwitch: true,
          } as any,
          trx
        )
      );

      const sub = await readSubscription(shopId);
      expect(sub?.billing_provider).toBe('shopify');

      const rows = await readLedger(shopId);
      expect(rows).toHaveLength(1);
      expect(rows[0].from_billing_provider).toBe('stripe');
      expect(rows[0].to_billing_provider).toBe('shopify');
    });
  });

  // ── OWNER-03 ────────────────────────────────────────────────────────────
  describe('OWNER-03: first-provider initialization still works', () => {
    it.each([
      ['stripe', 'stripe'],
      ['shopify', 'shopify'],
    ] as const)(
      'a shop with no subscription row can be created by acting provider %s',
      async (actingProvider, expectedProvider) => {
        const shopId = await createFixtureShop(`p0b3own03${actingProvider}`, null);

        await withTenant(shopId, (trx) =>
          transitionShopSubscription(
            {
              shopId,
              to: { tier: 'growth', status: 'trialing', billingProvider: expectedProvider },
              source: 'first_provider_initialization',
              reason: 'initial_subscription_creation',
              actorType: 'system',
              actingProvider,
            } as any,
            trx
          )
        );

        const sub = await readSubscription(shopId);
        expect(sub?.tier).toBe('growth');
        expect(sub?.billing_provider).toBe(expectedProvider);

        const rows = await readLedger(shopId);
        expect(rows).toHaveLength(1);
        expect(rows[0].from_billing_provider).toBeNull();
      }
    );
  });
});
