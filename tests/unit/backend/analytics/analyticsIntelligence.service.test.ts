// tests/unit/backend/analytics/analyticsIntelligence.service.test.ts

import { buildAnalyticsIntelligence } from 'api-src/services/analytics-intelligence/analyticsIntelligence.service';
import { AnalyticsFacts } from 'api-src/services/analytics-facts/analyticsFacts.types';

describe('Analytics Intelligence — orders-based classification only', () => {
  const baseFacts: AnalyticsFacts = {
    shopId: 1,
    period: { from: '2025-01-01', to: '2025-01-31' },
    ordersObserved: {
      processing: 1,
      delivered: 2,
      in_transit: 0,
    },
    extractedAt: '2025-02-01T00:00:00.000Z',
  };

  test('classifies positive when any order count > 0', () => {
    const result = buildAnalyticsIntelligence(baseFacts);

    expect(result.outcome.status).toBe('positive');
    expect(result.trend.direction).toBe('unknown');
  });

  test('classifies negative when all order counts are zero', () => {
    const result = buildAnalyticsIntelligence({
      ...baseFacts,
      ordersObserved: {
        processing: 0,
        delivered: 0,
        in_transit: 0,
      },
    });

    expect(result.outcome.status).toBe('negative');
  });

  test('classifies unknown when all order counts are null', () => {
    const result = buildAnalyticsIntelligence({
      ...baseFacts,
      ordersObserved: {
        processing: null,
        delivered: null,
        in_transit: null,
      },
    });

    expect(result.outcome.status).toBe('unknown');
    expect(result.trend.direction).toBe('unknown');
  });

  test('does not compute financials, percentages, or explanations', () => {
    const result = buildAnalyticsIntelligence(baseFacts);

    expect((result as any).revenueObserved).toBeUndefined();
    expect((result as any).cogsObserved).toBeUndefined();
    expect((result as any).margin).toBeUndefined();
    expect((result as any).percentage).toBeUndefined();
    expect((result as any).reason).toBeUndefined();
  });
});
