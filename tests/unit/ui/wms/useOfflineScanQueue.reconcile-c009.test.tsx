/**
 * SF-PICK-ASSIGN-01 C009 — historical web Pick scans reconcile through the
 * authenticated API client (the hook's httpPost → axiosInstance), never the
 * service worker.
 *
 * Eligible: same-origin POST to /api/v1/wms/pick/scan whose body carries
 * pick_batch_id + pick_claim_generation (the server's per-claim fence binds the
 * replay to the original claimant), either never evaluated or marked 401 by the
 * old token-less service worker. Everything else is preserved untouched.
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

test('RC-01 authenticated replay on startup: a historical scan goes through the API client and is cleared on 2xx', async () => {
  store.set('q1', entry('q1', 'b1'));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  const { result } = await mount(httpPost);
  await waitFor(() => expect(store.has('q1')).toBe(false));
  expect(httpPost).toHaveBeenCalledWith(SCAN_URL, scanBody('b1'));
  await waitFor(() => expect(result.current.queuedCount).toBe(0));
});

test('RC-02 ALREADY_RECORDED by this requester clears; by another operator it is kept and shown', async () => {
  store.set('mine', entry('mine', 'b-mine'));
  store.set('theirs', entry('theirs', 'b-theirs'));
  const httpPost = jest.fn(async (_url: string, body: any) => {
    if (body.pick_batch_id === 'b-mine') throw httpError(409, { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: true });
    throw httpError(409, { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: false, error: 'This scan is already recorded.' });
  });
  const { result } = await mount(httpPost);
  await waitFor(() => expect(store.has('mine')).toBe(false));
  await waitFor(() => expect(result.current.rejectedScans.map((e) => e.id)).toEqual(['theirs']));
  expect(store.get('theirs')?.rejected).toMatchObject({ status: 409, code: 'PICK_SCAN_ALREADY_RECORDED' });
  expect(JSON.parse(store.get('theirs')!.body)).toEqual(scanBody('b-theirs')); // original data preserved
});

test('RC-03 revoked ownership and stale generation are preserved, displayed, and never resent', async () => {
  store.set('rev', entry('rev', 'b-rev'));
  store.set('stale', entry('stale', 'b-stale'));
  const httpPost = jest.fn(async (_url: string, body: any) => {
    if (body.pick_batch_id === 'b-rev') throw httpError(409, { code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator' });
    throw httpError(409, { code: 'PICK_GENERATION_STALE', error: 'stale' });
  });
  const { result } = await mount(httpPost);
  await waitFor(() => expect(result.current.rejectedScans).toHaveLength(2));
  expect(store.get('rev')?.rejected?.code).toBe('PICK_OWNERSHIP_REVOKED');
  expect(store.get('stale')?.rejected?.code).toBe('PICK_GENERATION_STALE');
  httpPost.mockClear();
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await settle();
  expect(httpPost).not.toHaveBeenCalled();
  expect(store.size).toBe(2);
});

test('RC-04 network failure / 5xx retain the entry unmarked; a later trigger confirms it', async () => {
  store.set('n', entry('n', 'b-n'));
  const httpPost = jest.fn()
    .mockRejectedValueOnce(networkError())
    .mockRejectedValueOnce(httpError(503))
    .mockResolvedValue(undefined);
  await mount(httpPost);
  expect(store.get('n')?.rejected).toBeUndefined();
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await settle();
  expect(store.get('n')?.rejected).toBeUndefined();
  expect(writes).toEqual([]);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await waitFor(() => expect(store.has('n')).toBe(false));
});

test('RC-05 retries after transient failure are bounded', async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] }); // the IDB double resolves on microtasks
  store.set('n', entry('n', 'b-n'));
  const httpPost = jest.fn().mockRejectedValue(networkError());
  renderHook(() => useOfflineScanQueue({ httpPost }));
  for (let i = 0; i < 10; i += 1) {
    await act(async () => { for (let j = 0; j < 40; j += 1) await Promise.resolve(); jest.advanceTimersByTime(10 * 60 * 1000); });
  }
  expect(httpPost.mock.calls.length).toBeGreaterThan(1);
  expect(httpPost.mock.calls.length).toBeLessThanOrEqual(4);
  expect(store.get('n')?.rejected).toBeUndefined();
});

test('RC-06 401 pauses reconciliation without marking; it resumes once authentication is restored', async () => {
  store.set('a', entry('a', 'b-a'));
  store.set('b', entry('b', 'b-b'));
  const httpPost = jest.fn().mockRejectedValue(httpError(401, { error: 'Unauthorized' }));
  const { result } = await mount(httpPost);
  expect(httpPost).toHaveBeenCalledTimes(1);           // paused after the first 401
  expect(writes).toEqual([]);
  expect(result.current.rejectedScans).toEqual([]);
  httpPost.mockReset().mockResolvedValue(undefined);
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(store.size).toBe(0));
});

test('RC-07 historical 401 entries from the old service worker are retried; other refusals are not', async () => {
  store.set('sw401', entry('sw401', 'b-401', { rejected: { status: 401, code: null, error: 'Unauthorized', at: 2 } }));
  store.set('sw409', entry('sw409', 'b-409', { rejected: { status: 409, code: 'PICK_OWNERSHIP_REVOKED', error: null, at: 2 } }));
  const httpPost = jest.fn().mockResolvedValue(undefined);
  await mount(httpPost);
  await waitFor(() => expect(store.has('sw401')).toBe(false));
  expect(httpPost).toHaveBeenCalledTimes(1);
  expect(httpPost).toHaveBeenCalledWith(SCAN_URL, scanBody('b-401'));
  expect(store.get('sw409')?.rejected?.code).toBe('PICK_OWNERSHIP_REVOKED');
});

test('RC-08 entries whose origin or requester cannot be established are never sent and never modified', async () => {
  store.set('nogen', entry('nogen', 'b-x', { __noGen: true }));
  store.set('nogen401', entry('nogen401', 'b-y', { __noGen: true, rejected: { status: 401, code: null, error: null, at: 2 } }));
  store.set('foreign', { ...entry('foreign', 'b-z'), url: 'https://evil.example.com/api/v1/wms/pick/scan' });
  store.set('otherpath', { ...entry('otherpath', 'b-w'), url: '/api/v1/wms/pack/scan' });
  store.set('get', { ...entry('get', 'b-v'), method: 'GET' });
  store.set('garbage', { id: 'garbage', url: SCAN_URL, method: 'POST', body: 'not json', queuedAt: 1 });
  const before = JSON.stringify([...store.entries()]);
  const httpPost = jest.fn().mockResolvedValue(undefined);
  await mount(httpPost);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await settle();
  expect(httpPost).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
  expect(JSON.stringify([...store.entries()])).toBe(before);
});

test('RC-09 uncertain answers (no recognised status) preserve the entry without marking it', async () => {
  store.set('u', entry('u', 'b-u'));
  const httpPost = jest.fn().mockRejectedValue(httpError(302, {}));
  const { result } = await mount(httpPost);
  await settle();
  expect(httpPost).toHaveBeenCalled();
  expect(writes).toEqual([]);
  expect(result.current.rejectedScans).toEqual([]);
});

test('RC-10 repeated triggers in one tab never send the same entry concurrently', async () => {
  store.set('q', entry('q', 'b-q'));
  let release: () => void = () => {};
  const httpPost = jest.fn(() => new Promise<void>((r) => { release = r; }));
  await mount(httpPost);
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  await settle();
  expect(httpPost).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
  await waitFor(() => expect(store.has('q')).toBe(false));
});

test('RC-11 multiple tabs: when another tab holds the reconcile lock this tab sends nothing', async () => {
  store.set('q', entry('q', 'b-q'));
  const request = jest.fn((_name: string, opts: any, cb: (lock: unknown) => Promise<unknown>) => {
    expect(opts).toMatchObject({ ifAvailable: true });
    return cb(null); // held elsewhere
  });
  (navigator as any).locks = { request };
  const httpPost = jest.fn().mockResolvedValue(undefined);
  await mount(httpPost);
  await settle();
  expect(request).toHaveBeenCalled();
  expect(httpPost).not.toHaveBeenCalled();
  expect(store.has('q')).toBe(true);
});

test('RC-12 an entry cleared by another tab mid-run is not resent', async () => {
  store.set('a', entry('a', 'b-a'));
  store.set('b', entry('b', 'b-b'));
  const httpPost = jest.fn(async (_url: string, body: any) => {
    if (body.pick_batch_id === 'b-a') store.delete('b'); // other tab confirmed b meanwhile
  });
  await mount(httpPost);
  await waitFor(() => expect(store.size).toBe(0));
  expect(httpPost).toHaveBeenCalledTimes(1);
});

test('RC-13 reconciliation never creates queue entries and never registers Background Sync', async () => {
  const register = jest.fn();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ sync: { register } }), addEventListener: () => {}, removeEventListener: () => {} },
  });
  store.set('q', entry('q', 'b-q'));
  const httpPost = jest.fn().mockRejectedValue(networkError());
  const { result } = await mount(httpPost);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await act(async () => { await result.current.submitScan({ deviceEventId: 'new', url: SCAN_URL, body: scanBody('b-new') }).catch(() => undefined); });
  await settle();
  expect(writes.filter((w) => w.op === 'put')).toEqual([]);
  expect([...store.keys()]).toEqual(['q']);
  expect(register).not.toHaveBeenCalled();
  delete (navigator as any).serviceWorker;
});
