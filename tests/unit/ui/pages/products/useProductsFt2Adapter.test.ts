// tests/unit/ui/pages/products/useProductsFt2Adapter.test.ts

import { mapProductsFt2Props } from 'ui/src/pages/products/useProductsFt2Adapter';

describe('FT2 Products Adapter - mapProductsFt2Props', () => {
  it('maps a full backend snapshot without inference', () => {
    const snapshot = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        productsObserved: 42,
      },
      outcome: { status: 'negative' },
      trend: { direction: 'unknown' },
    } as const;

    const props = mapProductsFt2Props(snapshot);

    expect(props.context.period.from).toBe('2025-01-01');
    expect(props.context.productsObserved).toBe(42);
    expect(props.outcome?.status).toBe('negative');
    expect(props.trend?.direction).toBe('unknown');
  });

  it('preserves explicit nulls without coercion', () => {
    const snapshot = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        productsObserved: null,
      },
      outcome: null,
      trend: null,
    };

    const props = mapProductsFt2Props(snapshot);

    expect(props.context.productsObserved).toBeNull();
    expect(props.outcome).toBeNull();
    expect(props.trend).toBeNull();
  });

  it('normalizes undefined fields to null (shape-stable)', () => {
    const snapshot = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
      },
    };

    const props = mapProductsFt2Props(snapshot);

    expect(props.context.productsObserved).toBeNull();
    expect(props.outcome).toBeNull();
    expect(props.trend).toBeNull();
  });
});
