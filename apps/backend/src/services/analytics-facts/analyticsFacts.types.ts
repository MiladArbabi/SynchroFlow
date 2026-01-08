// apps/backend/src/services/analytics-facts/analyticsFacts.types.ts

export interface AnalyticsFacts {
  shopId: number;
  period: {
    from: string;
    to: string;
  };

  ordersObserved: {
    processing: number | null;
    delivered: number | null;
    in_transit: number | null;
  };

  extractedAt: string;
}

