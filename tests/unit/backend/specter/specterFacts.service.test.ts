//tests/unit/backend/specter/specterFacts.service.test.ts
import { InMemorySessionStore, setSessionStoreForTests } from '@lasyncro/specter/store/session-store';
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
      createdAt: '2024-01-03T10:00:00.000Z'
    },
    {
      sessionId: 's2',
      shopId,
      exitIntent: true,
      createdAt: '2024-01-04T12:00:00.000Z'
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

  it('counts only sessions inside the given period', async () => {
    const store = new InMemorySessionStore([
      {
        sessionId: 'old-session',
        shopId,
        exitIntent: true,
        createdAt: '2023-12-15T10:00:00.000Z'
      },
      {
        sessionId: 'in-period-1',
        shopId,
        exitIntent: false,
        createdAt: '2024-01-03T10:00:00.000Z'
      },
      {
        sessionId: 'in-period-2',
        shopId,
        exitIntent: true,
        createdAt: '2024-01-05T12:00:00.000Z'
      }
    ]);

    setSessionStoreForTests(store);

    const facts = await getSpecterFacts({
      shopId,
      period: {
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-07T23:59:59.999Z'
      }
    });

    expect(facts.sessionsObserved).toBe(2);
    expect(facts.exitIntentSessions).toBe(1);
  });

  it('returns nulls when sessions exist but none fall inside the period', async () => {
    const store = new InMemorySessionStore([
      {
        sessionId: 'too-old',
        shopId,
        exitIntent: true,
        createdAt: '2023-12-01T10:00:00.000Z'
      },
      {
        sessionId: 'too-new',
        shopId,
        exitIntent: false,
        createdAt: '2024-02-01T10:00:00.000Z'
      }
    ]);

    setSessionStoreForTests(store);

    const facts = await getSpecterFacts({
      shopId,
      period: {
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-07T23:59:59.999Z'
      }
    });

    expect(facts.sessionsObserved).toBeNull();
    expect(facts.exitIntentSessions).toBeNull();
    expect(facts.funnelsDetected).toBeNull();
  });

  it('does not derive semantic signals (funnelsDetected must remain null)', async () => {
    const store = new InMemorySessionStore([
      {
        sessionId: 's1',
        shopId,
        exitIntent: false,
        createdAt: '2024-01-03T10:00:00.000Z',
        pagesViewed: ['/home', '/pricing']
      },
      {
        sessionId: 's2',
        shopId,
        exitIntent: false,
        createdAt: '2024-01-04T10:00:00.000Z',
        pagesViewed: ['/home', '/pricing']
      }
    ]);

    setSessionStoreForTests(store);

    const facts = await getSpecterFacts({
      shopId,
      period: {
        from: '2024-01-01T00:00:00.000Z',
        to: '2024-01-07T23:59:59.999Z'
      }
    });

    expect(facts.sessionsObserved).toBe(2);
    expect(facts.funnelsDetected).toBeNull();
  });
});