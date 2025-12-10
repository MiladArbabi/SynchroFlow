// tests/unit/specter/session-store.config.test.ts

import { InMemorySessionStore, setSessionStoreForTests } from '../../../modules/specter/src/store/session-store';
import { getShopConfig, updateShopConfig, warmCache } from '../../../modules/specter/src/store/session-store';

describe('Specter session-store config helpers (FT0)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Ensure tests use a fresh in-memory store
    const store = new InMemorySessionStore();
    setSessionStoreForTests(store as any);
  });

  test('getShopConfig returns null when no config present', async () => {
    const cfg = await getShopConfig(10);
    expect(cfg).toBeNull();
  });

  test('updateShopConfig sets and returns new config (replace semantics)', async () => {
    const updated = await updateShopConfig(11, { mode: 'fast' });
    expect(updated).toEqual({ mode: 'fast' });

    const read = await getShopConfig(11);
    expect(read).toEqual({ mode: 'fast' });
  });

  test('updateShopConfig merges shallow patch into existing object', async () => {
    await updateShopConfig(12, { a: 1, b: 2 });
    const patched = await updateShopConfig(12, { b: 3, c: 4 });
    expect(patched).toEqual({ a: 1, b: 3, c: 4 });

    const read = await getShopConfig(12);
    expect(read).toEqual({ a: 1, b: 3, c: 4 });
  });

  test('warmCache replaces config when called', async () => {
    await updateShopConfig(13, { hello: 'world' });
    await warmCache(13, { hello: 'universe' });
    const read = await getShopConfig(13);
    expect(read).toEqual({ hello: 'universe' });

    // Clearing cache
    await warmCache(13, null);
    const read2 = await getShopConfig(13);
    expect(read2).toBeNull();
  });

  test('updateShopConfig replaces non-object values', async () => {
    await updateShopConfig(14, 42 as any);
    const read = await getShopConfig(14);
    expect(read).toEqual(42);

    await updateShopConfig(14, { now: true });
    const read2 = await getShopConfig(14);
    expect(read2).toEqual({ now: true });
  });
});