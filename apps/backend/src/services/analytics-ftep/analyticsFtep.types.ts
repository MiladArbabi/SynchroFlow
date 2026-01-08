// apps/backend/src/services/analytics-ftep/analyticsFtep.types.ts

export interface AnalyticsFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };
  };

  outcome: {
    status: 'positive' | 'negative';
  } | null;

  trend: {
    direction: 'unknown';
  } | null;
}
