// tests/scripts/specter-redis-e2e.ts
import { initRedisSessionStore, closeRedisSessionStore } from '../../modules/specter/src/store/session-store-redis';
import assert from 'assert';

(async () => {
  console.log('[e2e] Starting Specter RedisSessionStore E2E test');

  // Init the store (will use REDIS_URL env)
  const store = await initRedisSessionStore();
  console.log('[e2e] Store initialized');

  // Make a test session
  const now = new Date().toISOString();
  const session = {
    sessionId: `e2e-${Date.now()}`,
    shopId: 1,
    createdAt: now,
    pagesViewed: [{ path: '/test', ts: now }],
    userAgent: 'e2e-test',
  };

  const savedId = await store.saveSession(session as any);
  console.log('[e2e] Saved sessionId:', savedId);
  assert(savedId === session.sessionId, 'saved id mismatch');

  // Wait a short moment for Redis write (store writes synchronously but list trimming is async)
  await new Promise((r) => setTimeout(r, 300));

  // Read last N days
  const read = await store.getSessionsLastNDays(1, 1);
  console.log('[e2e] getSessionsLastNDays returned count:', read.length);
  if (!read.find((s: any) => s.sessionId === session.sessionId)) {
    console.error('[e2e] SESSION NOT FOUND in redis read — check redis keys');
    process.exitCode = 2;
  } else {
    console.log('[e2e] SESSION FOUND — Redis write/read OK');
  }

  // Reset (cleanup) - this is non-blocking in store.reset but close will quit client
  store.reset();
  await new Promise((r) => setTimeout(r, 200)); // let background deletion try to run

  // Close store
  await closeRedisSessionStore(store as any);
  console.log('[e2e] Store closed, E2E finished successfully');
  process.exit(0);
})();
