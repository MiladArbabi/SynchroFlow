/**
 * SF-PICK-ASSIGN-01 C008 — web Pick scan submission is online-only
 * (modules/wms/src/ui/hooks/useOfflineScanQueue.ts, consumed only by the Pick
 * scan path of WmsOperationsPage).
 *   - every scan is POSTed; navigator.onLine never decides acceptance;
 *   - no HTTP answer → rejects with code PICK_CONNECTION_LOST; nothing is
 *     written to IndexedDB and no Background Sync is registered;
 *   - PICK_SCAN_ALREADY_RECORDED for this operator (lost response) confirms;
 *   - historical queued / rejected entries are still read for display and are
 *     never modified by a new scan.
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
        put: (entry: Entry) => request(() => { writes.push({ op: 'put', id: entry.id }); store.set(entry.id, { ...entry }); }),
        delete: (id: string) => request(() => { writes.push({ op: 'delete', id }); store.delete(id); }),
      }),
    }),
  };
  return { open: () => request(() => db) };
}

const body = { pick_batch_id: 'b1', reservation_allocation_id: 'alloc-1', pick_claim_generation: 'gen-1' };
const params = (id = 'evt-1') => ({ deviceEventId: id, url: '/api/v1/wms/pick/scan', body });
const httpError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data } });
const networkError = () => Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK', request: {}, response: undefined });

let onLine = true;
beforeAll(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => onLine });
});
beforeEach(() => {
  onLine = true;
  store.clear();
  writes.length = 0;
  (globalThis as any).indexedDB = memoryIndexedDb();
});

async function mount(httpPost: jest.Mock) {
  const hook = renderHook(() => useOfflineScanQueue({ httpPost }));
  await act(async () => { await Promise.resolve(); });
  return hook;
}

test('WH-01 online: the scan is POSTed and resolves only on the server acceptance', async () => {
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await act(async () => { await result.current.submitScan(params()); });
  expect(httpPost).toHaveBeenCalledWith('/api/v1/wms/pick/scan', body);
  expect(writes).toEqual([]);
});

test('WH-02 no HTTP answer → PICK_CONNECTION_LOST; nothing queued', async () => {
  const httpPost = jest.fn().mockRejectedValue(networkError());
  const { result } = await mount(httpPost);
  let caught: any;
  await act(async () => { await result.current.submitScan(params()).catch((e: unknown) => { caught = e; }); });
  expect(caught?.code).toBe('PICK_CONNECTION_LOST');
  expect(writes).toEqual([]);
  expect(result.current.queuedCount).toBe(0);
});

test('WH-03 the browser reports offline: the scan is still attempted, never queued, and rejects as connection lost', async () => {
  onLine = false;
  const httpPost = jest.fn().mockRejectedValue(networkError());
  const { result } = await mount(httpPost);
  act(() => { window.dispatchEvent(new Event('offline')); });
  let caught: any;
  await act(async () => { await result.current.submitScan(params()).catch((e: unknown) => { caught = e; }); });
  expect(httpPost).toHaveBeenCalledTimes(1);
  expect(caught?.code).toBe('PICK_CONNECTION_LOST');
  expect(writes).toEqual([]);
});

test('WH-04 lost response retried: already recorded for this operator confirms; by someone else it rejects', async () => {
  const httpPost = jest.fn()
    .mockRejectedValueOnce(httpError(409, { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: true }))
    .mockRejectedValueOnce(httpError(409, { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: false }));
  const { result } = await mount(httpPost);
  await act(async () => { await result.current.submitScan(params('evt-1')); });
  let caught: any;
  await act(async () => { await result.current.submitScan(params('evt-1')).catch((e: unknown) => { caught = e; }); });
  expect(caught?.response?.data?.code).toBe('PICK_SCAN_ALREADY_RECORDED');
  expect(writes).toEqual([]);
});

test('WH-05 historical entries stay visible and untouched by new scans', async () => {
  store.set('old-q', { id: 'old-q', url: '/api/v1/wms/pick/scan', method: 'POST', body: '{}', queuedAt: 1 });
  store.set('old-r', { id: 'old-r', url: '/api/v1/wms/pick/scan', method: 'POST', body: '{}', queuedAt: 1, rejected: { status: 409, code: 'PICK_OWNERSHIP_REVOKED', error: null, at: 2 } });
  const httpPost = jest.fn().mockRejectedValue(networkError());
  const { result } = await mount(httpPost);
  // C010 (F2): a generation-less entry is shown as unconfirmed, not counted as pending.
  await waitFor(() => expect(result.current.unconfirmedScans.map((e) => e.id)).toEqual(['old-q']));
  expect(result.current.queuedCount).toBe(0);
  expect(result.current.rejectedScans.map((e) => e.id)).toEqual(['old-r']);
  await act(async () => { await result.current.submitScan(params('new')).catch(() => undefined); });
  expect(writes).toEqual([]);
  expect([...store.keys()].sort()).toEqual(['old-q', 'old-r']);
});
