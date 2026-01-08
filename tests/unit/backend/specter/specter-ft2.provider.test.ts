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
      createdAt: '2024-01-03T10:00:00.000Z'
    },
    {
      sessionId: 's2',
      shopId,
      exitIntent: true,
      pagesViewed: ['/checkout'],
      createdAt: '2024-01-04T15:30:00.000Z'
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
  it('returns null when sessions fall outside period', async () => {
    const store = new InMemorySessionStore([
      {
        sessionId: 'old',
        shopId,
        exitIntent: false,
        pagesViewed: ['/'],
        createdAt: '2023-01-01T00:00:00.000Z'
      }
    ]);

    setSessionStoreForTests(store);

    const snapshot = await getSpecterFt2Snapshot({ shopId, period });

    expect(snapshot.context.sessionsObserved).toBeNull();
  });
});