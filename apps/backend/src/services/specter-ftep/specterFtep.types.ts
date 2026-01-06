//apps/backend/src/services/specter-ftep/specterFtep.types.ts
export interface SpecterFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };
    sessionsObserved: number | null;
  };

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  signals: {
    funnelsDetected: boolean | null;
  };

  dataCoverage: {
    sessionsPresent: boolean | null;
  };
}