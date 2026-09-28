// tests/unit/ui/orders/OrdersFT2Page.ops-console-wiring.test.tsx
//
// SCREEN-ARCH RED — Orders follows the shared Ops Console state.
//
// Mirrors OverviewFT2Page.ops-console-wiring.test.tsx: the page reads the
// shared Ops Console state (owned by the top-nav trigger) and hands it to
// the module as a domain-specific presentation prop, `suppressOrderHealth`.
// The module never reads ConfigContext itself, and the page owns no Ops
// Console entry point (no onOpenOpsConsole).
//
// Mock harness copied from OrdersFT2Page.operational-episodes-wiring.test.tsx
// (same module-scope dependency surface for OrdersFT2Page).

import React from 'react';
import { act, screen } from '@testing-library/react';

import { renderWithProviders } from 'test-utils';
import OrdersFT2Page from 'pages/ft2-pages/OrdersFT2Page';
import { ConfigProvider } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';

const mockOrdersModuleFT2 = jest.fn();

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
        constrained_orders: 0,
      },
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
  useOperationalEpisodes: () => ({
    data: [],
    isPending: false,
    isSuccess: true,
    isError: false,
    status: 'success',
  }),
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

beforeEach(() => {
  mockOrdersModuleFT2.mockClear();
});

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
  const calls = mockOrdersModuleFT2.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
}

function renderInShell() {
  renderWithProviders(
    <ConfigProvider>
      <SetConsole />
      <OrdersFT2Page />
    </ConfigProvider>,
  );
}

describe('SCREEN-ARCH: page owns no Ops Console entry point', () => {
  it('does not pass onOpenOpsConsole to OrdersModuleFT2', () => {
    renderInShell();

    expect(mockOrdersModuleFT2).toHaveBeenCalled();
    for (const [props] of mockOrdersModuleFT2.mock.calls) {
      expect(props).not.toHaveProperty('onOpenOpsConsole');
    }
  });
});

describe('SCREEN-ARCH: Order health follows shared Ops Console state', () => {
  it('shared state false -> suppressOrderHealth false', () => {
    renderInShell();

    expect(lastModuleProps().suppressOrderHealth).toBe(false);
  });

  it('shared state true -> suppressOrderHealth true, and back to false on close', () => {
    renderInShell();

    act(() => { screen.getByText('open console').click(); });
    expect(lastModuleProps().suppressOrderHealth).toBe(true);
    expect(lastModuleProps()).not.toHaveProperty('onOpenOpsConsole');

    act(() => { screen.getByText('close console').click(); });
    expect(lastModuleProps().suppressOrderHealth).toBe(false);
  });
});
