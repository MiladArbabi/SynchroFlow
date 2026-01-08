/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/
import React from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { IntegrationProvider } from 'contexts/integration/IntegrationProvider';
import { DashboardStateProvider } from "contexts/DashboardStateContext";
import { EntitlementsProvider } from 'contexts/EntitlementsContext';
import { SpecterConfigProvider } from "contexts/SpecterConfigContext";

import ProtectedRoute from "./components/ProtectedRoute";
import ModuleBootstrap from 'runtime/ModuleBootstrap';
import { RuntimeRoutesProvider } from "runtime/RuntimeRoutesProvider";
import { useRuntimeRoutes } from 'runtime/useRuntimeRoutes';

import OrdersPage from "pages/OrdersPage";
import CustomersPage from "pages/CustomersPage";
import ProductsPage from "pages/ProductsPage";

// --- BERRY THEME IMPORT ---
import ThemeCustomization from './themes';
import FinancesPage from "pages/FinancesPage";
import AnalyticsPage from "pages/AnalyticsPage";
/* import { ConnectStoreModal } from "components/ConnectStoreModal"; */

import { DashboardPage } from "pages/DashboardPage";
import { ModuleLifecycleShell } from "lifecycle/ModuleLifecycleShell";
import LoginPage from "pages/authentication/LoginPage";
import RegisterPage from "pages/authentication/RegisterPage";
import { DashboardLifecycleShell } from "lifecycle/DashboardLifecycleShell";
import { ShopLifecycleShell } from "lifecycle/ShopLifecycleShell";
import { ShopLifecycleGate } from "lifecycle/ShopLifecycleGate";
import { LifecycleProvider } from "lifecycle/LifecycleProvider";
import { useIntegration } from "contexts/integration/useIntegration";

const queryClient = new QueryClient();
function RuntimeRoutesSubscriber() {
  // This hook ONLY forces rerender when routes change
  // We intentionally ignore the value
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
    console.error('[IntlErrorBoundary] Caught error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <h2>UI rendering error</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
};

function LifecycleGate() {
  const integration = useIntegration();

  if (import.meta.env.DEV) {
    console.debug('[APP_LIFECYCLE_GATE]', {
      isResolved: integration.isResolved,
      existence: integration.existence,
      ts: performance.now(),
    });
  }

  // 🔒 Hard gate: lifecycle must not mount until integration is authoritative
  if (!integration.isResolved) {
    return null;
  }

  return (
    <LifecycleProvider>
      <ShopLifecycleShell>
        <ShopLifecycleGate />
      </ShopLifecycleShell>
    </LifecycleProvider>
  );
}

function PublicAppShell() {
  return (
    <ThemeCustomization>
      <Outlet />
    </ThemeCustomization>
  );
}

function AuthenticatedAppShell() {
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
                    <LifecycleGate />
                    <Outlet />
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
  );
}