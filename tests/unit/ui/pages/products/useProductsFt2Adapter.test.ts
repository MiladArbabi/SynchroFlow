// tests/unit/ui/pages/products/useProductsFt2Adapter.test.ts

import { mapProductsFt2Props } from 'ui/src/pages/products/useProductsFt2Adapter';

describe('FT2 Products Adapter - mapProductsFt2Props', () => {
  it('maps a full backend snapshot without inference', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
      productsAnalyzed: 42,

      productSummary: {
        totalRevenue: 120000,
        totalCost: 90000,
        netContribution: 30000,
        currency: 'USD',
      },

      productBreakdown: [
        {
          sku: 'SKU-001',
          revenue: 60000,
          cost: 40000,
          marginPct: 33,
        },
        {
          sku: 'SKU-002',
          revenue: 30000,
          cost: 25000,
          marginPct: 17,
        },
      ],

      dominantProductPressure: {
        sku: 'SKU-002',
        pressureType: 'low-margin',
        confidence: 'high',
      },

      timeSignal: {
        trend: 'stable',
      },
    } as const satisfies Parameters<typeof mapProductsFt2Props>[0];

    const props = mapProductsFt2Props(snapshot);

    expect(props.context.productsAnalyzed).toBe(42);
    expect(props.productSummary.totalRevenue).toBe(120000);
    expect(props.productBreakdown?.[0].sku).toBe('SKU-001');
    expect(props.dominantProductPressure?.pressureType).toBe('low-margin');
    expect(props.timeSignal?.trend).toBe('stable');
  });

  it('preserves explicit nulls without coercion', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
      productsAnalyzed: null,

      productSummary: {
        totalRevenue: null,
        totalCost: null,
        netContribution: null,
        currency: null,
      },

      productBreakdown: null,
      dominantProductPressure: null,
      timeSignal: null,
    };

    const props = mapProductsFt2Props(snapshot);

    expect(props.context.productsAnalyzed).toBeNull();
    expect(props.productSummary.totalRevenue).toBeNull();
    expect(props.productBreakdown).toBeNull();
    expect(props.dominantProductPressure).toBeNull();
    expect(props.timeSignal).toBeNull();
  });

  it('normalizes undefined fields to null (shape-stable)', () => {
    const snapshot = {
      period: { from: '2025-01-01', to: '2025-01-31' },
    };

    const props = mapProductsFt2Props(snapshot);

    expect(props.context.productsAnalyzed).toBeNull();
    expect(props.productSummary.totalRevenue).toBeNull();
    expect(props.productBreakdown).toBeNull();
    expect(props.dominantProductPressure).toBeNull();
    expect(props.timeSignal).toBeNull();
  });
});