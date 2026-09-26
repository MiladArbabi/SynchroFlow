// tests/unit/ui/overview/OverviewFT2Page.refresh-boundary.test.tsx
//
// OV-UX-18 — RED-first page boundary contract.
//
// Mocks the module package so this test does not import the full Overview UI
// or the shared-ui barrel. The seam under test is the page's prop mapping:
// a manual morning-brief refresh must not turn existing brief data into
// `undefined`, because `OverviewModuleFT2` treats that as full-page loading.

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import OverviewPageFT2 from 'pages/ft2-pages/OverviewFT2Page';

const mockNavigate = jest.fn();
const mockUseMorningBriefSnapshot = jest.fn();
const mockRefreshMorningBrief = jest.fn();
const mockFloorPlanningRefetch = jest.fn();
const mockOverviewModuleFT2 = jest.fn((props: Record<string, unknown>) => (
  <div>
    <div data-testid="morning-brief-prop">
      {props.morningBrief ? 'present' : 'missing'}
    </div>
    <div data-testid="refreshing-prop">
      {props.isRefreshingBrief ? 'refreshing' : 'idle'}
    </div>
    <button type="button" aria-label="Refresh morning brief" onClick={props.onRefreshBrief as () => void}>
      Refresh
    </button>
  </div>
));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@lasyncro/overview', () => ({
  OverviewModuleFT2: (props: Record<string, unknown>) => mockOverviewModuleFT2(props),
}), { virtual: true });

jest.mock('@lasyncro/shared/ui', () => ({
  IsometricCanvas: () => <div data-testid="live-map" />,
}));

jest.mock('analytics/adapter', () => ({
  sendEvent: jest.fn(),
}), { virtual: true });

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { role: 'owner', first_name: 'Milad' },
    isLoading: false,
  }),
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    displayCurrency: 'USD',
    tier: 'scale',
    hasResolved: true,
  }),
}));

jest.mock('pages/overview/useOverviewFt2Adapter', () => ({
  mapOverviewFt2Props: () => ({
    trust: {
      dataFreshness: 'fresh',
      syncCoverage: 'complete',
      lastSyncAt: '2026-08-31T20:21:25.104Z',
    },
    pulse: {
      revenueToday: 1000,
      revenueDeltaVsYesterday: 0,
      collectedRevenue: 900,
      atRiskRevenue: 0,
      blockedRevenue: 0,
      topBlockingType: null,
    },
  }),
}));

jest.mock('pages/overview/useOverviewModulesFt2Snapshot', () => ({
  useOverviewModulesFt2Snapshot: () => ({
    isPending: false,
    isError: false,
    data: {},
  }),
}));

jest.mock('pages/trust/useTrustFt2Snapshot', () => ({
  useTrustFt2Snapshot: () => ({ data: null }),
}));

jest.mock('pages/overview/useMorningBriefSnapshot', () => ({
  useMorningBriefSnapshot: (...args: unknown[]) => mockUseMorningBriefSnapshot(...args),
}));

jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: () => ({
    data: {
      zones: [
        {
          location_code: 'A-1',
          type: 'bin',
          active: true,
          position_x: 1,
          position_y: 1,
          zone_type: 'pick',
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: mockFloorPlanningRefetch,
  }),
}));

jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGridOccupancy: () => ({
    data: { occupancy: {} },
    isLoading: false,
    isError: false,
  }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useOrderPool: () => ({
    data: {
      eligible_order_count: 0,
      summary: { blocked_count: 0 },
    },
    isPending: false,
    isError: false,
  }),
}));

jest.mock('pages/wms/useWmsLiveActivity', () => ({
  useWmsLiveActivity: () => ({
    data: {
      pickerPositions: [],
      activeBatches: [],
      stowPressure: { by_location: [] },
      receiveAtDock: [],
      awaitingPackUnits: 0,
      shippedToday: 0,
      packedNotShipped: 0,
      staleThresholdMinutes: 15,
    },
    isLoading: false,
    isError: false,
  }),
}));

jest.mock('../../../../apps/frontend/src/hooks/useIdleAlerts', () => ({
  useIdleAlerts: () => ({
    alerts: [],
    isLoading: false,
    isError: false,
  }),
}));

jest.mock('pages/problem-center/useProblemCenter', () => ({
  useProblemCenter: () => ({
    data: { tasks: [] },
    isLoading: false,
    isError: false,
  }),
}));

const initialBrief = {
  signals: [
    {
      id: 'revenue:shop-1:at_risk',
      priority: 2,
      title: '10 orders blocked',
      detail: 'Resolve each blocker.',
      module: 'orders',
      deepLink: '/orders/flow',
      revenueImpact: 13198.9,
    },
  ],
  hasUrgentIssues: true,
  generatedAt: '2026-08-31T20:21:25.104Z',
  trustWarning: false,
  fromCache: false,
  greeting: 'Good evening.',
  summaryLine: '1 decision pending. Review the issue below.',
};

describe('OverviewPageFT2 — OV-UX-18 manual refresh boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMorningBriefSnapshot.mockReturnValue({
      isPending: false,
      isError: false,
      isRefreshingBrief: false,
      data: initialBrief,
      refreshMorningBrief: mockRefreshMorningBrief,
    });
  });

  it('OV-REFRESH-04 keeps the current morning brief prop during manual refresh pending state', async () => {
    mockUseMorningBriefSnapshot.mockReturnValue({
      isPending: false,
      isError: false,
      isRefreshingBrief: true,
      data: initialBrief,
      refreshMorningBrief: mockRefreshMorningBrief,
    });

    render(<OverviewPageFT2 />);

    expect(screen.getByTestId('morning-brief-prop')).toHaveTextContent('present');
    expect(screen.getByTestId('refreshing-prop')).toHaveTextContent('refreshing');
    expect(mockUseMorningBriefSnapshot).toHaveBeenLastCalledWith(true);
  });

  it('OV-REFRESH-01/05/06 wires manual refresh without a force-query-key path', async () => {
    render(<OverviewPageFT2 />);

    expect(screen.getByTestId('morning-brief-prop')).toHaveTextContent('present');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh morning brief' }));

    await waitFor(() => {
      expect(mockRefreshMorningBrief).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('morning-brief-prop')).toHaveTextContent('present');
    expect(mockUseMorningBriefSnapshot).toHaveBeenLastCalledWith(true);
    expect(mockFloorPlanningRefetch).not.toHaveBeenCalled();
  });
});
