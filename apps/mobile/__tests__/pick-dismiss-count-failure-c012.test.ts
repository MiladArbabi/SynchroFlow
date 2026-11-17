/**
 * SF-PICK-ASSIGN-01 C012 (UX-TRUTH-004, F-B) — mobile dismissRejected: once
 * the audited review is recorded and the scan is removed from the review list,
 * a failure to re-read the queue count afterwards does not report the removed
 * scan as still present. The dismissal resolves; the storage problem is
 * surfaced through the queue status (storageError → the screen's "Scans can't
 * be saved on this phone" banner). Audit-before-removal is unchanged and no
 * Pick scan is re-sent.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockPost = jest.fn();
jest.mock('../../../packages/mobile-core/src/apiClient', () => ({ apiClient: { post: (...a: unknown[]) => mockPost(...a) } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { offlineQueue } = require('../../../packages/mobile-core/src/offlineQueue');

const QUEUE_KEY = 'ls:offline_queue';
const REJECTED_KEY = 'ls:offline_rejected';
const SCAN_URL = '/api/v1/wms/pick/scan';
const REVIEW_URL = '/api/v1/wms/pick/unconfirmed-scan-review';

const kept = (id: string) => ({
  deviceEventId: id,
  url: SCAN_URL,
  body: { pick_batch_id: `batch-${id}`, pick_claim_generation: 'gen-1', device_event_id: id },
  status: 503, code: null, error: 'Service unavailable', rejectedAt: 1_234,
  reason: 'server_error_retries_exhausted',
});

// AsyncStorage is itself a jest mock here, so spying on it replaces the very
// function a saved reference would call: back the spies with plain memory.
const mem = new Map<string, string>();
const realGet = async (key: string) => (mem.has(key) ? mem.get(key)! : null);
const realSet = async (key: string, value: string) => { mem.set(key, value); };
let rejectedWritten = false;
let failQueueReadAfterWrite = false;
let failRejectedWrite = false;
let timerSpy: jest.SpyInstance;

beforeEach(async () => {
  timerSpy = jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as never);
  rejectedWritten = false;
  failQueueReadAfterWrite = false;
  failRejectedWrite = false;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key: string, value: string) => {
    if (key === REJECTED_KEY && failRejectedWrite) throw new Error('disk full');
    await realSet(key, value);
    if (key === REJECTED_KEY) rejectedWritten = true;
  });
  jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key: string) => {
    if (key === QUEUE_KEY && failQueueReadAfterWrite && rejectedWritten) throw new Error('read failed');
    return realGet(key);
  });
  mem.clear();
  await offlineQueue.flush();
  await realSet(REJECTED_KEY, JSON.stringify([kept('a'), kept('b')]));
  rejectedWritten = false;
  mockPost.mockReset();
});
afterEach(() => { jest.restoreAllMocks(); timerSpy.mockRestore(); });

test('MD-01 review recorded and scan removed, then the queue count cannot be read: resolves and reports storage', async () => {
  const seen: Array<{ rejected: number; storageError: string | null }> = [];
  const unsub = offlineQueue.subscribe((_c: number, _o: boolean, rejected: number, status: { storageError: string | null }) =>
    seen.push({ rejected, storageError: status.storageError }));
  failQueueReadAfterWrite = true;
  mockPost.mockResolvedValueOnce({ data: { recorded: true } });

  await expect(offlineQueue.dismissRejected('a')).resolves.toBeUndefined();

  const stored = JSON.parse((await realGet(REJECTED_KEY)) ?? '[]');
  expect(stored.map((r: { deviceEventId: string }) => r.deviceEventId)).toEqual(['b']);
  expect(mockPost.mock.calls.map(([url]) => url)).toEqual([REVIEW_URL]);   // audit only; no Pick scan re-sent
  expect(offlineQueue.status.storageError).toBeTruthy();
  expect(seen[seen.length - 1]).toMatchObject({ rejected: 1 });
  expect(seen[seen.length - 1].storageError).toBeTruthy();
  unsub();
});

test('MD-02 the review list cannot be written: rejects and the scan stays (unchanged)', async () => {
  failRejectedWrite = true;
  mockPost.mockResolvedValueOnce({ data: { recorded: true } });
  await expect(offlineQueue.dismissRejected('a')).rejects.toMatchObject({ name: 'QueueStorageError' });
  const stored = JSON.parse((await realGet(REJECTED_KEY)) ?? '[]');
  expect(stored.map((r: { deviceEventId: string }) => r.deviceEventId)).toEqual(['a', 'b']);
});

test('MD-03 the audit is still recorded before removal: a failed review removes nothing and reads no count', async () => {
  failQueueReadAfterWrite = true;
  mockPost.mockRejectedValueOnce(Object.assign(new Error('HTTP 500'), { response: { status: 500, data: {} } }));
  await expect(offlineQueue.dismissRejected('a')).rejects.toMatchObject({ code: 'PICK_REVIEW_NOT_RECORDED', kind: 'server' });
  expect(rejectedWritten).toBe(false);
  const stored = JSON.parse((await realGet(REJECTED_KEY)) ?? '[]');
  expect(stored.map((r: { deviceEventId: string }) => r.deviceEventId)).toEqual(['a', 'b']);
});
