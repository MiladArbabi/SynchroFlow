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
  const { isLoggedIn, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;