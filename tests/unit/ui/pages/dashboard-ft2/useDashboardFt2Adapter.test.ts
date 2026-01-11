//tests/unit/ui/pages/dashboard-ft2/useDashboardFt2Adapter.test.ts
import { mapDashboardFt2Snapshot } from 'pages/dashboard-ft2/useDashboardFt2Adapter';

describe('mapDashboardFt2Snapshot — contract', () => {
  it('maps undefined snapshot fields to null without inference', () => {
    const rawSnapshot = {
      observationWindow: {
        from: undefined,
        to: undefined,
      },
      coverage: {
        ordersObserved: undefined,
        productsObserved: undefined,
        sessionsObserved: undefined,
      },
      systemHealth: {
        ingestion: undefined,
        confidence: undefined,
      },
    };

    const result = mapDashboardFt2Snapshot(rawSnapshot as any);

    expect(result).toEqual({
      observationWindow: {
        from: null,
        to: null,
      },
      coverage: {
        ordersObserved: null,
        productsObserved: null,
        sessionsObserved: null,
      },
      systemHealth: {
        ingestion: null,
        confidence: null,
      },
    });
  });
});