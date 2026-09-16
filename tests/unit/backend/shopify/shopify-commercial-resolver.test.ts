// tests/unit/backend/shopify/shopify-commercial-resolver.test.ts
//
// BILL-ENTITLEMENT-01 / P0-B3 — Shopify Managed Pricing mapping integrity.
// PERMANENT regression contract, authored RED.
// ===========================================================================
// WHAT THIS PROTECTS
//   Today shopifyBillingReconciliation.service.ts:156 keys tier on
//   PLAN_NAME_TO_TIER[normalizePlanName(sub.name)] — the merchant-facing
//   DISPLAY STRING. Renaming a plan in the Partner Dashboard breaks tier
//   resolution for every merchant on it; a plan named to match a key grants
//   that tier at any price.
//
//   The authoritative key must be the immutable plan handle:
//     AppSubscription -> lineItems[] -> plan.pricingDetails
//       -> AppRecurringPricing.planHandle
//   planHandle exists from Shopify Admin API 2025-04 onward; production runs
//   2025-07, so it is available.
//
// FROZEN BOUNDARY
//   module : apps/backend/src/services/shopify/shopifyCommercialResolver.service.ts
//   exports:
//     resolveShopifyPlanHandle(planHandle)            -> Tier | throws
//     resolveShopifySubscriptionCommercial(appSub)    -> ShopifyCommercial | throws
//
//   ShopifyCommercial
//     { tier, status, isEntitled, currentPeriodEnd, planHandle,
//       displayName, price, interval }
//
//   `price` and `interval` are carried through from AppRecurringPricing for
//   commercial cross-check. This suite asserts they are AVAILABLE and passed
//   through faithfully. It deliberately does NOT assert expected amounts:
//   no source config declares per-plan Shopify amounts today, and inventing
//   them would freeze a number nothing owns.
//
// RED EXPECTATION
//   The resolver module does not exist.
//
// DB-free. No network. No provider call.

const RESOLVER_MODULE = 'api-src/services/shopify/shopifyCommercialResolver.service';

interface Resolver {
  resolveShopifyPlanHandle: (planHandle: string) => any;
  resolveShopifySubscriptionCommercial: (appSub: any) => any;
}

