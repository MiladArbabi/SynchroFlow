import { buildAnalyticsIntelligence } from 'api-src/services/analytics-intelligence';

describe('Analytics Intelligence (Layer 2)', () => {
  test('preserves ambiguity and does not collapse observability', () => {
    const baseFacts = {
        snapshotId: 's1',
        extractedAt: 'now',
        shopId: 1,
        domains: {
            orders: {
            presence: true,
            observationCount: 5,
            nullSurface: 0,
            firstSeenAt: 'a',
            lastSeenAt: 'b',
            },
            products: null,
            customers: null,
            finances: null,
        },
    };

    const intelligence = buildAnalyticsIntelligence(baseFacts as any);

    expect(intelligence.domains.orders.presence).toBe('present');
    expect(intelligence.domains.orders.raw.observationCount).toBe(5);
  });

  test('does not emit outcome, trend, or business meaning', () => {
    const intelligence = buildAnalyticsIntelligence({
        snapshotId: 's1',
        extractedAt: 'now',
        shopId: 1,
        domains: {
        orders: {
            presence: null,
            observationCount: null,
            nullSurface: 1,
            firstSeenAt: null,
            lastSeenAt: null,
        },
        products: null,
        customers: null,
        finances: null,
        },
    } as any);

    expect((intelligence as any).outcome).toBeUndefined();
    expect((intelligence as any).trend).toBeUndefined();
   });
});