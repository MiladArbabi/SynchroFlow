//apps/backend/src/services/specter-facts/specterFacts.types.ts
export interface SpecterFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  sessionsObserved: number | null;
  exitIntentSessions: number | null;

  funnelsDetected: boolean | null;

  extractedAt: string;
}

export interface GetSpecterFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}