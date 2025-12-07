// tests/unit/api/specter.provider.test.ts
import {
  specterOnboardingSignalProvider
} from 'api-src/onboarding/readiness.providers';

describe('specterOnboardingSignalProvider', () => {
  it('returns a specter.sdkInstalled signal', async () => {
    const signals = await specterOnboardingSignalProvider.getSignals({ shopId: 1 });

    expect(Array.isArray(signals)).toBe(true);
    const names = signals.map((s) => s.name);
    expect(names).toContain('specter.sdkInstalled');
  });
});
