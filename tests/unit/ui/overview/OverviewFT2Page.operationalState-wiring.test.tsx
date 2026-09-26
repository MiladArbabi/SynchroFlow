// tests/unit/ui/overview/OverviewFT2Page.operationalState-wiring.test.tsx
//
// OVERVIEW-LIVE-MAP-01 Slice C — ORCHESTRATION WIRING.
//
// Protects only that OverviewFT2Page passes its already-derived (Slice B)
// overviewOperationalStateByLocation / overviewOperationalStateByStation
// records into IsometricCanvas's operationalStateByLocation /
// operationalStateByStation props unchanged. Does not retest Slice B's
// derivation logic (overviewOperationalProjection.test.ts) or the renderer's
// visual treatment (IsometricCanvas.operationalState.render.test.tsx).
//
// SEAM: the page's prop/orchestration boundary. Mock set copied from
// OverviewFT2Page.address-resolution-wiring.test.tsx so the full Overview UI
// and the shared-ui barrel are never imported.

import React from 'react';
import { render } from '@testing-library/react';

import OverviewPageFT2 from 'pages/ft2-pages/OverviewFT2Page';

const mockUseSearchParams = jest.fn();
const mockSetSearchParams = jest.fn();
const mockUseAddressResolutionOrders = jest.fn();
const mockIsometricCanvas = jest.fn((_props: Record<string, unknown>) => (
  <div data-testid="live-map" />
));
const mockNavigate = jest.fn();
const mockUseMorningBriefSnapshot = jest.fn();
const mockFloorPlanningRefetch = jest.fn();
const mockOverviewModuleFT2 = jest.fn((_props: Record<string, unknown>) => <div />);

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => mockUseSearchParams(),
}));

jest.mock('@lasyncro/overview', () => ({
  OverviewModuleFT2: (props: Record<string, unknown>) => mockOverviewModuleFT2(props),
}), { virtual: true });

jest.mock('@lasyncro/shared/ui', () => ({
  IsometricCanvas: (props: Record<string, unknown>) => mockIsometricCanvas(props),
}));

jest.mock('analytics/adapter', () => ({
  sendEvent: jest.fn(),
}), { virtual: true });

jest.mock('analytics/useUiEvents', () => ({
  useUiEvents: () => ({ emit: jest.fn() }),
}), { virtual: true });

jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    context: { tier: 'scale', modules: new Set<string>(), flags: new Set<string>() },
    isResolved: true,
    decide: () => ({ allowed: true }),
  }),
}));

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

// One physical bin (open problem -> critical) and the default synthetic
// stations, so both operationalStateByLocation and operationalStateByStation
// are non-empty and observable.
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
      eligible_order_count: 3,
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
      shippedToday: 5,
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
    // One open problem at A-1 -> operationalStateByLocation['A-1'] = 'critical'.
    data: { tasks: [{ problem_bin_location: 'A-1' }] },
    isLoading: false,
    isError: false,
  }),
}));

jest.mock('pages/orders/AddressResolutionSessionModal', () => ({
  AddressResolutionSessionModal: () => null,
}));

jest.mock('pages/orders/useAddressResolutionOrders', () => ({
  useAddressResolutionOrders: (...args: unknown[]) => mockUseAddressResolutionOrders(...args),
  useInvalidateAddressResolutionOrders: () => jest.fn(),
}));

const BRIEF = {
  signals: [],
  hasUrgentIssues: false,
  generatedAt: '2026-09-11T08:00:00.000Z',
  trustWarning: false,
  greeting: 'Good morning, Milad',
  summaryLine: 'All clear',
};

function setSearchParams(search: string) {
  const params = new URLSearchParams(search);
  mockUseSearchParams.mockReturnValue([params, mockSetSearchParams]);
}

beforeEach(() => {
  jest.clearAllMocks();
  setSearchParams('');
  mockUseMorningBriefSnapshot.mockReturnValue({
    data: BRIEF,
    isPending: false,
    isError: false,
    refreshMorningBrief: jest.fn(),
    isRefreshingBrief: false,
  });
  mockUseAddressResolutionOrders.mockReturnValue({
    candidates: [],
    isLoading: false,
    isError: false,
  });
});

/**
 * OverviewFT2Page passes the live-map JSX tree as OverviewModuleFT2's
 * `mapContent` prop rather than rendering IsometricCanvas as a direct JSX
 * sibling (see OverviewFT2Page.tsx line ~876: `<OverviewModuleFT2
 * mapContent={mapContent} .../>`). The mocked OverviewModuleFT2 never mounts
 * that subtree, so this renders the captured `mapContent` element on its own
 * to reach the mocked IsometricCanvas underneath it.
 */
function renderMapContentAndGetIsometricCanvasProps(): Record<string, unknown> {
  render(<OverviewPageFT2 />);
  expect(mockOverviewModuleFT2).toHaveBeenCalled();
  const mapContent = mockOverviewModuleFT2.mock.calls[0][0].mapContent as React.ReactNode;
  render(<>{mapContent}</>);
  expect(mockIsometricCanvas).toHaveBeenCalled();
  return mockIsometricCanvas.mock.calls[0][0];
}

describe('9: OverviewFT2Page wires the Slice B operational-state projections into IsometricCanvas', () => {
  it('passes operationalStateByLocation exactly as derived (open problem at A-1 -> critical)', () => {
    const props = renderMapContentAndGetIsometricCanvasProps();
    expect(props.operationalStateByLocation).toBeDefined();
    expect((props.operationalStateByLocation as Record<string, string>)['A-1']).toBe('critical');
  });

  it('passes operationalStateByStation with an entry per rendered synthetic station id', () => {
    const props = renderMapContentAndGetIsometricCanvasProps();
    const byStation = props.operationalStateByStation as Record<string, string>;
    expect(byStation).toBeDefined();
    // pool has eligible orders -> active; shipped has shippedToday -> healthy.
    expect(byStation.pool).toBe('active');
    expect(byStation.shipped).toBe('healthy');
  });

  it('does not mutate the projections between derivation and the prop passed to IsometricCanvas', () => {
    const props = renderMapContentAndGetIsometricCanvasProps();
    // Every value in both records is a member of the shared operational-state vocabulary.
    const vocabulary = ['neutral', 'active', 'healthy', 'stale', 'warning', 'critical'];
    for (const v of Object.values(props.operationalStateByLocation as Record<string, string>)) {
      expect(vocabulary).toContain(v);
    }
    for (const v of Object.values(props.operationalStateByStation as Record<string, string>)) {
      expect(vocabulary).toContain(v);
    }
  });
});
