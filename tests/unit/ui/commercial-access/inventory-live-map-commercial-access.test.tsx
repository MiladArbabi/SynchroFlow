// tests/unit/ui/commercial-access/inventory-live-map-commercial-access.test.tsx
//
// INV-UX-01 Slice 2B — Inventory live-map commercial access
// =========================================================
// Behavioral (jsdom) proof for the /inventory Intelligence map surface.
//
// Proves AUTHORITY, not a claim about the current canonical policy: each
// scenario constructs a deliberate disagreement between the legacy tier and a
// mocked canonical inventory.live_map AccessDecision, then asserts the
// canonical decision wins. Mirrors
// tests/unit/ui/commercial-access/overview-live-map-commercial-access.test.tsx.
//
// The decision source is mocked at its public boundary (runtime/
// commercialContext's useCommercialAccess) rather than re-implementing
// commercial policy locally.

import React from 'react';
import { render, screen } from '@testing-library/react';

const mockNavigate = jest.fn();
const mockUseFloorPlanning = jest.fn();
const mockUseWarehouseGridOccupancy = jest.fn();

// Exposes what the production page cannot otherwise be observed through:
// whether mapContent was supplied, and whether the authoritative operator
// facts still reached the module while the map was denied.
const mockProductsModuleFT2 = jest.fn((props: Record<string, unknown>) => (
  <div>
    <div data-testid="operator-summary-prop">
      {props.operatorSummary ? 'present' : 'missing'}
    </div>
    <div data-testid="inventory-state-suppressed-prop">
      {String(props.suppressInventoryState)}
    </div>
    <div data-testid="map-content">{(props.mapContent as React.ReactNode) ?? null}</div>
  </div>
));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Routes: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  // Only the "/" Intelligence child is exercised here. Rendering every child
  // route would defeat the point of the boundary under test.
  Route: ({ path, element }: { path: string; element: React.ReactNode }) =>
    path === '/' ? <>{element}</> : null,
  Navigate: () => null,
}));

jest.mock('@lasyncro/products', () => ({
  ProductsModuleFT2: (props: Record<string, unknown>) => mockProductsModuleFT2(props),
}), { virtual: true });

jest.mock('@lasyncro/shared/ui', () => ({
  IsometricCanvas: () => <div data-testid="live-map" />,
}));

jest.mock('components/ModuleTabBar', () => ({
  ModuleTabBar: () => null,
}));

// The inventory.core parent gate is a separate contract; this file is about
// inventory.live_map only, so the gate is transparent here.
jest.mock('components/CommercialGate', () => ({
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('components/ExportDrawer', () => ({
  ExportDrawer: () => null,
}));

jest.mock('pages/ft2-pages/ProductsCatalogPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/ft2-pages/ProductsCostsPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/ft2-pages/ProductsWmsReadinessPage', () => ({ __esModule: true, default: () => null }));

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

// Controlled canonical decision — set per test, mocked at the shared adapter's
// public boundary, never re-deriving tier/module/feature policy locally.
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

// The enabled argument is captured at this boundary so the test can prove
// floor-geometry and occupancy ACQUISITION are gated by the same canonical
// decision — not merely that the rendered map slot is hidden.
jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: (enabled?: boolean) => mockUseFloorPlanning(enabled),
}));

jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGridOccupancy: (enabled?: boolean) => mockUseWarehouseGridOccupancy(enabled),
}));

jest.mock('pages/products/useProductsFt2Snapshot', () => ({
  useProductsFt2Snapshot: () => ({ isSuccess: true, data: {} }),
}));

jest.mock('pages/products/useProductsFt2Adapter', () => ({
  mapProductsFt2Props: () => ({
    context: {
      period: { from: '2026-08-01', to: '2026-08-31' },
      productsObserved: 10,
      variantsObserved: 12,
      productsWithSkuCount: 12,
      productsWithoutSkuCount: 0,
      statusCounts: null,
    },
    dataFreshness: null,
    outcome: null,
    operationalCounts: null,
  }),
}));

jest.mock('pages/products/useProductsOperatorSummary', () => ({
  useProductsOperatorSummary: () => ({
    isSuccess: true,
    data: { sellability: { sellable: 5, blocked: 0, blockedReasons: {} } },
  }),
}));

import ProductsFT2Page from 'pages/ft2-pages/ProductsFT2Page';

const ALLOW = { allowed: true, reason: 'ALLOWED' as const };
const DENY_TIER_TOO_LOW = (requiredTier: string) => ({
  allowed: false, reason: 'TIER_TOO_LOW' as const, requiredTier,
});

/** hasPlacedFloor === true — a zone carrying real geometry. */
const PLACED_FLOOR = {
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
  refetch: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseFloorPlanning.mockReturnValue(PLACED_FLOOR);
  mockUseWarehouseGridOccupancy.mockReturnValue({
    data: { occupancy: {} },
    isLoading: false,
    isError: false,
  });
});

