// tests/unit/ui/specter/useSpecterFt1Scenario.test.ts

import { useSpecterFt1Scenario } from
  '@lasyncro/specter';

describe('useSpecterFt1Scenario', () => {
  it('returns LOADING when sessionCount is null', () => {
    expect(
      useSpecterFt1Scenario({
        sessionCount: null,
        signalConfidence: null,
      })
    ).toBe('LOADING');
  });

  it('returns NO_SESSIONS when sessionCount is 0', () => {
    expect(
      useSpecterFt1Scenario({
        sessionCount: 0,
        signalConfidence: null,
      })
    ).toBe('NO_SESSIONS');
  });

  it('returns LOW_SIGNAL when sessions exist but confidence is null', () => {
    expect(
      useSpecterFt1Scenario({
        sessionCount: 12,
        signalConfidence: null,
      })
    ).toBe('LOW_SIGNAL');
  });

  it('returns HEALTHY when sessions and confidence exist', () => {
    expect(
      useSpecterFt1Scenario({
        sessionCount: 12,
        signalConfidence: 0.42,
      })
    ).toBe('HEALTHY');
  });
});
