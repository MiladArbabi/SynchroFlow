/**
 * FT2 Analytics Adapter — Contract Enforcement Tests
 * ==================================================
 *
 * Purpose:
 * --------
 * These tests enforce the downgraded FT2 observability contract
 * for Analytics / InsightCore.
 *
 * FT2 RULES (NON-NEGOTIABLE):
 * - No intelligence
 * - No explanations
 * - No derived meaning
 * - No inference
 * - Undefined → null only
 * - Shape-stable output
 *
 * If any of these tests fail in the future,
 * it means FT2 intelligence has leaked back in.
 */

import { mapAnalyticsFt2Props } from 'pages/analytics/useAnalyticsFt2Adapter';

describe('FT2 Analytics Adapter — observability-only mapping', () => {
  it('maps a full backend snapshot using observability semantics only', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },

      signalsObserved: 42,

      systemStatus: {
        state: 'healthy',
        reliability: 'high',
      },

      stabilityIndicator: {
        state: 'stable',
      },

      dataCoverage: [
        {
          domain: 'orders',
          status: 'partial',
        },
        {
          domain: 'products',
          status: 'complete',
        },
      ],

      trendSignal: {
        direction: 'flat',
        comparedPeriod: {
          from: '2024-12-01',
          to: '2024-12-31',
        },
      },
    } as const satisfies Parameters<typeof mapAnalyticsFt2Props>[0];

    const props = mapAnalyticsFt2Props(snapshot);

    // Context
    expect(props.context.signalsObserved).toBe(42);

    // Status
    expect(props.systemStatus?.state).toBe('healthy');
    expect(props.systemStatus?.reliability).toBe('high');

    // Stability
    expect(props.stabilityIndicator?.state).toBe('stable');

    // Coverage
    expect(props.dataCoverage?.[0].domain).toBe('orders');
    expect(props.dataCoverage?.[0].status).toBe('partial');

    // Trend
    expect(props.trendSignal?.direction).toBe('flat');
  });

  it('preserves explicit nulls without coercion or inference', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },

      signalsObserved: null,
      systemStatus: null,
      stabilityIndicator: null,
      dataCoverage: null,
      trendSignal: null,
    };

    const props = mapAnalyticsFt2Props(snapshot);

    expect(props.context.signalsObserved).toBeNull();
    expect(props.systemStatus).toBeNull();
    expect(props.stabilityIndicator).toBeNull();
    expect(props.dataCoverage).toBeNull();
    expect(props.trendSignal).toBeNull();
  });

  it('normalizes undefined fields to null (shape-stable output)', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
    };

    const props = mapAnalyticsFt2Props(snapshot);

    expect(props.context.signalsObserved).toBeNull();
    expect(props.systemStatus).toBeNull();
    expect(props.stabilityIndicator).toBeNull();
    expect(props.dataCoverage).toBeNull();
    expect(props.trendSignal).toBeNull();
  });
});