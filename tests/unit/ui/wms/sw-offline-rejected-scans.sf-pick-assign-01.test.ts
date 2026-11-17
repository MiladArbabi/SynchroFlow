/**
 * SF-PICK-ASSIGN-01 — web offline Pick scan drain (apps/frontend/public/sw.js).
 *
 * The real service-worker source runs in a vm sandbox against a minimal
 * in-memory IndexedDB and a scripted fetch.
 *
 * C009 supersedes the original drain contract (2xx removed / 4xx marked
 * rejected / 5xx kept): the token-less SW replay always drew 401 and abandoned
 * the entry. sw.js now never replays; reconciliation is application-driven
 * (tests/unit/ui/wms/useOfflineScanQueue.reconcile-c009.test.tsx).
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

type Entry = Record<string, any>;

function memoryIndexedDb(store: Map<string, Entry>) {
  const request = (fn: () => unknown) => {
    const req: any = {};
    queueMicrotask(() => {
      req.result = fn();
      req.onsuccess?.();
    });
    return req;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({
        getAll: () => request(() => [...store.values()].map((e) => ({ ...e }))),
        put: (entry: Entry) => request(() => { store.set(entry.id, { ...entry }); }),
        delete: (id: string) => request(() => { store.delete(id); }),
      }),
    }),
  };
  return { open: () => request(() => db) };
}

function loadServiceWorker(store: Map<string, Entry>, fetchImpl: (url: string, init: any) => Promise<any>) {
  const listeners: Record<string, (e: any) => void> = {};
  const sandbox: any = {
    indexedDB: memoryIndexedDb(store),
    fetch: fetchImpl,
    console: { info: () => {}, warn: () => {}, error: () => {} },
    queueMicrotask,
    self: {
      addEventListener: (type: string, fn: (e: any) => void) => { listeners[type] = fn; },
      skipWaiting: () => {},
      clients: { claim: () => Promise.resolve() },
      registration: { showNotification: () => Promise.resolve() },
    },
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../../../../apps/frontend/public/sw.js'), 'utf8');
  vm.runInNewContext(source, sandbox);
  // C009 — the only queue entry point left is the legacy sync tag.
  return async () => {
    let waited: Promise<unknown> | undefined;
    listeners.sync?.({ tag: 'wms-pick-scan-sync', waitUntil: (p: Promise<unknown>) => { waited = p; } });
    await waited;
  };
}

const entry = (id: string, batch: string): Entry => ({
  id, url: '/api/v1/wms/pick/scan', method: 'POST', queuedAt: 1,
  body: JSON.stringify({ pick_batch_id: batch, pick_claim_generation: 'gen-1' }),
});

const response = (status: number, body: Record<string, unknown> = {}) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});

test('SW-01 (C009) the service worker never sends, marks, or removes a queued scan', async () => {
  const store = new Map<string, Entry>([
    ['ok', entry('ok', 'b-ok')],
    ['revoked', entry('revoked', 'b-revoked')],
  ]);
  const before = JSON.stringify([...store.entries()]);
  const fetchImpl = jest.fn(async () => response(201));
  const flush = loadServiceWorker(store, fetchImpl);
  await flush();
  await flush();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(JSON.stringify([...store.entries()])).toBe(before);
});

test('SW-02 (C009) a network-less sync leaves the scan queued and unmarked', async () => {
  const store = new Map<string, Entry>([['net', entry('net', 'b-net')]]);
  const flush = loadServiceWorker(store, async () => { throw new Error('offline'); });
  await flush();
  expect(store.get('net')).toBeDefined();
  expect(store.get('net')?.rejected).toBeUndefined();
});
