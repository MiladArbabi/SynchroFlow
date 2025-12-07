// tests/unit/api/insight-core.provider.test.ts
import {
  insightCoreOnboardingSignalProvider
} from 'api-src/onboarding/readiness.providers';

describe('insightCoreOnboardingSignalProvider', () => {
  it('returns base insightCore signals with stubbed values', async () => {
    const signals = await insightCoreOnboardingSignalProvider.getSignals({ shopId: 1 });

    const map = Object.fromEntries(signals.map((s) => [s.name, s.value]));

    expect(map['insightCore.orderCount']).toBe(0);
    expect(map['insightCore.productCount']).toBe(0);
    expect(map['insightCore.baseSignalsReady']).toBe(false);
  });
});
