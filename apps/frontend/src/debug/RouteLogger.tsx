//apps/frontend/src/debug/RouteLogger.tsx
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useUiEvents } from 'analytics/useUiEvents';

/**
 * RouteLogger
 * -----------
 * DEV-ONLY diagnostic component.
 * Logs every route transition to console.
 *
 * Safe to remove once debugging is complete.
 */
export function RouteLogger() {
  const { emit } = useUiEvents();
  const location = useLocation();

  console.log('[RouteLogger] render', location.pathname); 

  useEffect(() => {
    console.log('[RouteLogger] EFFECT FIRED', location.pathname);

    console.debug('[Router] location changed →', location.pathname, window.location.pathname);

    emit('ui.intent', {
      action: 'page_view',
      surface: window.location.pathname,
    });

}, [location.pathname, emit]);

  return null;
}
