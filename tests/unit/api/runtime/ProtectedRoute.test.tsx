// tests/unit/api/runtime/ProtectedRoute.test.ts
import React from 'react';
import { render, screen } from '@testing-library/react';
import ProtectedRoute from 'components/ProtectedRoute';
import { Navigate, MemoryRouter, Routes, Route } from 'react-router-dom';

// mock hooks
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: true, isLoading: false })
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({ modules: [], flags: [], isLoading: false })
}));

// mock registered routes
jest.mock('runtime/registerRoute', () => ({
  getRegisteredRoutes: () => [
    { id: 'orders', path: '/orders', requiredModuleId: 'order-nexus' },
    { id: 'analytics', path: '/analytics' }
  ]
}));

// render initialEntries ['/orders'] where orders has requiredModuleId and upgradeRoute
jest.mock('runtime/registerRoute', () => ({
  getRegisteredRoutes: () => [
    { id: 'orders', path: '/orders', requiredModuleId: 'order-nexus', upgradeRoute: '/upgrade' },
  ]
}));

describe('ProtectedRoute entitlement gating', () => {
  test('redirects gated route to /dashboard when entitlement missing', async () => {
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/orders" element={<div>orders</div>} />
            <Route path="/dashboard" element={<div>dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    // The route is gated and our ProtectedRoute now shows the GatedPlaceholder UI.
    // Assert gated placeholder is shown (upgrade CTA + back button).
    expect(await screen.findByTestId('gated-upgrade')).toBeInTheDocument();
    expect(await screen.findByTestId('gated-back')).toBeInTheDocument();
  });

  test('allows cross-sell paths (analytics) even when module missing', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/analytics" element={<div>analytics</div>} />
            <Route path="/dashboard" element={<div>dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('analytics')).toBeInTheDocument();
  });
});
