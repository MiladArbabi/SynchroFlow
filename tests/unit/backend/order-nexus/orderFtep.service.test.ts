// tests/unit/backend/order-nexus/orderFtep.service.test.ts

import { exposeOrderNexusFT2 } from
  'api-src/services/order-ftep/orderFtep.service';

describe('Order FTEP (Layer 3) — Leak Prevention', () => {
  const baseInput = {
    intelligence: {
      ordersObserved: 120,
      margin: {
        averagePct: 18.4,
        status: 'healthy' as const,
      },
      loss: {
        exists: false,
      },
      trend: {
        direction: 'down' as const,
      },
      dataCoveragePct: 82,
    },
    facts: {
      shopId: 1,
      period: {
        from: '2025-01-01',
        to: '2025-01-31',
      },
      ordersObserved: 120,
      totals: {
        revenueTotal: 18500,
        costTotal: 14300,
        currency: 'USD',
      },
      dataCoverage: {
        completenessPct: 82,
      },
      extractedAt: '2025-02-01T00:00:00.000Z',
    },
  };

  it('exposes only downgraded FT2 observability fields', () => {
    const result = exposeOrderNexusFT2(baseInput);

    expect(result.context.ordersObserved).toBe(120);
    expect(result.context.period.from).toBe('2025-01-01');

    expect(result.totals.revenueTotal).toBe(18500);
    expect(result.totals.costTotal).toBe(14300);
    expect(result.totals.currency).toBe('USD');

    expect(result.outcome?.status).toBe('positive');
    expect(result.trend?.direction).toBe('down');

    expect(result.dataCoverage.completenessPct).toBe(82);
  });

  it('does NOT expose intelligence internals', () => {
    const result = exposeOrderNexusFT2(baseInput) as any;

    expect(result.margin).toBeUndefined();
    expect(result.loss).toBeUndefined();
    expect(result.trendDelta).toBeUndefined();
    expect(result.dataCoveragePct).toBeUndefined();
  });

  it('does NOT expose margin percentages or intelligence semantics', () => {
    const result = exposeOrderNexusFT2(baseInput) as any;
    const serialized = JSON.stringify(result).toLowerCase();

    expect(serialized).not.toMatch(/margin/);
    expect(serialized).not.toMatch(/average/);
    expect(serialized).not.toMatch(/percent/);
    expect(serialized).not.toMatch(/health/);
    expect(serialized).not.toMatch(/risk/);
  });

  it('does NOT expose causation or explanation language', () => {
    const result = exposeOrderNexusFT2(baseInput);
    const serialized = JSON.stringify(result).toLowerCase();

    expect(serialized).not.toMatch(/because/);
    expect(serialized).not.toMatch(/due to/);
    expect(serialized).not.toMatch(/driver/);
    expect(serialized).not.toMatch(/caused/);
    expect(serialized).not.toMatch(/reason/);
  });

  it('returns null-safe exposure when intelligence is unknown', () => {
    const result = exposeOrderNexusFT2({
      ...baseInput,
      intelligence: {
        ordersObserved: null,
        margin: { averagePct: null, status: 'unknown' },
        loss: { exists: null },
        trend: { direction: 'unknown' },
        dataCoveragePct: null,
      },
    });

    expect(result.context.ordersObserved).toBeNull();
    expect(result.outcome).toBeNull();
    expect(result.trend).toBeNull();
    expect(result.dataCoverage.completenessPct).toBeNull();
  });
});