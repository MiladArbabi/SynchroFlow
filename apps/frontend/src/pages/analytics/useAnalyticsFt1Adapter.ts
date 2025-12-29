/* eslint-disable @typescript-eslint/no-explicit-any */
//apps/frontend/src/pages/analytics/useAnalyticsFt1Adapter.ts

export function mapAnalyticsFt1Props(readinessData: any) {
  const module = readinessData?.modules?.find(
    (m: any) => m.moduleId === 'analytics'
  );

  const signals = module?.signals ?? [];

  const get = (name: string) =>
    signals.find((s: any) => s.name === name)?.value;

  const orderCount = get('analytics.orderCount');
  const productCount = get('analytics.productCount');
  const baseSignalsReady = get('analytics.baseSignalsReady');

  return {
    orderCount: orderCount === undefined ? null : Number(orderCount),
    productCount: productCount === undefined ? null : Number(productCount),
    baseSignalsReady:
      baseSignalsReady === undefined ? null : Boolean(baseSignalsReady),
  };
}
