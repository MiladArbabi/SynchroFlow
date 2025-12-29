//tests/unit/ui/hooks/useFinancesFt1Scenario.test.ts
import { useFinancesFt1Scenario } from '@lasyncro/finances';

describe('useFinancesFt1Scenario', () => {
  it('returns LOADING when any input is null', () => {
    expect(
      useFinancesFt1Scenario({
        orderCount: null,
        productCount: 10,
        baseSignalsReady: true,
      })
    ).toBe('LOADING');

    expect(
      useFinancesFt1Scenario({
        orderCount: 10,
        productCount: null,
        baseSignalsReady: true,
      })
    ).toBe('LOADING');

    expect(
      useFinancesFt1Scenario({
        orderCount: 10,
        productCount: 10,
        baseSignalsReady: null,
      })
    ).toBe('LOADING');
  });

  it('returns NO_BASE_DATA when orderCount or productCount is 0', () => {
    expect(
      useFinancesFt1Scenario({
        orderCount: 0,
        productCount: 10,
        baseSignalsReady: true,
      })
    ).toBe('NO_BASE_DATA');

    expect(
      useFinancesFt1Scenario({
        orderCount: 10,
        productCount: 0,
        baseSignalsReady: true,
      })
    ).toBe('NO_BASE_DATA');
  });

  it('returns PARTIAL_DATA when baseSignalsReady is false', () => {
    expect(
      useFinancesFt1Scenario({
        orderCount: 10,
        productCount: 10,
        baseSignalsReady: false,
      })
    ).toBe('PARTIAL_DATA');
  });

  it('returns HEALTHY when all signals are present and baseSignalsReady is true', () => {
    expect(
      useFinancesFt1Scenario({
        orderCount: 10,
        productCount: 10,
        baseSignalsReady: true,
      })
    ).toBe('HEALTHY');
  });
});
