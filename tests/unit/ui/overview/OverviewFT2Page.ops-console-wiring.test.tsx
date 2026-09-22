// tests/unit/ui/overview/OverviewFT2Page.ops-console-wiring.test.tsx
//
// UX-OWNERSHIP-01 — RED CONTRACT (page wiring).
//
// TARGET FUTURE API — OverviewFT2Page should derive:
//   openOpsConsole():
//     if (!state.isOpsConsoleOpen)
//       dispatch({ type: 'TOGGLE_OPS_CONSOLE' })
//
// and pass it to OverviewModuleFT2 as onOpenOpsConsole. This must be
// idempotent: invoking it while the console is already open must NOT
// dispatch again (OPEN semantics, not blind TOGGLE).
//
// RED today: the page does not consume ConfigContext at all and does not
// pass onOpenOpsConsole to OverviewModuleFT2, so onOpenOpsConsole is
// undefined in both cases below. The "is a function" assertion in each test
// is the load-bearing one — it fails identically whether isOpsConsoleOpen is
// true or false, which is what stops the "already open → dispatch not
// called" case from vacuously passing just because nothing is wired yet.
//
// Mock harness copied from OverviewFT2Page.address-resolution-wiring.test.tsx
// (same module-scope dependency surface for OverviewFT2Page).

import React from 'react';
import { render } from '@testing-library/react';

import OverviewPageFT2 from 'pages/ft2-pages/OverviewFT2Page';
import { ConfigContext } from 'contexts/ConfigContext';
import defaultConfig, { type ConfigProps } from 'config';

const mockUseSearchParams = jest.fn();
const mockSetSearchParams = jest.fn();
const mockUseAddressResolutionOrders = jest.fn();
const mockInvalidateAddressResolution = jest.fn();
const mockFloorPlanningRefetch = jest.fn();
const mockNavigate = jest.fn();
const mockUseMorningBriefSnapshot = jest.fn();
const mockRefreshMorningBrief = jest.fn();
const mockOverviewModuleFT2 = jest.fn((_props: Record<string, unknown>) => <div data-testid="overview-module" />);

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => mockUseSearchParams(),
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
    trust: { dataFreshness: 'fresh', syncCoverage: 'complete', lastSyncAt: '2026-08-31T20:21:25.104Z' },
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
  useOverviewModulesFt2Snapshot: () => ({ isPending: false, isError: false, data: {} }),
}));

jest.mock('pages/trust/useTrustFt2Snapshot', () => ({
  useTrustFt2Snapshot: () => ({ data: null }),
}));

jest.mock('pages/overview/useMorningBriefSnapshot', () => ({
  useMorningBriefSnapshot: (...args: unknown[]) => mockUseMorningBriefSnapshot(...args),
}));

jest.mock('pages/overview/ProfileCompletionBanner', () => ({
  ProfileCompletionBanner: () => null,
}));

jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: () => ({
    data: {
      zones: [
        { location_code: 'A-1', type: 'bin', active: true, position_x: 1, position_y: 1, zone_type: 'pick' },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: mockFloorPlanningRefetch,
  }),
}));

jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGridOccupancy: () => ({ data: { occupancy: {} }, isLoading: false, isError: false }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useOrderPool: () => ({
    data: { eligible_order_count: 0, summary: { blocked_count: 0 } },
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
  useIdleAlerts: () => ({ alerts: [], isLoading: false, isError: false }),
}));

jest.mock('pages/problem-center/useProblemCenter', () => ({
  useProblemCenter: () => ({ data: { tasks: [] }, isLoading: false, isError: false }),
}));

jest.mock('pages/orders/AddressResolutionSessionModal', () => ({
  AddressResolutionSessionModal: () => <div data-testid="session-modal" />,
}));

jest.mock('pages/orders/useAddressResolutionOrders', () => ({
  useAddressResolutionOrders: (...args: unknown[]) => mockUseAddressResolutionOrders(...args),
  useInvalidateAddressResolutionOrders: () => mockInvalidateAddressResolution,
}));

function setSearchParams(search: string) {
  const params = new URLSearchParams(search);
  mockUseSearchParams.mockReturnValue([params, mockSetSearchParams]);
}

function renderWithConfig(isOpsConsoleOpen: boolean, dispatch: jest.Mock) {
  const state: ConfigProps = { ...defaultConfig, isOpsConsoleOpen };
  return render(
    <ConfigContext.Provider value={{ state, dispatch }}>
      <OverviewPageFT2 />
    </ConfigContext.Provider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  setSearchParams('');
  mockUseMorningBriefSnapshot.mockReturnValue({
    data: {
      signals: [],
      hasUrgentIssues: false,
      generatedAt: '2026-09-11T08:00:00.000Z',
      trustWarning: false,
      greeting: 'Good morning, Milad',
      summaryLine: 'All operations are on track.',
    },
    isPending: false,
    isError: false,
    refreshMorningBrief: mockRefreshMorningBrief,
    isRefreshingBrief: false,
  });
  mockUseAddressResolutionOrders.mockReturnValue({ candidates: [], isLoading: false, isError: false });
});

// ─── 5 — PAGE WIRING: CLOSED CONSOLE ────────────────────────────────────────

describe('UX-OWNERSHIP-01 (5): page wiring — console closed', () => {
  it('invoking onOpenOpsConsole dispatches TOGGLE_OPS_CONSOLE and never navigates to /ops-console', () => {
    const dispatch = jest.fn();
    renderWithConfig(false, dispatch);

    const onOpenOpsConsole = mockOverviewModuleFT2.mock.calls[0][0].onOpenOpsConsole as
      | (() => void)
      | undefined;

    // Load-bearing: the page must expose the callback at all.
    expect(typeof onOpenOpsConsole).toBe('function');

    onOpenOpsConsole?.();

    expect(dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_OPS_CONSOLE' });
    expect(mockNavigate).not.toHaveBeenCalledWith('/ops-console');
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('ops-console'));
  });
});

// ─── 6 — PAGE WIRING: ALREADY OPEN ──────────────────────────────────────────

describe('UX-OWNERSHIP-01 (6): page wiring — console already open (OPEN, not TOGGLE, semantics)', () => {
  it('invoking onOpenOpsConsole while already open does not dispatch', () => {
    const dispatch = jest.fn();
    renderWithConfig(true, dispatch);

    const onOpenOpsConsole = mockOverviewModuleFT2.mock.calls[0][0].onOpenOpsConsole as
      | (() => void)
      | undefined;

    // Load-bearing: same assertion as the closed case, so this test cannot
    // vacuously pass merely because nothing is wired yet.
    expect(typeof onOpenOpsConsole).toBe('function');

    onOpenOpsConsole?.();

    expect(dispatch).not.toHaveBeenCalled();
  });
});
