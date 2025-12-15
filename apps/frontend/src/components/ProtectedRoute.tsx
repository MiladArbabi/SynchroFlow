/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from 'contexts/AuthContext';
import { Box, CircularProgress } from '@mui/material';
import { useEntitlements } from 'contexts/EntitlementsContext';
import routes, { isRouteEnabled } from 'routes';
import { getRegisteredRoutes } from 'runtime/registerRoute';
import GatedPlaceholder from 'ui-component/GatedPlaceholder';

/**
 * A component to protect routes from unauthenticated access.
 * It checks the authentication state from AuthContext.
 */
const ProtectedRoute: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const { modules, flags, isLoading: entLoading, hasResolved } = useEntitlements();
  const location = useLocation();

  // 1. Show a full-screen loader while auth or entitlements are being checked
  if (authLoading || !hasResolved) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh'
        }}
      >
        <CircularProgress />
      </Box>
    );
  };

  // 2. If not authenticated, redirect to the login page
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  // 3. Authenticated: enforce entitlement gating for the matched route, if any
  const currentPath = location.pathname;

  // --- Runtime module bootstrap escape hatch ---
  // If user is authenticated and we're on a known module route
  // but runtime routes are not registered yet, do NOT redirect.
  if (
    isLoggedIn &&
    (
      currentPath.startsWith('/orders') ||
      currentPath.startsWith('/modules/')
    )
  ) {
    return <Outlet />;
  }

  // We only care about routes defined in routes.tsx and runtime-registered routes
  const matchingRouteRaw = getRegisteredRoutes().find(
    (r) =>
      r.path === currentPath ||
      (r.path !== '/' && currentPath.startsWith(r.path + '/'))
  );

  if (matchingRouteRaw) {
    // Cast to any to avoid strict structural mismatch with RouteConfig (RouteConfig uses `route` key)
    const matchingRoute: any = matchingRouteRaw;

    // Cross-sell exception (static routes only)
    const crossSellPaths = ['/analytics', '/finances'];
    if (!crossSellPaths.includes(currentPath)) {

      // 🧠 Runtime module route (e.g. /orders)
      if (matchingRoute.requiredModuleId) {
        if (!modules.includes(matchingRoute.requiredModuleId)) {
          return <Navigate to="/dashboard" replace />;
        }
      }

      // 🧱 Static route (defined in routes.tsx)
      else {
        const snapshot = { modules, flags } as any;

        const routeForCheck = {
          ...(matchingRoute as any),
          route: matchingRoute.path
        } as any;

        if (!isRouteEnabled(routeForCheck, snapshot)) {
          return <Navigate to="/dashboard" replace />;
        }
      }
    }
  }

  // 4. Authenticated and either ungated or allowed by entitlements → render app
  return children ? <>{children}</> : <Outlet />;
};

export default ProtectedRoute;