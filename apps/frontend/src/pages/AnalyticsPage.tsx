// apps/frontend/src/pages/AnalyticsPage.tsx
import { AnalyticsModule } from '@lasyncro/analytics';
import { useOnboardingReadiness } from 'lifecycle/useOnboardingReadiness';
import { useShopLifecycle } from 'lifecycle/ShopLifecycleContext';
import { useAuth } from 'contexts/AuthContext';
import { mapAnalyticsFt1Props } from './analytics/useAnalyticsFt1Adapter';
import { useAnalyticsAhaAdapter } from 'wiring/analyticsAhaAdapter';

export default function AnalyticsPage() {
  const { phase } = useShopLifecycle();
  const { user } = useAuth();
  const onIntent = useAnalyticsAhaAdapter();

  const shopId = user?.shop_id ?? null;

  const isFt1 = phase === 'FT1_READY';
  const enabled = isFt1 && !!shopId;

  const readinessQuery = useOnboardingReadiness(
    enabled,
    shopId ?? 0
  );

  // ---- Rendering gates only ----

  if (!isFt1) {
    return <div>Analytics not available (phase: {phase})</div>;
  }

  if (!shopId) {
    return <div>Analytics not available (no shopId)</div>;
  }

  if (!readinessQuery.isSuccess) {
    return <div>Loading analytics…</div>;
  }

  const props = mapAnalyticsFt1Props(readinessQuery.data);
  console.debug('[FT1][Analytics][Props]', props);

  return <AnalyticsModule {...props} onIntent={onIntent} />;
}
