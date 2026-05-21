/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/App.tsx

import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from 'contexts/AuthContext';

import { IntegrationProvider } from 'contexts/integration/IntegrationProvider';
import { EntitlementsProvider } from 'contexts/EntitlementsContext';
import { SpecterConfigProvider } from 'contexts/SpecterConfigContext';

import ProtectedRoute from './components/ProtectedRoute';
import { RuntimeRoutesProvider } from 'runtime/RuntimeRoutesProvider';
import { useRuntimeRoutes } from 'runtime/useRuntimeRoutes';

import ThemeCustomization from './themes';
import LoginPage from 'pages/authentication/LoginPage';
import RegisterPage from 'pages/authentication/RegisterPage';
import ForgotPasswordPage from 'pages/authentication/ForgotPasswordPage';

import { ShopLifecycleShell } from 'lifecycle/ShopLifecycleShell';
import { ShopLifecycleGate } from 'lifecycle/ShopLifecycleGate';
import { LifecycleProvider } from 'lifecycle/LifecycleProvider';
import { LifecycleRouteHost } from 'lifecycle/LifecycleRouteHost';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';

import AppLayout from 'layouts/AppLayout';
import { EntitlementBoundary } from 'runtime/EntitlementBoundary';
import ConnectStorePage from 'pages/authentication/ConnectStorePage';

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

function LifecycleGuardedApp({
  isConnectModalOpen,
  onCloseConnectModal,
  onActivation,
}: {
  isConnectModalOpen: boolean;
  onCloseConnectModal: () => void;
  onActivation: (actionId: string) => void;
}) {
  const { isBooting, phase } = useShopLifecycle();

  /**
   * CRITICAL:
   * Block ALL rendering only during true lifecycle boot.
   * This prevents pre-lifecycle flash (FT_MINUS_ONE → FT0 → FT1).
   *
   * DO NOT block FT_MINUS_ONE or FT0 here.
   * They must render inside AppLayout via ShopLifecycleGate.
   */
  if (isBooting) {
    console.warn('[LIFECYCLE_GUARD][BOOT_BLOCK]', {
      phase,
      ts: performance.now(),
    });

    return null;
  }

  return (
    <AppLayout
      isConnectModalOpen={isConnectModalOpen}
      onCloseConnectModal={onCloseConnectModal}
    >
      <ShopLifecycleGate onActivation={onActivation}>
        <>
          <EntitlementBoundary>
            <LifecycleRouteHost />
          </EntitlementBoundary>
        </>
      </ShopLifecycleGate>
    </AppLayout>
  );
}

/* ─────────────────────────────
   AUTHENTICATED APP SHELL
   (ALWAYS mounts AppLayout)
───────────────────────────── */
function AuthenticatedAppShell() {
  const { isLoading, isLoggedIn } = useAuth();
  const [isConnectModalOpen, setIsConnectModalOpen] = React.useState(false);

  /**
   * CRITICAL: FIRST-PAINT BLOCK (must be before any return)
   */
  const [hasMounted, setHasMounted] = React.useState(false);

  React.useEffect(() => {
    setHasMounted(true);
  }, []);

  /**
   * BLOCK 1: auth not ready
   */
  if (isLoading || !isLoggedIn) return null;

  /**
   * BLOCK 2: prevent first paint before effects run
   */
  if (!hasMounted) {
    console.warn('[APP_SHELL_PREVENT_FIRST_PAINT]');
    return null;
  }

  const handleActivation = (actionId: string) => {
    if (actionId === 'connect-store') {
      setIsConnectModalOpen(true);
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeRoutesProvider>
        <RuntimeRoutesSubscriber />

          <IntegrationProvider>
            <ThemeCustomization>
              <EntitlementsProvider>
                <SpecterConfigProvider>
                  <IntlErrorBoundary>
                    <LifecycleProvider>
                      <ShopLifecycleShell>
                        <LifecycleGuardedApp
                          isConnectModalOpen={isConnectModalOpen}
                          onCloseConnectModal={() => setIsConnectModalOpen(false)}
                          onActivation={handleActivation}
                        />
                      </ShopLifecycleShell>
                    </LifecycleProvider>
                  </IntlErrorBoundary>
                </SpecterConfigProvider>
              </EntitlementsProvider>
            </ThemeCustomization>
          </IntegrationProvider>

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
          {/* AUTH-018: forgot-password is public — no auth required */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          {/* AUTH-005/006: A3 connect-store step — auth-protected post-registration */}
          <Route path="/connect-store" element={<ConnectStorePage />} />
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