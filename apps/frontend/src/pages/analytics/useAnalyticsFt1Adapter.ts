import type { OnboardingReadinessSnapshot } from '@lasyncro/shared';

export function mapAnalyticsFt1Props(
  snapshot: OnboardingReadinessSnapshot
) {
  const analyticsModule = snapshot.modules.find(
    (m) => m.moduleId === 'analytics'
  );

  const signals = analyticsModule?.signals ?? [];
  const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

  return {
    orderCount:
      typeof map['analytics.orderCount'] === 'number'
        ? map['analytics.orderCount']
        : null,

    productCount:
      typeof map['analytics.productCount'] === 'number'
        ? map['analytics.productCount']
        : null,

    baseSignalsReady:
      typeof map['analytics.baseSignalsReady'] === 'boolean'
        ? map['analytics.baseSignalsReady']
        : null,
  };
}
