// tests/unit/backend/billing/provider-price-resolver.test.ts
//
// BILL-ENTITLEMENT-01 / P0-B3 — Stripe provider-price mapping integrity.
// PERMANENT regression contract, authored RED.
// ===========================================================================
// WHAT THIS PROTECTS
//   The tier laSyncro grants must be derived from the Stripe price the merchant
//   ACTUALLY bought, not from mutable subscription metadata. Today
//   handleSubscriptionUpsert.ts:59 reads `sub.metadata.tier` and no reverse
//   price map exists anywhere in the repo, so entitlements and revenue can
//   diverge silently and permanently.
//
// FROZEN BOUNDARY (the only implementation detail this file depends on)
//   module : apps/backend/src/services/billing/providerPriceResolver.service.ts
//   exports:
//     resolveStripePriceIdentity(priceId)      -> StripePriceIdentity | throws
//     resolveStripeSubscriptionCommercial(sub) -> StripeSubscriptionCommercial | throws
//     assertStripePriceConfigComplete()        -> void | throws
//
//   StripePriceIdentity
//     { tier, currency, interval?, itemKind: 'base' | 'seat_addon' }
//     interval is present for base prices and absent for seat add-ons
//     (seats are monthly-only — see pricing.config.ts SEAT_DISPLAY_PRICES).
//
//   StripeSubscriptionCommercial
//     { tier, interval, currency, basePriceId, extraSeats,
//       metadataTier, metadataDisagreement }
//
//   The resolver MUST be built from the same PRICE_ID_ENV_KEYS /
//   SEAT_PRICE_ID_ENV_KEYS tables that drive outbound checkout
//   (packages/backend-core/src/config/pricing.config.ts), so the forward and
//   reverse directions can never disagree.
//
// RED EXPECTATION
//   The resolver module does not exist. `loadResolver()` fails with an explicit
//   absence message rather than collapsing the file at import time, so each
//   contract reports its own failure.
//
// DB-free. No network. No provider call.

const RESOLVER_MODULE = 'api-src/services/billing/providerPriceResolver.service';

type Tier = 'core' | 'growth' | 'scale';
type Currency = 'GBP' | 'USD' | 'EUR';
type Interval = 'monthly' | 'annual';
type SeatTier = 'core' | 'growth';

/** The 18 configured base prices — 3 tiers x 3 currencies x 2 intervals. */
const BASE_MATRIX: Array<[Tier, Currency, Interval]> = (
  ['core', 'growth', 'scale'] as Tier[]
).flatMap((tier) =>
  (['GBP', 'USD', 'EUR'] as Currency[]).flatMap((currency) =>
    (['monthly', 'annual'] as Interval[]).map(
      (interval) => [tier, currency, interval] as [Tier, Currency, Interval]
    )
  )
);

/** The 6 configured seat add-on prices — 2 tiers x 3 currencies. */
const SEAT_MATRIX: Array<[SeatTier, Currency]> = (['core', 'growth'] as SeatTier[]).flatMap(
  (tier) => (['GBP', 'USD', 'EUR'] as Currency[]).map((currency) => [tier, currency] as [SeatTier, Currency])
);

const baseEnvKey = (t: Tier, c: Currency, i: Interval) =>
  `STRIPE_PRICE_${t.toUpperCase()}_${i.toUpperCase()}_${c}`;
const seatEnvKey = (t: SeatTier, c: Currency) =>
  `STRIPE_PRICE_SEAT_ADDON_${t.toUpperCase()}_${c}`;

/** Deterministic synthetic ids — never a real Stripe price. */
const basePriceId = (t: Tier, c: Currency, i: Interval) => `price_test_base_${t}_${i}_${c}`;
const seatPriceId = (t: SeatTier, c: Currency) => `price_test_seat_${t}_${c}`;

const ALL_KEYS = [
  ...BASE_MATRIX.map(([t, c, i]) => baseEnvKey(t, c, i)),
  ...SEAT_MATRIX.map(([t, c]) => seatEnvKey(t, c)),
];

let savedEnv: Record<string, string | undefined> = {};

function applyCompletePriceConfig(): void {
  for (const [t, c, i] of BASE_MATRIX) process.env[baseEnvKey(t, c, i)] = basePriceId(t, c, i);
  for (const [t, c] of SEAT_MATRIX) process.env[seatEnvKey(t, c)] = seatPriceId(t, c);
}

interface Resolver {
  resolveStripePriceIdentity: (priceId: string) => any;
  resolveStripeSubscriptionCommercial: (sub: any) => any;
  assertStripePriceConfigComplete: () => void;
}

/**
 * Loaded lazily and AFTER env is applied, so the resolver may legitimately
 * build its reverse table at module load without this suite pinning that
 * choice.
 */
