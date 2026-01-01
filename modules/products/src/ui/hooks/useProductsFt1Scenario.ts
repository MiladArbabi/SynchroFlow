// modules/products/src/ui/hooks/useProductsFt1Scenario.ts

import type { ProductsFt1Scenario } from '../types';

export function useProductsFt1Scenario(
  input: { 
    productCount: number | null;
    productHealthEvents: number | null;
    excludedProductCount: number | null;
  }
): ProductsFt1Scenario {
  const { productCount, productHealthEvents, excludedProductCount } = input;

  // 1. No products at all
  if (productCount === 0) {
    return 'NO_PRODUCTS';
  }

  // 2. Products exist but data is incomplete or untrusted
  const hasProducts = productCount !== null && productCount > 0;
  const hasHealthEvents =
    productHealthEvents !== null && productHealthEvents > 0;

  // Guard against stubbed signal: productHealthEvents === productCount
  const healthEventsTrusted =
    hasHealthEvents &&
    productCount !== null &&
    productHealthEvents !== productCount;

  if (!hasProducts || !healthEventsTrusted) {
    return 'PRODUCT_DATA_INCOMPLETE';
  }

  // 3. Partial coverage
  if ((excludedProductCount ?? 0) > 0) {
    return 'PARTIALLY_READY';
  }

  // 4. Fully healthy
  return 'HEALTHY';
}
