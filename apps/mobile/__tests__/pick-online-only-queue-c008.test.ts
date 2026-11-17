/**
 * SF-PICK-ASSIGN-01 C008 — online-only Pick (owner decision: Pick v1 requires a
 * working backend connection). packages/mobile-core submitScanOnline():
 *   - a scan is confirmed only by the server's answer (2xx, or the authoritative
 *     PICK_SCAN_ALREADY_RECORDED for this operator after a lost response);
 *   - a connectivity failure is reported as PICK_CONNECTION_LOST and nothing is
 *     written to the device queue;
 *   - historical queued / rejected entries are left untouched by new scans and
 *     are still reconciled by the existing drain when connected.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockPost = jest.fn();
jest.mock('../../../packages/mobile-core/src/apiClient', () => ({ apiClient: { post: (...a: unknown[]) => mockPost(...a) } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { offlineQueue } = require('../../../packages/mobile-core/src/offlineQueue');

const QUEUE_KEY = 'ls:offline_queue';
const REJECTED_KEY = 'ls:offline_rejected';

const httpError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
const networkError = () => new Error('Network request failed');

const scan = (id: string) => ({
  deviceEventId: id,
  url: '/api/v1/wms/pick/scan',
  body: { pick_batch_id: `batch-${id}`, reservation_allocation_id: `alloc-${id}`, pick_claim_generation: 'gen-1' },
});

const raw = async (key: string) => AsyncStorage.getItem(key);

let timerSpy: jest.SpyInstance;
beforeEach(async () => {
  timerSpy = jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as never);
  mockPost.mockReset();
  await AsyncStorage.clear();
  await offlineQueue.flush();                          // settle module state from earlier tests
});
afterEach(() => timerSpy.mockRestore());

test('OQ-01 online: the server accepts the scan → confirmed (undefined); the exact body is posted once; nothing queued', async () => {
  mockPost.mockResolvedValue({ data: { scan_id: 's1' } });
  expect(await offlineQueue.submitScanOnline(scan('a'))).toBeUndefined();
  const scanPosts = mockPost.mock.calls.filter(([url]) => url === '/api/v1/wms/pick/scan');
  expect(scanPosts).toHaveLength(1);
  expect(scanPosts[0][1]).toStrictEqual(scan('a').body);           // allocation + generation travel unchanged
  expect(await raw(QUEUE_KEY)).toBeNull();
});

test('OQ-02 no HTTP answer → PICK_CONNECTION_LOST; the scan is NOT written to the device queue', async () => {
  mockPost.mockRejectedValue(networkError());
  const result = await offlineQueue.submitScanOnline(scan('b'));
  expect(result).toMatchObject({ status: 0, code: 'PICK_CONNECTION_LOST' });
  expect(await raw(QUEUE_KEY)).toBeNull();
  expect(await offlineQueue.getCount()).toBe(0);
  expect(await raw(REJECTED_KEY)).toBeNull();
});

test('OQ-03 lost response, retried: PICK_SCAN_ALREADY_RECORDED for this operator is the authoritative confirmation', async () => {
  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: true }));
  expect(await offlineQueue.submitScanOnline(scan('c'))).toBeUndefined();
  expect(await raw(QUEUE_KEY)).toBeNull();
});

test('OQ-04 recorded by another operator, ownership refusal, uncertain outcome: returned to the caller, never confirmed or queued', async () => {
  for (const [data, code] of [
    [{ code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: false }, 'PICK_SCAN_ALREADY_RECORDED'],
    [{ code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator' }, 'PICK_OWNERSHIP_REVOKED'],
    [{ code: 'PICK_SCAN_OUTCOME_UNCERTAIN', error: 'may already be recorded' }, 'PICK_SCAN_OUTCOME_UNCERTAIN'],
  ] as const) {
    mockPost.mockRejectedValueOnce(httpError(409, data));
    expect(await offlineQueue.submitScanOnline(scan(code))).toMatchObject({ status: 409, code });
  }
  mockPost.mockRejectedValueOnce(httpError(503, { error: 'Service unavailable' }));
  expect(await offlineQueue.submitScanOnline(scan('srv'))).toMatchObject({ status: 503 });
  expect(await raw(QUEUE_KEY)).toBeNull();
  expect(await raw(REJECTED_KEY)).toBeNull();
});

test('OQ-05 historical queued and rejected entries survive a disconnected new scan byte-for-byte', async () => {
  const legacyQueue = JSON.stringify([scan('old-1'), scan('old-2')]);
  const legacyRejected = JSON.stringify([{ ...scan('old-r'), status: 409, code: 'PICK_OWNERSHIP_REVOKED', error: 'x', rejectedAt: 1, reason: 'refused' }]);
  await AsyncStorage.setItem(QUEUE_KEY, legacyQueue);
  await AsyncStorage.setItem(REJECTED_KEY, legacyRejected);

  mockPost.mockRejectedValue(networkError());
  expect(await offlineQueue.submitScanOnline(scan('new'))).toMatchObject({ code: 'PICK_CONNECTION_LOST' });
  expect(await raw(QUEUE_KEY)).toBe(legacyQueue);               // not appended to, not cleared
  expect(await raw(REJECTED_KEY)).toBe(legacyRejected);
});

test('OQ-06 historical entries are reconciled when connected: delivered/own-recorded leave the queue, refusals are kept for review', async () => {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([scan('h-ok'), scan('h-mine'), scan('h-revoked')]));
  mockPost.mockImplementation(async (_url: string, body: { pick_batch_id: string }) => {
    if (body.pick_batch_id === 'batch-h-ok') return { data: {} };
    if (body.pick_batch_id === 'batch-h-mine') throw httpError(409, { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: true });
    throw httpError(409, { code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator' });
  });
  await offlineQueue.flush();
  expect(await offlineQueue.getCount()).toBe(0);
  const rejected = await offlineQueue.getRejected();
  expect(rejected.map((r: { deviceEventId: string; code: string }) => [r.deviceEventId, r.code]))
    .toEqual([['h-revoked', 'PICK_OWNERSHIP_REVOKED']]);         // evidence kept, never resent
});

test('OQ-07 a live success still drains historical entries afterwards (existing reconciliation trigger)', async () => {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([scan('h-1')]));
  mockPost.mockResolvedValue({ data: {} });
  expect(await offlineQueue.submitScanOnline(scan('live'))).toBeUndefined();
  await offlineQueue.flush();
  expect(mockPost.mock.calls.map(([, b]) => (b as { pick_batch_id: string }).pick_batch_id)).toEqual(['batch-live', 'batch-h-1']);
  expect(await offlineQueue.getCount()).toBe(0);
});
