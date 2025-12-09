// tests/unit/onboarding/specter.signals.test.ts
import { specterOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';

describe('specterOnboardingSignalProvider — FT1 behavioral signals (red tests)', () => {
  const shopId = 42;

  it('has correct moduleId', () => {
    expect(specterOnboardingSignalProvider.moduleId).toBe('specter');
  });

  it('exposes the FT1 set of signals (names & types)', async () => {
    const signals = await specterOnboardingSignalProvider.getSignals({ shopId });

    // Map for easy lookup
    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    // Required signal names (FT0 + FT1)
    const required = [
      'specter.sdkInstalled',
      'specter.sessionVolume',            // number (sessions last 7 days)
      'specter.intentFeedActive',         // boolean | 'low'|'medium'|'high' allowed (we accept boolean for FT1)
      'specter.exitIntentRate',           // number (0-1)
      'specter.topPageFunnelsDetected',   // boolean
      'specter.customerSignalFallbackMode'// string: 'default'|'fallback'|'integrated'
    ];

    required.forEach(name => {
      expect(map.hasOwnProperty(name)).toBe(true);
    });

    // Type assertions (be permissive where appropriate)
    expect(typeof map['specter.sdkInstalled']).toBe('boolean');
    expect(typeof map['specter.sessionVolume']).toBe('number');
    const intentVal = map['specter.intentFeedActive'];
    const intentTypeOk = typeof intentVal === 'boolean' || ['low','medium','high'].includes(String(intentVal));
    expect(intentTypeOk).toBe(true);
    expect(typeof map['specter.exitIntentRate']).toBe('number');
    expect(typeof map['specter.topPageFunnelsDetected']).toBe('boolean');
    expect(typeof map['specter.customerSignalFallbackMode']).toBe('string');
  });

  it('returns stable signal ordering (sdkInstalled first)', async () => {
    const signals = await specterOnboardingSignalProvider.getSignals({ shopId });
    const names = signals.map(s => s.name);
    expect(names[0]).toBe('specter.sdkInstalled');
  });
});
