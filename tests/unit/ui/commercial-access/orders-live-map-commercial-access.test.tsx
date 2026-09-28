// tests/unit/ui/commercial-access/orders-live-map-commercial-access.test.tsx
//
// ORD-UX-01 — Orders live-map commercial access
// =============================================
// Behavioral (jsdom) proof for the /orders Overview map surface.
//
// Proves AUTHORITY, not a claim about the current canonical policy: each
// scenario constructs a deliberate disagreement between the legacy tier and a
// mocked canonical orders.live_map AccessDecision, then asserts the canonical
// decision wins. Mirrors the Overview and Inventory live-map files.
//
// The decision source is mocked at its public boundary (runtime/
// commercialContext's useCommercialAccess), never by re-implementing policy.

import React from 'react';
import { render, screen } from '@testing-library/react';

const mockNavigate = jest.fn();
const mockUseFloorPlanning = jest.fn();
const mockUseOrdersLiveActivity = jest.fn();
const mockUseWmsLiveActivity = jest.fn();

// Exposes what the production page cannot otherwise be observed through:
// whether mapContent was supplied, and whether real decision data still
// reached the module while the map was denied.
const mockOrdersModuleFT2 = jest.fn((props: Record<string, unknown>) => (
  <div>
    <div data-testid="operator-summary-prop">
      {props.operatorSummary ? 'present' : 'missing'}
    </div>
    <div data-testid="map-content">{(props.mapContent as React.ReactNode) ?? null}</div>
  </div>
));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@lasyncro/order-nexus', () => ({
  OrdersModuleFT2: (props: Record<string, unknown>) => mockOrdersModuleFT2(props),
}), { virtual: true });

jest.mock('@lasyncro/shared/ui', () => ({
  IsometricCanvas: () => <div data-testid="live-map" />,
  EntityDetailModal: () => null,
}));

jest.mock('components/ModuleTabBar', () => ({ ModuleTabBar: () => null }));
jest.mock('components/ShippedOrderCapBanner', () => ({ ShippedOrderCapBanner: () => null }));
jest.mock('components/ExportDrawer', () => ({ ExportDrawer: () => null }));
jest.mock('pages/orders/OrderDetailModalBody', () => ({ OrderDetailModalBody: () => null }));

// Legacy tier source — set per test, deliberately disagreeing with the mocked
// canonical decision below.
let mockTier: 'starter' | 'core' | 'growth' | 'scale' = 'growth';
jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    displayCurrency: 'USD',
    locale: 'en-US',
    tier: mockTier,
    hasResolved: true,
  }),
}));

jest.mock('hooks/useExchangeRates', () => ({
  useExchangeRates: () => ({ rates: {} }),
}));

let mockDecide: (capabilityId: string) => {
  allowed: boolean;
  reason: string;
  requiredTier?: string;
};
jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    context: { tier: mockTier, modules: new Set<string>(), flags: new Set<string>() },
    isResolved: true,
    decide: (capabilityId: string) => mockDecide(capabilityId),
  }),
}));

// The enabled argument is captured at these boundaries so the test can prove
// ACQUISITION is gated by the canonical decision — not merely that the rendered
// map slot is hidden.
jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: (enabled?: boolean) => mockUseFloorPlanning(enabled),
}));

