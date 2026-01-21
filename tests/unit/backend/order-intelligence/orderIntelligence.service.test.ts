import { deriveOrderIntelligence } from
  'api-src/services/order-intelligence/orderIntelligence.service';
import type { OrderFacts } from
  'api-src/services/order-facts/orderFacts.types';
import type { OrderTrendFacts } from
  'api-src/services/order-facts/orderTrendFacts.service';

function makeFacts(
  overrides: Partial<OrderFacts> = {}
): OrderFacts {
  return {
    shopId: 1,
    ordersObserved: 10,
    totals: {
      revenueTotal: 100,
      costTotal: null,
      currency: null,
    },
    dataCoverage: {
      completenessPct: 90,
    },
    extractedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTrendFacts(
  overrides: Partial<OrderTrendFacts> = {}
): OrderTrendFacts {
  return {
    previousWindowOrders: 10,
    currentWindowOrders: 12,
    ...overrides,
  };
}

describe('Order Intelligence — Epistemic Classification', () => {
  it('fails closed when data coverage is null', () => {
    const intelligence = deriveOrderIntelligence(
      makeFacts({ dataCoverage: { completenessPct: null } }),
      makeTrendFacts()
    );

    expect(intelligence.margin.status).toBe('unknown');
    expect(intelligence.trend.direction).toBe('unknown');
    expect(intelligence.visibility.status).toBe('unknown');
    expect(intelligence.loss.exists).toBeNull();
  });

  it('enforces coverage threshold (79% vs 80%)', () => {
    const below = deriveOrderIntelligence(
      makeFacts({ dataCoverage: { completenessPct: 79 } }),
      makeTrendFacts()
    );

    expect(below.visibility.status).toBe('insufficient');
    expect(below.margin.status).toBe('unknown');
    expect(below.trend.direction).toBe('unknown');

    const at = deriveOrderIntelligence(
      makeFacts({ dataCoverage: { completenessPct: 80 } }),
      makeTrendFacts()
    );

    expect(at.visibility.status).toBe('sufficient');
  });

  it('classifies margin directionally (not accounting)', () => {
    const unknownRevenue = deriveOrderIntelligence(
      makeFacts({ totals: { revenueTotal: null, costTotal: null, currency: null } }),
      makeTrendFacts()
    );

    expect(unknownRevenue.margin.status).toBe('unknown');

    const zeroRevenue = deriveOrderIntelligence(
      makeFacts({ totals: { revenueTotal: 0, costTotal: null, currency: null } }),
      makeTrendFacts()
    );

    expect(zeroRevenue.margin.status).toBe('loss');
    expect(zeroRevenue.loss.exists).toBe(true);
  });

  it('returns unknown trend when trend facts are insufficient', () => {
    const missingPrev = deriveOrderIntelligence(
      makeFacts(),
      makeTrendFacts({ previousWindowOrders: null })
    );

    expect(missingPrev.trend.direction).toBe('unknown');

    const zeroPrev = deriveOrderIntelligence(
      makeFacts(),
      makeTrendFacts({ previousWindowOrders: 0 })
    );

    expect(zeroPrev.trend.direction).toBe('unknown');
  });

  it('classifies trend direction using ±5% threshold', () => {
    const up = deriveOrderIntelligence(
      makeFacts(),
      makeTrendFacts({ previousWindowOrders: 100, currentWindowOrders: 106 })
    );
    expect(up.trend.direction).toBe('up');

    const down = deriveOrderIntelligence(
      makeFacts(),
      makeTrendFacts({ previousWindowOrders: 100, currentWindowOrders: 94 })
    );
    expect(down.trend.direction).toBe('down');

    const flat = deriveOrderIntelligence(
      makeFacts(),
      makeTrendFacts({ previousWindowOrders: 100, currentWindowOrders: 102 })
    );
    expect(flat.trend.direction).toBe('flat');
  });
});
