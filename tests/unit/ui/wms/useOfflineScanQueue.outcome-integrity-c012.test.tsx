/**
 * SF-PICK-ASSIGN-01 C012 (OUTCOME-INTEGRITY) — web offline scans the server
 * answered with PICK_SCAN_OUTCOME_UNCERTAIN (409: the removal or reservation
 * release already exists, so the scan may already be recorded). Like a fence
 * refusal, dismissing one records the operator's audited review first, carrying
 * the original request AND the rejection (status, code, error, timestamp); a
 * failed review keeps the entry untouched.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useOfflineScanQueue } from '../../../../modules/wms/src/ui/hooks/useOfflineScanQueue';

type Entry = Record<string, any>;
const store = new Map<string, Entry>();
const writes: Array<{ op: string; id: string }> = [];

function memoryIndexedDb() {
  const request = (fn: () => unknown) => {
    const req: any = {};
    queueMicrotask(() => { req.result = fn(); req.onsuccess?.(); });
    return req;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({
        getAll: () => request(() => [...store.values()].map((e) => ({ ...e }))),
        get: (id: string) => request(() => (store.has(id) ? { ...store.get(id) } : undefined)),
        put: (entry: Entry) => request(() => { writes.push({ op: 'put', id: entry.id }); store.set(entry.id, { ...entry }); }),
        delete: (id: string) => request(() => { writes.push({ op: 'delete', id }); store.delete(id); }),
      }),
    }),
  };
  return { open: () => request(() => db) };
}

const SCAN_URL = '/api/v1/wms/pick/scan';
const REVIEW_URL = '/api/v1/wms/pick/unconfirmed-scan-review';

const uncertain = (id: string): Entry => ({
  id, url: SCAN_URL, method: 'POST', queuedAt: 1_700_000_000_000,
  body: JSON.stringify({ pick_batch_id: `b-${id}`, reservation_allocation_id: `a-${id}`, quantity_confirmed: 1, pick_claim_generation: 'gen-1' }),
  rejected: { status: 409, code: 'PICK_SCAN_OUTCOME_UNCERTAIN', error: 'This pick may already have been recorded.', at: 1_700_000_000_500 },
});
const httpError = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data } });
const networkError = () => Object.assign(new Error('Network Error'), { isAxiosError: true, request: {}, response: undefined });

beforeAll(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
});
beforeEach(() => {
  store.clear();
  writes.length = 0;
  (globalThis as any).indexedDB = memoryIndexedDb();
  delete (navigator as any).locks;
});

async function mount(httpPost: jest.Mock) {
  const hook = renderHook(() => useOfflineScanQueue({ httpPost }));
  await act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
  return hook;
}

test('WO-01 dismissing an outcome-uncertain refusal records the audited review (original + rejection), then removes it', async () => {
  const entry = uncertain('u1');
  store.set(entry.id, entry);
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.rejectedScans).toHaveLength(1));
  await act(async () => { await result.current.dismissRejectedScan(entry.id); });
  expect(httpPost.mock.calls).toEqual([[REVIEW_URL, {
    device_event_id: entry.id, queued_at: entry.queuedAt,
    original: { url: entry.url, method: entry.method, body: entry.body },
    rejection: { status: 409, code: 'PICK_SCAN_OUTCOME_UNCERTAIN', error: entry.rejected.error, rejected_at: entry.rejected.at },
  }]]);
  expect(writes).toEqual([{ op: 'delete', id: entry.id }]);
});

test('WO-02 a failed review (network, 401, 5xx) keeps the outcome-uncertain scan untouched', async () => {
  const entry = uncertain('keep');
  store.set('keep', entry);
  const before = JSON.stringify(store.get('keep'));
  const httpPost = jest.fn()
    .mockRejectedValueOnce(networkError())
    .mockRejectedValueOnce(httpError(401))
    .mockRejectedValueOnce(httpError(500));
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.rejectedScans).toHaveLength(1));
  for (let i = 0; i < 3; i += 1) {
    await act(async () => { await expect(result.current.dismissRejectedScan('keep')).rejects.toBeTruthy(); });
  }
  expect(httpPost).toHaveBeenCalledTimes(3);
  expect(writes).toEqual([]);
  expect(JSON.stringify(store.get('keep'))).toBe(before);
  expect(result.current.rejectedScans.map((e) => e.id)).toEqual(['keep']);
});
