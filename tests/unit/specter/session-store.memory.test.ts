// tests/unit/specter/session-store.memory.spec.ts
import { createInMemorySpecterStore, ISpecterStore } from 'modules-specter/store/session-store-memory';

describe('Specter In-Memory Store — Session CRUD + Events (TDD)', () => {
  let store: ISpecterStore;
  const shopId = 'test-shop-123';

  beforeEach(async () => {
    store = createInMemorySpecterStore();
    // ensure clean slate (delete if exists)
    await store.deleteSession(shopId).catch(() => {});
  });

  test('setSession and getSession should persist and return a deep copy', async () => {
    const initial = { lastSync: null, foo: { a: 1 } };
    await store.setSession(shopId, initial);
    const got = await store.getSession(shopId);
    expect(got).not.toBeNull();
    expect(got).toEqual(initial);

    // mutate returned object — original in store should NOT change (deep copy)
    if (got) (got.foo as any).a = 42;
    const after = await store.getSession(shopId);
    expect(after?.foo.a).toBe(1);
  });

  test('patchSession should merge fields and return the new session', async () => {
    await store.setSession(shopId, { lastSync: null, count: 1 });
    const patched = await store.patchSession(shopId, { lastSync: '2025-12-10T00:00:00Z', count: 2 });
    expect(patched.lastSync).toBe('2025-12-10T00:00:00Z');
    expect(patched.count).toBe(2);

    const persisted = await store.getSession(shopId);
    expect(persisted).toEqual(patched);
  });

  test('deleteSession should remove the session', async () => {
    await store.setSession(shopId, { a: 1 });
    await store.deleteSession(shopId);
    const got = await store.getSession(shopId);
    expect(got).toBeNull();
  });

  test('appendEvent and getRecentEvents should store and return newest-first', async () => {
    const ev1 = await store.appendEvent(shopId, { type: 'sync.completed', payload: { ok: true } });
    const ev2 = await store.appendEvent(shopId, { type: 'canonical.ingested', payload: { orderId: 'o1' } });

    expect(ev1.id).toBeDefined();
    expect(ev2.id).toBeDefined();
    // newest-first -> ev2 should be first
    const recent = await store.getRecentEvents(shopId, 10);
    expect(recent.length).toBe(2);
    expect(recent[0].type).toBe('canonical.ingested');
    expect(recent[1].type).toBe('sync.completed');
  });

  test('getRecentEvents limit respected', async () => {
    // append 60 events
    for (let i = 0; i < 60; i++) {
      await store.appendEvent(shopId, { type: 'tick', payload: { i } });
    }
    const r1 = await store.getRecentEvents(shopId, 10);
    expect(r1.length).toBe(10);

    const r2 = await store.getRecentEvents(shopId, 1000);
    // capped by internal storage limit (500) but our requested 1000 should return available count
    expect(r2.length).toBeGreaterThanOrEqual(60);
  });
});
