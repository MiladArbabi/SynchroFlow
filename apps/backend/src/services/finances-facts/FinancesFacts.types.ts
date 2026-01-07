export interface FinancesFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  totalRevenue: number | null;
  totalCosts: number | null;
  netResult: number | null;

  dataCoverage: {
    completenessPct: number | null;
  };

  extractedAt: string;
}