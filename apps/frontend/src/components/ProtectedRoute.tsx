// apps/frontend/src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from 'contexts/AuthContext';

/**
 * ProtectedRoute
 * --------------
 * Guards authenticated routes ONLY.
 *
 * Responsibilities:
 * - Wait for auth resolution
 * - Redirect unauthenticated users
 *
 * It MUST NOT:
 * - Access entitlements
 * - Trigger lifecycle logic
 * - Depend on app providers
 */

// apps/frontend/src/components/ProtectedRoute.tsx
export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isLoading, accessToken, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isLoggedIn || !accessToken) {
    return <Navigate to="/login" replace />;
  }

  /**
   * OPERATOR ROUTE GUARD (WM-31)
   * ----------------------------
   * Operators are restricted to /wms only.
   * Any other route redirects to /wms.
   * Will be superseded by action-level entitlements in WM-19.
   */
  if (user?.role === 'operator' && !location.pathname.startsWith('/wms')) {
    return <Navigate to="/wms" replace />;
  }

  return <>{children}</>;
};