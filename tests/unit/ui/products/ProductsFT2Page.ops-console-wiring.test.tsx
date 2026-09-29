// tests/unit/ui/products/ProductsFT2Page.ops-console-wiring.test.tsx
//
// INVENTORY INTELLIGENCE RED-A — Inventory follows the shared Ops Console state.
//
// Mirrors OverviewFT2Page / OrdersFT2Page ops-console-wiring: the page reads
// the shared Ops Console state (owned by the top-nav trigger) and hands it to
// the module as a domain-specific presentation prop, `suppressInventoryState`.
// The module never reads ConfigContext itself, and the page owns no Ops
// Console entry point (no onOpenOpsConsole or other local Console callback).
//
// Mock harness copied from
// tests/unit/ui/commercial-access/inventory-live-map-commercial-access.test.tsx
// (same module-scope dependency surface for ProductsFT2Page).

import React from 'react';
import { act, render, screen } from '@testing-library/react';

import ProductsFT2Page from 'pages/ft2-pages/ProductsFT2Page';
import { ConfigProvider } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';

const mockNavigate = jest.fn();
const mockProductsModuleFT2 = jest.fn((_props: Record<string, unknown>) => (
  <div data-testid="products-module-ft2" />
));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Routes: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  // Only the "/" Intelligence child is exercised here.
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

jest.mock('components/CommercialGate', () => ({
  CommercialGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('components/ExportDrawer', () => ({
  ExportDrawer: () => null,
}));

jest.mock('pages/ft2-pages/ProductsCatalogPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/ft2-pages/ProductsCostsPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/ft2-pages/ProductsWmsReadinessPage', () => ({ __esModule: true, default: () => null }));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    displayCurrency: 'USD',
    locale: 'en-US',
    tier: 'growth',
    hasResolved: true,
  }),
}));

jest.mock('hooks/useExchangeRates', () => ({
  useExchangeRates: () => ({ rates: {} }),
}));

jest.mock('runtime/commercialContext', () => ({
  __esModule: true,
  useCommercialAccess: () => ({
    context: { tier: 'growth', modules: new Set<string>(), flags: new Set<string>() },
    isResolved: true,
    decide: () => ({ allowed: true, reason: 'ALLOWED' }),
  }),
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
    refetch: jest.fn(),
  }),
}));

jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGridOccupancy: () => ({ data: { occupancy: {} }, isLoading: false, isError: false }),
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

const DEFAULT_OPERATOR_SUMMARY = { sellability: { sellable: 5, blocked: 0, blockedReasons: {} } };
let mockOperatorSummaryData: Record<string, unknown> = DEFAULT_OPERATOR_SUMMARY;

jest.mock('pages/products/useProductsOperatorSummary', () => ({
  useProductsOperatorSummary: () => ({
    isSuccess: true,
    data: mockOperatorSummaryData,
  }),
}));

beforeEach(() => {
  mockProductsModuleFT2.mockClear();
  mockOperatorSummaryData = DEFAULT_OPERATOR_SUMMARY;
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
  const calls = mockProductsModuleFT2.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
}

function renderInShell() {
  render(
    <ConfigProvider>
      <SetConsole />
      <ProductsFT2Page />
    </ConfigProvider>,
  );
}

describe('INVENTORY RED-A: page owns no Ops Console entry point', () => {
  it('never passes onOpenOpsConsole or another local Console callback to ProductsModuleFT2', () => {
    renderInShell();

    act(() => { screen.getByText('open console').click(); });
    act(() => { screen.getByText('close console').click(); });

    expect(mockProductsModuleFT2).toHaveBeenCalled();
    for (const [props] of mockProductsModuleFT2.mock.calls) {
      expect(props).not.toHaveProperty('onOpenOpsConsole');
      const consoleCallbacks = Object.keys(props).filter(
        (key) => /console/i.test(key) && typeof props[key] === 'function',
      );
      expect(consoleCallbacks).toEqual([]);
    }
  });
});

describe('INVENTORY RED-A: Inventory state follows shared Ops Console state', () => {
  it('shared state false -> suppressInventoryState false', () => {
    renderInShell();

    expect(lastModuleProps().suppressInventoryState).toBe(false);
  });

  it('shared state true -> suppressInventoryState true, and back to false on close', () => {
    renderInShell();

    act(() => { screen.getByText('open console').click(); });
    expect(lastModuleProps().suppressInventoryState).toBe(true);
    expect(lastModuleProps()).not.toHaveProperty('onOpenOpsConsole');

    act(() => { screen.getByText('close console').click(); });
    expect(lastModuleProps().suppressInventoryState).toBe(false);
  });
});

describe('INVENTORY A1: Not received follows the canonical no-inventory fact', () => {
  it('blockedReasons.noInventory = 4 -> inventoryState.notReceivedCount 4', () => {
    mockOperatorSummaryData = {
      sellability: { sellable: 5, blocked: 4, blockedReasons: { noInventory: 4 } },
    };
    renderInShell();

    const inventoryState = lastModuleProps().inventoryState as Record<string, unknown>;
    expect(inventoryState.notReceivedCount).toBe(4);
  });

  it('missing noInventory source -> inventoryState.notReceivedCount null, never 0', () => {
    renderInShell();

    const inventoryState = lastModuleProps().inventoryState as Record<string, unknown>;
    expect(inventoryState.notReceivedCount).toBeNull();
  });
});
