/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/App.tsx

import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth, AuthProvider } from 'contexts/AuthContext';

import { IntegrationProvider } from 'contexts/integration/IntegrationProvider';
import { DashboardStateProvider } from 'contexts/DashboardStateContext';
import { EntitlementsProvider } from 'contexts/EntitlementsContext';
import { SpecterConfigProvider } from 'contexts/SpecterConfigContext';

import ProtectedRoute from './components/ProtectedRoute';
import ModuleBootstrap from 'runtime/ModuleBootstrap';
import { RuntimeRoutesProvider } from 'runtime/RuntimeRoutesProvider';
import { useRuntimeRoutes } from 'runtime/useRuntimeRoutes';

import ThemeCustomization from './themes';
import LoginPage from 'pages/authentication/LoginPage';
import RegisterPage from 'pages/authentication/RegisterPage';

import { ShopLifecycleShell } from 'lifecycle/ShopLifecycleShell';
import { ShopLifecycleGate } from 'lifecycle/ShopLifecycleGate';
import { LifecycleProvider } from 'lifecycle/LifecycleProvider';

import AnalyticsPage from 'pages/AnalyticsPage';
import CustomersPage from 'pages/CustomersPage';
import { DashboardPage } from 'pages/DashboardPage';
import FinancesPage from 'pages/FinancesPage';
import OrdersPage from 'pages/OrdersPage';
import ProductsPage from 'pages/ProductsPage';
import AppLayout from 'layouts/AppLayout';

const queryClient = new QueryClient();

function RuntimeRoutesSubscriber() {
  useRuntimeRoutes();
  return null;
}

class IntlErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any) {
    console.error('[IntlErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <h2>UI rendering error</h2>
          <pre>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}

function PublicAppShell() {
  return (
    <ThemeCustomization>
      <Outlet />
    </ThemeCustomization>
  );
}

function AuthenticatedAppShell() {
  const { isLoading, isLoggedIn } = useAuth();

  if (isLoading || !isLoggedIn) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeRoutesProvider>
        <RuntimeRoutesSubscriber />

        <DashboardStateProvider>
          <IntegrationProvider>
            <ThemeCustomization>
              <EntitlementsProvider>
                <SpecterConfigProvider>
                  <ModuleBootstrap />
                  <IntlErrorBoundary>
                    <LifecycleProvider>
                      <ShopLifecycleShell>
                        <AppLayout>
                          {/* 🔒 SINGLE lifecycle authority */}
                          <ShopLifecycleGate />

                          {/* Pages mount ONLY if lifecycle allows */}
                          <Outlet />
                        </AppLayout>
                      </ShopLifecycleShell>
                    </LifecycleProvider>
                  </IntlErrorBoundary>
                </SpecterConfigProvider>
              </EntitlementsProvider>
            </ThemeCustomization>
          </IntegrationProvider>
        </DashboardStateProvider>
      </RuntimeRoutesProvider>
    </QueryClientProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* ===== PUBLIC ===== */}
        <Route element={<PublicAppShell />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        {/* ===== AUTHENTICATED ===== */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AuthenticatedAppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/orders/*" element={<OrdersPage />} />
            <Route path="/customers/*" element={<CustomersPage />} />
            <Route path="/products/*" element={<ProductsPage />} />
            <Route path="/analytics/*" element={<AnalyticsPage />} />
            <Route path="/finances/*" element={<FinancesPage />} />
          </Route>
        </Route>

        {/* ===== FALLBACK ===== */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </AuthProvider>
  );
}
