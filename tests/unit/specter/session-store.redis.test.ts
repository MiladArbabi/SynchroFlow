// tests/unit/specter/session-store.redis.test.ts
// Unit tests for RedisSessionStore snapshot behaviour (no real Redis).
// These tests exercise the in-memory snapshot paths so they are safe to run in CI without a Redis server.

import { RedisSessionStore } from 'modules-specter/store/session-store-redis';
import { AnonymousSession } from '@lasyncro/specter/store/session-store';

describe('RedisSessionStore — snapshot behaviour (no redis connection)', () => {
  let store: RedisSessionStore;
  const shopId = 777;

  beforeEach(async () => {
    // do NOT call init() so the store remains disconnected and uses its in-memory snapshots
    store = new RedisSessionStore({ listMaxLen: 100, redisUrl: 'redis://invalid:1' });
    // ensure clean slate
    await store.reset();
  });

  test('saveSession should update in-memory snapshot and return sessionId', async () => {
    const s: AnonymousSession = {
      sessionId: '',
      shopId,
      createdAt: new Date().toISOString(),
      exitIntent: false,
    } as any;

    const sid = await store.saveSession(s);
    expect(sid).toBeDefined();
    const all = store.getAllSessionsForShop(shopId);
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBe(1);
    expect(all[0].sessionId).toBe(sid);
  });

  test('getSessionsLastNDays falls back to snapshot when not connected', async () => {
    const now = new Date();
    const older = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    await store.saveSession({
      sessionId: 'old',
      shopId,
      createdAt: older,
      exitIntent: false,
    } as any);
    await store.saveSession({
      sessionId: 'new',
      shopId,
      createdAt: now.toISOString(),
      exitIntent: false,
    } as any);

    const last7 = await store.getSessionsLastNDays(shopId, 7);
    expect(last7.find((s) => s.sessionId === 'new')).toBeDefined();
    expect(last7.find((s) => s.sessionId === 'old')).toBeUndefined();
  });

  test('appendEvent and getRecentEvents use in-memory eventsSnapshot when disconnected', async () => {
    await store.appendEvent(shopId, { type: 'sync.completed', payload: { ok: true } });
    await store.appendEvent(shopId, { type: 'canonical.ingested', payload: { orderId: 'o1' } });

    const recent = await store.getRecentEvents(shopId, 10);
    expect(recent.length).toBe(2);
    expect(recent[0].type).toBe('canonical.ingested');
    expect(recent[1].type).toBe('sync.completed');
  });

  test('warmCache and getShopConfig operate on snapshot without redis', async () => {
    const cfg = { syncFrequency: 60, enabled: true };
    await store.warmCache(shopId, cfg);
    const got = await store.getShopConfig(shopId);
    expect(got).toEqual(cfg);

    // update via updateShopConfig
    const patched = await store.updateShopConfig(shopId, { enabled: false });
    expect(patched).toEqual({ enabled: false }); // note: current redis impl treats patch as replace
    const got2 = await store.getShopConfig(shopId);
    expect(got2).toEqual({ enabled: false });
  });

  test('reset clears snapshots', async () => {
    await store.saveSession({ sessionId: 'x', shopId, createdAt: new Date().toISOString(), exitIntent: false } as any);
    await store.appendEvent(shopId, { type: 't' });
    await store.warmCache(shopId, { a: 1 });

    // sanity before reset
    expect(store.getAllSessionsForShop(shopId).length).toBeGreaterThan(0);
    expect((await store.getRecentEvents(shopId)).length).toBeGreaterThan(0);
    expect(await store.getShopConfig(shopId)).not.toBeNull();

    await store.reset();

    expect(store.getAllSessionsForShop(shopId).length).toBe(0);
    expect((await store.getRecentEvents(shopId)).length).toBe(0);
    expect(await store.getShopConfig(shopId)).toBeNull();
  });
});
