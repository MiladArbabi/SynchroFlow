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
// - Render FT1 or FT2 Analytics modules based on available data
// - Remain silent about lifecycle state in user-facing UI

import { AnalyticsModule, AnalyticsModuleFT2 } from '@lasyncro/analytics';
import { useAuth } from 'contexts/AuthContext';

import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useAnalyticsFt2Snapshot } from './analytics/useAnalyticsFt2Snapshot';

import { mapAnalyticsFt1Props } from './analytics/useAnalyticsFt1Adapter';
import { mapAnalyticsFt2Props } from './analytics/useAnalyticsFt2Adapter';

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
   */
  const onIntent = useAnalyticsAhaAdapter();

  /**
   * Data gating
   */
  const ft1Enabled = !!shopId;
  const ft2Enabled = !!shopId;

  /**
   * FT2 snapshot (authoritative)
   */
  const ft2Query = useAnalyticsFt2Snapshot(ft2Enabled);

  /**
   * FT1 onboarding readiness
   */
  const readinessQuery = useOnboardingReadiness(
    ft1Enabled,
    shopId ?? 0
  );

  /**
   * FT2 rendering path (authoritative)
   */
  if (ft2Query.isSuccess) {
    if (__DEV__) {
      console.debug('[AnalyticsPage][FT2] rendering AnalyticsModuleFT2', {
        snapshot: ft2Query.data,
      });
    }

    const ft2Props = mapAnalyticsFt2Props(ft2Query.data);
    return <AnalyticsModuleFT2 {...ft2Props} />;
  }

  /**
   * FT2 loading (neutral)
   */
  if (ft2Query.isLoading) {
    if (__DEV__) {
      console.debug('[AnalyticsPage][FT2] awaiting snapshot');
    }
    return <div>Loading analytics…</div>;
  }

  /**
   * Missing shopId (neutral fallback)
   */
  if (!shopId) {
    return <div>Analytics unavailable</div>;
  }

  /**
   * FT1 readiness loading
   */
  if (!readinessQuery.isSuccess) {
    if (__DEV__) {
      console.debug('[AnalyticsPage][FT1] awaiting onboarding readiness');
    }
    return <div>Loading analytics…</div>;
  }

  /**
   * FT1 rendering path
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