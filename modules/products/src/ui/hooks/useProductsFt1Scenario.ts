// modules/products/src/ui/hooks/useProductsFt1Scenario.ts

import type { ProductsFt1Scenario } from '../types';

export function useProductsFt1Scenario(
  input: { productCount: number | null }
): ProductsFt1Scenario {
  if (input.productCount === null) {
    return 'LOADING';
  }

  if (input.productCount === 0) {
    return 'NO_PRODUCTS';
  }

  return 'HEALTHY';
}