function loadResolver(): Resolver {
  let mod: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('api-src/services/shopify/shopifyCommercialResolver.service');
  } catch (err) {
    throw new Error(
      `[BILL-ENTITLEMENT-01/P0-B3] canonical Shopify commercial resolver is absent: ` +
        `${RESOLVER_MODULE} (expected exports resolveShopifyPlanHandle, ` +
        `resolveShopifySubscriptionCommercial). ` +
        `Underlying resolution error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  for (const name of ['resolveShopifyPlanHandle', 'resolveShopifySubscriptionCommercial']) {
    if (typeof mod[name] !== 'function') {
      throw new Error(`[BILL-ENTITLEMENT-01/P0-B3] ${RESOLVER_MODULE} does not export ${name}`);
    }
  }
  return mod as unknown as Resolver;
}

/**
 * AppSubscription shaped as the Admin GraphQL API returns it, including the
 * lineItems -> plan -> pricingDetails path the current query does not request.
 */
function appSubscription(opts: {
  planHandle?: string | null;
  name?: string;
  status?: string;
  currentPeriodEnd?: string | null;
  amount?: string;
  currencyCode?: string;
  interval?: string;
}) {
  return {
    id: 'gid://shopify/AppSubscription/1',
    name: opts.name ?? 'Growth',
    status: opts.status ?? 'ACTIVE',
    currentPeriodEnd: opts.currentPeriodEnd === undefined ? '2099-01-01T00:00:00Z' : opts.currentPeriodEnd,
    lineItems: [
      {
        id: 'gid://shopify/AppSubscriptionLineItem/1',
        plan: {
          pricingDetails: {
            __typename: 'AppRecurringPricing',
            ...(opts.planHandle === null ? {} : { planHandle: opts.planHandle ?? 'growth' }),
            price: {
              amount: opts.amount ?? '99.00',
              currencyCode: opts.currencyCode ?? 'USD',
            },
            interval: opts.interval ?? 'EVERY_30_DAYS',
          },
        },
      },
    ],
  };
}

describe('P0-B3 — Shopify commercial resolver', () => {
  // ── SHOPIFY-01 ──────────────────────────────────────────────────────────
  describe('SHOPIFY-01: planHandle is the authoritative tier key', () => {
    it.each([
      ['starter', 'starter'],
      ['core', 'core'],
      ['growth', 'growth'],
      ['scale', 'scale'],
    ])('planHandle %s resolves to tier %s', (handle, expectedTier) => {
      const resolver = loadResolver();
      expect(resolver.resolveShopifyPlanHandle(handle)).toBe(expectedTier);
    });

    it('derives tier from the line item plan handle, not from the subscription name', () => {
      const resolver = loadResolver();
      const commercial = resolver.resolveShopifySubscriptionCommercial(
        appSubscription({ planHandle: 'scale', name: 'Growth' })
      );

      expect(commercial.tier).toBe('scale');
      expect(commercial.planHandle).toBe('scale');
      // Name is retained for display/diagnostics only.
      expect(commercial.displayName).toBe('Growth');
    });
  });

  // ── SHOPIFY-02 ──────────────────────────────────────────────────────────
  describe('SHOPIFY-02: a valid handle survives display-name drift', () => {
    it.each([
      'Growth',
      'Growth Plan',
      'laSyncro Growth (Monthly)',
      'Growth — renamed 2026',
      '',
    ])('resolves to growth when the display name is %p', (displayName) => {
      const resolver = loadResolver();
      const commercial = resolver.resolveShopifySubscriptionCommercial(
        appSubscription({ planHandle: 'growth', name: displayName })
      );
      expect(commercial.tier).toBe('growth');
    });
  });

  // ── SHOPIFY-03 ──────────────────────────────────────────────────────────
  describe('SHOPIFY-03: an unknown or missing handle rejects', () => {
    it('rejects an unmapped plan handle', () => {
      const resolver = loadResolver();
      expect(() => resolver.resolveShopifyPlanHandle('enterprise-2027')).toThrow();
    });

    // GH-1128: `early-access` was a pre-launch Shopify public plan, since
    // deleted from the Partner Dashboard. It has no customer-migration
    // purpose (LaSyncro has not launched) and must fail closed like any
    // other retired/unrecognized commercial handle — not silently resolve
    // to starter.
    it('rejects the retired early-access handle (GH-1128)', () => {
      const resolver = loadResolver();
      expect(() => resolver.resolveShopifyPlanHandle('early-access')).toThrow();
    });

    it('rejects a subscription whose handle is unmapped, even when the name looks valid', () => {
      const resolver = loadResolver();
      expect(() =>
        resolver.resolveShopifySubscriptionCommercial(
          appSubscription({ planHandle: 'enterprise-2027', name: 'Growth' })
        )
      ).toThrow();
    });

    it('rejects a subscription with no plan handle at all rather than falling back to the name', () => {
      const resolver = loadResolver();
      expect(() =>
        resolver.resolveShopifySubscriptionCommercial(
          appSubscription({ planHandle: null, name: 'Growth' })
        )
      ).toThrow();
    });
  });

  // ── SHOPIFY-04 ──────────────────────────────────────────────────────────
  describe('SHOPIFY-04: recurring price and interval are available for cross-check', () => {
    it('carries AppRecurringPricing price, currency and interval through unchanged', () => {
      const resolver = loadResolver();
      const commercial = resolver.resolveShopifySubscriptionCommercial(
        appSubscription({
          planHandle: 'core',
          amount: '49.00',
          currencyCode: 'GBP',
          interval: 'ANNUAL',
        })
      );

      expect(commercial.tier).toBe('core');
      // Passed through faithfully. No expected amount is asserted — no source
      // config declares per-plan Shopify amounts yet.
      expect(commercial.price).toMatchObject({ amount: '49.00', currencyCode: 'GBP' });
      expect(commercial.interval).toBe('ANNUAL');
    });
  });

  // ── SHOPIFY-05 ──────────────────────────────────────────────────────────
  describe('SHOPIFY-05: existing status and grace semantics remain protected', () => {
    it.each([
      ['ACTIVE', 'active', true],
      ['PENDING', 'unpaid', false],
      ['DECLINED', 'canceled', false],
      ['EXPIRED', 'canceled', false],
    ])('status %s maps to %s with isEntitled=%s', (shopifyStatus, dbStatus, isEntitled) => {
      const resolver = loadResolver();
      const commercial = resolver.resolveShopifySubscriptionCommercial(
        appSubscription({ planHandle: 'growth', status: shopifyStatus })
      );

      expect(commercial.status).toBe(dbStatus);
      expect(commercial.isEntitled).toBe(isEntitled);
    });

    it.each(['CANCELLED', 'FROZEN'])(
      '%s inside an unexpired paid period keeps the paid tier (SHB-08 grace)',
      (shopifyStatus) => {
        const resolver = loadResolver();
        const commercial = resolver.resolveShopifySubscriptionCommercial(
          appSubscription({
            planHandle: 'growth',
            status: shopifyStatus,
            currentPeriodEnd: '2099-01-01T00:00:00Z',
          })
        );

        expect(commercial.isEntitled).toBe(true);
        expect(commercial.tier).toBe('growth');
      }
    );

    it.each(['CANCELLED', 'FROZEN'])(
      '%s after the paid period has lapsed forces starter (SHB-13)',
      (shopifyStatus) => {
        const resolver = loadResolver();
        const commercial = resolver.resolveShopifySubscriptionCommercial(
          appSubscription({
            planHandle: 'growth',
            status: shopifyStatus,
            currentPeriodEnd: '2020-01-01T00:00:00Z',
          })
        );

        expect(commercial.isEntitled).toBe(false);
        expect(commercial.tier).toBe('starter');
      }
    );
  });
});
