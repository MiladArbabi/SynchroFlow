// tests/unit/ui/orders/OrdersFT2Page.operational-episodes-wiring.test.tsx
//
// D2B-RED — CONTRACT 7: SHELL WIRING CONTRACT.
//
// OrdersFT2Page must ultimately:
//   - call useOperationalEpisodes()
//   - pass data through projectOrdersOperationalEpisodes()
//   - pass aggregates through projectOrdersOperationalVisuals()
//   - hand the result to OrdersModuleFT2 through an additive presentation seam
//   - preserve existing mapContent unchanged
//   - preserve selectedOrderId / EntityDetailModal wiring unchanged
//
// This suite proves the FIRST THREE bullets only — the real
// useOperationalEpisodes() hook (mocked as a hook, like every other data
// hook OrdersFT2Page consumes) and the real, UNMOCKED
// projectOrdersOperationalEpisodes()/projectOrdersOperationalVisuals()
// exports (SLICE D1/D2A, already shipped and already covered by their own
// pure-function contracts in orders-operational-episode-projection.test.ts
// and orders-operational-episode-visual.test.ts) are spied on via their
// real module namespace. Today OrdersFT2Page imports none of these three
// seams at all, so every assertion below is expected to fail RED against
// current production code.
//
// Deliberately NOT asserted here: the exact prop name/shape OrdersModuleFT2
// receives this data through. That "additive presentation seam" does not
// exist yet on OrdersModuleFT2DataProps, and inventing one here would
// violate the brief's instruction not to fabricate a fake prop/data seam
// merely to make a RED test convenient — see the accompanying report's
// proposed shape, held for confirmation before any production change.
import React from 'react';

import { renderWithProviders } from 'test-utils';
import OrdersFT2Page from 'pages/ft2-pages/OrdersFT2Page';
import * as operationalEpisodeProjectionModule from 'pages/orders/ordersOperationalEpisodeProjection';
import * as operationalEpisodeVisualModule from 'pages/orders/ordersOperationalEpisodeVisual';
import type { OperationalEpisodeItem } from 'pages/orders/useOperationalEpisodes';

const mockOrdersModuleFT2 = jest.fn();
const mockUseConstrainedOrders = jest.fn();
const mockUseOperationalEpisodes = jest.fn();

jest.mock('@lasyncro/order-nexus', () => ({
  __esModule: true,
  OrdersModuleFT2: (props: any) => {
    mockOrdersModuleFT2(props);
    return require('react').createElement('div', { 'data-testid': 'orders-module-ft2' });
  },
}));

// @lasyncro/shared/ui's barrel does not resolve under jest (./activation/index.js).
// Stub the single symbols OrdersFT2Page uses.
jest.mock('@lasyncro/shared/ui', () => ({
  __esModule: true,
  EntityDetailModal: ({ children }: any) => require('react').createElement(require('react').Fragment, {}, children),
  IsometricCanvas: () => null,
}));

jest.mock('pages/orders/OrderDetailModalBody', () => ({
  __esModule: true,
  OrderDetailModalBody: () => null,
}));

jest.mock('components/ModuleTabBar', () => ({
  __esModule: true,
  ModuleTabBar: () => null,
}));

jest.mock('components/ExportDrawer', () => ({
  __esModule: true,
  ExportDrawer: () => null,
}));

jest.mock('pages/orders/useOrdersFt2Snapshot', () => ({
  useOrdersFt2Snapshot: () => ({
    data: {
      decision: { brief: null },
      operationalControl: {
        snapshot_date: new Date().toISOString(),
        aggregate_version: 1,
        constrained_orders: 1,
      },
    },
  }),
}));

jest.mock('pages/orders/useOrdersFt2Adapter', () => ({
  mapOrdersFt2Props: () => ({
    context: {},
    orders: { total: 1, fulfilled: 0, unfulfilled: 1, constrained: 1 },
    revenue: { totalSales: 0, earned: 0, pending: 0, blocked: 0 },
    decision: { brief: null },
  }),
}));

jest.mock('pages/orders/useOrdersOperatorSummary', () => ({
  useOrdersOperatorSummary: () => ({ data: { agingOrders: [] } }),
}));

jest.mock('pages/orders/useConstrainedOrders', () => ({
  useConstrainedOrders: (opts: any) => mockUseConstrainedOrders(opts),
}));

// The hook itself IS mocked (same convention as every other data hook this
// page consumes, e.g. useConstrainedOrders above) — only the pure projector
// functions downstream of it are exercised for real.
jest.mock('pages/orders/useOperationalEpisodes', () => ({
  useOperationalEpisodes: () => mockUseOperationalEpisodes(),
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    displayCurrency: 'USD',
    locale: 'en-US',
    tier: 'growth',
    snapshot: {
      modules: new Set<string>(),
      flags: new Set<string>(),
    },
    hasResolved: true,
  }),
}));

jest.mock('hooks/useExchangeRates', () => ({
  useExchangeRates: () => ({ rates: {} }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useBulkSetPriority: () => ({ mutateAsync: jest.fn().mockResolvedValue(undefined) }),
}));

const ORDER_ID = 'order-episode-wiring-1';

function operationalEpisodeItems(): OperationalEpisodeItem[] {
  return [
    {
      episodeId: `constraint-1:2026-09-21T09:00:00.000Z`,
      constraintId: 'constraint-1',
      constraintStartedAt: '2026-09-21T09:00:00.000Z',
      lasyncroOrderId: ORDER_ID,
      constraintType: 'customer',
      blockType: 'incomplete_address',
      targetId: null,
      lifecycle: 'attention',
      occurredAt: '2026-09-21T09:00:00.000Z',
      treatment: 'address_correction',
      interventionId: null,
    },
  ];
}

beforeEach(() => {
  mockOrdersModuleFT2.mockClear();
  mockUseConstrainedOrders.mockReset();
  mockUseConstrainedOrders.mockReturnValue({ data: { data: [], pagination: { page: 1, limit: 50 } } });

  mockUseOperationalEpisodes.mockReset();
  mockUseOperationalEpisodes.mockReturnValue({ data: operationalEpisodeItems() });

  jest.spyOn(operationalEpisodeProjectionModule, 'projectOrdersOperationalEpisodes');
  jest.spyOn(operationalEpisodeVisualModule, 'projectOrdersOperationalVisuals');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('OrdersFT2Page — D2B operational-episode shell wiring (item 7)', () => {
  it('calls useOperationalEpisodes(), then projectOrdersOperationalEpisodes(), then projectOrdersOperationalVisuals() with the real data flow', () => {
    renderWithProviders(<OrdersFT2Page />);

    expect(mockUseOperationalEpisodes).toHaveBeenCalled();

    expect(operationalEpisodeProjectionModule.projectOrdersOperationalEpisodes).toHaveBeenCalledWith(
      operationalEpisodeItems()
    );

    const aggregates = (
      operationalEpisodeProjectionModule.projectOrdersOperationalEpisodes as jest.Mock
    ).mock.results[0]?.value;
    expect(aggregates).toBeDefined();

    expect(operationalEpisodeVisualModule.projectOrdersOperationalVisuals).toHaveBeenCalledWith(aggregates);
  });

  it('preserves existing mapContent wiring — OrdersModuleFT2 still receives a rendered mapContent node', () => {
    renderWithProviders(<OrdersFT2Page />);

    expect(mockOrdersModuleFT2).toHaveBeenCalled();
    const props = mockOrdersModuleFT2.mock.calls[0][0];
    expect(props.mapContent).toBeTruthy();
  });
});
