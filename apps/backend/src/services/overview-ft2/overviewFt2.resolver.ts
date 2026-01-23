/**
 * getOverviewFt2Snapshot
 * ---------------------
 * Authoritative Overview FT2 snapshot resolver.
 *
 * INPUT:
 * - shopId (required)
 *
 * OUTPUT:
 * - OverviewFt2Snapshot
 *
 * NOTES:
 * - Time range is intentionally NOT accepted
 * - All inputs MUST already be FT2-downgraded
 */
export interface OverviewFt2Snapshot {
  trust: {
    dataFreshness: 'fresh' | 'stale' | 'unknown' | null;
    syncCoverage: 'complete' | 'partial' | 'missing' | 'unknown' | null;
    crossSourceConsistency: 'consistent' | 'inconsistent' | 'unknown' | null;
    trustEligible: boolean | null;
  } | null;

  context: {
    ordersObserved: number | null;
    productsObserved: number | null;
    customersObserved: number | null;
  };

  snapshot: {
    orders: {
      revenueTotal: number | null;
      currency: string | null;
    } | null;

    products: null;
    customers: null;
  };

  alignment: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
  } | null;
}

/**
 * IMPORTANT:
 * Overview FT2 is trust-gated.
 * Resolver MAY return null when epistemically blocked.
 */
export async function getOverviewFt2Snapshot(input: {
  shopId: number;
}): Promise<OverviewFt2Snapshot | null> {
  const { shopId } = input;

  // ─────────────────────────────────────────────
  // HARD DEPENDENCY — Trust FT2
  // ─────────────────────────────────────────────

  /**
   * Overview FT2 does not evaluate trust.
   * It inherits trust eligibility from Trust FT2.
   *
   * Any trustEligible !== true results in silence.
   * No partial rendering is allowed.
   */

  const { getTrustFt2Snapshot } = await import(
    'api-src/services/trust-ft2/trustFt2.resolver'
  );

  const trust = await getTrustFt2Snapshot({ shopId });

  /**
   * Trust Gate (Inherited, Absolute)
   *
   * Rules:
   * - trustEligible !== true → epistemic silence
   * - Overview must not degrade or explain
   */
  if (trust.trustEligible !== true) {
    return null;
  }

  // ─────────────────────────────────────────────
  // TERMINAL FT2 COMPOSITION (MINIMAL)
  // ─────────────────────────────────────────────

  const { getOrderNexusFt2Snapshot } = await import(
    'api-src/services/order-nexus-ft2/orderNexusFt2.resolver'
  );

  const { getProductsFt2Snapshot } = await import(
    'api-src/services/products-ft2.provider'
  );

  const { getCustomersFt2Snapshot } = await import(
    'api-src/services/customers-ft2.provider'
  );

  const { getFt2Period } = await import(
    'api-src/utils/ft2Period'
  );

  const period = getFt2Period();

  const ordersFt2 = await getOrderNexusFt2Snapshot({
  shopId,
    range: {
      preset: 'custom',
      from: period.from,
      to: period.to,
    },
  });

  const productsFt2 = await getProductsFt2Snapshot({
    shopId,
    period,
  });

  const customersFt2 = await getCustomersFt2Snapshot({
    shopId,
    period,
  });


  return {
    trust: {
      dataFreshness: trust.dataFreshness,
      syncCoverage: null,
      crossSourceConsistency: null,
      trustEligible: trust.trustEligible,
    },

    context: {
      ordersObserved:
        ordersFt2?.context.ordersObserved ?? null,

      productsObserved:
        productsFt2?.context.productsObserved ?? null,

      customersObserved:
        customersFt2?.context.customersPresent === true
          ? 1
          : customersFt2?.context.customersPresent === false
            ? 0
            : null,
    },

    snapshot: {
      orders: ordersFt2?.totals
        ? {
            revenueTotal:
              ordersFt2.totals.revenueTotal ?? null,
            currency:
              ordersFt2.totals.currency ?? null,
          }
        : null,

      products: null,
      customers: null,
    },

    alignment: null,
  };
}