/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/App.tsx

import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from 'contexts/AuthContext';

import { IntegrationProvider } from 'contexts/integration/IntegrationProvider';
import { DashboardStateProvider } from 'contexts/DashboardStateContext';
import { EntitlementsProvider } from 'contexts/EntitlementsContext';
import { SpecterConfigProvider } from 'contexts/SpecterConfigContext';

import ProtectedRoute from './components/ProtectedRoute';
import { RuntimeRoutesProvider } from 'runtime/RuntimeRoutesProvider';
import { useRuntimeRoutes } from 'runtime/useRuntimeRoutes';

import ThemeCustomization from './themes';
import LoginPage from 'pages/authentication/LoginPage';
import RegisterPage from 'pages/authentication/RegisterPage';

import { ShopLifecycleShell } from 'lifecycle/ShopLifecycleShell';
import { ShopLifecycleGate } from 'lifecycle/ShopLifecycleGate';
import { LifecycleProvider } from 'lifecycle/LifecycleProvider';
import { LifecycleRouteHost } from 'lifecycle/LifecycleRouteHost';

import AppLayout from 'layouts/AppLayout';
import { EntitlementBoundary } from 'runtime/EntitlementBoundary';

const queryClient = new QueryClient();

function RuntimeRoutesSubscriber() {
  useRuntimeRoutes();
  return null;
}

/* ─────────────────────────────
   Error Boundary
───────────────────────────── */
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

/* ─────────────────────────────
   PUBLIC (NO APP LAYOUT)
───────────────────────────── */
function PublicAppShell() {
  return (
    <ThemeCustomization>
      <Outlet />
    </ThemeCustomization>
  );
}

/* ─────────────────────────────
   AUTHENTICATED APP SHELL
   (ALWAYS mounts AppLayout)
───────────────────────────── */
function AuthenticatedAppShell() {
  const { isLoading, isLoggedIn } = useAuth();
  const [isConnectModalOpen, setIsConnectModalOpen] = React.useState(false);

  if (isLoading || !isLoggedIn) return null;

  const handleActivation = (actionId: string) => {
    if (actionId === 'connect-store') {
      setIsConnectModalOpen(true);
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeRoutesProvider>
        <RuntimeRoutesSubscriber />

        <DashboardStateProvider>
          <IntegrationProvider>
            <ThemeCustomization>
              <EntitlementsProvider>
                <SpecterConfigProvider>
                  <IntlErrorBoundary>
                    <LifecycleProvider>
                      <ShopLifecycleShell>
                        <AppLayout
                          isConnectModalOpen={isConnectModalOpen}
                          onCloseConnectModal={() => setIsConnectModalOpen(false)}
                        >
                          <ShopLifecycleGate onActivation={handleActivation}>
                            <EntitlementBoundary>
                              <LifecycleRouteHost />
                            </EntitlementBoundary>
                          </ShopLifecycleGate>
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

/* ─────────────────────────────
   ROOT ROUTER
───────────────────────────── */
export default function App() {
  return (
    <AuthProvider>
      <Routes>

        {/* ===== PUBLIC ===== */}
        <Route element={<PublicAppShell />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        {/* ===== APP (AUTH REQUIRED) ===== */}
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AuthenticatedAppShell />
            </ProtectedRoute>
          }
        />

        {/* ===== FALLBACK ===== */}
        <Route path="*" element={<Navigate to="/login" replace />} />

      </Routes>
    </AuthProvider>
  );
}