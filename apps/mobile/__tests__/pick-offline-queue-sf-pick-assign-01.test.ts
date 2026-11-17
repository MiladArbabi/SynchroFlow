/**
 * SF-PICK-ASSIGN-01 — mobile offline Pick scan queue (packages/mobile-core).
 *   - a queued scan the server refuses (4xx) is kept for operator review, never resent;
 *   - a queued scan that hits a server error (5xx) stays queued and is retried;
 *   - a live refusal returns its machine-readable code to the screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockPost = jest.fn();
jest.mock('../../../packages/mobile-core/src/apiClient', () => ({ apiClient: { post: (...a: unknown[]) => mockPost(...a) } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { offlineQueue } = require('../../../packages/mobile-core/src/offlineQueue');

const httpError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
const networkError = () => new Error('Network request failed');

const scan = (id: string) => ({
  deviceEventId: id,
  url: '/api/v1/wms/pick/scan',
  body: { pick_batch_id: `batch-${id}`, pick_claim_generation: 'gen-1' },
});

let timerSpy: jest.SpyInstance;
beforeEach(async () => {
  // Backoff retries are not under test here: keep them from firing between steps.
  timerSpy = jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as never);
  mockPost.mockReset();
  await AsyncStorage.clear();
  for (const r of await offlineQueue.getRejected()) await offlineQueue.dismissRejected(r.deviceEventId);
});
afterEach(() => timerSpy.mockRestore());

test('MQ-01 a queued scan refused while offline is kept for review and never resent', async () => {
  mockPost.mockRejectedValueOnce(networkError());
  expect(await offlineQueue.submitScan(scan('a'))).toBeUndefined();     // queued optimistically
  expect(await offlineQueue.getCount()).toBe(1);

  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator' }));
  await offlineQueue.flush();
  expect(await offlineQueue.getCount()).toBe(0);
  const rejected = await offlineQueue.getRejected();
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({
    deviceEventId: 'a', status: 409, code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator',
  });

  mockPost.mockClear();
  await offlineQueue.flush();
  expect(mockPost).not.toHaveBeenCalled();
  await offlineQueue.dismissRejected('a');
  expect(await offlineQueue.getRejected()).toHaveLength(0);
});

test('MQ-02 a queued scan that hits a 5xx stays queued (not dropped, not rejected) and syncs later', async () => {
  mockPost.mockRejectedValueOnce(networkError());
  await offlineQueue.submitScan(scan('b'));
  mockPost.mockRejectedValueOnce(httpError(503, { error: 'Service unavailable' }));
  await offlineQueue.flush();
  expect(await offlineQueue.getCount()).toBe(1);
  expect(await offlineQueue.getRejected()).toHaveLength(0);

  mockPost.mockResolvedValueOnce({ data: {} });
  await offlineQueue.flush();
  expect(await offlineQueue.getCount()).toBe(0);
});

test('MQ-03 a live refusal reaches the screen with its code; nothing is queued', async () => {
  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_GENERATION_STALE', error: 'This Pick session is no longer current' }));
  const detail = await offlineQueue.submitScanWithDetail(scan('c'));
  expect(detail).toEqual({ status: 409, code: 'PICK_GENERATION_STALE', error: 'This Pick session is no longer current' });
  expect(await offlineQueue.getCount()).toBe(0);
});

// ── C005 (REVIEW-003 MEDIUM-1/2) ─────────────────────────────────────────────

const STORAGE = 'ls:offline_queue';
const queueSnapshot = async () =>
  JSON.parse((await AsyncStorage.getItem(STORAGE)) ?? '[]') as Array<Record<string, any>>;
const ids = async () => (await queueSnapshot()).map((e) => e.deviceEventId);

const queueOffline = async (...names: string[]) => {
  for (const n of names) {
    mockPost.mockRejectedValueOnce(networkError());
    await offlineQueue.submitScan(scan(n));
  }
};

let now = 1_000_000;
let nowSpy: jest.SpyInstance;
beforeEach(() => { now = 1_000_000; nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now); });
afterEach(() => nowSpy.mockRestore());
const MIN = 60_000;

/** A POST that stays pending until the test settles it. */
function deferredPost() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  mockPost.mockImplementationOnce(() => promise);
  return { resolve, reject };
}
const tick = () => new Promise((r) => jest.requireActual('timers').setImmediate(r));

