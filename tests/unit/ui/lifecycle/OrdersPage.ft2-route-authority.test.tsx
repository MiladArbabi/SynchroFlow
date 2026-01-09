/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from 'test-utils';

import OrdersPage from 'pages/OrdersPage';
import { ShopLifecycleContext } from 'lifecycle/ShopLifecycleContext';

// ---- mocks ----
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

// FT2 snapshot resolves
jest.mock('pages/orders/useOrdersFt2Snapshot', () => ({
  useOrdersFt2Snapshot: () => ({
    isSuccess: true,
    isLoading: false,
    data: {},
  }),
}));

describe('OrdersPage — FT2 route authority', () => {
  test('FT2 lifecycle without FT2 routes → NOTHING renders', () => {
    renderWithProviders(
      <ShopLifecycleContext.Provider value={{ phase: 'FT2_READY' } as any}>
        {/* 🔴 OrdersPage mounted directly, NOT via FT2 route tree */}
        <OrdersPage />
      </ShopLifecycleContext.Provider>
    );

    expect(
      screen.queryByTestId('orders-ft1')
    ).not.toBeInTheDocument();

    expect(
      screen.queryByTestId('orders-ft2')
    ).not.toBeInTheDocument();
  });
});