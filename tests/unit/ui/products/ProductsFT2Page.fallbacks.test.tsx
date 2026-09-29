// tests/unit/ui/products/ProductsFT2Page.fallbacks.test.tsx
//
// INVENTORY INTELLIGENCE RED-D — Inventory page fallback state machine.
//
// Each data source fails or waits in its own scope; none masquerades as
// another state, and none takes down independent Inventory surfaces.
//
//   floor loading    → "Checking your floor…"            (never the no-floor setup)
//   floor error      → "Warehouse map unavailable" + Retry → floorPlanning.refetch()
//   floor success,   → "Map your warehouse floor first"  (existing setup state)
//     no floor
//   occupancy loading→ geometry stays; "Loading inventory locations…"; nothing
//                      fabricated as known / inspectable / plated
//   occupancy error  → geometry stays; "Inventory locations unavailable" + Retry
//                      → occupancyQuery.refetch(); nothing fabricated
//   summary loading  → module inventoryStateStatus = 'loading'; page not replaced
//   summary error    → module inventoryStateStatus = 'error';
//                      onRetryInventoryState → operatorQuery.refetch(); no zeros
//   snapshot loading → the Inventory view stays mounted (no whole-page
//     / error          "Loading product insights…")
//
// Commercial access is resolved and ALLOWED throughout; commercial denial and
// successful no-floor remain owned by inventory-live-map-commercial-access.

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mockNavigate = jest.fn();
const mockCanvas = jest.fn();
const mockModule = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Routes: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Route: ({ path, element }: { path: string; element: React.ReactNode }) =>
    path === '/' ? <>{element}</> : null,
  Navigate: () => null,
}));

jest.mock('@lasyncro/products', () => ({
  ProductsModuleFT2: (props: Record<string, unknown>) => {
    mockModule(props);
    return <div data-testid="products-module-ft2">{props.mapContent as React.ReactNode}</div>;
  },
}), { virtual: true });

jest.mock('@lasyncro/shared/ui', () => ({
  __esModule: true,
  IsometricCanvas: (props: Record<string, unknown>) => {
    mockCanvas(props);
    return <div data-testid="isometric-canvas" />;
  },
}));

jest.mock('components/ModuleTabBar', () => ({ ModuleTabBar: () => null }));
jest.mock('components/CommercialGate', () => ({
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('components/ExportDrawer', () => ({ ExportDrawer: () => null }));
jest.mock('pages/ft2-pages/ProductsCatalogPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/ft2-pages/ProductsCostsPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/ft2-pages/ProductsWmsReadinessPage', () => ({ __esModule: true, default: () => null }));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({ displayCurrency: 'USD', locale: 'en-US', tier: 'growth', hasResolved: true }),
}));
jest.mock('hooks/useExchangeRates', () => ({ useExchangeRates: () => ({ rates: {} }) }));

jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    context: { tier: 'growth', modules: new Set<string>(), flags: new Set<string>() },
    isResolved: true,
    decide: () => ({ allowed: true, reason: 'ALLOWED' }),
  }),
}));

const mockPlacedZones = [
  {
    location_code: 'WH-1-ROOT', type: 'warehouse', parent_location_code: null, barcode: null,
    active: true, children_count: 1, position_x: 0, position_y: 0, width: 20, depth: 10,
    orientation: 0, rack_levels: 1, zone_type: null, last_printed_at: null, warehouse_name: 'Main',
  },
  {
    location_code: 'A-01', type: 'bin', parent_location_code: 'WH-1-ROOT', barcode: null,
    active: true, children_count: 0, position_x: 1, position_y: 1, width: 1, depth: 0.5,
    orientation: 0, rack_levels: 1, zone_type: 'pick', last_printed_at: null, warehouse_name: null,
  },
];

const mockFloorRefetch = jest.fn();
const mockOccupancyRefetch = jest.fn();
const mockOperatorRefetch = jest.fn();
const mockSnapshotRefetch = jest.fn();

