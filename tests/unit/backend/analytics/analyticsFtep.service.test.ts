// tests/unit/backend/analytics/analyticsFtep.service.test.ts

import { buildAnalyticsFtep } from 'api-src/services/analytics-ftep/analyticsFtep.service';
import { AnalyticsFacts } from 'api-src/services/analytics-facts/analyticsFacts.types';
import { AnalyticsIntelligence } from 'api-src/services/analytics-intelligence/analyticsIntelligence.types';

describe('Analytics FTEP — leak prevention & downgrade rules', () => {
  const baseFacts: AnalyticsFacts = {
    shopId: 1,
    period: { from: '2025-01-01', to: '2025-01-31' },
    revenueObserved: 1000,
    cogsObserved: 400,
    ordersObserved: {
      processing: 2,
      delivered: 5,
      in_transit: 1,
    },
    extractedAt: '2025-02-01T00:00:00.000Z',
  };

  test('exposes positive outcome when intelligence is positive', () => {
    const intelligence: AnalyticsIntelligence = {
      revenueObserved: 1000,
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' },
    };

    const result = buildAnalyticsFtep({ facts: baseFacts, intelligence });

    expect(result.outcome?.status).toBe('positive');
    expect(result.context.period).toEqual(baseFacts.period);
  });

  test('downgrades unknown intelligence to null outcome and trend', () => {
    const intelligence: AnalyticsIntelligence = {
      revenueObserved: null,
      outcome: { status: 'unknown' },
      trend: { direction: 'unknown' },
    };

    const result = buildAnalyticsFtep({ facts: baseFacts, intelligence });

    expect(result.outcome).toBeNull();
    expect(result.trend).toBeNull();
  });

  test('does not leak intelligence internals or forbidden fields', () => {
    const intelligence: AnalyticsIntelligence = {
      revenueObserved: 1000,
      outcome: { status: 'positive' },
      trend: { direction: 'up' },
    };

    const result = buildAnalyticsFtep({ facts: baseFacts, intelligence });

    expect((result as any).margin).toBeUndefined();
    expect((result as any).percentage).toBeUndefined();
    expect((result as any).reason).toBeUndefined();
  });

  test('serialization scan — no forbidden semantic leakage', () => {
    const intelligence: AnalyticsIntelligence = {
      revenueObserved: 1000,
      outcome: { status: 'negative' },
      trend: { direction: 'down' },
    };

    const result = buildAnalyticsFtep({ facts: baseFacts, intelligence });

    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/percent|percentage|margin|profit|loss|because|reason/i);
  });
});