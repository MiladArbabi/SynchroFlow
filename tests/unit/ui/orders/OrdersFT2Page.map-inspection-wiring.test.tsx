// tests/unit/ui/orders/OrdersFT2Page.map-inspection-wiring.test.tsx
//
// C2C — Orders live-map hover/pinned inspection wiring (caller level).
//
// IsometricCanvas owns the hover plate, pinned plate, dimming, outline and
// close control. OrdersFT2Page only supplies Orders facts and owns the
// selected location. This proves that wiring: a bin with real Orders
// activity gets a LocationPulse, selection is controlled by the page, the
// pinned action is the shared "Open order flow →" to /orders/flow only for
// an Orders-active bin, and onPinnedClose clears the selection. A bin with
// no Orders fact stays silent (no pulse, no action).
//
// C2D: the page also passes inspectableLocationCodes = the keys of its
// LocationPulse map, so a silent bin is warehouse context only — the shared
// renderer will not hover-focus or select it.
//
// Harness based on OrdersFT2Page.operational-episodes-wiring.test.tsx, with
// the map data hooks mocked so the live-map branch renders.

import React from 'react';
import { act } from '@testing-library/react';

import { renderWithProviders } from 'test-utils';
import OrdersFT2Page from 'pages/ft2-pages/OrdersFT2Page';

const mockCanvas = jest.fn();
const mockNavigate = jest.fn();
const mockUseOrdersLiveActivity = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('@lasyncro/order-nexus', () => ({
  __esModule: true,
  OrdersModuleFT2: (props: any) =>
    require('react').createElement('div', { 'data-testid': 'orders-module-ft2' }, props.mapContent),
}));

jest.mock('@lasyncro/shared/ui', () => ({
  __esModule: true,
  EntityDetailModal: ({ children }: any) => require('react').createElement(require('react').Fragment, {}, children),
  IsometricCanvas: (props: any) => {
    mockCanvas(props);
    return null;
  },
}));

jest.mock('pages/orders/OrderDetailModalBody', () => ({ __esModule: true, OrderDetailModalBody: () => null }));
jest.mock('components/ModuleTabBar', () => ({ __esModule: true, ModuleTabBar: () => null }));
jest.mock('components/ExportDrawer', () => ({ __esModule: true, ExportDrawer: () => null }));
jest.mock('components/LiveMapTeaser', () => ({ __esModule: true, LiveMapTeaser: () => null }));

jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    decide: () => ({ allowed: true, requiredTier: null }),
    isResolved: true,
  }),
}));

