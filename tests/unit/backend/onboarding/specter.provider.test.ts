//tests/unit/backend/onboarding/specter.provider.test.ts

import { specterOnboardingSignalProvider } from 'api-src/onboarding/providers/specter.provider';
import {
  InMemorySessionStore,
  setSessionStoreForTests
} from 'modules-specter/store/session-store';

describe('Specter Onboarding Signal Provider (FT1 readiness)', () => {
  const shopId = 7777;

  afterEach(() => {
    // reset overridden store after each test
    setSessionStoreForTests(null);
  });

  it('emits sessionsKnown=true and sessionCount=0 when store exists but no sessions were ever recorded', async () => {
    setSessionStoreForTests(null); // default store, empty

    const signals = await specterOnboardingSignalProvider.getSignals({ shopId });
    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    expect(map['specter.sessionsKnown']).toBe(true);
    expect(map['specter.sessionCount']).toBe(0);
    expect(map['specter.signalConfidence']).toBeNull();
  });

  it('emits sessionsKnown=true and sessionCount=0 when store resolves but no sessions exist', async () => {
  const store = new InMemorySessionStore([]);
  setSessionStoreForTests(store);

  const signals = await specterOnboardingSignalProvider.getSignals({ shopId });
  const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

  expect(map['specter.sessionsKnown']).toBe(true);
  expect(map['specter.sessionCount']).toBe(0);
  expect(map['specter.signalConfidence']).toBeNull();
});

it('emits sessionsKnown=true and sessionCount>0 when sessions exist', async () => {
    const store = new InMemorySessionStore([
        {
        sessionId: 'sess-1',
        shopId,
        exitIntent: false,
        createdAt: new Date().toISOString(),
        },
    ]);
    setSessionStoreForTests(store);

    const signals = await specterOnboardingSignalProvider.getSignals({ shopId });
    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    expect(map['specter.sessionsKnown']).toBe(true);
    expect(map['specter.sessionCount']).toBe(1);
    expect(map['specter.signalConfidence']).toBeNull();
  });
});
