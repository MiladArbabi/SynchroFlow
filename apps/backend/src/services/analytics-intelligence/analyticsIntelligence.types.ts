// apps/backend/src/services/analytics-intelligence/analyticsIntelligence.types.ts

export interface AnalyticsIntelligence {
  revenueObserved: number | null;

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };
}