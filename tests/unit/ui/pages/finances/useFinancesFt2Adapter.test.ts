//tests/unit/ui/pages/finances/useFinancesFt2Adapter.test.ts
import { mapFinancesFt2Props } from 'ui/src/pages/finances/useFinancesFt2Adapter';

describe('FT2 Finances Adapter - mapFinancesFt2Props', () => {
  it('maps a full backend snapshot without inference', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
      transactionsAnalyzed: 1200,

      costSummary: {
        totalRevenue: 50000,
        totalCost: 42000,
        netResult: 8000,
        currency: 'USD',
      },

      costBreakdown: [
        {
          type: 'cogs',
          amount: 25000,
          pctOfRevenue: 50,
        },
        {
          type: 'fulfillment',
          amount: 9000,
          pctOfRevenue: 18,
        },
      ],

      dominantPressure: {
        type: 'cogs',
        confidence: 'high',
      },

      timeSignal: {
        trend: 'stable',
      },
    } as const satisfies Parameters<typeof mapFinancesFt2Props>[0];

    const props = mapFinancesFt2Props(snapshot);

    expect(props.context.transactionsAnalyzed).toBe(1200);
    expect(props.costSummary.totalRevenue).toBe(50000);
    expect(props.costBreakdown?.[0].type).toBe('cogs');
    expect(props.dominantPressure?.confidence).toBe('high');
    expect(props.timeSignal?.trend).toBe('stable');
  });

  it('preserves explicit nulls without coercion', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
      transactionsAnalyzed: null,

      costSummary: {
        totalRevenue: null,
        totalCost: null,
        netResult: null,
        currency: null,
      },

      costBreakdown: null,
      dominantPressure: null,
      timeSignal: null,
    };

    const props = mapFinancesFt2Props(snapshot);

    expect(props.context.transactionsAnalyzed).toBeNull();
    expect(props.costSummary.totalRevenue).toBeNull();
    expect(props.costBreakdown).toBeNull();
    expect(props.dominantPressure).toBeNull();
    expect(props.timeSignal).toBeNull();
  });

  it('normalizes undefined fields to null (shape-stable)', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
    };

    const props = mapFinancesFt2Props(snapshot);

    expect(props.context.transactionsAnalyzed).toBeNull();
    expect(props.costSummary.totalRevenue).toBeNull();
    expect(props.costBreakdown).toBeNull();
    expect(props.dominantPressure).toBeNull();
    expect(props.timeSignal).toBeNull();
  });
});