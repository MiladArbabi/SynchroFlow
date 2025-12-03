/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from 'contexts/AuthContext';
import { Box, CircularProgress } from '@mui/material';
import { useEntitlements } from 'contexts/EntitlementsContext';
import routes, { isRouteEnabled } from 'routes';

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

  // We only care about routes defined in routes.tsx
  const matchingRoute = (routes as any[]).find(
    (r) => typeof r.route === 'string' && r.route === currentPath
  );

  if (matchingRoute) {
    const snapshot = {
      modules,
      flags
    } as any;

    // If the route is gated and the user doesn’t satisfy it, bounce them to dashboard
    if (!isRouteEnabled(matchingRoute, snapshot)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // 4. Authenticated and either ungated or allowed by entitlements → render app
  return <Outlet />;
};

export default ProtectedRoute;