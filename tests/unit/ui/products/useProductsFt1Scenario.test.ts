// tests/unit/ui/products/useProductsFt1Scenario.test.ts

import { useProductsFt1Scenario } from '@lasyncro/products';
import type { ProductsFt1Scenario } from '@lasyncro/products';

// Helper to make intent explicit
function run(input: {
  productCount: number | null;
  productHealthEvents: number | null;
  excludedProductCount: number | null;
}): ProductsFt1Scenario {
  return useProductsFt1Scenario(input as any);
}

describe('useProductsFt1Scenario (FT1 truth surface)', () => {
  test('returns PRODUCT_DATA_INCOMPLETE when all signals are null', () => {
    expect(
      run({
        productCount: null,
        productHealthEvents: null,
        excludedProductCount: null,
      })
    ).toBe('PRODUCT_DATA_INCOMPLETE');
  });

  test('returns NO_PRODUCTS when productCount is 0', () => {
    expect(
      run({
        productCount: 0,
        productHealthEvents: null,
        excludedProductCount: null,
      })
    ).toBe('NO_PRODUCTS');
  });

  test('returns PRODUCT_DATA_INCOMPLETE when products exist but no health events', () => {
    expect(
      run({
        productCount: 5,
        productHealthEvents: 0,
        excludedProductCount: null,
      })
    ).toBe('PRODUCT_DATA_INCOMPLETE');
  });

  test('treats productHealthEvents === productCount as untrusted (stub)', () => {
    expect(
      run({
        productCount: 5,
        productHealthEvents: 5,
        excludedProductCount: 0,
      })
    ).toBe('PRODUCT_DATA_INCOMPLETE');
  });

  test('returns PARTIALLY_READY when some products are excluded', () => {
    expect(
      run({
        productCount: 10,
        productHealthEvents: 4,
        excludedProductCount: 6,
      })
    ).toBe('PARTIALLY_READY');
  });

  test('returns HEALTHY only when coverage is complete and trusted', () => {
    expect(
      run({
        productCount: 4,
        productHealthEvents: 2,
        excludedProductCount: 0,
      })
    ).toBe('HEALTHY');
  });
});
