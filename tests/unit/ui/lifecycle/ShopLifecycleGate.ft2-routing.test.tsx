/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from 'test-utils';

import { Routes, Route } from 'react-router-dom';
import { ShopLifecycleGate } from 'lifecycle/ShopLifecycleGate';
import { ShopLifecycleContext } from 'lifecycle/ShopLifecycleContext';

import OrdersPage from 'pages/OrdersPage';

// ─── mocks ───────────────────────────────────────────────

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { shop_id: 123 },
    isLoading: false,
    isLoggedIn: true,
  }),
}));

jest.mock('@lasyncro/order-nexus', () => ({
  OrdersModule: () => <div data-testid="orders-ft1" />,
  OrdersModuleFT2: () => <div data-testid="orders-ft2" />,
}));

jest.mock('lifecycle/useOnboardingReadiness', () => ({
  useOnboardingReadiness: () => ({
    isSuccess: true,
    data: {},
  }),
}));

jest.mock('pages/orders/useOrdersFt2Snapshot', () => ({
  useOrdersFt2Snapshot: () => ({
    isSuccess: true, // 🔴 even if FT2 snapshot exists
    isLoading: false,
    data: {},
  }),
}));

// ─── helper ──────────────────────────────────────────────

function renderAt(path: string, phase: any) {
  return renderWithProviders(
    <ShopLifecycleContext.Provider value={{ phase } as any}>
      <Routes>
        {/* 🔴 NOTE: ONLY generic routes, no FT2 route tree */}
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

// ─── tests ───────────────────────────────────────────────

describe('FT2 routing authority', () => {
  test('FT2 modules do NOT mount unless FT2 routes are explicitly mounted', () => {
    renderAt('/orders', 'FT2_READY');

    // 🔴 OrdersPage renders, but FT2 module MUST NOT
    expect(
      screen.queryByTestId('orders-ft2')
    ).not.toBeInTheDocument();

    // Optional sanity: FT1 also should not appear
    expect(
      screen.queryByTestId('orders-ft1')
    ).not.toBeInTheDocument();
  });
});
