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
import CheckInboxPage from 'pages/authentication/CheckInboxPage';
import VerifyEmailPage from 'pages/authentication/VerifyEmailPage';
import ResetPasswordPage from 'pages/authentication/ResetPasswordPage';
import WmsDisplayPage from 'pages/display/WmsDisplayPage';
import { shouldEnableActivationPreviewRoute } from 'activation/activationPreviewFixtures';

// OV-36: intentionally NOT constructed here. A module-scope client is a
// process-lifetime singleton — logout unmounts its provider (:122) but the
// cache survives, so the next tenant to log in reads the previous tenant's
// data. Built per-shop inside AuthenticatedAppShell instead.

function RuntimeRoutesSubscriber() {
  useRuntimeRoutes();
  return null;
}

const activationPreviewRouteEnabled = shouldEnableActivationPreviewRoute(import.meta.env.DEV);
const ActivationExperiencePreview = activationPreviewRouteEnabled
  ? React.lazy(() => import('activation/ActivationExperiencePreview'))
  : null;

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

function LifecycleGuardedApp() {
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
    <AppLayout>
      <ShopLifecycleGate>
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
  const { isLoading, isLoggedIn, user } = useAuth();

  // OV-36: one QueryClient per tenant, rebuilt when shop_id changes.
  // No query key in this app carries a shop dimension, so a cache shared
  // across a tenant switch serves shop A's zones, batches, order pool and
  // alerts to shop B. Rebuilding the client is structural rather than
  // corrective: a fresh client has an empty cache, so there is no stale
  // entry to read and no post-paint effect racing the first render.
  // shop_id (not user.id) is the key — two operators in one shop are the
  // same tenant and should share a warm cache. Confirmed present on all
  // three hydration paths in AuthContext: login(), localStorage rehydrate,
  // and the OAuth handoff decode.
  // NOTE: covers this provider only. WmsDisplayPage is a public route under
  // main.tsx's client and is scoped by shop_display_tokens, not a user
  // session — see OV-37 for that client's separate lifecycle.
  // invalidation trigger, not a value the factory reads. The rule flags it as
  // unnecessary because new QueryClient() takes no arguments; removing it
  // would rebuild the client every render and refetch every query forever.
  const tenantQueryClient = React.useMemo(
    () => new QueryClient(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.shop_id]
  );
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
  return (
    <QueryClientProvider client={tenantQueryClient}>
      <RuntimeRoutesProvider>
        <RuntimeRoutesSubscriber />

          <IntegrationProvider>
            <ThemeCustomization>
              <EntitlementsProvider>
                <SpecterConfigProvider>
                  <IntlErrorBoundary>
                    <LifecycleProvider>
                      <ShopLifecycleShell>
                        <LifecycleGuardedApp />
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
          <Route
            path="/connect-store"
            element={
              <ProtectedRoute>
                <ConnectStorePage />
              </ProtectedRoute>
            }
          />
          {/* AUTH-007: A5 email verification inbox screen */}
          <Route path="/check-inbox" element={<CheckInboxPage />} />
          {/* AUTH-007: verify-email token handler — verifies then redirects to /connect-store */}
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          {/* Password reset — token from email link */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/wms/analytics/display" element={<WmsDisplayPage />} />
          {activationPreviewRouteEnabled && ActivationExperiencePreview && (
            <Route
              path="/dev/activation-preview"
              element={
                <React.Suspense fallback={null}>
                  <ActivationExperiencePreview />
                </React.Suspense>
              }
            />
          )}
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
