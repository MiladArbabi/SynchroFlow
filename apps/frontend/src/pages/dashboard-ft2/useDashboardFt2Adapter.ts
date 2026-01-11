/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/dashboard-ft2/useDashboardFt2Adapter.ts

type Nullable<T> = T | null;

type DashboardFt2Snapshot = {
  observationWindow?: {
    from?: string;
    to?: string;
  };
  coverage?: {
    ordersObserved?: number;
    productsObserved?: number;
    sessionsObserved?: number;
  };
  systemHealth?: {
    ingestion?: string;
    confidence?: string;
  };
};

export function mapDashboardFt2Snapshot(
  snapshot: DashboardFt2Snapshot
) {
  return {
    observationWindow: {
      from: snapshot.observationWindow?.from ?? null,
      to: snapshot.observationWindow?.to ?? null,
    },
    coverage: {
      ordersObserved: snapshot.coverage?.ordersObserved ?? null,
      productsObserved: snapshot.coverage?.productsObserved ?? null,
      sessionsObserved: snapshot.coverage?.sessionsObserved ?? null,
    },
    systemHealth: {
      ingestion: snapshot.systemHealth?.ingestion ?? null,
      confidence: snapshot.systemHealth?.confidence ?? null,
    },
  };
}