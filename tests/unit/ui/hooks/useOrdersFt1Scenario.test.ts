import { useOrdersFt1Scenario } from '@lasyncro/order-nexus';

describe('useOrdersFt1Scenario', () => {
  it('returns NO_ORDERS when ordersIngested is 0', () => {
    const scenario = useOrdersFt1Scenario({
      ordersIngested: 0,
      hasNegativeMarginOrder: false,
      missingCostCount: 0,
    });

    expect(scenario).toBe('NO_ORDERS');
  });

  it('returns LOSS when there is at least one negative margin order', () => {
    const scenario = useOrdersFt1Scenario({
      ordersIngested: 10,
      hasNegativeMarginOrder: true,
      missingCostCount: 0,
    });

    expect(scenario).toBe('LOSS');
  });

  it('returns UNCERTAIN when there are missing costs and no losses', () => {
    const scenario = useOrdersFt1Scenario({
      ordersIngested: 10,
      hasNegativeMarginOrder: false,
      missingCostCount: 3,
    });

    expect(scenario).toBe('UNCERTAIN');
  });

  it('returns HEALTHY when orders exist, no losses, and no missing costs', () => {
    const scenario = useOrdersFt1Scenario({
      ordersIngested: 10,
      hasNegativeMarginOrder: false,
      missingCostCount: 0,
    });

    expect(scenario).toBe('HEALTHY');
  });
});
