import type { OverviewModuleFT2DataProps } from '@lasyncro/overview';
import type { OverviewModulesFt2Snapshot } from './useOverviewModulesFt2Snapshot';
import type { TrustFt2Snapshot } from '../trust/useTrustFt2Snapshot';

export function mapOverviewFt2Props(
  snapshot: OverviewModulesFt2Snapshot,
  trust: TrustFt2Snapshot | null
): OverviewModuleFT2DataProps {

  return {
    /**
     * Trust FT2 passthrough
     * --------------------
     * Adapter must not derive UI signals.
     * Pass raw Trust FT2 data unchanged.
     */
    trust: trust
      ? {
          /**
           * Trust FT2 normalization for Overview UI contract
           * -----------------------------------------------
           * Structural completion only.
           * No inference. No scoring. No explanation.
           */
          trustEligible: trust.trustEligible ?? null,

          dataFreshness: 'unknown',
          syncCoverage: 'unknown',
          crossSourceConsistency: 'unknown',
        }
      : null,

    context: {
      ordersObserved:
        snapshot.orders?.context?.ordersObserved === undefined
          ? null
          : snapshot.orders.context.ordersObserved,

      productsObserved:
        snapshot.products?.context?.productsObserved === undefined
          ? null
          : snapshot.products.context.productsObserved,

      customersObserved:
        snapshot.customers?.context?.customersPresent === undefined
          ? null
          : snapshot.customers.context.customersPresent === true
            ? 1
            : snapshot.customers.context.customersPresent === false
              ? 0
              : null,
    },

    snapshot: {
      orders:
        snapshot.orders?.totals === undefined
          ? null
          : {
              revenueTotal:
                snapshot.orders.totals.revenueTotal ?? null,
              /**
               * FT2 totals are magnitude-only.
               * Currency is intentionally unavailable.
               */
              currency: null,
            },

      products: null,
      customers: null,
    },

    pulse:
      snapshot.pulse == null
        ? null
        : {
            revenueToday: snapshot.pulse.revenueToday ?? null,
            revenueDeltaVsYesterday:
              snapshot.pulse.revenueDeltaVsYesterday ?? null,
            collectedRevenue: snapshot.pulse.collectedRevenue ?? null,
            atRiskRevenue: snapshot.pulse.atRiskRevenue ?? null,
            blockedRevenue: snapshot.pulse.blockedRevenue ?? null,
            topBlockingType: snapshot.pulse.topBlockingType ?? null,
          },
    alignment: null,
  };
}
