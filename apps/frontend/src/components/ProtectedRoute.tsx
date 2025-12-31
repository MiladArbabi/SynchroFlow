// apps/frontend/src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';

import { useAuth } from 'contexts/AuthContext';
import { useEntitlements } from 'contexts/EntitlementsContext';

/**
 * ProtectedRoute
 * --------------
 * Guards the authenticated application shell.
 *
 * Responsibilities:
 * - Wait for auth + entitlements resolution
 * - Redirect unauthenticated users
 *
 * It MUST NOT:
 * - Inspect routes
 * - Enforce module access
 * - Encode lifecycle or activation logic
 */
const ProtectedRoute: React.FC = () => {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const { hasResolved } = useEntitlements();

  // 1️⃣ Wait for auth + entitlements
  // ✅ wait only for auth
  if (authLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // ✅ unauthenticated users should NEVER wait for entitlements
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  // ✅ authenticated users may now wait for entitlements
  if (!hasResolved) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return <Outlet />;
};

export default ProtectedRoute;