let mockFloorState: Record<string, unknown>;
let mockOccupancyState: Record<string, unknown>;
let mockOperatorState: Record<string, unknown>;
let mockSnapshotState: Record<string, unknown>;

jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: () => mockFloorState,
}));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGridOccupancy: () => mockOccupancyState,
}));
jest.mock('pages/products/useProductsOperatorSummary', () => ({
  useProductsOperatorSummary: () => mockOperatorState,
}));
jest.mock('pages/products/useProductsFt2Snapshot', () => ({
  useProductsFt2Snapshot: () => mockSnapshotState,
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

import ProductsFT2Page from 'pages/ft2-pages/ProductsFT2Page';

const SETUP_COPY = 'Map your warehouse floor first';
const SNAPSHOT_LOADING_COPY = 'Loading product insights…';

const FLOOR_READY = () => ({
  data: { zones: mockPlacedZones }, isLoading: false, isError: false, refetch: mockFloorRefetch,
});
const OCCUPANCY_READY = () => ({
  data: {
    occupancy: { 'A-01': { on_hand_quantity: 4, variants: [] } },
    inventoryInspection: {
      'A-01': {
        on_hand_quantity: 4, available_quantity: 4, reserved_quantity: 0,
        variants: [{
          lasyncro_variant_id: 'v-1', sku: 'SKU-1', product_title: 'P', variant_title: 'V',
          on_hand_quantity: 4, available_quantity: 4, reserved_quantity: 0,
        }],
      },
    },
  },
  isLoading: false, isPending: false, isError: false, isSuccess: true, refetch: mockOccupancyRefetch,
});
const OPERATOR_READY = () => ({
  data: {
    sellability: { sellable: 5, blocked: 0, blockedReasons: { noSku: 0, noInventory: 0, zeroStock: 0, phantom: 0 } },
    inventoryState: {
      onHandUnits: 4, availableUnits: 4, reservedUnits: 0, noValidPickLocationCount: 0, hasInventoryTruth: true,
    },
  },
  isLoading: false, isPending: false, isError: false, isSuccess: true, refetch: mockOperatorRefetch,
});
const SNAPSHOT_READY = () => ({
  data: {}, isLoading: false, isPending: false, isError: false, isSuccess: true, refetch: mockSnapshotRefetch,
});

function lastModuleProps(): Record<string, any> {
  expect(mockModule).toHaveBeenCalled();
  return mockModule.mock.calls[mockModule.mock.calls.length - 1][0];
}

function lastCanvasProps(): Record<string, any> {
  expect(mockCanvas).toHaveBeenCalled();
  return mockCanvas.mock.calls[mockCanvas.mock.calls.length - 1][0];
}

/** No occupancy fact is fabricated for the canvas while occupancy is not ready. */
function expectNoFabricatedInspection() {
  const props = lastCanvasProps();
  const size = (value: unknown) => (value instanceof Set ? value.size : 0);
  expect(size(props.knownOccupancyLocationCodes)).toBe(0);
  expect(size(props.inspectableLocationCodes)).toBe(0);
  expect(Object.keys(props.locationPulseByCode ?? {})).toHaveLength(0);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFloorState = FLOOR_READY();
  mockOccupancyState = OCCUPANCY_READY();
  mockOperatorState = OPERATOR_READY();
  mockSnapshotState = SNAPSHOT_READY();
});

describe('Inventory fallbacks — floor geometry', () => {
  it('A. floor LOADING shows "Checking your floor…", never the no-floor setup state', () => {
    mockFloorState = { data: undefined, isLoading: true, isError: false, refetch: mockFloorRefetch };
    render(<ProductsFT2Page />);

    expect(screen.getByText('Checking your floor…')).toBeInTheDocument();
    expect(screen.queryByText(SETUP_COPY)).toBeNull();
    expect(screen.queryByText('Map the floor')).toBeNull();
  });

  it('B. floor ERROR shows "Warehouse map unavailable" with Retry → floorPlanning.refetch()', () => {
    mockFloorState = { data: undefined, isLoading: false, isError: true, refetch: mockFloorRefetch };
    render(<ProductsFT2Page />);

    expect(screen.getByText('Warehouse map unavailable')).toBeInTheDocument();
    expect(screen.queryByText(SETUP_COPY)).toBeNull();

    act(() => { fireEvent.click(screen.getByRole('button', { name: /retry/i })); });
    expect(mockFloorRefetch).toHaveBeenCalledTimes(1);
  });

  it('C. floor SUCCESS with no operational floor keeps the existing setup state', () => {
    mockFloorState = { data: { zones: [] }, isLoading: false, isError: false, refetch: mockFloorRefetch };
    render(<ProductsFT2Page />);

    expect(screen.getByText(SETUP_COPY)).toBeInTheDocument();
    expect(screen.queryByText('Checking your floor…')).toBeNull();
    expect(screen.queryByText('Warehouse map unavailable')).toBeNull();
  });
});

describe('Inventory fallbacks — inventory locations (occupancy)', () => {
  it('D. occupancy LOADING keeps geometry, says "Loading inventory locations…", fabricates nothing', () => {
    mockOccupancyState = {
      data: undefined, isLoading: true, isPending: true, isError: false, isSuccess: false, refetch: mockOccupancyRefetch,
    };
    render(<ProductsFT2Page />);

    expect(screen.getByTestId('isometric-canvas')).toBeInTheDocument();
    expect(lastCanvasProps().zones).toBe(mockPlacedZones);
    expectNoFabricatedInspection();
    expect(screen.getByText('Loading inventory locations…')).toBeInTheDocument();
    expect(screen.queryByText(SETUP_COPY)).toBeNull();
  });

  it('E. occupancy ERROR keeps geometry, says "Inventory locations unavailable", Retry → occupancyQuery.refetch()', () => {
    mockOccupancyState = {
      data: undefined, isLoading: false, isPending: false, isError: true, isSuccess: false, refetch: mockOccupancyRefetch,
    };
    render(<ProductsFT2Page />);

    expect(screen.getByTestId('isometric-canvas')).toBeInTheDocument();
    expectNoFabricatedInspection();
    expect(screen.getByText('Inventory locations unavailable')).toBeInTheDocument();
    expect(screen.queryByText(SETUP_COPY)).toBeNull();

    act(() => { fireEvent.click(screen.getByRole('button', { name: /retry/i })); });
    expect(mockOccupancyRefetch).toHaveBeenCalledTimes(1);
  });
});

describe('Inventory fallbacks — Inventory state (operator summary)', () => {
  it('control: a successful summary gives inventoryStateStatus = ready', () => {
    render(<ProductsFT2Page />);

    expect(lastModuleProps().inventoryStateStatus).toBe('ready');
  });

  it('F. summary LOADING → status loading; the page is not replaced and the map stays', () => {
    mockOperatorState = {
      data: undefined, isLoading: true, isPending: true, isError: false, isSuccess: false, refetch: mockOperatorRefetch,
    };
    render(<ProductsFT2Page />);

    expect(lastModuleProps().inventoryStateStatus).toBe('loading');
    expect(screen.getByTestId('isometric-canvas')).toBeInTheDocument();
    expect(screen.queryByText(SNAPSHOT_LOADING_COPY)).toBeNull();
  });

  it('G. summary ERROR → status error, Retry → operatorQuery.refetch(), no fabricated zeros', () => {
    mockOperatorState = {
      data: undefined, isLoading: false, isPending: false, isError: true, isSuccess: false, refetch: mockOperatorRefetch,
    };
    render(<ProductsFT2Page />);

    const props = lastModuleProps();
    expect(props.inventoryStateStatus).toBe('error');
    expect(screen.getByTestId('isometric-canvas')).toBeInTheDocument();

    expect(typeof props.onRetryInventoryState).toBe('function');
    act(() => { props.onRetryInventoryState(); });
    expect(mockOperatorRefetch).toHaveBeenCalledTimes(1);

    for (const key of ['onHandUnits', 'availableUnits', 'reservedUnits', 'notReceivedCount', 'phantomCount', 'noValidPickLocationCount']) {
      expect(props.inventoryState[key]).toBeNull();
    }
    expect(props.inventoryState.hasInventoryTruth ?? null).toBeNull();
  });
});

describe('Inventory fallbacks — FT2 snapshot never takes down independent surfaces', () => {
  it('H. snapshot LOADING: the Inventory view stays mounted, no whole-page loading copy', () => {
    mockSnapshotState = {
      data: undefined, isLoading: true, isPending: true, isError: false, isSuccess: false, refetch: mockSnapshotRefetch,
    };
    render(<ProductsFT2Page />);

    expect(screen.queryByText(SNAPSHOT_LOADING_COPY)).toBeNull();
    expect(screen.getByTestId('products-module-ft2')).toBeInTheDocument();
    expect(screen.getByTestId('isometric-canvas')).toBeInTheDocument();
  });

  it('I. snapshot ERROR: the Inventory view stays mounted, no permanent loading copy', () => {
    mockSnapshotState = {
      data: undefined, isLoading: false, isPending: false, isError: true, isSuccess: false, refetch: mockSnapshotRefetch,
    };
    render(<ProductsFT2Page />);

    expect(screen.queryByText(SNAPSHOT_LOADING_COPY)).toBeNull();
    expect(screen.getByTestId('products-module-ft2')).toBeInTheDocument();
    expect(screen.getByTestId('isometric-canvas')).toBeInTheDocument();
    expect(lastModuleProps().inventoryState).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// RED-E — the inventory-location status overlay is anchored TOP-RIGHT, away
// from the shared canvas's top-left unplaced-zone badge. Structural style
// contract only; browser certification measures the real rectangles.
// ---------------------------------------------------------------------------

function statusOverlayFor(copy: string): HTMLElement {
  const overlay = screen.getByText(copy).closest('[role="status"]') as HTMLElement | null;
  expect(overlay).not.toBeNull();
  return overlay!;
}

function expectTopRightOverlayOverMap(overlay: HTMLElement) {
  const cs = window.getComputedStyle(overlay);
  expect(cs.getPropertyValue('position')).toBe('absolute');
  expect(['', 'auto']).not.toContain(cs.getPropertyValue('top'));
  expect(['', 'auto']).not.toContain(cs.getPropertyValue('right'));
  expect(['', 'auto']).toContain(cs.getPropertyValue('left'));

  // An overlay inside the map box, alongside — not replacing — the geometry.
  const mapBox = overlay.parentElement!;
  expect(mapBox.contains(screen.getByTestId('isometric-canvas'))).toBe(true);
}

describe('Inventory fallbacks — inventory-location status overlay position', () => {
  it('occupancy LOADING overlay is anchored top-right over the kept map', () => {
    mockOccupancyState = {
      data: undefined, isLoading: true, isPending: true, isError: false, isSuccess: false, refetch: mockOccupancyRefetch,
    };
    render(<ProductsFT2Page />);

    expectTopRightOverlayOverMap(statusOverlayFor('Loading inventory locations…'));
  });

  it('occupancy ERROR overlay is anchored top-right, and its Retry still refetches', () => {
    mockOccupancyState = {
      data: undefined, isLoading: false, isPending: false, isError: true, isSuccess: false, refetch: mockOccupancyRefetch,
    };
    render(<ProductsFT2Page />);

    const overlay = statusOverlayFor('Inventory locations unavailable');
    expectTopRightOverlayOverMap(overlay);

    act(() => { fireEvent.click(within(overlay).getByRole('button', { name: /retry/i })); });
    expect(mockOccupancyRefetch).toHaveBeenCalledTimes(1);
  });
});
