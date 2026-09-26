// tests/unit/ui/overview/OverviewFT2Page.ov-v1-pulse-wiring.test.tsx
//
// OV-V1-0 — page wiring: Operations Pulse canonical sources.
//
// OverviewFT2Page must hand OverviewModuleFT2 a structured `operationsPulse`
// prop (shape defined in OverviewModuleFT2.ov-v1-operations-pulse.test.tsx)
// derived ONLY from canonical structured sources.
//
// Ratified data ownership: Overview does NOT call Orders UI read models for
// the Pulse. Cross-domain commercial values arrive on Overview's own
// useOverviewModulesFt2Snapshot().data.pulse, extended with:
//   blockedOrderCount, blockedRevenue, inventoryWaitingCount,
//   inventoryBlockedRevenue, pastSlaCount, pastSlaRevenue
// Existing live hooks keep their ownership:
//   Ready       ← useOrderPool().data.summary.ready_for_release_count
//   Fulfillment ← useWmsLiveActivity().data.activeBatches
//   Inbound     ← useWmsLiveActivity().data.receiveAtDock
//                 + useWmsLiveActivity().data.stowPressure.by_location
//
// Mapping under test:
//   orders.readyCount            ← ready_for_release_count   (NOT eligible_order_count)
//   orders.blockedCount/Revenue  ← pulse.blockedOrderCount / blockedRevenue
//                                  (NOT orderPool summary.blocked_count)
//   orders.pastSlaCount/Revenue  ← pulse.pastSlaCount / pastSlaRevenue
//                                  (NEVER parsed from Morning Brief copy)
//   inventory.*                  ← pulse.inventoryWaitingCount / inventoryBlockedRevenue
//                                  (NOT the broader blocked count, NOT a sum)
//   fulfillment.*                ← activeBatches (NOT orderPool active_batch_count)
//   inbound.receiveAtDockUnits   ← Σ receiveAtDock[].units
//   inbound.awaitingStowUnits    ← Σ stowPressure.by_location[].pending_units
//                                  (NOT stowPressure.pending_count, which counts tasks)
//
// The real mapOverviewFt2Props adapter is used (it is a pure function), so
// the contract holds whether the mapping lives in the adapter or the page.
//
// Fixtures are hostile: every non-canonical neighbour field carries a
// different, recognisable number.
//
// OVERVIEW-SCREEN-OPT-01 (Slice A): also asserts the Profile Completion
// banner is no longer part of the Overview production composition.
//
// Mock harness copied from OverviewFT2Page.ops-console-wiring.test.tsx.

import fs from 'fs';
import path from 'path';
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
const mockUseOrderPool = jest.fn();
const mockUseOverviewModulesFt2Snapshot = jest.fn();
const mockUseWmsLiveActivity = jest.fn();
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

jest.mock('pages/overview/useOverviewModulesFt2Snapshot', () => ({
  useOverviewModulesFt2Snapshot: (...args: unknown[]) => mockUseOverviewModulesFt2Snapshot(...args),
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
  useOrderPool: (...args: unknown[]) => mockUseOrderPool(...args),
}));

