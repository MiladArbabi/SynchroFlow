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
const ProtectedRoute: React.FC = () => {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const { modules, flags, isLoading: entLoading } = useEntitlements();
  const location = useLocation();

  // 1. Show a full-screen loader while auth or entitlements are being checked
  if (authLoading || entLoading) {
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
  }

    // 2. If not authenticated, redirect to the login page
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  // 3. Authenticated: enforce entitlement gating for the matched route, if any
  const currentPath = location.pathname;

  // We only care about routes defined in routes.tsx and runtime-registered routes
  const matchingRouteRaw = getRegisteredRoutes().find((r) => r.path === currentPath);

  if (matchingRouteRaw) {
    // Cast to any to avoid strict structural mismatch with RouteConfig (RouteConfig uses `route` key)
    const matchingRoute: any = matchingRouteRaw;

    // Cross-sell exception:
    // Analytics & Finances routes should always be reachable,
    // even if the user doesn't yet have those modules.
    const crossSellPaths = ['/analytics', '/finances'];
    if (!crossSellPaths.includes(currentPath)) {
      const snapshot = {
        modules,
        flags
      } as any;

      // Build a RouteConfig-like object for the entitlement check.
      // `isRouteEnabled` expects a RouteConfig with a `route` string — runtime uses `path`.
      const routeForCheck = {
        ...(matchingRoute as any),
        route: matchingRoute.path // satisfy RouteConfig shape
      } as any;

      // If the route is gated and the user doesn’t satisfy it, show placeholder or bounce
      if (!isRouteEnabled(routeForCheck, snapshot)) {
        // prefer showing gated placeholder if module provided an upgradeRoute or
        // if the route has 'showGatedPlaceholder' meta flag
        const showPlaceholder = !!(matchingRoute.upgradeRoute || matchingRoute.meta?.showGatedPlaceholder);

        if (showPlaceholder) {
          return (
            <GatedPlaceholder
              routeName={matchingRoute.name || matchingRoute.path}
              missingModules={matchingRoute.requiredModuleId ? [matchingRoute.requiredModuleId] : []}
              missingFlags={matchingRoute.requiredFlagId ? [matchingRoute.requiredFlagId] : []}
              upgradeRoute={matchingRoute.upgradeRoute}
            />
          );
        }
        // otherwise fallback redirect
        return <Navigate to="/dashboard" replace />;
      }
    }
  }

  // 4. Authenticated and either ungated or allowed by entitlements → render app
  return <Outlet />;
};

export default ProtectedRoute;