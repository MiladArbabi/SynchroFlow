// tests/unit/ui/overview/OverviewFT2Page.address-resolution-wiring.test.tsx
//
// OPS-RESOLVE-01 Slice C — OVERVIEW ORCHESTRATION WIRING.
//
// Protects the four things that can silently break between the morning brief,
// the Overview page and the Address Resolution Session:
//   A  the customer signal's destination is the session intent, not
//      /orders/flow?constraint=customer
//   B  ?resolution=address opens the session with the AUTHORITATIVE candidates
//   C  closing clears the intent and refreshes authoritative queries
//   D  every other signal's navigation is untouched
//
// SEAM: the page's prop/orchestration boundary. This reuses the mock set
// established by OverviewFT2Page.refresh-boundary.test.tsx verbatim (module
// package mocked, so the full Overview UI and the shared-ui barrel are never
// imported), plus mocks for useSearchParams and the Slice C candidate hook.
// AddressResolutionSessionModal is mocked to a prop probe: its internal
// OPEN/RECHECKING/FIXED machine and row rendering are already covered by
// AddressResolutionSessionModal.session-state.test.tsx and are NOT retested.

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import OverviewPageFT2 from 'pages/ft2-pages/OverviewFT2Page';

const mockUseSearchParams = jest.fn();
const mockSetSearchParams = jest.fn();
const mockUseAddressResolutionOrders = jest.fn();
const mockInvalidateAddressResolution = jest.fn();
const mockSessionModal = jest.fn((props: Record<string, unknown>) => (
  <div data-testid="session-modal">
    <div data-testid="session-open">{props.open ? 'open' : 'closed'}</div>
    <div data-testid="session-orders">
      {JSON.stringify((props.orders as unknown[]) ?? [])}
    </div>
    <button type="button" aria-label="close session" onClick={props.onClose as () => void}>
      close
    </button>
  </div>
));

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

// GH-1179: preserve this operational page fixture's mature onboarding state.
jest.mock('hooks/useActivationChecklist', () => ({
  useActivationChecklist: () => ({ firstEntry: false, externalLocationMapped: true }),
}));

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

// OverviewFT2Page imports these at module scope; canonical mock shapes copied
// from tests/unit/ui/commercial-access/overview-live-map-commercial-access.test.tsx.
jest.mock('analytics/useUiEvents', () => ({
  useUiEvents: () => ({ emit: jest.fn() }),
}), { virtual: true });

// The live-map gate is a separate contract; transparent here so this file stays
// about address-session wiring only.
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


jest.mock('pages/orders/AddressResolutionSessionModal', () => ({
  AddressResolutionSessionModal: (props: Record<string, unknown>) => mockSessionModal(props),
}));

jest.mock('pages/orders/useAddressResolutionOrders', () => ({
  useAddressResolutionOrders: (...args: unknown[]) => mockUseAddressResolutionOrders(...args),
  useInvalidateAddressResolutionOrders: () => mockInvalidateAddressResolution,
}));

/** Authoritative candidates exactly as the Slice C hook maps them. */
const CANDIDATES = [
  { lasyncroOrderId: 'order-aaa', orderNumber: '#1001' },
  { lasyncroOrderId: 'order-bbb', orderNumber: '#1002' },
];

const BRIEF = {
  signals: [
    {
      id: 'customer',
      priority: 2 as const,
      title: '2 orders with address issues',
      detail: 'Address problems are blocking fulfillment.',
      module: 'overview',
      // The destination the backend resolver now emits for this signal.
      deepLink: '/overview?resolution=address',
      revenueImpact: 120,
      alertType: 'customer',
      actionLabel: 'Fix addresses',
    },
    {
      id: 'sla',
      priority: 1 as const,
      title: '8 orders past SLA',
      detail: 'These orders missed their window.',
      module: 'order-nexus',
      deepLink: '/orders/flow?urgency=sla_breach',
      revenueImpact: 900,
      alertType: 'sla_breach',
      actionLabel: 'Fulfil orders',
    },
  ],
  hasUrgentIssues: true,
  generatedAt: '2026-09-11T08:00:00.000Z',
  trustWarning: false,
  greeting: 'Good morning, Milad',
  summaryLine: '2 issues need your attention',
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
    refreshMorningBrief: mockRefreshMorningBrief,
    isRefreshingBrief: false,
  });
  mockUseAddressResolutionOrders.mockReturnValue({
    candidates: CANDIDATES,
    isLoading: false,
    isError: false,
  });
});

// ─── A — SIGNAL DESTINATION ──────────────────────────────────────────────────