jest.mock('pages/wms/useWmsLiveActivity', () => ({
  useWmsLiveActivity: (...args: unknown[]) => mockUseWmsLiveActivity(...args),
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

// Render prerequisite only: OverviewFT2Page calls useConfig() at this HEAD.
// No Ops Console state is set or asserted here (GH-1153 owns that).
function renderPage() {
  const state: ConfigProps = { ...defaultConfig };
  return render(
    <ConfigContext.Provider value={{ state, dispatch: jest.fn() }}>
      <OverviewPageFT2 />
    </ConfigContext.Provider>
  );
}

function lastModuleProps(): Record<string, any> {
  const calls = mockOverviewModuleFT2.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as Record<string, any>;
}

beforeEach(() => {
  jest.clearAllMocks();
  setSearchParams('');
  mockUseMorningBriefSnapshot.mockReturnValue({
    data: {
      signals: [
        {
          id: 'sla',
          priority: 1,
          title: '999 orders past SLA',
          detail: '999 orders are past their fulfillment SLA.',
          module: 'order-nexus',
          deepLink: '/orders/flow?urgency=sla_breach',
          revenueImpact: 99900,
          alertType: 'sla_breach',
        },
        {
          id: 'blocked',
          priority: 1,
          title: '40 orders blocked',
          detail: '40 orders cannot ship.',
          module: 'orders',
          deepLink: '/orders/blocked',
          revenueImpact: 77777,
          alertType: 'revenue_at_risk',
        },
      ],
      hasUrgentIssues: true,
      generatedAt: '2026-09-11T08:00:00.000Z',
      trustWarning: false,
      greeting: 'Good morning, Milad',
      summaryLine: null,
    },
    isPending: false,
    isError: false,
    refreshMorningBrief: mockRefreshMorningBrief,
    isRefreshingBrief: false,
  });
  mockUseAddressResolutionOrders.mockReturnValue({ candidates: [], isLoading: false, isError: false });

  mockUseOrderPool.mockReturnValue({
    data: {
      eligible_order_count: 99,
      max_batch_line_items: 50,
      orders: [],
      summary: {
        ready_for_release_count: 8,
        in_batch_order_count: 14,
        active_batch_count: 6,
        blocked_count: 4,
        fulfilled_count: 70,
        not_ready_count: 15,
      },
    },
    isPending: false,
    isError: false,
  });

  mockUseOverviewModulesFt2Snapshot.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      orders: null,
      products: null,
      customers: null,
      pulse: {
        revenueToday: 1000,
        revenueDeltaVsYesterday: 0,
        atRiskRevenue: 8888,
        topBlockingType: 'inventory',
        // OV-V1 structured cross-domain values.
        blockedOrderCount: 9,
        blockedRevenue: 1250,
        inventoryWaitingCount: 2,
        inventoryBlockedRevenue: 600,
        pastSlaCount: 27,
        pastSlaRevenue: 5400,
      },
    },
  });

  mockUseWmsLiveActivity.mockReturnValue({
    data: {
      pickerPositions: [],
      activeBatches: [
        { batch_id: 'b1', status: 'picking', picked_lines: 1, total_lines: 4, total_units: 4, units_packed: 0 },
        { batch_id: 'b2', status: 'picking', picked_lines: 2, total_lines: 3, total_units: 3, units_packed: 0 },
        { batch_id: 'b3', status: 'packing', picked_lines: 5, total_lines: 5, total_units: 5, units_packed: 2 },
      ],
      stowPressure: {
        pending_count: 44,
        anchor_location: 'RECEIVE-1',
        by_location: [
          { location_code: 'A-1', pending_units: 7, pending_tasks: 1 },
          { location_code: 'A-2', pending_units: 5, pending_tasks: 1 },
        ],
      },
      receiveAtDock: [
        { location_code: 'DOCK-1', units: 3 },
        { location_code: 'DOCK-2', units: 2 },
      ],
      awaitingPackUnits: 0,
      shippedToday: 0,
      packedNotShipped: 0,
      staleThresholdMinutes: 15,
    },
    isLoading: false,
    isError: false,
  });
});

// ─── B — READY ──────────────────────────────────────────────────────────────

describe('OV-V1-0 (B) page: Ready ← ready_for_release_count', () => {
  it('passes readyCount 8, not eligible_order_count 99', () => {
    renderPage();

    const pulse = lastModuleProps().operationsPulse;
    expect(pulse).toBeDefined();
    expect(pulse.orders.readyCount).toBe(8);
    expect(pulse.orders.readyCount).not.toBe(99);
  });
});

// ─── C — BLOCKED ────────────────────────────────────────────────────────────

