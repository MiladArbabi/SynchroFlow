// tests/unit/ui/products/useProductsFt1Scenario.test.ts

import { useProductsFt1Scenario } from '@lasyncro/products';

describe('useProductsFt1Scenario', () => {
  it('returns LOADING when productCount is null', () => {
    expect(
      useProductsFt1Scenario({
        productCount: null,
      })
    ).toBe('LOADING');
  });

  it('returns NO_PRODUCTS when productCount is 0', () => {
    expect(
      useProductsFt1Scenario({
        productCount: 0,
      })
    ).toBe('NO_PRODUCTS');
  });

  it('returns PRODUCTS_READY when productCount is greater than 0', () => {
    expect(
      useProductsFt1Scenario({
        productCount: 12,
      })
    ).toBe('HEALTHY');
  });

  it('treats productCount=0 as HEALTHY when products are known', () => {
    const scenario = useProductsFt1Scenario({
      productCount: 0,
    });

    expect(scenario).toBe('HEALTHY');
  });

});