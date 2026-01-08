// apps/backend/src/services/analytics-intelligence/analyticsIntelligence.types.ts

export interface AnalyticsIntelligence {
  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };
  trend: {
    direction: 'unknown';
  };
}
