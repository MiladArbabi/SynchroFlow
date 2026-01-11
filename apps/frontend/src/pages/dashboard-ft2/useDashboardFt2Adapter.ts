// apps/frontend/src/pages/dashboard-ft2/useDashboardFt2Adapter.ts

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

  orders?: {
    outcome?: {
      status?: 'positive' | 'negative' | 'unknown';
    };
  };

  products?: {
    outcome?: {
      status?: 'positive' | 'negative' | 'unknown';
    };
  };
};

/**
 * mapDashboardFt2Snapshot
 * ----------------------
 * Pure FT2 adapter.
 *
 * Rules:
 * - Undefined → null only
 * - No inference
 * - No aggregation
 * - No semantic translation
 */
export function mapDashboardFt2Snapshot(snapshot: DashboardFt2Snapshot) {
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
      ordersOutcome:
        snapshot.orders?.outcome?.status ?? null,

      productsOutcome:
        snapshot.products?.outcome?.status ?? null,
    },
  };
}