describe('customer signal destination', () => {
  it('navigates to the Overview address-session intent, not the Blocked Orders group', () => {
    render(<OverviewPageFT2 />);

    const onNavigate = mockOverviewModuleFT2.mock.calls[0][0].onNavigate as (d: string) => void;
    onNavigate('/overview?resolution=address');

    expect(mockNavigate).toHaveBeenCalledWith('/overview?resolution=address');
    expect(mockNavigate).not.toHaveBeenCalledWith('/orders/flow?constraint=customer');
  });

  it('is the destination the morning brief actually supplies for alertType customer', () => {
    render(<OverviewPageFT2 />);

    const brief = mockOverviewModuleFT2.mock.calls[0][0].morningBrief as typeof BRIEF;
    const customer = brief.signals.find((s) => s.alertType === 'customer')!;

    expect(customer.deepLink).toBe('/overview?resolution=address');
    expect(customer.deepLink).not.toMatch(/\/orders\/flow/);
    // The label the merchant reads is unchanged.
    expect(customer.actionLabel).toBe('Fix addresses');
  });
});

// ─── D — EVERY OTHER SIGNAL UNCHANGED ────────────────────────────────────────

describe('non-address navigation', () => {
  it('still passes other signals straight through to the router', () => {
    render(<OverviewPageFT2 />);

    const onNavigate = mockOverviewModuleFT2.mock.calls[0][0].onNavigate as (d: string) => void;
    onNavigate('/orders/flow?urgency=sla_breach');
    expect(mockNavigate).toHaveBeenCalledWith('/orders/flow?urgency=sla_breach');

    // A non-address signal must not open the session or fetch candidates.
    expect(screen.queryByTestId('session-modal')).not.toBeInTheDocument();
    expect(mockUseAddressResolutionOrders).toHaveBeenCalledWith(false);
  });

  it('does not open the session for an unrelated resolution value', () => {
    setSearchParams('?resolution=something-else');
    render(<OverviewPageFT2 />);

    expect(screen.queryByTestId('session-modal')).not.toBeInTheDocument();
    expect(mockUseAddressResolutionOrders).toHaveBeenCalledWith(false);
  });
});

// ─── B — INTENT OPENS THE SESSION WITH AUTHORITATIVE CANDIDATES ──────────────

describe('address-resolution intent', () => {
  it('opens the session and passes the authoritative candidates through', () => {
    setSearchParams('?resolution=address');
    render(<OverviewPageFT2 />);

    expect(screen.getByTestId('session-open')).toHaveTextContent('open');
    expect(JSON.parse(screen.getByTestId('session-orders').textContent!)).toEqual(CANDIDATES);
    // The candidate query is enabled only under the intent.
    expect(mockUseAddressResolutionOrders).toHaveBeenCalledWith(true);
  });

  it('renders a truthful state instead of an empty workspace when the read fails', () => {
    setSearchParams('?resolution=address');
    mockUseAddressResolutionOrders.mockReturnValue({
      candidates: [], isLoading: false, isError: true,
    });
    render(<OverviewPageFT2 />);

    expect(screen.getByText('Address issues unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('session-modal')).not.toBeInTheDocument();
  });

  it('opens the session with zero candidates rather than fabricating rows', () => {
    setSearchParams('?resolution=address');
    mockUseAddressResolutionOrders.mockReturnValue({
      candidates: [], isLoading: false, isError: false,
    });
    render(<OverviewPageFT2 />);

    // The modal owns the truthful empty copy; no Fixed row is invented here.
    expect(screen.getByTestId('session-open')).toHaveTextContent('open');
    expect(JSON.parse(screen.getByTestId('session-orders').textContent!)).toEqual([]);
  });
});

// ─── C — CLOSE CLEARS INTENT AND REFRESHES AUTHORITATIVE QUERIES ─────────────

describe('closing the session', () => {
  it('drops the URL intent and refreshes authoritative sources instead of patching locally', () => {
    setSearchParams('?resolution=address');
    render(<OverviewPageFT2 />);

    fireEvent.click(screen.getByRole('button', { name: 'close session' }));

    // Intent removed via normal router semantics, so Back still behaves.
    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const [nextParams, options] = mockSetSearchParams.mock.calls[0];
    expect((nextParams as URLSearchParams).get('resolution')).toBeNull();
    expect(options).toEqual({ replace: true });

    // Authoritative refresh, using the page's EXISTING brief mechanism.
    expect(mockInvalidateAddressResolution).toHaveBeenCalledTimes(1);
    expect(mockRefreshMorningBrief).toHaveBeenCalledTimes(1);
  });

  it('preserves other query params when clearing the intent', () => {
    setSearchParams('?resolution=address&range=30d');
    render(<OverviewPageFT2 />);

    fireEvent.click(screen.getByRole('button', { name: 'close session' }));

    const [nextParams] = mockSetSearchParams.mock.calls[0];
    expect((nextParams as URLSearchParams).get('resolution')).toBeNull();
    expect((nextParams as URLSearchParams).get('range')).toBe('30d');
  });
});