jest.mock('pages/wms/useWmsLiveActivity', () => ({
  useOrdersLiveActivity: (enabled?: boolean) => mockUseOrdersLiveActivity(enabled),
  useWmsLiveActivity: (enabled?: boolean) => mockUseWmsLiveActivity(enabled),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useBulkSetPriority: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock('pages/orders/useOrdersFt2Snapshot', () => ({
  useOrdersFt2Snapshot: () => ({
    data: { decision: null, operationalControl: {} },
  }),
}));

jest.mock('pages/orders/useOrdersFt2Adapter', () => ({
  mapOrdersFt2Props: () => ({ orders: { fulfilled: 0 } }),
}));

jest.mock('pages/orders/useOrdersOperatorSummary', () => ({
  useOrdersOperatorSummary: () => ({ data: { constraintCounts: {} } }),
}));

jest.mock('pages/orders/useConstrainedOrders', () => ({
  useConstrainedOrders: () => ({ data: { data: [] } }),
}));

import OrdersFT2Page from 'pages/ft2-pages/OrdersFT2Page';

const ALLOW = { allowed: true, reason: 'ALLOWED' as const };
const DENY_TIER_TOO_LOW = (requiredTier: string) => ({
  allowed: false, reason: 'TIER_TOO_LOW' as const, requiredTier,
});

/** hasPlacedFloor === true — a zone carrying real geometry. */
const PLACED_FLOOR = {
  data: {
    zones: [
      { location_code: 'A-1', type: 'bin', active: true, position_x: 1, position_y: 1, zone_type: 'pick' },
    ],
  },
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};

const NO_LIVE_ACTIVITY = {
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
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseFloorPlanning.mockReturnValue(PLACED_FLOOR);
  mockUseOrdersLiveActivity.mockReturnValue(NO_LIVE_ACTIVITY);
  mockUseWmsLiveActivity.mockReturnValue(NO_LIVE_ACTIVITY);
});

// ===========================================================================
// ORDLM-A — canonical DENY (the Starter/Core shape)
// ===========================================================================
describe('ORDLM-A — canonical orders.live_map DENY wins over a permissive legacy tier', () => {
  it('legacy tier growth, canonical DENY — teaser present, real map absent, floor + Orders live activity acquisition disabled', () => {
    mockTier = 'growth';
    mockDecide = () => DENY_TIER_TOO_LOW('growth');
    render(<OrdersFT2Page />);

    expect(screen.getByTestId('map-content')).not.toBeEmptyDOMElement();
    expect(screen.getByText('Orders live map')).toBeInTheDocument();
    expect(screen.getByText('Available on Growth')).toBeInTheDocument();

    // A denial must stop ACQUIRING premium map data, not merely stop rendering it.
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(false);
    expect(mockUseOrdersLiveActivity).toHaveBeenLastCalledWith(false);

    // Orders must never reach for the Overview-owned live-activity route.
    expect(mockUseWmsLiveActivity).not.toHaveBeenCalled();
  });

  it('legacy tier scale, canonical DENY — same authority requirement', () => {
    mockTier = 'scale';
    mockDecide = () => DENY_TIER_TOO_LOW('growth');
    render(<OrdersFT2Page />);

    expect(screen.getByText('Orders live map')).toBeInTheDocument();
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(false);
    expect(mockUseOrdersLiveActivity).toHaveBeenLastCalledWith(false);
  });

  it('the right rail keeps real Orders decision data while the map is teased', () => {
    mockTier = 'core';
    mockDecide = () => DENY_TIER_TOO_LOW('growth');
    render(<OrdersFT2Page />);

    expect(screen.getByTestId('operator-summary-prop')).toHaveTextContent('present');
  });
});

// ===========================================================================
// ORDLM-B — canonical ALLOW + positioned floor
// ===========================================================================
describe('ORDLM-B — canonical orders.live_map ALLOW wins over a restrictive legacy tier', () => {
  it('legacy tier starter, canonical ALLOW — real IsometricCanvas renders, floor + Orders live activity enabled', () => {
    mockTier = 'starter';
    mockDecide = () => ALLOW;
    render(<OrdersFT2Page />);

    expect(
      screen.getByTestId('map-content').querySelector('[data-testid="live-map"]')
    ).not.toBeNull();
    expect(screen.queryByText('Orders live map')).toBeNull();

    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(true);
    expect(mockUseOrdersLiveActivity).toHaveBeenLastCalledWith(true);
  });

  it('legacy tier core, canonical ALLOW — same authority requirement', () => {
    mockTier = 'core';
    mockDecide = () => ALLOW;
    render(<OrdersFT2Page />);

    expect(
      screen.getByTestId('map-content').querySelector('[data-testid="live-map"]')
    ).not.toBeNull();
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(true);
    expect(mockUseOrdersLiveActivity).toHaveBeenLastCalledWith(true);
  });
});

// ===========================================================================
// ORDLM-C — allowed but no floor mapped
// ===========================================================================
describe('ORDLM-C — allowed with no positioned floor shows setup, never the old dashboard', () => {
  it('renders the map-slot setup state and does not poll activity for a floor that does not exist', () => {
    mockTier = 'growth';
    mockDecide = () => ALLOW;
    mockUseFloorPlanning.mockReturnValue({
      // Bootstrapped root row with no geometry — rows exist, a floor does not.
      data: { zones: [{ location_code: 'WH-1-ROOT', type: 'warehouse', active: true, position_x: null, position_y: null }] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    render(<OrdersFT2Page />);

    expect(screen.getByText('Map your warehouse floor first')).toBeInTheDocument();
    expect(
      screen.getByTestId('map-content').querySelector('[data-testid="live-map"]')
    ).toBeNull();
    // Never the teaser either — this tenant is entitled, just unconfigured.
    expect(screen.queryByText('Orders live map')).toBeNull();

    // Geometry is acquired (that is how we know there is no floor); activity
    // for an undrawable floor is not.
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(true);
    expect(mockUseOrdersLiveActivity).toHaveBeenLastCalledWith(false);
  });
});

// SCREEN-ARCH C2A (TEST-VALUE-02 REWRITE): the stable spatial-slot minimum
// height now follows certified Overview per state — live map 520, no-floor
// teaching state 420 (OverviewFT2Page mapContent) — replacing the
// pre-normalization { xs: 420, lg: 460 } Orders slot.
it('keeps the certified Overview minimum height for the real-map and no-floor slots', () => {
  mockTier = 'growth';
  mockDecide = () => ALLOW;
  const { rerender } = render(<OrdersFT2Page />);

  const realMapSlot = mockOrdersModuleFT2.mock.calls[
    mockOrdersModuleFT2.mock.calls.length - 1
  ][0].mapContent as React.ReactElement<{ sx: { minHeight: unknown } }>;
  expect(realMapSlot.props.sx.minHeight).toBe(520);

  mockUseFloorPlanning.mockReturnValue({
    ...PLACED_FLOOR,
    data: { zones: [] },
  });
  rerender(<OrdersFT2Page />);

  const noFloorSlot = mockOrdersModuleFT2.mock.calls[
    mockOrdersModuleFT2.mock.calls.length - 1
  ][0].mapContent as React.ReactElement<{ sx: { minHeight: unknown } }>;
  expect(noFloorSlot.props.sx.minHeight).toBe(420);
});

// ===========================================================================
// ORDLM-D — denial metadata comes from the AccessDecision, never hardcoded
// ===========================================================================
describe('ORDLM-D — teaser required-tier text derives from AccessDecision', () => {
  it('a deliberate non-growth requiredTier reaches the teaser copy', () => {
    mockTier = 'starter';
    // Deliberately NOT 'growth' — proves the teaser reads the decision rather
    // than assuming the current policy's Growth step.
    mockDecide = () => DENY_TIER_TOO_LOW('scale');
    render(<OrdersFT2Page />);

    expect(screen.getByText('Available on Scale')).toBeInTheDocument();
    expect(screen.queryByText('Available on Growth')).toBeNull();
  });
});
