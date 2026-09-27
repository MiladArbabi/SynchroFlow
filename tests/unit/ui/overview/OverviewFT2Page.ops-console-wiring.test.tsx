// tests/unit/ui/overview/OverviewFT2Page.ops-console-wiring.test.tsx
//
// UX-OWNERSHIP-01 — negative page ownership contract.
// Overview is status-only and must not pass an Ops Console callback to the
// module. Global top-nav Ops Console is the sole entry point.
//
// Mock harness copied from OverviewFT2Page.address-resolution-wiring.test.tsx
// (same module-scope dependency surface for OverviewFT2Page).

import React from 'react';
import { act, render, screen } from '@testing-library/react';

import OverviewPageFT2 from 'pages/ft2-pages/OverviewFT2Page';
import { ConfigProvider } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';

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

describe('UX-OWNERSHIP-01 (5): page owns no Ops Console entry point', () => {
  it('does not pass onOpenOpsConsole to OverviewModuleFT2', () => {
    render(<OverviewPageFT2 />);

    expect(mockOverviewModuleFT2).toHaveBeenCalled();
    for (const [props] of mockOverviewModuleFT2.mock.calls) {
      expect(props).not.toHaveProperty('onOpenOpsConsole');
      expect(props.onOpenOpsConsole).toBeUndefined();
    }
  });
});

// OVERVIEW-SCREEN-OPT-01 (Slice B) — the page reads the shared Ops Console
// state (owned by the topnav trigger) and passes it down as a presentation
// prop. It still owns no Ops Console entry point.
describe('OVERVIEW-SCREEN-OPT-01: Operations Pulse follows shared Ops Console state', () => {
  function SetConsole() {
    const { dispatch } = useConfig();
    return (
      <>
        <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: true })}>open console</button>
        <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: false })}>close console</button>
      </>
    );
  }

  function lastModuleProps(): Record<string, unknown> {
    const calls = mockOverviewModuleFT2.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][0];
  }

  function renderInShell() {
    render(
      <ConfigProvider>
        <SetConsole />
        <OverviewPageFT2 />
      </ConfigProvider>,
    );
  }

  it('shared state false -> suppressOperationsPulse false', () => {
    renderInShell();

    expect(lastModuleProps().suppressOperationsPulse).toBe(false);
  });

  it('shared state true -> suppressOperationsPulse true, and back to false on close', () => {
    renderInShell();

    act(() => { screen.getByText('open console').click(); });
    expect(lastModuleProps().suppressOperationsPulse).toBe(true);
    expect(lastModuleProps()).not.toHaveProperty('onOpenOpsConsole');

    act(() => { screen.getByText('close console').click(); });
    expect(lastModuleProps().suppressOperationsPulse).toBe(false);
  });
});
