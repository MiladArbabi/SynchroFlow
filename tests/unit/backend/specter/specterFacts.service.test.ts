//tests/unit/backend/specter/specterFacts.service.test.ts
import { InMemorySessionStore, setSessionStoreForTests } from 'modules-specter/store/session-store';
import { getSpecterFacts } from 'api-src/services/specter-facts/specterFacts.service';

describe('SpecterFacts.service', () => {
  const shopId = 42;

  beforeEach(() => {
    const store = new InMemorySessionStore();
    setSessionStoreForTests(store);
  });

  afterEach(() => {
    setSessionStoreForTests(null);
  });

  it('returns null facts when no sessions exist', async () => {
    const facts = await getSpecterFacts({
      shopId,
      period: { from: '2024-01-01', to: '2024-01-07' }
    });

    expect(facts.sessionsObserved).toBeNull();
    expect(facts.exitIntentSessions).toBeNull();
    expect(facts.funnelsDetected).toBeNull();
  });

  it('counts sessions correctly', async () => {
    const store = new InMemorySessionStore([
      {
        sessionId: 's1',
        shopId,
        exitIntent: false,
        createdAt: new Date().toISOString()
      },
      {
        sessionId: 's2',
        shopId,
        exitIntent: true,
        createdAt: new Date().toISOString()
      }
    ]);

    setSessionStoreForTests(store);

    const facts = await getSpecterFacts({
      shopId,
      period: { from: '2024-01-01', to: '2024-01-07' }
    });

    expect(facts.sessionsObserved).toBe(2);
    expect(facts.exitIntentSessions).toBe(1);
  });

  it('preserves nulls and does not emit derived fields', async () => {
    const facts = await getSpecterFacts({
      shopId,
      period: { from: '2024-01-01', to: '2024-01-07' }
    });

    const serialized = JSON.stringify(facts);

    expect(serialized).not.toMatch(/rate|percent|trend|risk|ltv/i);
  });
});