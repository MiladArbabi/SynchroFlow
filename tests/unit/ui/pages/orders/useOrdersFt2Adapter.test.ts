// tests/unit/ui/pages/orders/useOrdersFt2Adapter.test.ts

import { mapOrdersFt2Props } from 'ui/src/pages/orders/useOrdersFt2Adapter';

describe('FT2 Orders Adapter – mapOrdersFt2Props', () => {
  it('maps backend snapshot to FT2 props without inference', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
      ordersAnalyzed: 50,
      marginSummary: {
        avgMarginPct: 12,
        lossRatePct: 30,
        totalLossAmount: 2100,
        currency: 'USD',
      },
      lossDrivers: [
        { type: 'shipping', contributionPct: 55, confidence: 'high' },
      ],
      patterns: [],
      timeSignal: { trend: 'stable' },
    };

    const props = mapOrdersFt2Props(snapshot);

    expect(props.context.ordersAnalyzed).toBe(50);
    expect(props.marginSummary.avgMarginPct).toBe(12);
    expect(props.lossDrivers?.[0].type).toBe('shipping');
  });

  it('preserves nulls and does not coerce values', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
      ordersAnalyzed: null,
      marginSummary: {
        avgMarginPct: null,
        lossRatePct: null,
        totalLossAmount: null,
        currency: null,
      },
      lossDrivers: null,
      patterns: null,
      timeSignal: null,
    };

    const props = mapOrdersFt2Props(snapshot);

    expect(props.context.ordersAnalyzed).toBeNull();
    expect(props.marginSummary.avgMarginPct).toBeNull();
    expect(props.lossDrivers).toBeNull();
    expect(props.patterns).toBeNull();
    expect(props.timeSignal).toBeNull();
  });

  it('does not derive or enrich missing fields', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
    };

    const props = mapOrdersFt2Props(snapshot as any);

    expect(props.marginSummary).toBeDefined();
    expect(props.marginSummary.avgMarginPct).toBeNull();
  });
});