// ===========================================================================
// INVLM-A — canonical DENY (the Core shape): teaser wins, no map acquisition
// ===========================================================================
describe('INVLM-A — canonical inventory.live_map DENY wins over a permissive legacy tier', () => {
  it('legacy tier growth, canonical DENY — real map absent, teaser present, floor + occupancy acquisition disabled', () => {
    mockTier = 'growth';
    mockDecide = () => DENY_TIER_TOO_LOW('growth');
    render(<ProductsFT2Page />);

    const slot = screen.getByTestId('map-content');

    // The teaser draws its own synthetic preview through the same mocked
    // IsometricCanvas, so "no real map" is proven by the absence of real
    // geometry acquisition below, plus the teaser's presence here.
    expect(slot).not.toBeEmptyDOMElement();
    expect(screen.getByText('Inventory live map')).toBeInTheDocument();
    expect(screen.getByText('Available on Growth')).toBeInTheDocument();

    // A denial must stop ACQUIRING floor geometry and occupancy, not merely
    // stop rendering them.
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(false);
    expect(mockUseWarehouseGridOccupancy).toHaveBeenLastCalledWith(false);
  });

  it('legacy tier scale, canonical DENY — same authority requirement', () => {
    mockTier = 'scale';
    mockDecide = () => DENY_TIER_TOO_LOW('growth');
    render(<ProductsFT2Page />);

    expect(screen.getByText('Inventory live map')).toBeInTheDocument();
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(false);
    expect(mockUseWarehouseGridOccupancy).toHaveBeenLastCalledWith(false);
  });

  it('the right rail keeps real inventory facts while the map is teased', () => {
    mockTier = 'core';
    mockDecide = () => DENY_TIER_TOO_LOW('growth');
    render(<ProductsFT2Page />);

    // Target rail is Inventory state (not Inventory Pulse / decisions): the
    // authoritative facts still reach the module, and a commercial denial of
    // the map does not withdraw the Inventory state rail — only the shared
    // Ops Console does (default shared state here is closed).
    expect(screen.getByTestId('operator-summary-prop')).toHaveTextContent('present');
    expect(screen.getByTestId('inventory-state-suppressed-prop')).toHaveTextContent('false');
  });
});

// ===========================================================================
// INVLM-B — canonical ALLOW + positioned floor: real map, acquisition enabled
// ===========================================================================
describe('INVLM-B — canonical inventory.live_map ALLOW wins over a restrictive legacy tier', () => {
  it('legacy tier starter, canonical ALLOW — real IsometricCanvas renders, floor + occupancy acquisition enabled', () => {
    mockTier = 'starter';
    mockDecide = () => ALLOW;
    render(<ProductsFT2Page />);

    expect(
      screen.getByTestId('map-content').querySelector('[data-testid="live-map"]')
    ).not.toBeNull();
    expect(screen.queryByText('Inventory live map')).toBeNull();

    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(true);
    expect(mockUseWarehouseGridOccupancy).toHaveBeenLastCalledWith(true);
  });

  it('legacy tier core, canonical ALLOW — same authority requirement', () => {
    mockTier = 'core';
    mockDecide = () => ALLOW;
    render(<ProductsFT2Page />);

    expect(
      screen.getByTestId('map-content').querySelector('[data-testid="live-map"]')
    ).not.toBeNull();
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(true);
    expect(mockUseWarehouseGridOccupancy).toHaveBeenLastCalledWith(true);
  });

  it('allowed but no floor mapped — setup state, never the old dashboard; occupancy stays unacquired', () => {
    mockTier = 'growth';
    mockDecide = () => ALLOW;
    mockUseFloorPlanning.mockReturnValue({
      // Bootstrapped root row with no geometry — rows exist, floor does not.
      data: { zones: [{ location_code: 'WH-1-ROOT', type: 'warehouse', active: true, position_x: null, position_y: null }] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    render(<ProductsFT2Page />);

    expect(screen.getByText('Map your warehouse floor first')).toBeInTheDocument();
    expect(
      screen.getByTestId('map-content').querySelector('[data-testid="live-map"]')
    ).toBeNull();

    // Geometry is still acquired (that is how we know there is no floor), but
    // occupancy for a floor that does not exist must not be fetched.
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(true);
    expect(mockUseWarehouseGridOccupancy).toHaveBeenLastCalledWith(false);
  });
});

// ===========================================================================
// GH1176 — a positioned warehouse root alone is not an operational floor
// ===========================================================================
describe('GH1176 — warehouse root at (0,0) with no positioned operational location', () => {
  it('GH1176: stays in the no-floor setup state and does not acquire occupancy', () => {
    mockTier = 'growth';
    mockDecide = () => ALLOW;
    mockUseFloorPlanning.mockReturnValue({
      // Root boundary persisted at the origin; no non-root location is placed.
      data: {
        zones: [
          { location_code: 'WH-1-ROOT', type: 'warehouse', active: true, position_x: 0, position_y: 0, width: 20, depth: 15 },
          { location_code: 'A-1', type: 'bin', active: true, position_x: null, position_y: null, zone_type: 'pick' },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    render(<ProductsFT2Page />);

    expect(screen.getByText('Map your warehouse floor first')).toBeInTheDocument();
    expect(
      screen.getByTestId('map-content').querySelector('[data-testid="live-map"]')
    ).toBeNull();
    expect(mockUseFloorPlanning).toHaveBeenLastCalledWith(true);
    expect(mockUseWarehouseGridOccupancy).toHaveBeenLastCalledWith(false);
  });
});

// ===========================================================================
// INVLM-C — denial metadata comes from the AccessDecision, never hardcoded
// ===========================================================================
describe('INVLM-C — teaser required-tier text derives from AccessDecision', () => {
  it('a deliberate non-growth requiredTier reaches the teaser copy', () => {
    mockTier = 'starter';
    // Deliberately NOT 'growth' — proves the teaser reads this from the
    // decision rather than assuming the current policy's Growth step.
    mockDecide = () => DENY_TIER_TOO_LOW('scale');
    render(<ProductsFT2Page />);

    expect(screen.getByText('Available on Scale')).toBeInTheDocument();
    expect(screen.queryByText('Available on Growth')).toBeNull();
  });
});
