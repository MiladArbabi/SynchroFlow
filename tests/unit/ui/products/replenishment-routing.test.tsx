// GH-1208 — exercise actual FT2 route authority and nested Inventory router.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { LifecycleRouteHost } from '../../../../apps/frontend/src/lifecycle/LifecycleRouteHost';
import { ConfigProvider } from 'contexts/ConfigContext';

jest.mock('lifecycle/ShopLifecycleContext', () => ({
  useShopLifecycle: () => ({ phase: 'FT2_READY', readiness: {}, isBooting: false }),
}));
jest.mock('components/EmptyStates/EmptyDashboardState', () => ({ EmptyDashboardState: () => null }));
jest.mock('activation/SyncAnimationPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/authentication/ConnectStorePage', () => ({ __esModule: true, default: () => null }));
// Keep DemandPage real: only its data and module dependencies are isolated.
jest.mock('@lasyncro/demand', () => ({ DemandModuleFT2: () => <div data-testid="planning-page" /> }), { virtual: true });
jest.mock('@lasyncro/products', () => ({ ProductsModuleFT2: () => <div data-testid="inventory-intelligence" /> }), { virtual: true });
jest.mock('@lasyncro/shared/ui', () => ({ IsometricCanvas: () => null, EntityDetailModal: () => null }));
jest.mock('pages/products/useDemand', () => ({ useDemand: () => ({ data: null, isLoading: false, isError: false }) }));
jest.mock('contexts/EntitlementsContext', () => ({ useEntitlements: () => ({ displayCurrency: 'USD', locale: 'en-US', tier: 'growth' }) }));
jest.mock('hooks/useExchangeRates', () => ({ useExchangeRates: () => ({ rates: {} }) }));
jest.mock('components/ModuleTabBar', () => ({ ModuleTabBar: () => null }));
jest.mock('components/CommercialGate', () => ({ CommercialGate: ({ children }: any) => <>{children}</> }));
jest.mock('components/ExportDrawer', () => ({ ExportDrawer: () => null }));
jest.mock('pages/ft2-pages/ProductsCatalogPage', () => ({ __esModule: true, default: () => null }));
jest.mock('pages/products/useProductsFt2Snapshot', () => ({ useProductsFt2Snapshot: () => ({ isSuccess: true, data: {} }) }));
jest.mock('pages/products/useProductsFt2Adapter', () => ({ mapProductsFt2Props: () => ({}) }));
jest.mock('pages/products/useProductsOperatorSummary', () => ({ useProductsOperatorSummary: () => ({ isSuccess: true, data: {} }) }));
jest.mock('pages/floor-planning/useFloorPlanning', () => ({ useFloorPlanning: () => ({ data: { zones: [] }, isLoading: false }) }));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({ useWarehouseGridOccupancy: () => ({ data: { occupancy: {} } }) }));
jest.mock('runtime/commercialContext', () => ({ useCommercialAccess: () => ({ isResolved: true, decide: () => ({ allowed: true }) }) }));

function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return <div data-testid="location">{pathname}{search}{hash}</div>;
}

function renderRoute(entry: string) {
  return render(<ConfigProvider><MemoryRouter initialEntries={[entry]}>
    <LifecycleRouteHost /><LocationProbe />
  </MemoryRouter></ConfigProvider>);
}

describe('GH-1208 Replenishment route behavior', () => {
  it('canonical /inventory/replenishment mounts planning and retains critical query/hash', async () => {
    renderRoute('/inventory/replenishment?filter=critical#planning');
    await waitFor(() => expect(screen.queryByTestId('planning-page')).toBeInTheDocument());
    expect(screen.getByTestId('location').textContent).toBe('/inventory/replenishment?filter=critical#planning');
    expect(screen.queryByTestId('inventory-intelligence')).toBeNull();
  });

  it('/demand redirects to canonical Replenishment preserving every query parameter and hash', async () => {
    renderRoute('/demand?filter=critical&search=merino&page=2#planning');
    await waitFor(() => expect(screen.getByTestId('location').textContent)
      .toBe('/inventory/replenishment?filter=critical&search=merino&page=2#planning'));
    expect(screen.getByTestId('planning-page')).toBeInTheDocument();
  });

  it('bare /demand redirects without introducing query parameters', async () => {
    renderRoute('/demand');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/inventory/replenishment'));
    expect(screen.getByTestId('planning-page')).toBeInTheDocument();
  });

  it('legacy /demand/* subpaths redirect preserving query and hash', async () => {
    renderRoute('/demand/forecast?filter=critical&search=merino#planning');
    await waitFor(() => expect(screen.getByTestId('location').textContent)
      .toBe('/inventory/replenishment?filter=critical&search=merino#planning'));
    expect(screen.getByTestId('planning-page')).toBeInTheDocument();
  });
});