jest.mock('pages/floor-planning/useFloorPlanning', () => ({
  useFloorPlanning: () => ({
    data: {
      zones: [
        { location_code: 'A-1', type: 'bin', active: true, position_x: 1, position_y: 1, zone_type: 'pick' },
        { location_code: 'B-1', type: 'bin', active: true, position_x: 2, position_y: 1, zone_type: 'pick' },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('pages/wms/useWmsLiveActivity', () => ({
  useOrdersLiveActivity: (enabled: boolean) => mockUseOrdersLiveActivity(enabled),
}));

jest.mock('pages/orders/useOrdersFt2Snapshot', () => ({
  useOrdersFt2Snapshot: () => ({
    data: {
      decision: { brief: null },
      operationalControl: { snapshot_date: new Date().toISOString(), aggregate_version: 1, constrained_orders: 0 },
    },
  }),
}));

jest.mock('pages/orders/useOrdersFt2Adapter', () => ({
  mapOrdersFt2Props: () => ({
    context: {},
    orders: { total: 1, fulfilled: 0, unfulfilled: 1, constrained: 0 },
    revenue: { totalSales: 0, earned: 0, pending: 0, blocked: 0 },
    decision: { brief: null },
  }),
}));

jest.mock('pages/orders/useOrdersOperatorSummary', () => ({
  useOrdersOperatorSummary: () => ({ data: { agingOrders: [] } }),
}));

jest.mock('pages/orders/useConstrainedOrders', () => ({
  useConstrainedOrders: () => ({ data: { data: [], pagination: { page: 1, limit: 50 } } }),
}));

jest.mock('pages/orders/useOperationalEpisodes', () => ({
  useOperationalEpisodes: () => ({ data: [], isPending: false, isSuccess: true, isError: false, status: 'success' }),
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({ displayCurrency: 'USD', locale: 'en-US', tier: 'growth', hasResolved: true }),
}));

jest.mock('hooks/useExchangeRates', () => ({ useExchangeRates: () => ({ rates: {} }) }));

jest.mock('pages/wms/useOrderPool', () => ({
  useBulkSetPriority: () => ({ mutateAsync: jest.fn().mockResolvedValue(undefined) }),
}));

function lastCanvasProps(): Record<string, any> {
  expect(mockCanvas).toHaveBeenCalled();
  return mockCanvas.mock.calls[mockCanvas.mock.calls.length - 1][0];
}

beforeEach(() => {
  mockCanvas.mockClear();
  mockNavigate.mockClear();
  const now = new Date().toISOString();
  mockUseOrdersLiveActivity.mockReturnValue({
    data: {
      pickerPositions: [
        { operator_id: 'op-1', location_code: 'A-1', last_scan_at: now, batch_activity_at: now, batch_id: 'b-1' },
      ],
      activeBatches: [
        { batch_id: 'b-1', status: 'picking', picked_lines: 0, total_lines: 2, total_units: 2, units_packed: 0 },
      ],
      staleThresholdMinutes: 15,
    },
  });
});

describe('OrdersFT2Page — C2C live-map hover/pinned inspection wiring', () => {
  it('passes shared hover focus and an Orders LocationPulse only for the Orders-active bin', () => {
    renderWithProviders(<OrdersFT2Page />);
    const props = lastCanvasProps();

    expect(props.enableHoverFocus).toBe(true);
    expect(props.locationPulseByCode['A-1']).toEqual({
      title: 'A-1',
      rows: [
        { label: 'Pickers here', value: '1' },
        { label: 'Batch phase', value: 'Picking', tone: 'muted' },
      ],
    });
    // No Orders fact at B-1 → no plate is fabricated for it.
    expect(props.locationPulseByCode['B-1']).toBeUndefined();
    // Inspection eligibility is exactly the Orders pulse set.
    expect([...props.inspectableLocationCodes]).toEqual(['A-1']);
    expect(props.selectedLocationCode).toBeNull();
    expect(props.pinnedAction).toBeNull();
  });

  it('page-owned selection pins an Orders-active bin with the shared Open order flow action, and onPinnedClose clears it', () => {
    renderWithProviders(<OrdersFT2Page />);

    act(() => { lastCanvasProps().onSelect('A-1'); });
    let props = lastCanvasProps();
    expect(props.selectedLocationCode).toBe('A-1');
    expect(props.pinnedAction).toEqual({ label: 'Open order flow →', onClick: expect.any(Function) });

    act(() => { props.pinnedAction.onClick(); });
    expect(mockNavigate).toHaveBeenCalledWith('/orders/flow');

    act(() => { lastCanvasProps().onPinnedClose(); });
    props = lastCanvasProps();
    expect(props.selectedLocationCode).toBeNull();
    expect(props.pinnedAction).toBeNull();
  });

  it('a bin with no Orders activity is not an inspection target and offers no pinned action', () => {
    renderWithProviders(<OrdersFT2Page />);
    expect(lastCanvasProps().inspectableLocationCodes.has('B-1')).toBe(false);

    // Even if a selection were forced through the callback, the caller
    // offers no Orders action for a silent bin.

    act(() => { lastCanvasProps().onSelect('B-1'); });
    const props = lastCanvasProps();
    expect(props.selectedLocationCode).toBe('B-1');
    expect(props.pinnedAction).toBeNull();
  });
});
