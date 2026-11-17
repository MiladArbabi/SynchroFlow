/**
 * SF-PICK-ASSIGN-01 C012 (UX-TRUTH-004, F-A) — web: reviewing an unconfirmed
 * (generation-less) historical scan. A failure of this device's own scan
 * storage (IndexedDB) is reported as SCAN_QUEUE_STORAGE_FAILED, never as an
 * HTTP/connectivity failure, and the scan is never silently removed. HTTP
 * failures pass through unchanged. Harness identical to
 * useOfflineScanQueue.local-failure-c012 (WL-*).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useOfflineScanQueue } from '../../../../modules/wms/src/ui/hooks/useOfflineScanQueue';

type Entry = Record<string, any>;
const store = new Map<string, Entry>();
const fail = { get: false, delete: false };

function memoryIndexedDb() {
  const request = (fn: () => unknown, failNow = false) => {
    const req: any = {};
    queueMicrotask(() => {
      if (failNow) { req.error = new DOMException('Disk full', 'QuotaExceededError'); req.onerror?.(); return; }
      req.result = fn(); req.onsuccess?.();
    });
    return req;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({
        getAll: () => request(() => [...store.values()].map((e) => ({ ...e }))),
        get: (id: string) => request(() => (store.has(id) ? { ...store.get(id) } : undefined), fail.get),
        put: (entry: Entry) => request(() => { store.set(entry.id, { ...entry }); }),
        delete: (id: string) => request(() => { store.delete(id); }, fail.delete),
      }),
    }),
  };
  return { open: () => request(() => db) };
}

const REVIEW_URL = '/api/v1/wms/pick/unconfirmed-scan-review';
/** Queued before Pick generations existed: never replayed, outcome unknown. */
const unconfirmed = (id: string): Entry => ({
  id, url: '/api/v1/wms/pick/scan', method: 'POST', queuedAt: 1,
  body: JSON.stringify({ pick_batch_id: `b-${id}` }),
});

beforeAll(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
});
beforeEach(() => {
  store.clear();
  fail.get = false;
  fail.delete = false;
  (globalThis as any).indexedDB = memoryIndexedDb();
  delete (navigator as any).locks;
});

async function mount(httpPost: jest.Mock) {
  const hook = renderHook(() => useOfflineScanQueue({ httpPost }));
  await act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
  return hook;
}

async function review(result: { current: ReturnType<typeof useOfflineScanQueue> }, id: string) {
  let caught: any;
  await act(async () => { await result.current.reviewUnconfirmedScan(id).catch((e: unknown) => { caught = e; }); });
  return caught;
}

test('WU-01 review recorded, local removal fails: rejects as a storage failure (not HTTP); the scan stays', async () => {
  store.set('u', unconfirmed('u'));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.unconfirmedScans).toHaveLength(1));
  fail.delete = true;
  const caught = await review(result, 'u');
  expect(caught).toMatchObject({ code: 'SCAN_QUEUE_STORAGE_FAILED' });
  expect(caught.response).toBeUndefined();
  expect(httpPost.mock.calls.map(([url]) => url)).toEqual([REVIEW_URL]);
  expect(store.has('u')).toBe(true);
  expect(result.current.unconfirmedScans).toHaveLength(1);
});

test('WU-02 the entry cannot be read: rejects as a storage failure and sends no review', async () => {
  store.set('u', unconfirmed('u'));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.unconfirmedScans).toHaveLength(1));
  fail.get = true;
  const caught = await review(result, 'u');
  expect(caught).toMatchObject({ code: 'SCAN_QUEUE_STORAGE_FAILED' });
  expect(httpPost).not.toHaveBeenCalled();
  expect(store.has('u')).toBe(true);
});

test('WU-03 HTTP review failures (401, 5xx, no answer) pass through unchanged and keep the scan', async () => {
  const failures = [
    Object.assign(new Error('401'), { isAxiosError: true, response: { status: 401, data: {} } }),
    Object.assign(new Error('500'), { isAxiosError: true, response: { status: 500, data: {} } }),
    Object.assign(new Error('Network Error'), { isAxiosError: true }),
  ];
  for (const failure of failures) {
    store.clear();
    store.set('u', unconfirmed('u'));
    const httpPost = jest.fn().mockRejectedValue(failure);
    const { result, unmount } = await mount(httpPost);
    await waitFor(() => expect(result.current.unconfirmedScans).toHaveLength(1));
    expect(await review(result, 'u')).toBe(failure);
    expect(store.has('u')).toBe(true);
    unmount();
  }
});

test('WU-04 success: review recorded first, then the scan is removed', async () => {
  store.set('u', unconfirmed('u'));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.unconfirmedScans).toHaveLength(1));
  expect(await review(result, 'u')).toBeUndefined();
  expect(httpPost.mock.calls.map(([url]) => url)).toEqual([REVIEW_URL]);
  expect(store.has('u')).toBe(false);
});
