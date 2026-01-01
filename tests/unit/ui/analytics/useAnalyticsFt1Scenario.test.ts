import { useAnalyticsFt1Scenario } from '@lasyncro/analytics';

describe('useAnalyticsFt1Scenario (pure logic)', () => {
  it('returns LOADING when counts are unknown', () => {
    const scenario = useAnalyticsFt1Scenario({
      orderCount: null,
      productCount: null,
      baseSignalsReady: null,
    });

    expect(scenario).toBe('LOADING');
  });

  it('returns NO_ORDERS when products exist but no orders', () => {
    const scenario = useAnalyticsFt1Scenario({
      orderCount: 0,
      productCount: 5,
      baseSignalsReady: false,
    });

    expect(scenario).toBe('NO_ORDERS');
  });

  it('returns NO_PRODUCTS when orders exist but no products', () => {
    const scenario = useAnalyticsFt1Scenario({
      orderCount: 3,
      productCount: 0,
      baseSignalsReady: false,
    });

    expect(scenario).toBe('NO_PRODUCTS');
  });

  it('returns HEALTHY when base signals are ready', () => {
    const scenario = useAnalyticsFt1Scenario({
      orderCount: 3,
      productCount: 2,
      baseSignalsReady: true,
    });

    expect(scenario).toBe('HEALTHY');
  });
});
