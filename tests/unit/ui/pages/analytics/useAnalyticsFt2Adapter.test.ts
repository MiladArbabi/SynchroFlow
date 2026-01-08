/**
 * FT2 Analytics Adapter — Canonical Contract Tests (RED)
 * =====================================================
 *
 * This test enforces strict FT2 parity with:
 * - OrdersModuleFT2
 * - ProductsModuleFT2
 *
 * Analytics FT2 MUST expose:
 * - context
 * - outcome | null
 * - trend | null
 *
 * NOTHING ELSE.
 */

import { mapAnalyticsFt2Props } from 'pages/analytics/useAnalyticsFt2Adapter';

describe('Analytics FT2 Adapter — canonical FT2 contract', () => {
  it('exposes ONLY canonical FT2 fields', () => {
    const snapshot: any = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        eventsObserved: 10,
      },
      outcome: { status: 'unknown' },
      trend: { direction: 'unknown' },

      // Illegal FT2 fields (must be dropped)
      systemStatus: { state: 'healthy' },
      stabilityIndicator: { state: 'stable' },
      dataCoverage: [],
      trendSignal: { direction: 'up' },
    };

    const props = mapAnalyticsFt2Props(snapshot);

    expect(props).toEqual({
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
      },
      outcome: { status: 'unknown' },
      trend: { direction: 'unknown' },
    });

    expect((props as any).systemStatus).toBeUndefined();
    expect((props as any).stabilityIndicator).toBeUndefined();
    expect((props as any).dataCoverage).toBeUndefined();
    expect((props as any).trendSignal).toBeUndefined();
  });

  it('normalizes undefined to null and preserves nulls', () => {
    const snapshot: any = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        revenueObserved: 10,
      },
      outcome: undefined,
      trend: null,
    };

    const props = mapAnalyticsFt2Props(snapshot);

    expect(props.outcome).toBeNull();
    expect(props.trend).toBeNull();
  });

  it('does NOT default or fabricate period', () => {
    const snapshot: any = {};

    const props = mapAnalyticsFt2Props(snapshot);

    expect(props.context.period.from).toBe('');
    expect(props.context.period.to).toBe('');
  });
});