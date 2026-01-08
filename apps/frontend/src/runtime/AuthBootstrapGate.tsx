import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from 'contexts/AuthContext';

/**
 * AuthBootstrapGate
 * -----------------
 * Hard gate: blocks ALL authenticated app bootstrap
 * until auth state is fully resolved.
 *
 * Prevents:
 * - premature entitlements fetch
 * - premature integration polling
 * - token-less API calls after login
 */
export default function AuthBootstrapGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isLoggedIn } = useAuth();

  if (isLoading) {
    if (import.meta.env.DEV) {
      console.debug('[AUTH_BOOTSTRAP] waiting for auth resolution');
    }

    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isLoggedIn) {
    // ProtectedRoute will handle redirect
    return null;
  }

  if (import.meta.env.DEV) {
    console.debug('[AUTH_BOOTSTRAP] auth resolved, booting app');
  }

  return <>{children}</>;
}