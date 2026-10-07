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

/** True when `pathname` is `base` itself or a path-segment descendant of it. */
function isWithin(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function isOperatorAdmitted(pathname: string): boolean {
  if (isWithin(pathname, '/wms/analytics')) return false;
  return isWithin(pathname, '/wms') || isWithin(pathname, '/problem-center');
}

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
    /**
     * RETURN-TO GUARD
     * ───────────────
     * Persists the intended destination before redirecting to /login.
     * AuthLogin.tsx reads sessionStorage.returnTo post-login and
     * navigates there instead of the default /overview.
     *
     * Covers: bookmarks, direct URLs, cross-tab navigation, and any
     * route the user was mid-workflow on when their session expired.
     *
     * Mirrors the same logic in hardLogout() in axiosConfig.ts —
     * both paths into /login must save returnTo consistently.
     */
    const intended = location.pathname + location.search;
    if (intended !== '/login') {
      sessionStorage.setItem('returnTo', intended);
    }
    return <Navigate to="/login" replace />;
  }

  /**
   * OPERATOR ROUTE GUARD (WM-31, GH-1222)
   * -------------------------------------
   * Operators are admitted to warehouse execution surfaces only:
   *   /wms and its descendants, EXCEPT /wms/analytics (owner/admin management)
   *   /problem-center (operational exception queue)
   * Everything else redirects to /wms. Role-route UX admission only — backend
   * requireAction remains the authority; no commercial inspection here.
   */
  if (user?.role === 'operator' && !isOperatorAdmitted(location.pathname)) {
    return <Navigate to="/wms" replace />;
  }

  return <>{children}</>;
};