// tests/unit/ui/overview/OverviewFT2Page.operationalPresentation-wiring.test.tsx
//
// OVERVIEW-LIVE-MAP-01 Slice D — ORCHESTRATION WIRING.
//
// Protects only that OverviewFT2Page passes its already-derived
// overviewOperationalPresentationByLocation / overviewOperationalPresentationByStation
// records into IsometricCanvas's operationalPresentationByLocation /
// operationalPresentationByStation props unchanged. Does not retest the pure
// badge/reason derivation (overviewOperationalPresentation.test.ts) or the
// renderer's badge painting (IsometricCanvas.operationalPresentation.render.test.tsx).
//
// SEAM + mock harness copied verbatim from
// OverviewFT2Page.operationalState-wiring.test.tsx (Slice C), which itself
// copied OverviewFT2Page.address-resolution-wiring.test.tsx's set, so the
// full Overview UI and the shared-ui barrel are never imported.

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

// One physical bin (open problem -> critical, badge "1 issue") and the
// default synthetic stations, so both presentation records are observable.
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
      summary: { blocked_count: 2 },
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
    // One open problem at A-1 -> primaryBadge "1 issue", state critical.
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
 * sibling. The mocked OverviewModuleFT2 never mounts that subtree, so this
 * renders the captured `mapContent` element on its own to reach the mocked
 * IsometricCanvas underneath it.
 */
function renderMapContentAndGetIsometricCanvasProps(): Record<string, unknown> {
  render(<OverviewPageFT2 />);
  expect(mockOverviewModuleFT2).toHaveBeenCalled();
  const mapContent = mockOverviewModuleFT2.mock.calls[0][0].mapContent as React.ReactNode;
  render(<>{mapContent}</>);
  expect(mockIsometricCanvas).toHaveBeenCalled();
  return mockIsometricCanvas.mock.calls[0][0];
}

describe('OverviewFT2Page wires Slice D presentation into IsometricCanvas', () => {
  it('passes operationalPresentationByLocation with the exact badge/state the pure helper derives for an open problem', () => {
    const props = renderMapContentAndGetIsometricCanvasProps();
    const byLocation = props.operationalPresentationByLocation as Record<
      string,
      { state: string; primaryBadge: { label: string; count?: number } | null }
    >;
    expect(byLocation).toBeDefined();
    // matchObject: the page legitimately passes the full
    // OverviewOperationalPresentation (reason/workLines/etc. included) —
    // structurally compatible with the shared renderer's narrower
    // OperationalMapPresentation primitive. Only state/primaryBadge matter here.
    expect(byLocation['A-1']).toMatchObject({
      state: 'critical',
      primaryBadge: { label: '1 issue', count: 1 },
    });
  });

  it('passes operationalPresentationByStation with a badge per rendered synthetic station', () => {
    const props = renderMapContentAndGetIsometricCanvasProps();
    const byStation = props.operationalPresentationByStation as Record<
      string,
      { state: string; primaryBadge: { label: string; count?: number } | null }
    >;
    expect(byStation).toBeDefined();
    // pool: eligible_order_count 3 -> active, "3 ready".
    expect(byStation.pool).toMatchObject({ state: 'active', primaryBadge: { label: '3 ready', count: 3 } });
    // shipped: shippedToday 5 -> healthy, "5 shipped".
    expect(byStation.shipped).toMatchObject({ state: 'healthy', primaryBadge: { label: '5 shipped', count: 5 } });
  });

  it('the presentation state for each object matches the same-object operationalStateByLocation/ByStation value (single source, no drift)', () => {
    const props = renderMapContentAndGetIsometricCanvasProps();
    const stateByLocation = props.operationalStateByLocation as Record<string, string>;
    const presentationByLocation = props.operationalPresentationByLocation as Record<
      string,
      { state: string }
    >;
    for (const code of Object.keys(presentationByLocation)) {
      expect(presentationByLocation[code].state).toBe(stateByLocation[code]);
    }

    const stateByStation = props.operationalStateByStation as Record<string, string>;
    const presentationByStation = props.operationalPresentationByStation as Record<
      string,
      { state: string }
    >;
    for (const id of Object.keys(presentationByStation)) {
      expect(presentationByStation[id].state).toBe(stateByStation[id]);
    }
  });

  it('never produces more than one badge object per rendered location or station', () => {
    const props = renderMapContentAndGetIsometricCanvasProps();
    const byLocation = props.operationalPresentationByLocation as Record<
      string,
      { primaryBadge: unknown }
    >;
    const byStation = props.operationalPresentationByStation as Record<
      string,
      { primaryBadge: unknown }
    >;
    for (const v of Object.values(byLocation)) {
      expect(Array.isArray(v.primaryBadge)).toBe(false);
    }
    for (const v of Object.values(byStation)) {
      expect(Array.isArray(v.primaryBadge)).toBe(false);
    }
  });
});

describe('OVERVIEW-LIVE-MAP-01 Slice D.1: occupancy suppression + station identity wiring', () => {
  it('passes occupancyPresentation="neutral" to IsometricCanvas', () => {
    const props = renderMapContentAndGetIsometricCanvasProps();
    expect(props.occupancyPresentation).toBe('neutral');
  });

  it('wires showIdentityLabel per the approved mapping: pool keeps identity, blocked/shipped suppress it', () => {
    const props = renderMapContentAndGetIsometricCanvasProps();
    const byStation = props.operationalPresentationByStation as Record<
      string,
      { showIdentityLabel?: boolean }
    >;
    expect(byStation.pool.showIdentityLabel).toBe(true);
    expect(byStation.shipped.showIdentityLabel).toBe(false);
    // blocked_count is 2 in this fixture -> non-neutral -> identity suppressed.
    expect(byStation.blocked.showIdentityLabel).toBe(false);
  });

  it('blocked badge wording uses the explicit noun, plural for count 2', () => {
    const props = renderMapContentAndGetIsometricCanvasProps();
    const byStation = props.operationalPresentationByStation as Record<
      string,
      { primaryBadge: { label: string } | null }
    >;
    expect(byStation.blocked.primaryBadge).toEqual({ label: '2 blocked orders', count: 2 });
  });
});
