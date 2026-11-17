/**
 * SF-PICK-ASSIGN-01 C012 (FINAL-CLOSURE, LOW-2) — web: a failure of this
 * device's own scan storage (IndexedDB) while dismissing is reported as a
 * storage failure (code SCAN_QUEUE_STORAGE_FAILED), never as lost
 * connectivity. The scan is not silently removed.
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
const uncertain = (id: string): Entry => ({
  id, url: '/api/v1/wms/pick/scan', method: 'POST', queuedAt: 1,
  body: JSON.stringify({ pick_batch_id: `b-${id}`, pick_claim_generation: 'gen-1' }),
  rejected: { status: 409, code: 'PICK_SCAN_OUTCOME_UNCERTAIN', error: 'may already be recorded', at: 2 },
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

test('WL-01 review recorded, local removal fails: rejects as a storage failure (not connectivity); the scan stays', async () => {
  store.set('u', uncertain('u'));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.rejectedScans).toHaveLength(1));
  fail.delete = true;
  let caught: any;
  await act(async () => { await result.current.dismissRejectedScan('u').catch((e: unknown) => { caught = e; }); });
  expect(caught).toMatchObject({ code: 'SCAN_QUEUE_STORAGE_FAILED' });
  expect(caught.response).toBeUndefined();
  expect(httpPost.mock.calls.map(([url]) => url)).toEqual([REVIEW_URL]);
  expect(store.has('u')).toBe(true);
});

test('WL-02 the entry cannot be read: rejects as a storage failure and sends no review', async () => {
  store.set('u', uncertain('u'));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.rejectedScans).toHaveLength(1));
  fail.get = true;
  let caught: any;
  await act(async () => { await result.current.dismissRejectedScan('u').catch((e: unknown) => { caught = e; }); });
  expect(caught).toMatchObject({ code: 'SCAN_QUEUE_STORAGE_FAILED' });
  expect(httpPost).not.toHaveBeenCalled();
  expect(store.has('u')).toBe(true);
});

test('WL-03 an HTTP review failure is passed through unchanged (401/network handling is the page\'s)', async () => {
  store.set('u', uncertain('u'));
  const unauthorized = Object.assign(new Error('401'), { isAxiosError: true, response: { status: 401, data: {} } });
  const httpPost = jest.fn().mockRejectedValue(unauthorized);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.rejectedScans).toHaveLength(1));
  let caught: any;
  await act(async () => { await result.current.dismissRejectedScan('u').catch((e: unknown) => { caught = e; }); });
  expect(caught).toBe(unauthorized);
  expect(store.has('u')).toBe(true);
});
