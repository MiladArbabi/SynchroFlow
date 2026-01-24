// apps/backend/src/services/overview-modules-ft2/overviewModulesFt2.resolver.ts

import { OrderNexusFT2Snapshot } from '../order-nexus-ft2/orderNexusFt2.types';
import { ProductsFT2Exposure } from '../products-ftep';
import { CustomersFT2Exposure } from '../customers-ftep';

import {
  FT2DateRangePreset,
  FT2RangeInput,
  resolveFt2Range,
} from 'api-src/utils/ft2Period';

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
  range: FT2RangeInput;
}): Promise<OverviewModulesFt2Snapshot> {

  const { shopId, range } = input;

  const period = resolveFt2Range(input.range);

  const { getOrderNexusFt2Snapshot } = await import(
    'api-src/services/order-nexus-ft2/orderNexusFt2.resolver'
  );

  const { getProductsFt2Snapshot } = await import(
    'api-src/services/products-ft2.provider'
  );

  const { getCustomersFt2Snapshot } = await import(
    'api-src/services/customers-ft2.provider'
  );

  return {
    orders: await getOrderNexusFt2Snapshot({
      shopId,
      range: input.range, // presets allowed
    }),

    products: await getProductsFt2Snapshot({
      shopId,
      period, // always { from; to }
    }),

    customers: await getCustomersFt2Snapshot({
      shopId,
      period, // always { from; to }
    }),
  };
}