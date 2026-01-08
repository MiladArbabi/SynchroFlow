export interface FinancesFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };
    revenueObserved: number | null;
    netObserved: number | null;
  };

  outcome:
    | {
        status: 'positive' | 'negative' | 'unknown';
      }
    | null;

  trend:
    | {
        direction: 'up' | 'down' | 'flat' | 'unknown';
      }
    | null;

  dataCoverage: {
    completenessPct: number | null;
  };
}