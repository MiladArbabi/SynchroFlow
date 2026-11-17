/**
 * SF-PICK-ASSIGN-01 C010 (REVIEW-006 F2) — historical web Pick scans WITHOUT a
 * pick_claim_generation (pre-C008 client) cannot be replayed safely. They are
 * preserved byte-for-byte, never submitted, shown as "Unconfirmed", and leave
 * the device only after the operator's explicit review has been recorded by
 * the server (operator_audit_log) — a failed audit keeps the entry.
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
const scanBody = (batch: string, gen: string | null = 'gen-1') => ({
  pick_batch_id: batch, reservation_allocation_id: `alloc-${batch}`, quantity_confirmed: 1,
  ...(gen === null ? {} : { pick_claim_generation: gen }),
});
const entry = (id: string, batch: string, extra: Entry = {}, gen?: string): Entry => ({
  id, url: SCAN_URL, method: 'POST', queuedAt: 1,
  body: JSON.stringify(scanBody(batch, extra.__noGen ? null : gen ?? 'gen-1')), ...extra,
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
afterEach(() => { jest.useRealTimers(); });

async function mount(httpPost: jest.Mock) {
  const hook = renderHook(() => useOfflineScanQueue({ httpPost }));
  await act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
  return hook;
}
const settle = async () => { await act(async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); }); };


const REVIEW_URL = '/api/v1/wms/pick/unconfirmed-scan-review';
/** Exactly what the pre-C008 hook enqueued: no generation existed then. */
const preC008 = (id: string, batch: string): Entry => ({
  id, url: SCAN_URL, method: 'POST', queuedAt: 1_699_999_000_000,
  body: JSON.stringify({ pick_batch_id: batch, lasyncro_line_item_id: 'li-1', lasyncro_variant_id: 'v-1', location_code: 'A-01', quantity_confirmed: 1, scan_source: 'camera' }),
});

test('UC-01 a pre-C008 entry is shown as unconfirmed, not counted as pending, and never submitted', async () => {
  store.set('old', preC008('old', 'b-old'));
  const before = JSON.stringify(store.get('old'));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await act(async () => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
  await settle();
  await waitFor(() => expect(result.current.unconfirmedScans.map((e) => e.id)).toEqual(['old']));
  expect(result.current.queuedCount).toBe(0);
  expect(result.current.rejectedScans).toEqual([]);
  expect(httpPost).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
  expect(JSON.stringify(store.get('old'))).toBe(before);
});

test('UC-02 explicit review records the audit with the original data, then removes the entry', async () => {
  store.set('old', preC008('old', 'b-old'));
  const original = store.get('old')!;
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.unconfirmedScans).toHaveLength(1));
  await act(async () => { await result.current.reviewUnconfirmedScan('old'); });
  expect(httpPost).toHaveBeenCalledTimes(1);
  expect(httpPost).toHaveBeenCalledWith(REVIEW_URL, {
    device_event_id: 'old', queued_at: original.queuedAt,
    original: { url: original.url, method: original.method, body: original.body },
  });
  expect(store.has('old')).toBe(false);
  expect(writes).toEqual([{ op: 'delete', id: 'old' }]);
  await waitFor(() => expect(result.current.unconfirmedScans).toEqual([]));
});

test('UC-03 a failed audit (network, 5xx, 401) keeps the entry untouched', async () => {
  store.set('old', preC008('old', 'b-old'));
  const before = JSON.stringify(store.get('old'));
  const httpPost = jest.fn()
    .mockRejectedValueOnce(networkError())
    .mockRejectedValueOnce(httpError(500))
    .mockRejectedValueOnce(httpError(401));
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.unconfirmedScans).toHaveLength(1));
  for (let i = 0; i < 3; i += 1) {
    await act(async () => { await expect(result.current.reviewUnconfirmedScan('old')).rejects.toBeTruthy(); });
  }
  expect(writes).toEqual([]);
  expect(JSON.stringify(store.get('old'))).toBe(before);
});

test('UC-04 review is only for unconfirmed entries: a replayable or refused entry is not removed through it', async () => {
  store.set('rej', entry('rej', 'b-r', { rejected: { status: 409, code: 'PICK_OWNERSHIP_REVOKED', error: null, at: 2 } }));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await settle();
  await act(async () => { await expect(result.current.reviewUnconfirmedScan('rej')).rejects.toBeTruthy(); });
  expect(store.has('rej')).toBe(true);
  expect(httpPost).not.toHaveBeenCalledWith(REVIEW_URL, expect.anything());
});

test('UC-05 valid-generation replay is unchanged alongside unconfirmed entries', async () => {
  store.set('old', preC008('old', 'b-old'));
  store.set('ok', entry('ok', 'b-ok'));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(store.has('ok')).toBe(false));
  expect(httpPost).toHaveBeenCalledTimes(1);
  expect(httpPost).toHaveBeenCalledWith(SCAN_URL, scanBody('b-ok'));
  await waitFor(() => expect(result.current.unconfirmedScans.map((e) => e.id)).toEqual(['old']));
});
