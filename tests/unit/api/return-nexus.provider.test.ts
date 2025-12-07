// tests/unit/api/return-nexus.provider.test.ts
import {
  returnNexusOnboardingSignalProvider
} from 'api-src/onboarding/readiness.providers';

describe('returnNexusOnboardingSignalProvider', () => {
  it('returns stubbed returnNexus signals', async () => {
    const signals = await returnNexusOnboardingSignalProvider.getSignals({ shopId: 1 });

    const map = Object.fromEntries(signals.map((s) => [s.name, s.value]));

    expect(map['returnNexus.enabled']).toBe(false);
    expect(map['returnNexus.returnsTracked']).toBe(0);
  });
});
