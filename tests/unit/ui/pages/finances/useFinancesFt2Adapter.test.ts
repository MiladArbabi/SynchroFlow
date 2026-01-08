import { mapFinancesFt2Props } from 'ui/src/pages/finances/useFinancesFt2Adapter';

describe('FT2 Finances Adapter — mapFinancesFt2Props (observability only)', () => {
  it('maps a canonical FT2 backend snapshot without inference', () => {
    const snapshot = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        netObserved: 3200,
      },
      outcome: {
        status: 'positive',
      },
      trend: {
        direction: 'up',
      },
      dataCoverage: {
        completenessPct: 95,
      },
    } as const;

    const props = mapFinancesFt2Props(snapshot);

    expect(props.context.period).toEqual({
      from: '2025-01-01',
      to: '2025-01-31',
    });

    expect(props.context.netObserved).toBe(3200);
    expect(props.outcome?.status).toBe('positive');
    expect(props.trend?.direction).toBe('up');
    expect(props.dataCoverage?.completenessPct).toBe(95);
  });

  it('preserves explicit nulls without coercion', () => {
    const snapshot = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        netObserved: null,
      },
      outcome: null,
      trend: null,
      dataCoverage: {
        completenessPct: null,
      },
    };

    const props = mapFinancesFt2Props(snapshot);

    expect(props.context.netObserved).toBeNull();
    expect(props.outcome).toBeNull();
    expect(props.trend).toBeNull();
    expect(props.dataCoverage?.completenessPct).toBeNull();
  });

  it('normalizes undefined fields to null (shape-stable)', () => {
    const snapshot = {};

    const props = mapFinancesFt2Props(snapshot);

    expect(props.context.period).toBeNull();
    expect(props.context.netObserved).toBeNull();
    expect(props.outcome).toBeNull();
    expect(props.trend).toBeNull();
    expect(props.dataCoverage).toBeNull();
  });

  /**
   * Doctrine guard:
   * These fields must NEVER exist in FT2.
   */
  it('does not expose financial intelligence or breakdowns', () => {
    const snapshot = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        netObserved: 1000,
      },
    };

    const props = mapFinancesFt2Props(snapshot as any);

    expect((props as any).costSummary).toBeUndefined();
    expect((props as any).costBreakdown).toBeUndefined();
    expect((props as any).dominantPressure).toBeUndefined();
    expect((props as any).confidence).toBeUndefined();
  });
});