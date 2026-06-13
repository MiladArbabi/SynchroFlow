// apps/frontend/src/analytics/PostHogPageView.tsx
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import posthog from 'posthog-js';

/**
 * POSTHOG PAGEVIEW TRACKER (PH-02)
 * ──────────────────────────────────
 * Fires posthog.capture('$pageview') on every React Router navigation.
 *
 * Why this is needed:
 * - capture_pageview: false in posthog.init() (SPA controls its own pageviews)
 * - Without this, PostHog never sees navigation events inside the app
 * - UTM params from marketing CTAs attach to the FIRST $pageview fired after
 *   the user lands on app.lasyncro.com — this component fires that event
 *
 * Placement: inside BrowserRouter (uses useLocation) but outside AuthProvider
 * so it fires for all routes including /login and /register.
 *
 * INVARIANT: must remain inside BrowserRouter in the render tree.
 */
export function PostHogPageView(): null {
  const location = useLocation();

  useEffect(() => {
    if (posthog?.capture) {
      posthog.capture('$pageview', {
        $current_url: window.location.href,
      });
      console.info('[analytics:pageview]', location.pathname);
    }
  }, [location.pathname]);

  return null;
}