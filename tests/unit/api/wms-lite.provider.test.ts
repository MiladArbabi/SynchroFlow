// tests/unit/api/wms-lite.provider.test.ts
import {
  wmsLiteOnboardingSignalProvider
} from 'api-src/onboarding/readiness.providers';

describe('wmsLiteOnboardingSignalProvider', () => {
  it('exposes a stubbed wmsLite.enabled signal', async () => {
    const signals = await wmsLiteOnboardingSignalProvider.getSignals({ shopId: 1 });

    const map = Object.fromEntries(signals.map((s) => [s.name, s.value]));
    expect(map['wmsLite.enabled']).toBe(false);
  });
});
