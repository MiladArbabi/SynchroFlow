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
  if (authLoading || !hasResolved) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // 2️⃣ Redirect unauthenticated users
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  // 3️⃣ Authenticated → enter app shell
  return <Outlet />;
};

export default ProtectedRoute;
