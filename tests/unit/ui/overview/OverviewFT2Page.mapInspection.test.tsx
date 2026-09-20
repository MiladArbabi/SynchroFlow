import React from 'react';
import { act, render, screen } from '@testing-library/react';

import OverviewPageFT2, { overviewLocationPulseTitle } from 'pages/ft2-pages/OverviewFT2Page';

const mockUseSearchParams = jest.fn();
const mockSetSearchParams = jest.fn();
const mockUseAddressResolutionOrders = jest.fn();
const mockIsometricCanvas = jest.fn((_props: Record<string, unknown>) => (
  <div data-testid="live-map" />
));
const mockNavigate = jest.fn();
const mockUseMorningBriefSnapshot = jest.fn();
const mockOverviewModuleFT2 = jest.fn((props: Record<string, unknown>) => (
  <div>{props.mapContent as React.ReactNode}</div>
));

let mockFloorZones: unknown[] = [];
let mockProblemTasks: unknown[] = [];
let mockOrderPoolData: unknown = {
  eligible_order_count: 3,
  summary: { blocked_count: 2 },
};
let mockLiveActivityData: unknown = {
  pickerPositions: [],
  activeBatches: [],
  stowPressure: { by_location: [] },
  receiveAtDock: [],
  awaitingPackUnits: 0,
  shippedToday: 1,
  packedNotShipped: 1,
  staleThresholdMinutes: 15,
};

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

jest.mock('analytics/useUiEvents', () => ({
  useUiEvents: () => ({ emit: jest.fn() }),
}), { virtual: true });

jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
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
  useEntitlements: () => ({ displayCurrency: 'USD' }),
}));

jest.mock('pages/overview/useOverviewFt2Adapter', () => ({
  mapOverviewFt2Props: () => ({}),
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

jest.mock('pages/overview/ProfileCompletionBanner', () => ({
  ProfileCompletionBanner: () => null,
}));

jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: () => ({
    data: { zones: mockFloorZones },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGridOccupancy: () => ({
    data: { occupancy: { 'A-1': { on_hand_quantity: 4 }, 'B-1': { on_hand_quantity: 2 } } },
    isLoading: false,
    isError: false,
  }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useOrderPool: () => ({
    data: mockOrderPoolData,
    isPending: false,
    isError: false,
  }),
}));

jest.mock('pages/wms/useWmsLiveActivity', () => ({
  useWmsLiveActivity: () => ({
    data: mockLiveActivityData,
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
    data: { tasks: mockProblemTasks },
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

function setSearchParams(search: string) {
  mockUseSearchParams.mockReturnValue([new URLSearchParams(search), mockSetSearchParams]);
}

function bin(location_code: string, zone_type: string | null = 'pick') {
  return {
    location_code,
    type: 'bin',
    active: true,
    position_x: 1,
    position_y: 1,
    width: 1,
    depth: 0.5,
    zone_type,
  };
}

const BRIEF = {
  signals: [],
  hasUrgentIssues: false,
  generatedAt: '2026-09-11T08:00:00.000Z',
  trustWarning: false,
  greeting: 'Good morning, Milad',
  summaryLine: 'All clear',
};

beforeEach(() => {
  jest.clearAllMocks();
  setSearchParams('');
  mockFloorZones = [bin('A-1'), bin('B-1'), bin('PROBLEM', 'problem')];
  mockProblemTasks = [{ problem_bin_location: 'A-1' }, { problem_bin_location: 'PROBLEM' }];
  mockOrderPoolData = {
    eligible_order_count: 3,
    summary: { blocked_count: 2 },
  };
  mockLiveActivityData = {
    pickerPositions: [],
    activeBatches: [],
    stowPressure: { by_location: [] },
    receiveAtDock: [],
    awaitingPackUnits: 0,
    shippedToday: 1,
    packedNotShipped: 1,
    staleThresholdMinutes: 15,
  };
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

function renderMapContent() {
  return render(<OverviewPageFT2 />);
}

function latestCanvasProps(): Record<string, unknown> {
  expect(mockIsometricCanvas).toHaveBeenCalled();
  return mockIsometricCanvas.mock.calls[mockIsometricCanvas.mock.calls.length - 1][0];
}

describe('overviewLocationPulseTitle', () => {
  it('normalizes duplicate code and zone type case-insensitively', () => {
    expect(overviewLocationPulseTitle('PROBLEM', 'problem')).toBe('PROBLEM');
  });

  it('retains distinct code and zone type', () => {
    expect(overviewLocationPulseTitle('A-1', 'pick')).toBe('A-1 · PICK');
  });
});

describe('Overview map inspection', () => {
  it('wires physical selection state and Problem Center pinned action without rendering a split panel', () => {
    renderMapContent();
    const props = latestCanvasProps();
    act(() => {
      (props.onSelect as (locationCode: string | null) => void)('A-1');
    });

    const nextProps = latestCanvasProps();
    expect(nextProps.selectedLocationCode).toBe('A-1');
    expect(nextProps.selectedStationId).toBeNull();
    expect(nextProps.pinnedAction).toMatchObject({ label: 'Open Problem Center →' });
    expect(screen.queryByTestId('overview-map-inspection')).not.toBeInTheDocument();
  });

  it('deselection clears selected props and selecting another zone replaces them', () => {
    renderMapContent();
    const props = latestCanvasProps();
    act(() => {
      (props.onSelect as (locationCode: string | null) => void)('A-1');
    });
    expect(latestCanvasProps().selectedLocationCode).toBe('A-1');

    act(() => {
      (props.onSelect as (locationCode: string | null) => void)('B-1');
    });
    expect(latestCanvasProps().selectedLocationCode).toBe('B-1');

    act(() => {
      (props.onSelect as (locationCode: string | null) => void)(null);
    });
    expect(latestCanvasProps().selectedLocationCode).toBeNull();
    expect(latestCanvasProps().pinnedAction).toBeNull();
  });

  it('physical problem CTA navigates exactly to /problem-center and click selection itself does not navigate', () => {
    renderMapContent();
    const props = latestCanvasProps();
    act(() => {
      (props.onSelect as (locationCode: string | null) => void)('A-1');
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    (latestCanvasProps().pinnedAction as { onClick: () => void }).onClick();
    expect(mockNavigate).toHaveBeenCalledWith('/problem-center');
  });

  it('physical location without problems has no fabricated workflow CTA', () => {
    mockProblemTasks = [];
    renderMapContent();
    const props = latestCanvasProps();
    act(() => {
      (props.onSelect as (locationCode: string | null) => void)('B-1');
    });

    expect(latestCanvasProps().selectedLocationCode).toBe('B-1');
    expect(latestCanvasProps().pinnedAction).toBeNull();
  });

  it.each(['blocked', 'pool'])('%s station click opens inspection and order-flow CTA without immediate navigation', (stationId) => {
    renderMapContent();
    const props = latestCanvasProps();
    act(() => {
      (props.onStationSelect as (stationId: string | null) => void)(stationId);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(latestCanvasProps().pinnedAction).toMatchObject({ label: 'Open order flow →' });
    (latestCanvasProps().pinnedAction as { onClick: () => void }).onClick();
    expect(mockNavigate).toHaveBeenCalledWith('/orders/flow');
  });

  it('close clears inspection state', () => {
    renderMapContent();
    const props = latestCanvasProps();
    act(() => {
      (props.onSelect as (locationCode: string | null) => void)('A-1');
    });
    act(() => {
      (latestCanvasProps().onPinnedClose as () => void)();
    });
    expect(latestCanvasProps().selectedLocationCode).toBeNull();
  });
});
