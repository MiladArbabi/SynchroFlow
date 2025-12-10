//tests/unit/specter/session-store.events.test.ts
import { 
    setSessionStoreForTests, 
    InMemorySessionStore, 
    appendEvent, 
    getRecentEvents, 
    recordShopSession, 
    getShopSession 
} from '../../../modules/specter/src/store/session-store';

describe('Specter session-store events API (FT0)', () => {
  beforeEach(() => {
    // use deterministic in-memory store for tests
    setSessionStoreForTests(new InMemorySessionStore());
  });

  afterEach(() => {
    // restore default behavior
    setSessionStoreForTests(null);
  });

  test('appendEvent and getRecentEvents store and retrieve events newest-first', async () => {
    await appendEvent(1, { type: 'test.a', payload: { x: 1 }, timestamp: 1000 });
    await appendEvent(1, { type: 'test.b', payload: { x: 2 }, timestamp: 2000 });

    const events = await getRecentEvents(1, 10);
    expect(events.length).toBe(2);
    // newest-first
    expect(events[0].type).toBe('test.b');
    expect(events[1].type).toBe('test.a');
  });

  test('recordShopSession and getShopSession persist and return the most recent session', async () => {
    const now = new Date().toISOString();
    const sid = await recordShopSession(2, { sessionId: 's1', shopId: 2, exitIntent: false, createdAt: now });
    expect(typeof sid).toBe('string');

    const s = await getShopSession(2);
    expect(s).not.toBeNull();
    expect(s!.sessionId).toBe('s1');
    expect(s!.shopId).toBe(2);
  });

  test('event list respects limit trimming (in-memory)', async () => {
    // insert 60 events — default in-memory max is 50
    for (let i = 0; i < 60; i++) {
      await appendEvent(3, { type: `e.${i}`, timestamp: 1000 + i });
    }
    const events = await getRecentEvents(3, 100);
    // trimmed to 50
    expect(events.length).toBeGreaterThanOrEqual(50);
    expect(events.length).toBeLessThanOrEqual(60);
    // newest-first ordering check
    expect(events[0].type).toBe('e.59');
    expect(events[events.length - 1].type).toBe('e.10');
  });
});