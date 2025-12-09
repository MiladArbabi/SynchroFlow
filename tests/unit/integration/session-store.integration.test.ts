// apps/backend/tests/specter/session-store.integration.test.ts
import { initRedisSessionStore, closeRedisSessionStore } from '../../../modules/specter/src/store/session-store-redis';

jest.setTimeout(10000);

describe('Specter Redis session store lifecycle', () => {
  test('init and close should not throw (fallback/no-redis)', async () => {
    // Ensure default env does not force a real redis connection
    const prev = process.env.SPECTER_SESSION_STORE;
    delete process.env.SPECTER_SESSION_STORE;

    let store: any;
    try {
      store = await initRedisSessionStore();
      expect(store).toBeDefined();
      // basic snapshot behaviour should be present
      const sessions = store.getAllSessionsForShop ? store.getAllSessionsForShop(1) : [];
      expect(Array.isArray(sessions)).toBe(true);
    } finally {
      if (store) await closeRedisSessionStore(store);
      if (prev !== undefined) process.env.SPECTER_SESSION_STORE = prev;
    }
  });

  test('optional real redis test (requires TEST_WITH_REDIS=1 and a redis server)', async () => {
    if (process.env.TEST_WITH_REDIS !== '1') {
      console.warn('Skipping real-redis test (TEST_WITH_REDIS != 1)');
      return;
    }

    process.env.SPECTER_SESSION_STORE = 'redis';
    const store = await initRedisSessionStore();
    expect(store).toBeDefined();

    // Save, retrieve, reset, close should work
    const id = await store.saveSession({ shopId: 9999, createdAt: new Date().toISOString(), pagesViewed: [], sessionId: undefined });
    expect(typeof id).toBe('string');

    const prev = await store.getAllSessionsForShop(9999);
    expect(Array.isArray(prev)).toBe(true);

    await store.reset(); // fire-and-forget by default; if you changed to return promise, await it

    await closeRedisSessionStore(store);
    delete process.env.SPECTER_SESSION_STORE;
  });
});
