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

  describe('FT1 Orders Scenario Resolution', () => {
    it('LOADING when ordersIngested is null', () => {
      expect(
        useOrdersFt1Scenario({
          ordersIngested: null,
          missingCostCount: 0,
          hasNegativeMarginOrder: false,
        })
      ).toBe('LOADING');
    });

    it('NO_ORDERS when ordersIngested is 0', () => {
      expect(
        useOrdersFt1Scenario({
          ordersIngested: 0,
          missingCostCount: 0,
          hasNegativeMarginOrder: false,
        })
      ).toBe('NO_ORDERS');
    });

    it('HEALTHY when orders exist and no issues', () => {
      expect(
        useOrdersFt1Scenario({
          ordersIngested: 7,
          missingCostCount: 0,
          hasNegativeMarginOrder: false,
        })
      ).toBe('HEALTHY');
    });

    it('UNCERTAIN when missing costs exist', () => {
      expect(
        useOrdersFt1Scenario({
          ordersIngested: 7,
          missingCostCount: 2,
          hasNegativeMarginOrder: false,
        })
      ).toBe('UNCERTAIN');
    });

    it('LOSS when negative margin detected', () => {
      expect(
        useOrdersFt1Scenario({
          ordersIngested: 7,
          missingCostCount: 0,
          hasNegativeMarginOrder: true,
        })
      ).toBe('LOSS');
    });
  });
});
