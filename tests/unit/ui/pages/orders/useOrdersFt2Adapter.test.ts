// tests/unit/ui/pages/orders/useOrdersFt2Adapter.test.ts

import { mapOrdersFt2Props } from 'pages/orders/useOrdersFt2Adapter';

describe('FT2 Orders Adapter - mapOrdersFt2Props', () => {
  it('maps a full backend snapshot without inference', () => {
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
        {
          type: 'shipping',
          contributionPct: 55,
          confidence: 'high',
        },
      ],
      patterns: [
        {
          description: 'International expedited shipping',
          affectedOrdersPct: 40,
          estimatedImpact: 1200,
          currency: 'USD',
        },
      ],
      timeSignal: {
        trend: 'stable',
      },
    } as const satisfies Parameters<typeof mapOrdersFt2Props>[0];

    const props = mapOrdersFt2Props(snapshot);

    expect(props.context.ordersAnalyzed).toBe(50);
    expect(props.marginSummary.avgMarginPct).toBe(12);
    expect(props.lossDrivers?.[0].type).toBe('shipping');
    expect(props.lossDrivers?.[0].confidence).toBe('high');
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

  it('normalizes undefined fields to null (shape-stable)', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
    };

    const props = mapOrdersFt2Props(snapshot);

    expect(props.context.ordersAnalyzed).toBeNull();
    expect(props.marginSummary.avgMarginPct).toBeNull();
    expect(props.lossDrivers).toBeNull();
  });
});