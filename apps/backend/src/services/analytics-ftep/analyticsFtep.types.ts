// apps/backend/src/services/analytics-ftep/analyticsFtep.types.ts

export interface AnalyticsFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };
    revenueObserved: number | null;
  };

  outcome: {
    status: 'positive' | 'negative';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;
}