export type DashboardFt2SystemHealth = {
  ordersOutcome: 'positive' | 'negative' | 'unknown' | null;
  productsOutcome: 'positive' | 'negative' | 'unknown' | null;
};

import type { OrderNexusFT2Exposure } from 'api-src/services/order-ftep/orderFtep.types.ts';
import type { ProductsFT2Exposure } from 'api-src/services/products-ftep/ProductsFtep.types.ts';

export function buildDashboardFt2SystemHealth(params: {
  orders?: OrderNexusFT2Exposure | null;
  products?: ProductsFT2Exposure | null;
}) {
  return {
    ordersOutcome:
      params.orders?.outcome?.status === undefined
        ? null
        : params.orders.outcome.status,

    productsOutcome:
      params.products?.outcome?.status === undefined
        ? null
        : params.products.outcome.status,
  };
}