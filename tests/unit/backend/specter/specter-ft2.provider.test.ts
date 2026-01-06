//tests/unit/backend/specter/specter-ft2.provider.test.ts
import { InMemorySessionStore, setSessionStoreForTests } from 'modules-specter/store/session-store';
import { getSpecterFt2Snapshot } from 'api-src/services/specter-ft2.provider';

describe('Specter FT2 Provider', () => {
  const shopId = 77;
  const period = {
    from: '2024-01-01',
    to: '2024-01-07'
  };

  beforeEach(() => {
    const store = new InMemorySessionStore([
      {
        sessionId: 's1',
        shopId,
        exitIntent: false,
        pagesViewed: ['/'],
        createdAt: new Date().toISOString()
      },
      {
        sessionId: 's2',
        shopId,
        exitIntent: true,
        pagesViewed: ['/checkout'],
        createdAt: new Date().toISOString()
      }
    ]);
    setSessionStoreForTests(store);
  });

  afterEach(() => {
    setSessionStoreForTests(null);
  });

  it('returns FT2-safe Specter exposure', async () => {
    const snapshot = await getSpecterFt2Snapshot({ shopId, period });

    expect(snapshot.context.sessionsObserved).toBe(2);
    expect(snapshot.outcome?.status).toBeDefined();
    expect(snapshot.signals.funnelsDetected).toBeDefined();
    expect(snapshot.dataCoverage.sessionsPresent).toBe(true);
  });

  it('does not leak intelligence or raw facts', async () => {
    const snapshot = await getSpecterFt2Snapshot({ shopId, period });
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toMatch(
      /exitIntent|sessionsObservedRaw|engagement|behavior|rate|percent|risk/i
    );
  });
});