test('MQ-04 a 5xx outage shorter than the recovery window never rejects, however many attempts it takes', async () => {
  await queueOffline('p', 'q');
  const window = offlineQueue.SERVER_ERROR_RECOVERY_WINDOW_MS as number;
  expect(window).toBe(10 * MIN);
  for (let t = 0; t < window - MIN; t += 30_000) {   // ~19 failed attempts inside 9.5 minutes
    now = 1_000_000 + t;
    mockPost.mockRejectedValueOnce(httpError(503, { error: 'Service unavailable' }));
    await offlineQueue.flush();
  }
  expect(await ids()).toEqual(['p', 'q']);
  expect(await offlineQueue.getRejected()).toHaveLength(0);
  const head = (await queueSnapshot())[0];
  expect(head.firstServerErrorAt).toBe(1_000_000);      // persisted, not reset by later 5xx

  mockPost.mockResolvedValue({ data: {} });
  await offlineQueue.flush();
  expect(await ids()).toEqual([]);
  expect(await offlineQueue.getRejected()).toHaveLength(0);
});

test('MQ-05 a 5xx that persists past the window moves the ORIGINAL entry to review and later scans sync', async () => {
  await queueOffline('p', 'q');
  mockPost.mockClear();
  mockPost.mockImplementation(async (_u: string, body: any) => {
    if (body.pick_batch_id === 'batch-p') throw httpError(500, { error: 'Pick scan failed: boom' });
    return { data: {} };
  });
  await offlineQueue.flush();                            // first 5xx at t0
  now += 10 * MIN - 1;
  await offlineQueue.flush();                            // still inside the window
  expect(await ids()).toEqual(['p', 'q']);
  now += 2;
  await offlineQueue.flush();                            // past the window
  expect(await ids()).toEqual([]);
  const rejected = await offlineQueue.getRejected();
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({
    deviceEventId: 'p', url: '/api/v1/wms/pick/scan',
    body: { pick_batch_id: 'batch-p', pick_claim_generation: 'gen-1' },
    status: 500, error: 'Pick scan failed: boom', reason: 'server_error_retries_exhausted', firstServerErrorAt: 1_000_000,
  });
  expect(mockPost.mock.calls.map((c) => (c[1] as any).pick_batch_id)).toEqual(['batch-p', 'batch-p', 'batch-p', 'batch-q']);
  mockPost.mockClear();
  await offlineQueue.flush();
  expect(mockPost).not.toHaveBeenCalled();
});

test('MQ-06 the window survives an app restart (module reload) and legacy entries start a fresh window', async () => {
  // Legacy entry (no window fields) written by an older build.
  await AsyncStorage.setItem(STORAGE, JSON.stringify([{ ...scan('legacy'), serverErrorAttempts: 4 }]));
  mockPost.mockRejectedValueOnce(httpError(502, { error: 'Bad gateway' }));
  await offlineQueue.flush();
  expect((await queueSnapshot())[0]).toMatchObject({ deviceEventId: 'legacy', firstServerErrorAt: 1_000_000 });

  // Restart: fresh module instance, same storage.
  let reloaded: any;
  jest.isolateModules(() => { reloaded = require('../../../packages/mobile-core/src/offlineQueue').offlineQueue; });
  now += 11 * MIN;
  mockPost.mockRejectedValueOnce(httpError(502, { error: 'Bad gateway' }));
  await reloaded.flush();
  expect(await ids()).toEqual([]);
  expect((await reloaded.getRejected())[0]).toMatchObject({ deviceEventId: 'legacy', reason: 'server_error_retries_exhausted' });
});

test('MQ-07 connectivity failures never start or consume the window and are reported offline', async () => {
  await queueOffline('p');
  for (let i = 0; i < 5; i++) { now += 5 * MIN; mockPost.mockRejectedValueOnce(networkError()); await offlineQueue.flush(); }
  expect((await queueSnapshot())[0].firstServerErrorAt).toBeUndefined();
  expect(await offlineQueue.getRejected()).toHaveLength(0);
  expect(offlineQueue.isOnline).toBe(false);
  mockPost.mockRejectedValueOnce(httpError(503, { error: 'x' }));
  await offlineQueue.flush();
  expect(offlineQueue.isOnline).toBe(true);
  expect((await queueSnapshot())[0].firstServerErrorAt).toBe(now);
});

test('MQ-08 an ownership 4xx is still rejected immediately and later scans continue', async () => {
  await queueOffline('p', 'q');
  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_GENERATION_STALE', error: 'stale' }));
  mockPost.mockResolvedValueOnce({ data: {} });
  await offlineQueue.flush();
  expect(await ids()).toEqual([]);
  const rejected = await offlineQueue.getRejected();
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({ deviceEventId: 'p', status: 409, code: 'PICK_GENERATION_STALE', reason: 'refused' });
});

