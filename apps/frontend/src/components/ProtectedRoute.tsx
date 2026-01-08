// apps/frontend/src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
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
const ProtectedRoute: React.FC = () => {
  const { isLoggedIn, isLoading, accessToken } = useAuth();

  if (import.meta.env.DEV) {
    console.log('[ProtectedRoute]', { isLoading, isLoggedIn, hasToken: !!accessToken });
  }

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

  console.error('[PROTECTED_ROUTE] OUTLET RENDER');

  return <Outlet />;
};

export default ProtectedRoute;