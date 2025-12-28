//apps/frontend/src/debug/RouteLogger.tsx
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * RouteLogger
 * -----------
 * DEV-ONLY diagnostic component.
 * Logs every route transition to console.
 *
 * Safe to remove once debugging is complete.
 */
export function RouteLogger() {
  const location = useLocation();

  useEffect(() => {
    console.debug('[Router] location changed →', location.pathname);
  }, [location.pathname]);

  return null;
}
