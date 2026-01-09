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

// 🔴 Critical: FT2 snapshot resolves even though lifecycle is FT1
jest.mock('pages/orders/useOrdersFt2Snapshot', () => ({
  useOrdersFt2Snapshot: () => ({
    isSuccess: true,
    isLoading: false,
    data: {},
  }),
}));

describe('OrdersPage — FT2 data must NOT upgrade UI', () => {
  test('FT1 lifecycle + FT2 snapshot → MUST render FT1 only', () => {
    renderWithProviders(
      <ShopLifecycleContext.Provider value={{ phase: 'FT1_READY' } as any}>
        <OrdersPage />
      </ShopLifecycleContext.Provider>
    );

    // ✅ FT1 must render
    expect(
      screen.getByTestId('orders-ft1')
    ).toBeInTheDocument();

    // ❌ FT2 must NOT render
    expect(
      screen.queryByTestId('orders-ft2')
    ).not.toBeInTheDocument();
  });
});