import { getFt2Period } from '@lasyncro/backend-core/utils/ft2Period.js';
import { getCustomersFt2Snapshot } from '../../services/customers-ft2.provider.js';
import { getOrderNexusFt2StateSnapshot } from '../../services/order-nexus-ft2/orderNexusFt2.state.resolver.js';
import { getProductsFt2Snapshot } from '../../services/products-ft2.provider.js';
import { getTrustFt2Snapshot } from '../../services/trust-ft2/trustFt2.resolver.js';

export interface OverviewFt2Snapshot {
  trust: {
    dataFreshness: 'fresh' | 'stale' | 'unknown' | null;
    syncCoverage: 'complete' | 'partial' | 'missing' | 'unknown' | null;
    crossSourceConsistency: 'consistent' | 'inconsistent' | 'unknown' | null;
    trustEligible: boolean | null;
  } | null;

  /**
   * Context is presence-only and non-derivative.
   * Overview MUST NOT fabricate or reinterpret counts.
   */
  context: {
    ordersObserved: number | null;
    productsObserved: number | null;
    customersObserved: number | null;
  };

  /**
   * Snapshot holds opaque FT2 module outputs.
   * Overview does NOT inspect or reshape these.
   */
  snapshot: {
    orders: unknown | null;
    products: unknown | null;
    customers: unknown | null;
  };

  /**
   * Cross-domain alignment (optional, read-only).
   */
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
  const period = getFt2Period();

  const ordersFt2 = await getOrderNexusFt2StateSnapshot(shopId);

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
      ordersObserved: null,
      productsObserved: productsFt2?.context.productsObserved ?? null,
      customersObserved: null,
    },

    snapshot: {
      orders: ordersFt2 ?? null,
      products: productsFt2 ?? null,
      customers: customersFt2 ?? null,
    },

    alignment: null,
  };
}