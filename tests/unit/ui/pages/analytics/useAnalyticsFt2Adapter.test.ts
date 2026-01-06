// tests/unit/ui/pages/analytics/useAnalyticsFt2Adapter.test.ts

import { mapAnalyticsFt2Props } from 'pages/analytics/useAnalyticsFt2Adapter';

describe('FT2 Analytics Adapter - mapAnalyticsFt2Props', () => {
  it('maps a full backend snapshot without inference', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
      signalsAnalyzed: 42,

      coherenceSignal: {
        state: 'coherent',
        confidence: 'high',
      },

      volatilitySignal: {
        level: 'stable',
        variancePct: 12,
      },

      blindSpots: [
        {
          domain: 'orders',
          description: 'Missing cancellation reasons',
          confidence: 'medium',
        },
      ],

      timeSignal: {
        trend: 'stable',
        comparedPeriod: {
          from: '2024-12-01',
          to: '2024-12-31',
        },
      },
    } as const satisfies Parameters<typeof mapAnalyticsFt2Props>[0];

    const props = mapAnalyticsFt2Props(snapshot);

    expect(props.context.signalsAnalyzed).toBe(42);
    expect(props.coherenceSignal?.state).toBe('coherent');
    expect(props.volatilitySignal?.variancePct).toBe(12);
    expect(props.blindSpots?.[0].domain).toBe('orders');
    expect(props.timeSignal?.trend).toBe('stable');
  });

  it('preserves explicit nulls without coercion', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
      signalsAnalyzed: null,

      coherenceSignal: null,
      volatilitySignal: null,
      blindSpots: null,
      timeSignal: null,
    };

    const props = mapAnalyticsFt2Props(snapshot);

    expect(props.context.signalsAnalyzed).toBeNull();
    expect(props.coherenceSignal).toBeNull();
    expect(props.volatilitySignal).toBeNull();
    expect(props.blindSpots).toBeNull();
    expect(props.timeSignal).toBeNull();
  });

  it('normalizes undefined fields to null (shape-stable)', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
    };

    const props = mapAnalyticsFt2Props(snapshot);

    expect(props.context.signalsAnalyzed).toBeNull();
    expect(props.coherenceSignal).toBeNull();
    expect(props.volatilitySignal).toBeNull();
    expect(props.blindSpots).toBeNull();
    expect(props.timeSignal).toBeNull();
  });
});