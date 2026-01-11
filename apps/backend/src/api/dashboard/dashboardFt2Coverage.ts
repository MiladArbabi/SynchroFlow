import type { OrderNexusFT2Exposure } from 'api-src/services/order-ftep/orderFtep.types.ts';
import type { ProductsFT2Exposure } from 'api-src/services/products-ftep/ProductsFtep.types.ts';

export type DashboardFt2Coverage = {
  ordersObserved: number | null;
  productsObserved: number | null;
  sessionsObserved: number | null;
};

/**
 * buildDashboardFt2Coverage
 * ------------------------
 * System-level FT2 coverage aggregation.
 *
 * Consumes ONLY Layer-3 FT2 exposures (FTEP outputs).
 *
 * HARD RULES:
 * - No inference
 * - No recomputation
 * - Undefined → null only
 */
export function buildDashboardFt2Coverage(params: {
  orders?: OrderNexusFT2Exposure | null;
  products?: ProductsFT2Exposure | null;
}): DashboardFt2Coverage {
  return {
    ordersObserved:
      params.orders?.context?.ordersObserved === undefined
        ? null
        : params.orders.context.ordersObserved,

    productsObserved:
      params.products?.context?.productsObserved === undefined
        ? null
        : params.products.context.productsObserved,

    sessionsObserved: null,
  };
}
