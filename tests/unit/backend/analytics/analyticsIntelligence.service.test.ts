// tests/unit/backend/analytics/analyticsIntelligence.service.test.ts

import { buildAnalyticsIntelligence } from 'api-src/services/analytics-intelligence/analyticsIntelligence.service';
import { AnalyticsFacts } from 'api-src/services/analytics-facts/analyticsFacts.types';

describe('Analytics Intelligence — classification only', () => {
  const baseFacts: AnalyticsFacts = {
    shopId: 1,
    period: { from: '2025-01-01', to: '2025-01-31' },
    revenueObserved: 1000,
    cogsObserved: 400,
    ordersObserved: {
      processing: 1,
      delivered: 5,
      in_transit: 2,
    },
    extractedAt: '2025-02-01T00:00:00.000Z',
  };

  test('classifies positive when revenueObserved > 0', () => {
    const result = buildAnalyticsIntelligence(baseFacts);

    expect(result.outcome.status).toBe('positive');
    expect(result.revenueObserved).toBe(1000);
    expect(result.trend.direction).toBe('unknown');
  });

  test('classifies negative when revenueObserved === 0', () => {
    const result = buildAnalyticsIntelligence({
      ...baseFacts,
      revenueObserved: 0,
    });

    expect(result.outcome.status).toBe('negative');
  });

  test('classifies unknown when revenueObserved is null', () => {
    const result = buildAnalyticsIntelligence({
      ...baseFacts,
      revenueObserved: null,
    });

    expect(result.outcome.status).toBe('unknown');
    expect(result.trend.direction).toBe('unknown');
  });

  test('does not compute percentages, margins, or explanations', () => {
    const result = buildAnalyticsIntelligence(baseFacts);

    expect((result as any).margin).toBeUndefined();
    expect((result as any).percentage).toBeUndefined();
    expect((result as any).reason).toBeUndefined();
  });
});