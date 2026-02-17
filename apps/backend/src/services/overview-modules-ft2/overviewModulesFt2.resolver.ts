// apps/backend/src/services/overview-modules-ft2/overviewModulesFt2.resolver.ts

import { getCustomersFt2Snapshot } from '../../services/customers-ft2.provider.js';
import { CustomersFT2Exposure } from '../../services/customers-ftep/customersFtep.types.js';
import { getOrderNexusFt2Snapshot } from '../../services/order-nexus-ft2/orderNexusFt2.resolver.js';
import { OrderNexusFT2Snapshot } from '../../services/order-nexus-ft2/orderNexusFt2.types.js';
import { getProductsFt2Snapshot } from '../../services/products-ft2.provider.js';
import { ProductsFT2Exposure } from '../../services/products-ftep/ProductsFtep.types.js';
import { FT2RangeInput, resolveFt2Range } from '@lasyncro/backend-core/utils/ft2Period.js';


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