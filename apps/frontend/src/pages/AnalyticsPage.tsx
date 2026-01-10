// apps/frontend/src/pages/AnalyticsPage.tsx
//
// AnalyticsPage
// -------------
// Lifecycle-agnostic Analytics surface.
//
// HARD CONTRACT:
// - This page MUST NOT read lifecycle state
// - This page MUST NOT decide whether it should exist
// - Lifecycle gating is handled exclusively by ShopLifecycleGate
//
// RESPONSIBILITIES:
// - Gate data fetching via explicit booleans
// - Remain silent about lifecycle state in user-facing UI

import { AnalyticsModule } from '@lasyncro/analytics';
import { useAuth } from 'contexts/AuthContext';

import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { mapAnalyticsFt1Props } from './analytics/useAnalyticsFt1Adapter';
import { useAnalyticsAhaAdapter } from 'wiring/analyticsAhaAdapter';

const __DEV__ = import.meta.env.DEV;

export default function AnalyticsPage() {
  /**
   * Auth context
   * ------------
   * shopId is the ONLY external precondition for this page.
   */
  const { user } = useAuth();
  const shopId = user?.shop_id ?? null;

  /**
   * Intents
   * -------
   * Always instantiated; no lifecycle branching allowed.
   */
  const onIntent = useAnalyticsAhaAdapter();

  /**
   * FT1 data gating
   * ---------------
   * Lifecycle validity is assumed if this page is mounted.
   */
  const ft1Enabled = !!shopId;

  const readinessQuery = useOnboardingReadiness(
    ft1Enabled,
    shopId ?? 0
  );

  /**
   * Missing shopId
   * --------------
   * Not a lifecycle error.
   */
  if (!shopId) {
    return <div>Analytics unavailable</div>;
  }

  /**
   * FT1 loading
   * -----------
   */
  if (!readinessQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[AnalyticsPage][FT1] awaiting onboarding readiness');
    }

    return <div>Loading analytics…</div>;
  }

  /**
   * FT1 rendering path
   * ------------------
   */
  const props = mapAnalyticsFt1Props(readinessQuery.data);

  if (__DEV__) {
    console.debug('[AnalyticsPage][FT1] rendering AnalyticsModule', {
      readiness: readinessQuery.data,
    });
  }

  return (
    <AnalyticsModule
      {...props}
      onIntent={onIntent}
    />
  );
}