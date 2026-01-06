// tests/unit/ui/pages/orders/useOrdersFt2Adapter.test.ts

import { mapOrdersFt2Props } from 'pages/orders/useOrdersFt2Adapter';

describe('FT2 Orders Adapter — observability only', () => {
  it('maps a full backend snapshot without inference or derivation', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },

      ordersObserved: 75,

      totals: {
        revenueTotal: 12500,
        costTotal: 9800,
        currency: 'USD',
      },

      outcome: {
        status: 'positive',
      },

      trend: {
        direction: 'up',
      },

      dataCoverage: {
        completenessPct: 91,
      },
    } as const satisfies Parameters<typeof mapOrdersFt2Props>[0];

    const props = mapOrdersFt2Props(snapshot);

    expect(props.context.ordersObserved).toBe(75);
    expect(props.totals.revenueTotal).toBe(12500);
    expect(props.totals.costTotal).toBe(9800);
    expect(props.totals.currency).toBe('USD');

    expect(props.outcome?.status).toBe('positive');
    expect(props.trend?.direction).toBe('up');
    expect(props.dataCoverage.completenessPct).toBe(91);
  });

  it('preserves nulls exactly and does not infer values', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },

      ordersObserved: null,

      totals: {
        revenueTotal: null,
        costTotal: null,
        currency: null,
      },

      outcome: null,
      trend: null,

      dataCoverage: {
        completenessPct: null,
      },
    };

    const props = mapOrdersFt2Props(snapshot);

    expect(props.context.ordersObserved).toBeNull();
    expect(props.totals.revenueTotal).toBeNull();
    expect(props.totals.costTotal).toBeNull();
    expect(props.outcome).toBeNull();
    expect(props.trend).toBeNull();
    expect(props.dataCoverage.completenessPct).toBeNull();
  });

  it('normalizes undefined fields to null and remains shape-stable', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
    };

    const props = mapOrdersFt2Props(snapshot);

    expect(props.context.ordersObserved).toBeNull();

    expect(props.totals.revenueTotal).toBeNull();
    expect(props.totals.costTotal).toBeNull();
    expect(props.totals.currency).toBeNull();

    expect(props.outcome).toBeNull();
    expect(props.trend).toBeNull();
    expect(props.dataCoverage.completenessPct).toBeNull();
  });

  it('does not expose legacy or intelligence fields', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
    };

    const props = mapOrdersFt2Props(snapshot) as any;

    expect(props.marginSummary).toBeUndefined();
    expect(props.lossDrivers).toBeUndefined();
    expect(props.patterns).toBeUndefined();
    expect(props.timeSignal).toBeUndefined();
  });
});