describe('OV-V1-0 (C) page: Blocked ← overview pulse blockedOrderCount / blockedRevenue', () => {
  it('passes blockedCount 9 / blockedRevenue 1250 — not order-pool blocked_count 4, not brief copy 40', () => {
    renderPage();

    const { orders } = lastModuleProps().operationsPulse;
    expect(orders.blockedCount).toBe(9);
    expect(orders.blockedRevenue).toBe(1250);
  });
});

// ─── D — PAST SLA ───────────────────────────────────────────────────────────

describe('OV-V1-0 (D) page: Past SLA ← overview pulse pastSlaCount / pastSlaRevenue', () => {
  it('passes pastSlaCount 27 / pastSlaRevenue 5400 while the brief title says "999 orders past SLA"', () => {
    renderPage();

    const { orders } = lastModuleProps().operationsPulse;
    expect(orders.pastSlaCount).toBe(27);
    expect(orders.pastSlaRevenue).toBe(5400);
    expect(orders.pastSlaCount).not.toBe(999);
  });
});

// ─── E — INVENTORY ──────────────────────────────────────────────────────────

describe('OV-V1-0 (E) page: Inventory ← overview pulse inventoryWaitingCount only', () => {
  it('passes awaitingInventoryCount 2 / revenue 600 — not the broader blocked count 9, not the sum 11', () => {
    renderPage();

    const { inventory } = lastModuleProps().operationsPulse;
    expect(inventory.awaitingInventoryCount).toBe(2);
    expect(inventory.awaitingInventoryRevenue).toBe(600);
  });
});

// ─── FULFILLMENT ────────────────────────────────────────────────────────────

describe('OV-V1-0 page: Fulfillment ← useWmsLiveActivity activeBatches', () => {
  it('passes 3 active batches (2 picking, 1 packing) — not order-pool active_batch_count 6', () => {
    renderPage();

    const { fulfillment } = lastModuleProps().operationsPulse;
    expect(fulfillment.activeBatchCount).toBe(3);
    expect(fulfillment.pickingBatchCount).toBe(2);
    expect(fulfillment.packingBatchCount).toBe(1);
  });
});

// ─── F — INBOUND ────────────────────────────────────────────────────────────

describe('OV-V1-0 (F) page: Inbound ← receiveAtDock units + stowPressure.by_location units', () => {
  it('passes receiveAtDockUnits 5 and awaitingStowUnits 12 — not stow pending_count 44', () => {
    renderPage();

    const { inbound } = lastModuleProps().operationsPulse;
    expect(inbound.receiveAtDockUnits).toBe(5);
    expect(inbound.awaitingStowUnits).toBe(12);
  });

  it('passes zero/zero when the dock and stow queues are empty', () => {
    mockUseWmsLiveActivity.mockReturnValue({
      data: {
        pickerPositions: [],
        activeBatches: [],
        stowPressure: { pending_count: 0, anchor_location: 'RECEIVE-1', by_location: [] },
        receiveAtDock: [],
        awaitingPackUnits: 0,
        shippedToday: 0,
        packedNotShipped: 0,
        staleThresholdMinutes: 15,
      },
      isLoading: false,
      isError: false,
    });

    renderPage();

    const { inbound } = lastModuleProps().operationsPulse;
    expect(inbound.receiveAtDockUnits).toBe(0);
    expect(inbound.awaitingStowUnits).toBe(0);
  });
});

// ─── PRODUCTION COMPOSITION ─────────────────────────────────────────────────

describe('OVERVIEW-SCREEN-OPT-01: Profile Completion banner is retired from Overview', () => {
  it('OverviewFT2Page does not compose ProfileCompletionBanner and the component no longer exists', () => {
    const root = process.cwd();
    const page = fs.readFileSync(path.join(root, 'apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx'), 'utf8');

    expect(page).not.toMatch(/ProfileCompletionBanner/);
    expect(fs.existsSync(path.join(root, 'apps/frontend/src/pages/overview/ProfileCompletionBanner.tsx'))).toBe(false);
  });
});
