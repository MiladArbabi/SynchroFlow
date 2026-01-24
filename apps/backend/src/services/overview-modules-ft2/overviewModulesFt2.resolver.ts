// apps/backend/src/services/overview-modules-ft2/overviewModulesFt2.resolver.ts

import { OrderNexusFT2Snapshot } from '../order-nexus-ft2/orderNexusFt2.types';
import { ProductsFT2Exposure } from '../products-ftep';
import { CustomersFT2Exposure } from '../customers-ftep';

export interface OverviewModulesFt2Snapshot {
  orders: OrderNexusFT2Snapshot | null;
  products: ProductsFT2Exposure | null;
  customers: CustomersFT2Exposure | null;
}

/**
 * OverviewModules FT2
 * ------------------
 * Independent FT2 module visibility surface.
 *
 * RULES:
 * - No trust gating
 * - No completion gating
 * - No aggregation
 * - No interpretation
 *
 * Each module is evaluated independently.
 */
export async function getOverviewModulesFt2Snapshot(input: {
  shopId: number;
}): Promise<OverviewModulesFt2Snapshot> {
  const { shopId } = input;

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

  return {
    orders: await getOrderNexusFt2Snapshot({
      shopId,
      range: {
        preset: 'custom',
        from: period.from,
        to: period.to,
      },
    }),

    products: await getProductsFt2Snapshot({
      shopId,
      period,
    }),

    customers: await getCustomersFt2Snapshot({
      shopId,
      period,
    }),
  };
}