import { Routes, Route, Navigate } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import ProtectedRoute from 'components/ProtectedRoute';
import { _resetNav } from 'runtime/registerNav';
import { registerRoute, _resetRoutes } from 'runtime/registerRoute';

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    isLoggedIn: true,
    isLoading: false
  })
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    modules: ['order-nexus'],
    flags: [],
    hasResolved: true,
    isLoading: false
  })
}));

describe('routing invariant: route access independent of nav', () => {
  beforeEach(() => {
    _resetNav();
    _resetRoutes();

    registerRoute({
      id: 'orders',
      path: '/orders',
      component: () => null,
      requiredModuleId: 'order-nexus',
      order: 100
    });
  });

  it('allows access to an entitled route even if nav item is missing', async () => {
    const OrdersPage = () => <div data-testid="orders-page" />;

    registerRoute({
        id: 'orders',
        path: '/orders',
        component: () => null,
        requiredModuleId: 'order-nexus',
        order: 100
    });

    renderWithProviders(
      <Routes>
        <Route
          path="/orders"
          element={
            <ProtectedRoute requiredModuleId="order-nexus">
              <OrdersPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>,
      {
        routerProps: { initialEntries: ['/orders'] }
      }
    );

    expect(await screen.findByTestId('orders-page')).toBeInTheDocument();
  });
});