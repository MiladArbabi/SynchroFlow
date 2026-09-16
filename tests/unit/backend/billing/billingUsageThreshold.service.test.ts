import { selectHighestBillingUsageThresholdCrossed } from '../../../../apps/backend/src/services/billing/billingUsageThreshold.service';

describe('billing usage threshold selection', () => {
  it.each([
    ['below 60 has no notification relevance', 10, 59, 100, null],
    ['74 -> 75 => 75', 74, 75, 100, 75],
    ['74 -> 89 => 75', 74, 89, 100, 75],
    ['70 -> 90 => 90', 70, 90, 100, 90],
    ['70 -> 99 => 90', 70, 99, 100, 90],
    ['70 -> 100 => 100', 70, 100, 100, 100],
    ['70 -> 105 => 100', 70, 105, 100, 100],
    ['92 -> 100 => 100', 92, 100, 100, 100],
    ['100 -> 105 => none', 100, 105, 100, null],
    ['same-value/idempotent evaluation => none', 75, 75, 100, null],
    ['Starter/no allowance does not emit paid-usage thresholds', 0, 1, 0, null],
  ])('%s', (_name, previousProcessed, projectedProcessed, includedAllowance, expected) => {
    expect(selectHighestBillingUsageThresholdCrossed({
      previousProcessed,
      projectedProcessed,
      includedAllowance,
    })).toBe(expected);
  });
});
