import type { OverviewModuleFT2DataProps } from '@lasyncro/overview';
import type { OverviewModulesFt2Snapshot } from './useOverviewModulesFt2Snapshot';

export function mapOverviewFt2Props(
  snapshot: OverviewModulesFt2Snapshot
): OverviewModuleFT2DataProps {
  return {
    trust: null,

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
              currency:
                snapshot.orders.totals.currency ?? null,
            },

      products: null,
      customers: null,
    },

    alignment: null,
  };
}
