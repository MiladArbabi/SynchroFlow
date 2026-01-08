// apps/frontend/src/pages/AnalyticsPage.tsx
import { AnalyticsModule, AnalyticsModuleFT2 } from '@lasyncro/analytics';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapAnalyticsFt1Props } from './analytics/useAnalyticsFt1Adapter';
import { mapAnalyticsFt2Props } from './analytics/useAnalyticsFt2Adapter';
import { useAnalyticsAhaAdapter } from 'wiring/analyticsAhaAdapter';
import { useAnalyticsFt2Snapshot } from './analytics/useAnalyticsFt2Snapshot';

export default function AnalyticsPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const onIntent = useAnalyticsAhaAdapter();

  const shopId = user?.shop_id ?? null;

  const isFt1 = phase === 'FT1_READY';
  const isFt2 = phase === 'FT2_READY';

  const ft1Enabled = isFt1 && !!shopId;
  const ft2Enabled = isFt2 && !!shopId;

  const readinessQuery = useOnboardingReadiness(
    ft1Enabled,
    shopId ?? 0
  );

  /**
   * FT2 Analytics Snapshot (Authoritative)
   * -------------------------------------
   * Hook must be called unconditionally.
   * Fetching is gated via `enabled`.
   */
  const ft2Query = useAnalyticsFt2Snapshot(ft2Enabled);

  // ---- Rendering gates only ----

  if (isFt2) {
    if (!ft2Query.isSuccess) {
      console.debug('[AnalyticsPage][FT2] awaiting FT2 snapshot', {
        phase,
        shopId,
      });
      return <div>Loading analytics…</div>;
    }

    const ft2Props = mapAnalyticsFt2Props(ft2Query.data);

    console.debug('[AnalyticsPage][FT2] rendering FT2 AnalyticsModule', {
      snapshot: ft2Query.data,
    });

    return <AnalyticsModuleFT2 {...ft2Props} />;
  }

  if (!isFt1) {
    return <div>Analytics not available (phase: {phase})</div>;
  }

  if (!shopId) {
    return <div>Analytics not available (no shopId)</div>;
  }

  if (readinessQuery.isLoading) {
    return <div>Loading analytics…</div>;
  }

  if (readinessQuery.isError) {
     console.error(
       '[FT1][Analytics][ReadinessError]',
       readinessQuery.error
     );
     return <div>Failed to load analytics.</div>;
   }

  const props = mapAnalyticsFt1Props(readinessQuery.data);
  console.debug('[FT1][Analytics][Props]', props);

  return <AnalyticsModule {...props} onIntent={onIntent} />;
}