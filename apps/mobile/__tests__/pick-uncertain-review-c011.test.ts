/**
 * SF-PICK-ASSIGN-01 C011 (C010-REVIEW-ADDENDUM-001 NEW-1) — mobile historical
 * Pick scans whose recorded outcome cannot be established.
 *
 * The server checks ownership/generation BEFORE its duplicate guard, so a
 * fence refusal (or a pre-generation entry that cannot be replayed at all)
 * does not prove the scan was never recorded. Such an entry:
 *   - is never replayed when it has no claim generation;
 *   - stays on the device until the operator reviews it;
 *   - leaves the device only after the server durably recorded that review
 *     (POST /pick/unconfirmed-scan-review with the original scan);
 *   - stays untouched when the review cannot be recorded (offline, 401, 5xx).
 * Certain outcomes (a non-fence refusal, recorded by another operator) keep
 * their existing local dismissal.
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
const FENCE_CODES = [
  'PICK_OWNERSHIP_REVOKED',
  'PICK_GENERATION_STALE',
  'PICK_GENERATION_REQUIRED',
  'PICK_BATCH_NOT_PICKING',
  'PICK_CUSTODY_ACK_REQUIRED',
];

const httpError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
const networkError = () => new Error('Network request failed');

/** What a pre-generation client queued: no pick_claim_generation existed then. */
const preGeneration = (id: string) => ({
  deviceEventId: id,
  url: SCAN_URL,
  body: { pick_batch_id: `batch-${id}`, lasyncro_line_item_id: 'li-1', lasyncro_variant_id: 'v-1', location_code: 'A-01', quantity_confirmed: 1, device_event_id: id },
});
const withGeneration = (id: string) => ({
  deviceEventId: id,
  url: SCAN_URL,
  body: { pick_batch_id: `batch-${id}`, reservation_allocation_id: `alloc-${id}`, pick_claim_generation: 'gen-1', device_event_id: id },
});
const rejectedEntry = (id: string, code: string | null, reason = 'refused', status = 409) => ({
  ...withGeneration(id), status, code, error: 'x', rejectedAt: 1, reason,
});

const raw = async (key: string) => AsyncStorage.getItem(key);
const reviewPosts = () => mockPost.mock.calls.filter(([url]) => url === REVIEW_URL);
const scanPosts = () => mockPost.mock.calls.filter(([url]) => url === SCAN_URL);

let timerSpy: jest.SpyInstance;
beforeEach(async () => {
  timerSpy = jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as never);
  mockPost.mockReset();
  await AsyncStorage.clear();
  await offlineQueue.flush();
  mockPost.mockReset();
});
afterEach(() => timerSpy.mockRestore());

test('MU-01 a queued scan without a claim generation is never replayed; it is kept, byte-identical, as uncertain', async () => {
  const entry = preGeneration('old');
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([entry]));
  mockPost.mockResolvedValue({ data: {} });
  await offlineQueue.flush();
  expect(scanPosts()).toHaveLength(0);
  expect(reviewPosts()).toHaveLength(0);
  const rejected = await offlineQueue.getRejected();
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({ deviceEventId: 'old', url: SCAN_URL, reason: 'outcome_uncertain' });
  expect(rejected[0].body).toStrictEqual(entry.body);
  expect(await offlineQueue.getCount()).toBe(0);
});

test('MU-02 dismissing a fence-refused scan records the audited review with the original scan, then removes it', async () => {
  for (const code of FENCE_CODES) {
    mockPost.mockReset();
    const entry = rejectedEntry(`f-${code}`, code);
    await AsyncStorage.setItem(REJECTED_KEY, JSON.stringify([entry]));
    mockPost.mockResolvedValue({ data: { recorded: true } });
    await offlineQueue.dismissRejected(entry.deviceEventId);
    expect(reviewPosts()).toEqual([[REVIEW_URL, {
      device_event_id: entry.deviceEventId,
      queued_at: null,
      original: { url: SCAN_URL, method: 'POST', body: JSON.stringify(entry.body) },
      rejection: { status: entry.status, code, error: entry.error, reason: entry.reason, rejected_at: entry.rejectedAt },
    }]]);
    expect(scanPosts()).toHaveLength(0);
    expect(await offlineQueue.getRejected()).toEqual([]);
  }
});

test('MU-03 the review is recorded BEFORE the entry is removed: a failed review (offline, 401, 5xx) keeps it untouched', async () => {
  const entry = rejectedEntry('keep', 'PICK_GENERATION_STALE');
  await AsyncStorage.setItem(REJECTED_KEY, JSON.stringify([entry]));
  const before = await raw(REJECTED_KEY);
  for (const [failure, kind] of [
    [networkError(), 'offline'],
    [httpError(401, { error: 'Unauthorized' }), 'auth'],
    [httpError(500, { error: 'The review could not be recorded.' }), 'server'],
  ] as const) {
    mockPost.mockReset();
    mockPost.mockRejectedValueOnce(failure);
    await expect(offlineQueue.dismissRejected('keep')).rejects.toMatchObject({ code: 'PICK_REVIEW_NOT_RECORDED', kind });
    expect(await raw(REJECTED_KEY)).toBe(before);
  }
});

test('MU-04 a pre-generation scan is dismissed only through the audited review', async () => {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([preGeneration('old')]));
  await offlineQueue.flush();
  mockPost.mockReset();
  mockPost.mockRejectedValueOnce(networkError());
  await expect(offlineQueue.dismissRejected('old')).rejects.toMatchObject({ code: 'PICK_REVIEW_NOT_RECORDED' });
  expect(await offlineQueue.getRejected()).toHaveLength(1);
  mockPost.mockResolvedValueOnce({ data: { recorded: true } });
  await offlineQueue.dismissRejected('old');
  expect(reviewPosts()[1][1]).toMatchObject({
    device_event_id: 'old',
    original: { url: SCAN_URL, method: 'POST', body: JSON.stringify(preGeneration('old').body) },
  });
  expect(await offlineQueue.getRejected()).toEqual([]);
});

test('MU-05 certain outcomes keep their local dismissal: no review is sent', async () => {
  await AsyncStorage.setItem(REJECTED_KEY, JSON.stringify([
    rejectedEntry('stock', null),
    rejectedEntry('other', 'PICK_SCAN_ALREADY_RECORDED', 'already_recorded_by_other'),
  ]));
  await offlineQueue.dismissRejected('stock');
  await offlineQueue.dismissRejected('other');
  expect(mockPost).not.toHaveBeenCalled();
  expect(await offlineQueue.getRejected()).toEqual([]);
});

test('MU-06 a queued scan WITH a claim generation is still replayed unchanged', async () => {
  const entry = withGeneration('ok');
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([entry]));
  mockPost.mockResolvedValue({ data: {} });
  await offlineQueue.flush();
  expect(scanPosts()).toEqual([[SCAN_URL, entry.body]]);
  expect(await offlineQueue.getCount()).toBe(0);
  expect(await offlineQueue.getRejected()).toEqual([]);
});
