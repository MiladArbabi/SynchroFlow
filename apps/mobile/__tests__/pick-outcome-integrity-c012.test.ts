/**
 * SF-PICK-ASSIGN-01 C012 (OUTCOME-INTEGRITY) — mobile scans whose server
 * outcome is unknown because every attempt answered 5xx for longer than the
 * recovery window ('server_error_retries_exhausted'). A 5xx may be returned
 * after the scan committed, so such a scan:
 *   - is uncertain: it leaves the device only after the server durably
 *     recorded the operator's review (POST /pick/unconfirmed-scan-review);
 *   - stays untouched when that review cannot be recorded (offline, 401, 5xx);
 *   - applies equally to an entry rejected now and one persisted by an
 *     earlier build;
 *   - carries its rejection code, status, reason and timestamp into the review.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockPost = jest.fn();
jest.mock('../../../packages/mobile-core/src/apiClient', () => ({ apiClient: { post: (...a: unknown[]) => mockPost(...a) } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { offlineQueue } = require('../../../packages/mobile-core/src/offlineQueue');

const REJECTED_KEY = 'ls:offline_rejected';
const SCAN_URL = '/api/v1/wms/pick/scan';
const REVIEW_URL = '/api/v1/wms/pick/unconfirmed-scan-review';
const MIN = 60_000;

const httpError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
const networkError = () => new Error('Network request failed');

const scan = (id: string) => ({
  deviceEventId: id,
  url: SCAN_URL,
  body: { pick_batch_id: `batch-${id}`, reservation_allocation_id: `alloc-${id}`, pick_claim_generation: 'gen-1', device_event_id: id },
});
/** As persisted by an earlier build after its 5xx window ran out. */
const persistedExhausted = (id: string) => ({
  ...scan(id), status: 503, code: null, error: 'Service unavailable', rejectedAt: 1_234,
  reason: 'server_error_retries_exhausted', firstServerErrorAt: 1_000, serverErrorAttempts: 7,
});

const raw = async (key: string) => AsyncStorage.getItem(key);
const reviewPosts = () => mockPost.mock.calls.filter(([url]) => url === REVIEW_URL);
const scanPosts = () => mockPost.mock.calls.filter(([url]) => url === SCAN_URL);

let now = 1_000_000;
let timerSpy: jest.SpyInstance;
let nowSpy: jest.SpyInstance;
beforeEach(async () => {
  now = 1_000_000;
  timerSpy = jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as never);
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockPost.mockReset();
  await AsyncStorage.clear();
  await offlineQueue.flush();
  mockPost.mockReset();
});
afterEach(() => { timerSpy.mockRestore(); nowSpy.mockRestore(); });

test('MO-01 a scan rejected NOW after exhausted 5xx retries is kept until its audited review succeeds', async () => {
  mockPost.mockRejectedValueOnce(networkError());
  await offlineQueue.submitScan(scan('x'));               // queued offline
  mockPost.mockRejectedValueOnce(httpError(500, { error: 'Pick scan failed: boom' }));
  await offlineQueue.flush();                            // first 5xx starts the window
  now += 10 * MIN + 1;
  mockPost.mockRejectedValueOnce(httpError(500, { error: 'Pick scan failed: boom' }));
  await offlineQueue.flush();                            // past the window → review
  const [kept] = await offlineQueue.getRejected();
  expect(kept).toMatchObject({ deviceEventId: 'x', reason: 'server_error_retries_exhausted', status: 500 });

  mockPost.mockReset();
  const before = await raw(REJECTED_KEY);
  mockPost.mockRejectedValueOnce(networkError());
  await expect(offlineQueue.dismissRejected('x')).rejects.toMatchObject({ code: 'PICK_REVIEW_NOT_RECORDED', kind: 'offline' });
  expect(await raw(REJECTED_KEY)).toBe(before);

  mockPost.mockResolvedValueOnce({ data: { recorded: true } });
  await offlineQueue.dismissRejected('x');
  expect(reviewPosts()[1][1]).toMatchObject({
    device_event_id: 'x',
    original: { url: SCAN_URL, method: 'POST', body: JSON.stringify(scan('x').body) },
    rejection: { status: 500, code: null, reason: 'server_error_retries_exhausted', rejected_at: kept.rejectedAt },
  });
  expect(scanPosts()).toHaveLength(0);
  expect(await offlineQueue.getRejected()).toEqual([]);
});

test('MO-02 an exhausted entry PERSISTED by an earlier build gets the same audited review; failures keep it byte-identical', async () => {
  const entry = persistedExhausted('legacy');
  await AsyncStorage.setItem(REJECTED_KEY, JSON.stringify([entry]));
  const before = await raw(REJECTED_KEY);
  for (const [failure, kind] of [
    [networkError(), 'offline'],
    [httpError(401, { error: 'Unauthorized' }), 'auth'],
    [httpError(500, { error: 'The review could not be recorded.' }), 'server'],
  ] as const) {
    mockPost.mockReset();
    mockPost.mockRejectedValueOnce(failure);
    await expect(offlineQueue.dismissRejected('legacy')).rejects.toMatchObject({ code: 'PICK_REVIEW_NOT_RECORDED', kind });
    expect(await raw(REJECTED_KEY)).toBe(before);
  }
  mockPost.mockReset();
  mockPost.mockResolvedValueOnce({ data: { recorded: true } });
  await offlineQueue.dismissRejected('legacy');
  expect(reviewPosts()).toEqual([[REVIEW_URL, {
    device_event_id: 'legacy',
    queued_at: null,
    original: { url: SCAN_URL, method: 'POST', body: JSON.stringify(entry.body) },
    rejection: { status: 503, code: null, error: 'Service unavailable', reason: 'server_error_retries_exhausted', rejected_at: 1_234 },
  }]]);
  expect(await offlineQueue.getRejected()).toEqual([]);
});

test('MO-03 only the reviewed entry is removed; other kept scans are untouched', async () => {
  const a = persistedExhausted('a');
  const b = persistedExhausted('b');
  await AsyncStorage.setItem(REJECTED_KEY, JSON.stringify([a, b]));
  mockPost.mockResolvedValueOnce({ data: { recorded: true } });
  await offlineQueue.dismissRejected('a');
  expect(await offlineQueue.getRejected()).toEqual([b]);
});
