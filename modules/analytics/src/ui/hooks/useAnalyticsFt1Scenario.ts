import type { AnalyticsFt1Scenario } from '../types';
import type { AnalyticsModuleProps } from '../pages/AnalyticsModule';

export function useAnalyticsFt1Scenario(
  props: AnalyticsModuleProps
): AnalyticsFt1Scenario {
  const { orderCount, productCount, baseSignalsReady } = props;

  // Loading gate
  if (
    baseSignalsReady === null ||
    orderCount === null ||
    productCount === null
  ) {
    return 'LOADING';
  }

  // No orders → onboarding must start here
  if (orderCount === 0) {
    return 'NO_ORDERS';
  }

  // Orders exist but no products
  if (productCount === 0) {
    return 'NO_PRODUCTS';
  }

  // Partial ingestion
  if (!baseSignalsReady) {
    return 'PARTIAL_DATA';
  }

  return 'HEALTHY';
}
