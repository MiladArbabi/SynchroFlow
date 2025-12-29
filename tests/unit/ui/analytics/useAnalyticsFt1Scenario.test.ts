//tests/unit/ui/analytics/useAnalyticsFt1Scenario.test.ts

import { useAnalyticsFt1Scenario } from '@lasyncro/analytics';

describe('useAnalyticsFt1Scenario', () => {
  it('returns LOADING when any input is null', () => {
    expect(
      useAnalyticsFt1Scenario({
        orderCount: null,
        productCount: 1,
        baseSignalsReady: true,
      })
    ).toBe('LOADING');
  });

  it('returns NO_BASE_DATA when orderCount is 0', () => {
    expect(
      useAnalyticsFt1Scenario({
        orderCount: 0,
        productCount: 5,
        baseSignalsReady: true,
      })
    ).toBe('NO_BASE_DATA');
  });

  it('returns NO_BASE_DATA when productCount is 0', () => {
    expect(
      useAnalyticsFt1Scenario({
        orderCount: 3,
        productCount: 0,
        baseSignalsReady: true,
      })
    ).toBe('NO_BASE_DATA');
  });

  it('returns PARTIAL_DATA when baseSignalsReady is false', () => {
    expect(
      useAnalyticsFt1Scenario({
        orderCount: 3,
        productCount: 5,
        baseSignalsReady: false,
      })
    ).toBe('PARTIAL_DATA');
  });

  it('returns HEALTHY when all base signals are ready', () => {
    expect(
      useAnalyticsFt1Scenario({
        orderCount: 3,
        productCount: 5,
        baseSignalsReady: true,
      })
    ).toBe('HEALTHY');
  });
});
