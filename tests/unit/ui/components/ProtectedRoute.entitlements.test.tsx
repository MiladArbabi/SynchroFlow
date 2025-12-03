// tests/unit/ui/components/ProtectedRoute.entitlements.test.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import ProtectedRoute from 'components/ProtectedRoute';
import { useAuth } from 'contexts/AuthContext';
import { useEntitlements } from 'contexts/EntitlementsContext';

// --- Mocks ---

jest.mock('contexts/AuthContext');
jest.mock('contexts/EntitlementsContext');

// Mock the routes module so we fully control gating metadata in this test
jest.mock('routes', () => {
  const routes = [
    { key: 'dashboard', route: '/dashboard' },
    { key: 'analytics', route: '/analytics', requiredModuleId: 'mod:analytics' }
  ];

  const isRouteEnabled = (
    route: any,
    ent: { modules: string[]; flags: string[] } | null
  ) => {
    if (!route.requiredModuleId && !route.requiredFlagId) return true;
    if (!ent) return false;

    const hasModule = route.requiredModuleId
      ? ent.modules.includes(route.requiredModuleId)
      : true;

    const hasFlag = route.requiredFlagId
      ? ent.flags.includes(route.requiredFlagId)
      : true;

    return hasModule && hasFlag;
  };

  return {
    __esModule: true,
    default: routes,
    isRouteEnabled
  };
});

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseEntitlements =
  useEntitlements as jest.MockedFunction<typeof useEntitlements>;

const renderWithRouter = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div data-testid="dashboard-page" />} />
          <Route path="/analytics" element={<div data-testid="analytics-page" />} />
        </Route>
        <Route path="/login" element={<div data-testid="login-page" />} />
      </Routes>
    </MemoryRouter>
  );

describe('ProtectedRoute entitlement gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the child route when authenticated and route is not gated', () => {
    mockedUseAuth.mockReturnValue({
      isLoggedIn: true,
      isLoading: false,
      accessToken: 'token',
      user: null,
      login: jest.fn(),
      logout: jest.fn()
    } as any);

    mockedUseEntitlements.mockReturnValue({
      shopId: 1,
      modules: [],
      flags: [],
      isLoading: false,
      error: null,
      hasModule: jest.fn(),
      hasFlag: jest.fn(),
      refresh: jest.fn()
    });

    renderWithRouter('/dashboard');

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', () => {
    mockedUseAuth.mockReturnValue({
      isLoggedIn: false,
      isLoading: false,
      accessToken: null,
      user: null,
      login: jest.fn(),
      logout: jest.fn()
    } as any);

    mockedUseEntitlements.mockReturnValue({
      shopId: null,
      modules: [],
      flags: [],
      isLoading: false,
      error: null,
      hasModule: jest.fn(),
      hasFlag: jest.fn(),
      refresh: jest.fn()
    });

    renderWithRouter('/analytics');

    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  it('allows access to a gated route when entitlements satisfy requirements', () => {
    mockedUseAuth.mockReturnValue({
      isLoggedIn: true,
      isLoading: false,
      accessToken: 'token',
      user: null,
      login: jest.fn(),
      logout: jest.fn()
    } as any);

    mockedUseEntitlements.mockReturnValue({
      shopId: 1,
      modules: ['mod:analytics'],
      flags: [],
      isLoading: false,
      error: null,
      hasModule: jest.fn(),
      hasFlag: jest.fn(),
      refresh: jest.fn()
    });

    renderWithRouter('/analytics');

    expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
  });

  it('redirects to dashboard when entitlements do NOT satisfy the route requirements', async () => {
    mockedUseAuth.mockReturnValue({
      isLoggedIn: true,
      isLoading: false,
      accessToken: 'token',
      user: null,
      login: jest.fn(),
      logout: jest.fn()
    } as any);

    mockedUseEntitlements.mockReturnValue({
      shopId: 1,
      modules: [], // missing mod:analytics
      flags: [],
      isLoading: false,
      error: null,
      hasModule: jest.fn(),
      hasFlag: jest.fn(),
      refresh: jest.fn()
    });

    renderWithRouter('/analytics');

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });
});