test('MQ-09 retries keep being scheduled with a bounded delay (no global retry ceiling)', async () => {
  const delays: number[] = [];
  timerSpy.mockImplementation(((_fn: unknown, ms: number) => { delays.push(ms); return 0; }) as never);
  await queueOffline('p');
  for (let i = 0; i < 20; i++) { mockPost.mockRejectedValueOnce(networkError()); await offlineQueue.flush(); }
  const max = offlineQueue.MAX_RETRY_DELAY_MS as number;
  expect(delays.length).toBeGreaterThanOrEqual(20);           // still rescheduling after 20 failures
  expect(Math.max(...delays)).toBeLessThanOrEqual(max);
  expect(delays.slice(-5).every((d) => d === max)).toBe(true);
  expect(Math.min(...delays)).toBeGreaterThanOrEqual(2_000);   // never hammers the server
});

// ── Concurrent enqueue while a flush request is in flight ────────────────────

async function raceScenario(settle: (d: ReturnType<typeof deferredPost>) => void) {
  await queueOffline('p');
  const pending = deferredPost();
  const flushing = offlineQueue.flush();
  await tick();                                               // flush is awaiting the POST for 'p'
  await queueOffline('new');                                   // accepted while in flight
  settle(pending);
  await flushing;
}

test('MQ-R1 request succeeds: the entry enqueued in flight survives and then syncs', async () => {
  await raceScenario((d) => { mockPost.mockResolvedValueOnce({ data: {} }); d.resolve({ data: {} }); });
  await offlineQueue.flush();
  // 'new' was either still queued or delivered — never dropped: it must have been POSTed by the queue.
  expect(await ids()).toEqual([]);
  const queued = mockPost.mock.calls.filter((c) => (c[1] as any).pick_batch_id === 'batch-new');
  expect(queued).toHaveLength(2); // 1 failed live attempt + 1 queue delivery
  expect(await offlineQueue.getRejected()).toHaveLength(0);
});

test('MQ-R2 request hits a retryable 5xx: both entries remain, in order, with the window on the head only', async () => {
  await raceScenario((d) => d.reject(httpError(503, { error: 'x' })));
  const q = await queueSnapshot();
  expect(q.map((e) => e.deviceEventId)).toEqual(['p', 'new']);
  expect(q[0].firstServerErrorAt).toBe(now);
  expect(q[1].firstServerErrorAt).toBeUndefined();
});

test('MQ-R3 request exhausts the window: head goes to review once, the in-flight entry survives and syncs', async () => {
  await queueOffline('p');
  mockPost.mockRejectedValueOnce(httpError(500, { error: 'boom' }));
  await offlineQueue.flush();                                  // window starts at t0
  now += 11 * MIN;
  const pending = deferredPost();
  const flushing = offlineQueue.flush();
  await tick();
  await queueOffline('new');
  pending.reject(httpError(500, { error: 'boom' }));
  await flushing;
  mockPost.mockResolvedValue({ data: {} });
  await offlineQueue.flush();
  expect(await ids()).toEqual([]);
  const rejected = await offlineQueue.getRejected();
  expect(rejected.map((r: { deviceEventId: string }) => r.deviceEventId)).toEqual(['p']);
  expect(mockPost.mock.calls.at(-1)?.[1]).toMatchObject({ pick_batch_id: 'batch-new' });
});

test('MQ-R4 request fails on connectivity: both entries remain, in order, nothing rejected', async () => {
  await raceScenario((d) => d.reject(networkError()));
  expect(await ids()).toEqual(['p', 'new']);
  expect(await offlineQueue.getRejected()).toHaveLength(0);
});

test('MQ-R5 concurrent flush calls never send the same entry twice or duplicate a rejection', async () => {
  await queueOffline('p');
  const pending = deferredPost();
  const a = offlineQueue.flush();
  const b = offlineQueue.flush();
  await tick();
  pending.reject(httpError(409, { code: 'PICK_OWNERSHIP_REVOKED', error: 'gone' }));
  await Promise.all([a, b]);
  expect(mockPost.mock.calls.filter((c) => (c[1] as any).pick_batch_id === 'batch-p')).toHaveLength(2); // 1 live + 1 flush
  expect((await offlineQueue.getRejected()).map((r: { deviceEventId: string }) => r.deviceEventId)).toEqual(['p']);
});