function loadResolver(): Resolver {
  let mod: Record<string, unknown>;
  jest.resetModules();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('api-src/services/billing/providerPriceResolver.service');
  } catch (err) {
    throw new Error(
      `[BILL-ENTITLEMENT-01/P0-B3] canonical Stripe provider-price resolver is absent: ` +
        `${RESOLVER_MODULE} (expected exports resolveStripePriceIdentity, ` +
        `resolveStripeSubscriptionCommercial, assertStripePriceConfigComplete). ` +
        `Underlying resolution error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  for (const name of [
    'resolveStripePriceIdentity',
    'resolveStripeSubscriptionCommercial',
    'assertStripePriceConfigComplete',
  ]) {
    if (typeof mod[name] !== 'function') {
      throw new Error(`[BILL-ENTITLEMENT-01/P0-B3] ${RESOLVER_MODULE} does not export ${name}`);
    }
  }
  return mod as unknown as Resolver;
}

/** Minimal Stripe subscription shape: only what the resolver may read. */
function stripeSubscription(opts: {
  items: Array<{ priceId: string; quantity?: number; interval?: 'month' | 'year' }>;
  metadataTier?: string | null;
}) {
  return {
    id: 'sub_test_p0b3',
    customer: 'cus_test_p0b3',
    status: 'active',
    metadata: opts.metadataTier === null || opts.metadataTier === undefined
      ? {}
      : { tier: opts.metadataTier },
    items: {
      data: opts.items.map((i) => ({
        price: { id: i.priceId },
        quantity: i.quantity ?? 1,
        plan: { interval: i.interval ?? 'month' },
      })),
    },
  };
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ALL_KEYS) savedEnv[k] = process.env[k];
  applyCompletePriceConfig();
});

afterEach(() => {
  for (const k of ALL_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  jest.resetModules();
});

describe('P0-B3 — Stripe provider-price resolver', () => {
  // ── STRIPE-01 ───────────────────────────────────────────────────────────
  describe('STRIPE-01: every configured base price round-trips to its canonical identity', () => {
    it.each(BASE_MATRIX)(
      '%s / %s / %s resolves to itemKind=base with matching tier, currency and interval',
      (tier, currency, interval) => {
        const resolver = loadResolver();
        const identity = resolver.resolveStripePriceIdentity(basePriceId(tier, currency, interval));

        expect(identity).toMatchObject({ tier, currency, interval, itemKind: 'base' });
      }
    );
  });

  // ── STRIPE-02 ───────────────────────────────────────────────────────────
  describe('STRIPE-02: every configured seat price resolves as a seat add-on', () => {
    it.each(SEAT_MATRIX)('%s / %s resolves to itemKind=seat_addon', (tier, currency) => {
      const resolver = loadResolver();
      const identity = resolver.resolveStripePriceIdentity(seatPriceId(tier, currency));

      expect(identity).toMatchObject({ tier, currency, itemKind: 'seat_addon' });
    });
  });

  // ── STRIPE-03 ───────────────────────────────────────────────────────────
  describe('STRIPE-03: an unknown price is rejected with no metadata fallback', () => {
    it('rejects a price id that is in no configured table', () => {
      const resolver = loadResolver();
      expect(() => resolver.resolveStripePriceIdentity('price_not_configured_anywhere')).toThrow();
    });

    it('rejects an unknown base price even when metadata names a valid tier', () => {
      const resolver = loadResolver();
      const sub = stripeSubscription({
        items: [{ priceId: 'price_not_configured_anywhere' }],
        metadataTier: 'scale',
      });

      // The whole point: metadata must never rescue an unrecognized purchase.
      expect(() => resolver.resolveStripeSubscriptionCommercial(sub)).toThrow();
    });
  });

  // ── STRIPE-04 ───────────────────────────────────────────────────────────
  describe('STRIPE-04: a known price resolves without any metadata at all', () => {
    it('resolves tier, interval and currency from the base price when metadata.tier is absent', () => {
      const resolver = loadResolver();
      const sub = stripeSubscription({
        items: [{ priceId: basePriceId('growth', 'EUR', 'annual'), interval: 'year' }],
        metadataTier: null,
      });

      const commercial = resolver.resolveStripeSubscriptionCommercial(sub);

      expect(commercial).toMatchObject({
        tier: 'growth',
        interval: 'annual',
        currency: 'EUR',
        basePriceId: basePriceId('growth', 'EUR', 'annual'),
      });
    });
  });

  // ── STRIPE-05 ───────────────────────────────────────────────────────────
  describe('STRIPE-05: the price wins when metadata disagrees, and the disagreement is surfaced', () => {
    it('a Scale price with metadata.tier=growth resolves to scale and flags the disagreement', () => {
      const resolver = loadResolver();
      const sub = stripeSubscription({
        items: [{ priceId: basePriceId('scale', 'USD', 'monthly') }],
        metadataTier: 'growth',
      });

      const commercial = resolver.resolveStripeSubscriptionCommercial(sub);

      // Price is authoritative.
      expect(commercial.tier).toBe('scale');
      // Metadata is retained for provenance, never for the decision.
      expect(commercial.metadataTier).toBe('growth');
      expect(commercial.metadataDisagreement).toBe(true);
    });

    it('agreeing metadata does not raise a disagreement flag', () => {
      const resolver = loadResolver();
      const sub = stripeSubscription({
        items: [{ priceId: basePriceId('scale', 'USD', 'monthly') }],
        metadataTier: 'scale',
      });

      const commercial = resolver.resolveStripeSubscriptionCommercial(sub);
      expect(commercial.tier).toBe('scale');
      expect(commercial.metadataDisagreement).toBe(false);
    });
  });

  // ── STRIPE-06 ───────────────────────────────────────────────────────────
  describe('STRIPE-06: exactly one known base item, with no items[0] fallback', () => {
    it('accepts a base item accompanied by a known seat add-on and counts the seats', () => {
      const resolver = loadResolver();
      const sub = stripeSubscription({
        items: [
          { priceId: seatPriceId('growth', 'GBP'), quantity: 3 },
          { priceId: basePriceId('growth', 'GBP', 'monthly') },
        ],
      });

      const commercial = resolver.resolveStripeSubscriptionCommercial(sub);

      // Seat item listed FIRST — order must not decide the base item.
      expect(commercial.tier).toBe('growth');
      expect(commercial.basePriceId).toBe(basePriceId('growth', 'GBP', 'monthly'));
      expect(commercial.extraSeats).toBe(3);
    });

    it('rejects a subscription with zero known base items', () => {
      const resolver = loadResolver();
      const sub = stripeSubscription({
        items: [{ priceId: seatPriceId('core', 'USD'), quantity: 2 }],
        metadataTier: 'core',
      });

      expect(() => resolver.resolveStripeSubscriptionCommercial(sub)).toThrow();
    });

    it('rejects a subscription carrying two known base items', () => {
      const resolver = loadResolver();
      const sub = stripeSubscription({
        items: [
          { priceId: basePriceId('core', 'USD', 'monthly') },
          { priceId: basePriceId('scale', 'USD', 'monthly') },
        ],
      });

      expect(() => resolver.resolveStripeSubscriptionCommercial(sub)).toThrow();
    });

    it('rejects an unknown commercial item alongside a known base item rather than ignoring it', () => {
      const resolver = loadResolver();
      const sub = stripeSubscription({
        items: [
          { priceId: basePriceId('core', 'USD', 'monthly') },
          { priceId: 'price_unknown_manually_added_item' },
        ],
      });

      // An unrecognized line is ambiguous by definition: it may be a tier line,
      // an add-on, or a mistake. Guessing is what today's `find()` does.
      expect(() => resolver.resolveStripeSubscriptionCommercial(sub)).toThrow();
    });
  });

  // ── STRIPE-07 ───────────────────────────────────────────────────────────
  describe('STRIPE-07: incomplete price configuration fails loudly, never silently', () => {
    it('assertStripePriceConfigComplete throws and names the missing key', () => {
      delete process.env[seatEnvKey('growth', 'EUR')];
      const resolver = loadResolver();

      expect(() => resolver.assertStripePriceConfigComplete()).toThrow(
        /STRIPE_PRICE_SEAT_ADDON_GROWTH_EUR/
      );
    });

    it('a missing seat price must not silently shrink the seat recognition set', () => {
      // Today SEAT_ADDON_PRICE_IDS is built with `.filter(Boolean)`
      // (handleSubscriptionUpsert.ts:36-45), so an unset var quietly turns a
      // real seat line into a base-item candidate. That degradation must be a
      // hard failure, not a reclassification.
      delete process.env[seatEnvKey('growth', 'GBP')];
      const resolver = loadResolver();
      const sub = stripeSubscription({
        items: [
          { priceId: basePriceId('growth', 'GBP', 'monthly') },
          { priceId: seatPriceId('growth', 'GBP'), quantity: 2 },
        ],
      });

      expect(() => resolver.resolveStripeSubscriptionCommercial(sub)).toThrow();
    });

    it('complete configuration passes the completeness assertion', () => {
      const resolver = loadResolver();
      expect(() => resolver.assertStripePriceConfigComplete()).not.toThrow();
    });
  });
});
