// tests/unit/api/problem-center.provider.test.ts
import { ReadinessSignal } from '@lasyncro/shared';
import {
  problemCenterOnboardingSignalProvider
} from 'api-src/onboarding/readiness.providers';

describe('problemCenterOnboardingSignalProvider', () => {
  it('exposes a stubbed problemCenter.enabled signal', async () => {
    const signals = await problemCenterOnboardingSignalProvider.getSignals({ shopId: 1 });

    const map = Object.fromEntries(signals.map((s) => [s.name, s.value]));
    expect(map['problemCenter.enabled']).toBe(false);
  });
});
