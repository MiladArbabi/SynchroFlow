/**
 * SF-PICK-ASSIGN-01 C009 — apps/frontend/public/sw.js must never replay Pick
 * scans. A token-less SW request always gets 401 and the SW used to mark the
 * entry rejected; reconciliation is now application-driven and authenticated.
 * A pending 'wms-pick-scan-sync' registration (from an older page) must
 * resolve without any fetch and without touching the queue.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

type Entry = Record<string, any>;

function load(store: Map<string, Entry>, fetchImpl: jest.Mock, idbOps: string[]) {
  const listeners: Record<string, (e: any) => void> = {};
  const request = (op: string, fn: () => unknown) => {
    idbOps.push(op);
    const req: any = {};
    queueMicrotask(() => { req.result = fn(); req.onsuccess?.(); });
    return req;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({
        getAll: () => request('getAll', () => [...store.values()]),
        put: (e: Entry) => request('put', () => store.set(e.id, e)),
        delete: (id: string) => request('delete', () => store.delete(id)),
      }),
    }),
  };
  const sandbox: any = {
    indexedDB: { open: () => request('open', () => db) },
    fetch: fetchImpl,
    console: { info: () => {}, warn: () => {}, error: () => {} },
    queueMicrotask,
    self: {
      addEventListener: (type: string, fn: (e: any) => void) => { listeners[type] = fn; },
      skipWaiting: jest.fn(),
      clients: { claim: () => Promise.resolve() },
      registration: { showNotification: () => Promise.resolve() },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../../apps/frontend/public/sw.js'), 'utf8'), sandbox);
  return { listeners, sandbox };
}

test('SW-C009-01 a pending pick-scan sync resolves without fetching or touching the queue', async () => {
  const store = new Map<string, Entry>([
    ['q', { id: 'q', url: '/api/v1/wms/pick/scan', method: 'POST', body: '{"pick_batch_id":"b","pick_claim_generation":"g"}', queuedAt: 1 }],
  ]);
  const before = JSON.stringify([...store.entries()]);
  const fetchImpl = jest.fn();
  const idbOps: string[] = [];
  const { listeners } = load(store, fetchImpl, idbOps);
  let waited: Promise<unknown> | undefined;
  listeners.sync?.({ tag: 'wms-pick-scan-sync', waitUntil: (p: Promise<unknown>) => { waited = p; } });
  await waited;
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(idbOps).toEqual([]);
  expect(JSON.stringify([...store.entries()])).toBe(before);
});

test('SW-C009-02 the new worker activates promptly so it supersedes an older replaying worker', () => {
  const { listeners, sandbox } = load(new Map(), jest.fn(), []);
  listeners.install?.({});
  expect(sandbox.self.skipWaiting).toHaveBeenCalled();
  expect(typeof listeners.activate).toBe('function');
});
