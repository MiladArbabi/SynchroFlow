/**
 * AnalyticsModule — FT1 Diagnostic Surface
 * ---------------------------------------
 * Purpose:
 * - Render the first truthful, read-only diagnostic state for Analytics.
 *
 * FT1 Invariants:
 * - No data fetching
 * - No lifecycle awareness
 * - No onboarding logic
 * - No optimization or recommendations
 * - Renders exactly ONE diagnostic message based on scenario
 *
 * Scenario source of truth:
 * - useAnalyticsFt1Scenario(props)
 *
 * If this file starts "helping" the user, FT1 is broken.
 */


//modules/analytics/src/ui/pages/AnalyticsModule.tsx

import { useAnalyticsFt1Scenario } from '../hooks/useAnalyticsFt1Scenario';
import { AnalyticsDiagnosticCard } from '../components/AnalyticsDiagnosticCard';
import type { AnalyticsUiIntent } from '../intents';

export interface AnalyticsModuleProps {
  orderCount: number | null;
  productCount: number | null;
  baseSignalsReady: boolean | null;
  onIntent?: (intent: AnalyticsUiIntent) => void;
}

export default function AnalyticsModule(props: AnalyticsModuleProps) {
  const scenario = useAnalyticsFt1Scenario(props);
  console.debug('[FT1][Analytics][Scenario]', scenario);

  console.debug('[FT1][Analytics][AnalyticsModule] props', {
    orderCount: props.orderCount,
    productCount: props.productCount,
    baseSignalsReady: props.baseSignalsReady,
  });

  const emitStartOnboarding = (taskId?: string) => {
    console.debug('[AnalyticsModule] emitStartOnboarding', taskId);
    props.onIntent?.({
      type: 'START_ONBOARDING',
      taskId,
    });
  };

  switch (scenario) {
    case 'LOADING':
      return (
        <AnalyticsDiagnosticCard
          testId="analytics-ft1-loading"
          title="Checking data readiness…"
          message="We’re verifying whether your store data is available for analytics."
        />
      );

    case 'NO_ORDERS':
      return (
        <AnalyticsDiagnosticCard
          testId="analytics-ft1-no-orders"
          title="No orders detected"
          message="Analytics cannot run without order data from your store."
          ctaLabel={props.onIntent ? 'Connect store' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('connect-store')
              : undefined
          }
        />
      );

    case 'NO_PRODUCTS':
      return (
        <AnalyticsDiagnosticCard
          testId="analytics-ft1-no-products"
          title="No products found"
          message="Analytics require product data to interpret order activity."
          ctaLabel={props.onIntent ? 'Sync products' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('sync-products')
              : undefined
          }
        />
      );

    case 'PARTIAL_DATA':
      return (
        <AnalyticsDiagnosticCard
          testId="analytics-ft1-partial"
          title="Analytics not ready"
          message="Required data is present but not yet sufficient for analytics."
          ctaLabel={props.onIntent ? 'Review setup' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('review-setup')
              : undefined
          }
        />
      );

    case 'HEALTHY':
      return (
        <AnalyticsDiagnosticCard
          testId="analytics-ft1-healthy"
          title="Analytics ready"
          message="Your store data meets the minimum requirements for analytics."
        />
      );
  }
}
