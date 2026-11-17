/**
 * SF-PICK-ASSIGN-01 C011 (NEW-1, requirement 7) — web offline scans refused by
 * ownership/generation fencing. The server checks the fence before its
 * duplicate guard, so such a refusal does not prove the scan was never
 * recorded. Dismissing it records the operator's review on the server (with
 * the original request) first; a failed review keeps the entry untouched.
 * Non-fence refusals keep their existing local dismissal.
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
const FENCE_CODES = ['PICK_OWNERSHIP_REVOKED', 'PICK_GENERATION_STALE', 'PICK_GENERATION_REQUIRED', 'PICK_BATCH_NOT_PICKING', 'PICK_CUSTODY_ACK_REQUIRED'];

const refused = (id: string, code: string | null, status = 409): Entry => ({
  id, url: SCAN_URL, method: 'POST', queuedAt: 1_700_000_000_000,
  body: JSON.stringify({ pick_batch_id: `b-${id}`, reservation_allocation_id: `a-${id}`, quantity_confirmed: 1, pick_claim_generation: 'gen-1' }),
  rejected: { status, code, error: 'refused', at: 2 },
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

test('WF-01 dismissing a fence-refused scan records the audited review with the original request, then removes it', async () => {
  for (const code of FENCE_CODES) {
    store.clear();
    writes.length = 0;
    const entry = refused(`f-${code}`, code);
    store.set(entry.id, entry);
    const httpPost = jest.fn().mockResolvedValue(undefined);
    const { result, unmount } = await mount(httpPost);
    await waitFor(() => expect(result.current.rejectedScans).toHaveLength(1));
    await act(async () => { await result.current.dismissRejectedScan(entry.id); });
    expect(httpPost.mock.calls).toEqual([[REVIEW_URL, {
      device_event_id: entry.id, queued_at: entry.queuedAt,
      original: { url: entry.url, method: entry.method, body: entry.body },
      rejection: { status: entry.rejected.status, code, error: entry.rejected.error, rejected_at: entry.rejected.at },
    }]]);
    expect(writes).toEqual([{ op: 'delete', id: entry.id }]);
    unmount();
  }
});

test('WF-02 a failed review (network, 401, 5xx) keeps the fence-refused scan untouched and reports the failure', async () => {
  const entry = refused('keep', 'PICK_GENERATION_STALE');
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
  expect(writes).toEqual([]);
  expect(JSON.stringify(store.get('keep'))).toBe(before);
  expect(result.current.rejectedScans.map((e) => e.id)).toEqual(['keep']);
});

test('WF-03 a non-fence refusal keeps its local dismissal: no review is sent', async () => {
  store.set('stock', refused('stock', 'ALLOCATION_EXCEPTION_EXISTS'));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.rejectedScans).toHaveLength(1));
  await act(async () => { await result.current.dismissRejectedScan('stock'); });
  expect(httpPost).not.toHaveBeenCalled();
  expect(writes).toEqual([{ op: 'delete', id: 'stock' }]);
});
