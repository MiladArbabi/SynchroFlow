// tests/unit/ui/products/ProductsFT2Page.inventory-state-wiring.test.tsx
//
// INVENTORY INTELLIGENCE RED-B — the page hands the canonical Inventory state
// read model to ProductsModuleFT2.
//
// operatorSummary.inventoryState (onHandUnits / availableUnits /
// reservedUnits / noValidPickLocationCount) maps field-for-field onto the
// module's inventoryState. A missing read model stays null — never 0.
// A1 ownership is unchanged: notReceivedCount comes from
// sellability.blockedReasons.noInventory and phantomCount from
// sellability.blockedReasons.phantom.
//
// Mock harness copied from
// tests/unit/ui/products/ProductsFT2Page.ops-console-wiring.test.tsx
// (same module-scope dependency surface for ProductsFT2Page).

import React from 'react';
import { render } from '@testing-library/react';

import ProductsFT2Page from 'pages/ft2-pages/ProductsFT2Page';

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

const SELLABILITY = {
  sellable: 5,
  blocked: 6,
  blockedReasons: { noSku: 0, noInventory: 4, zeroStock: 0, phantom: 2 },
};

let mockOperatorSummaryData: Record<string, unknown> = { sellability: SELLABILITY };

jest.mock('pages/products/useProductsOperatorSummary', () => ({
  useProductsOperatorSummary: () => ({
    isSuccess: true,
    data: mockOperatorSummaryData,
  }),
}));

beforeEach(() => {
  mockProductsModuleFT2.mockClear();
  mockOperatorSummaryData = { sellability: SELLABILITY };
});

function lastInventoryState(): Record<string, unknown> {
  const calls = mockProductsModuleFT2.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0].inventoryState as Record<string, unknown>;
}

describe('INVENTORY RED-B: canonical Inventory state read model reaches ProductsModuleFT2', () => {
  it('maps operatorSummary.inventoryState field-for-field, keeping A1 ownership of Not received / Phantom', () => {
    mockOperatorSummaryData = {
      sellability: SELLABILITY,
      inventoryState: {
        onHandUnits: 30,
        availableUnits: 21,
        reservedUnits: 9,
        noValidPickLocationCount: 3,
      },
    };

    render(<ProductsFT2Page />);

    const inventoryState = lastInventoryState();
    expect(inventoryState.onHandUnits).toBe(30);
    expect(inventoryState.availableUnits).toBe(21);
    expect(inventoryState.reservedUnits).toBe(9);
    expect(inventoryState.noValidPickLocationCount).toBe(3);

    expect(inventoryState.notReceivedCount).toBe(4);
    expect(inventoryState.phantomCount).toBe(2);
  });

  it('missing operatorSummary.inventoryState -> the four read-model fields are null, never 0', () => {
    render(<ProductsFT2Page />);

    const inventoryState = lastInventoryState();
    expect(inventoryState.onHandUnits).toBeNull();
    expect(inventoryState.availableUnits).toBeNull();
    expect(inventoryState.reservedUnits).toBeNull();
    expect(inventoryState.noValidPickLocationCount).toBeNull();

    expect(inventoryState.notReceivedCount).toBe(4);
    expect(inventoryState.phantomCount).toBe(2);
  });
});

describe('INVENTORY RED-D: hasInventoryTruth reaches ProductsModuleFT2 without defaulting', () => {
  const STATE = { onHandUnits: 0, availableUnits: 0, reservedUnits: 0, noValidPickLocationCount: 0 };

  it('hasInventoryTruth true -> module receives true', () => {
    mockOperatorSummaryData = { sellability: SELLABILITY, inventoryState: { ...STATE, hasInventoryTruth: true } };
    render(<ProductsFT2Page />);

    expect(lastInventoryState().hasInventoryTruth).toBe(true);
  });

  it('hasInventoryTruth false -> module receives false', () => {
    mockOperatorSummaryData = { sellability: SELLABILITY, inventoryState: { ...STATE, hasInventoryTruth: false } };
    render(<ProductsFT2Page />);

    expect(lastInventoryState().hasInventoryTruth).toBe(false);
  });

  it('missing inventoryState -> module receives null (unknown), never false', () => {
    render(<ProductsFT2Page />);

    expect(lastInventoryState().hasInventoryTruth).toBeNull();
  });
});
