/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from 'test-utils';

import { ShopLifecycleGate } from 'lifecycle/ShopLifecycleGate';
import { ShopLifecycleContext } from 'lifecycle/ShopLifecycleContext';
import { Routes, Route } from 'react-router-dom';
import OrdersPage from 'pages/OrdersPage';

// ---- mocks ----
jest.mock('components/EmptyStates/EmptyDashboardState', () => ({
  EmptyDashboardState: () => (
    <div data-testid="empty-dashboard-state" />
  ),
}));

jest.mock('activation/ActivationSurfaceAdapter', () => ({
  ActivationSurfaceAdapter: () => (
    <div data-testid="activation-surface" />
  ),
}));

jest.mock('@lasyncro/order-nexus', () => ({
  OrdersModule: () => <div data-testid="orders-ft1" />,
  OrdersModuleFT2: () => <div data-testid="orders-ft2" />,
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { shop_id: 123 },
    isLoading: false,
    isLoggedIn: true,
  }),
}));

jest.mock('lifecycle/useOnboardingReadiness', () => ({
  useOnboardingReadiness: () => ({
    isSuccess: true,
    data: {},
  }),
}));

jest.mock('pages/orders/useOrdersFt2Snapshot', () => ({
  useOrdersFt2Snapshot: () => {
    const phase =
      require('lifecycle/ShopLifecycleContext')
        .useShopLifecycle()
        .phase;

    return {
      isSuccess: phase === 'FT2_READY',
      isLoading: false,
      data: {},
    };
  },
}));

// ---- helpers ----
function renderAt(path: string, phase: any) {
  return renderWithProviders(
    <ShopLifecycleContext.Provider value={{ phase } as any}>
      <Routes>
        <Route element={<ShopLifecycleGate />}>
          <Route path="/orders" element={<OrdersPage />} />
        </Route>
      </Routes>
    </ShopLifecycleContext.Provider>,
    {
      routerProps: { initialEntries: [path] },
    }
  );
}

describe('ShopLifecycleGate route isolation', () => {
  test('FT_MINUS_ONE: /orders renders ActivationSurface only', () => {
    renderAt('/orders', 'FT_MINUS_ONE');

    expect(screen.getByTestId('activation-surface')).toBeInTheDocument();

    expect(
      screen.queryByTestId('empty-dashboard-state')
    ).not.toBeInTheDocument();

    expect(
      screen.queryByTestId('orders-ft1')
    ).not.toBeInTheDocument();

    expect(
      screen.queryByTestId('orders-ft2')
    ).not.toBeInTheDocument();
  });

  test('FT0: /orders renders EmptyDashboardState only', () => {
    renderAt('/orders', 'FT0_PREPARING');

    expect(
      screen.getByTestId('empty-dashboard-state')
    ).toBeInTheDocument();

    expect(
      screen.queryByTestId('activation-surface')
    ).not.toBeInTheDocument();

    expect(
      screen.queryByTestId('orders-ft1')
    ).not.toBeInTheDocument();

    expect(
      screen.queryByTestId('orders-ft2')
    ).not.toBeInTheDocument();
  });

  test('FT1: /orders renders FT1 Orders module', () => {
    renderAt('/orders', 'FT1_READY');

    expect(
      screen.getByTestId('orders-ft1')
    ).toBeInTheDocument();
  });

  test('FT1: FT2 Orders module must NOT mount', () => {
    renderAt('/orders', 'FT1_READY');

    expect(
      screen.queryByTestId('orders-ft2')
    ).not.toBeInTheDocument();
  });

  test('FT2: FT1 Orders module must NOT mount', () => {
    renderAt('/orders', 'FT2_READY');

    expect(
      screen.queryByTestId('orders-ft1')
    ).not.toBeInTheDocument();
  });
  test('FT1: FT2 snapshot resolving must NOT force FT2 UI', () => {
    renderAt('/orders', 'FT1_READY');

    // FT1 must render
    expect(
      screen.getByTestId('orders-ft1')
    ).toBeInTheDocument();

    // FT2 must NEVER render, even if snapshot hook says success
    expect(
      screen.queryByTestId('orders-ft2')
    ).not.toBeInTheDocument();
  });
});