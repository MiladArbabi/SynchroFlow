/**
 * SF-PICK-ASSIGN-01 — Correction 006 (REVIEW-004): offline Pick queue durability.
 *   HIGH-1  storage writes fail closed: a scan is never reported queued/synced unless persisted;
 *   HIGH-2  storage reads fail closed: a failed or corrupt read never erases queued work;
 *   MEDIUM-1 the empty-queue decision, retry timer and notification are consistent under concurrency;
 *   MEDIUM-3 an already-recorded scan is reconciled only on authoritative evidence, otherwise reviewed;
 *   MEDIUM-4 408 / 429 / 401 preserve queued scans; ownership refusals stay refusals.
 */
/**
 * File-local AsyncStorage: a real Map with explicit fault injection, so storage
 * failures are injected deliberately rather than by spying on a shared jest.fn.
 */
const mockStore = new Map<string, string>();
const mockFaults: {
  get?: (key: string) => boolean;   // return true → this getItem rejects
  set?: (key: string) => boolean;   // return true → this setItem rejects
} = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => {
      if (mockFaults.get?.(key)) throw new Error('io: getItem failed');
      return mockStore.has(key) ? mockStore.get(key)! : null;
    },
    setItem: async (key: string, value: string) => {
      if (mockFaults.set?.(key)) throw new Error('io: setItem failed');
      mockStore.set(key, value);
    },
    getAllKeys: async () => [...mockStore.keys()],
    clear: async () => { mockStore.clear(); },
  },
}));
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Fail the next n setItem calls (optionally only for one key). */
const failSet = (n = 1, onlyKey?: string) => {
  let left = n;
  mockFaults.set = (key) => (onlyKey && key !== onlyKey ? false : left-- > 0);
};
const failGet = (n = Infinity, onlyKey?: string) => {
  let left = n;
  mockFaults.get = (key) => (onlyKey && key !== onlyKey ? false : left-- > 0);
};

const mockPost = jest.fn();
jest.mock('../../../packages/mobile-core/src/apiClient', () => ({ apiClient: { post: (...a: unknown[]) => mockPost(...a) } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { offlineQueue } = require('../../../packages/mobile-core/src/offlineQueue');

const QUEUE = 'ls:offline_queue';
const REJECTED = 'ls:offline_rejected';
const httpError = (status: number, data: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers } });
const networkError = () => new Error('Network request failed');
const scan = (id: string) => ({
  deviceEventId: id,
  url: '/api/v1/wms/pick/scan',
  body: { pick_batch_id: `batch-${id}`, pick_claim_generation: 'gen-1', device_event_id: id },
});
const stored = async (key = QUEUE) => JSON.parse((await AsyncStorage.getItem(key)) ?? '[]') as Array<Record<string, any>>;
const storedIds = async (key = QUEUE) => (await stored(key)).map((e) => e.deviceEventId);
const tick = () => new Promise((r) => jest.requireActual('timers').setImmediate(r));

/** Every listener notification: [count, online, rejected, status?]. */
let notes: unknown[][] = [];
let unsub: () => void;
let timers: Array<{ ms: number }> = [];
let active = 0;
let timerSpy: jest.SpyInstance;
let clearSpy: jest.SpyInstance;
const realSetItem = async (k: string, v: string) => { mockStore.set(k, v); };
const realGetItem = async (k: string) => (mockStore.has(k) ? mockStore.get(k)! : null);

beforeEach(async () => {
  timers = [];
  active = 0;
  timerSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((_fn: unknown, ms: number) => {
    timers.push({ ms }); active += 1; return timers.length as unknown as NodeJS.Timeout;
  }) as never);
  clearSpy = jest.spyOn(global, 'clearTimeout').mockImplementation((() => { active = Math.max(0, active - 1); }) as never);
  mockPost.mockReset();
  mockFaults.get = undefined;
  mockFaults.set = undefined;
  mockStore.clear();
  await realSetItem(QUEUE, '[]');
  await realSetItem(REJECTED, '[]');
  notes = [];
  unsub = offlineQueue.subscribe((...args: unknown[]) => notes.push(args));
  // Settle module state (backoff, any run) from earlier tests.
  mockPost.mockResolvedValue({ data: {} });
  await offlineQueue.flush();
  mockPost.mockReset();
  notes = [];
});
afterEach(() => {
  unsub();
  mockFaults.get = undefined;
  mockFaults.set = undefined;
  timerSpy.mockRestore();
  clearSpy.mockRestore();
});

const queueOffline = async (...names: string[]) => {
  for (const n of names) {
    mockPost.mockRejectedValueOnce(networkError());
    expect(await offlineQueue.submitScanWithDetail(scan(n))).toBeUndefined();
  }
};
const lastNote = () => notes[notes.length - 1] ?? [];
/** A notification that tells the screen "nothing queued" while storage is healthy (i.e. all synced). */
const claimedSynced = () => notes.some((n) => n[0] === 0 && !(n[3] as any)?.storageError);

// ── HIGH-1 — storage writes fail closed ─────────────────────────────────────

test('W-1 a failed initial enqueue is reported to the screen, never as queued', async () => {
  failSet(1);
  mockPost.mockRejectedValueOnce(networkError());
  const result = await offlineQueue.submitScanWithDetail(scan('a'));
  expect(result).toMatchObject({ status: 0, code: 'OFFLINE_QUEUE_WRITE_FAILED' });
  expect(String(result?.error)).toMatch(/not saved/i);
  expect(await storedIds()).toEqual([]);
  expect(notes.some(([count]) => count === 1)).toBe(false);          // never shown as "1 queued"
});

test('W-2 a failed queue update after a 5xx keeps the last durable entry and reports the storage problem', async () => {
  await queueOffline('a');
  const before = await stored();
  failSet(1);
  mockPost.mockRejectedValueOnce(httpError(503));
  await offlineQueue.flush();
  expect(await stored()).toEqual(before);                             // last durable state
  expect(lastNote()[0]).toBe(1);
  expect(lastNote()[3]).toMatchObject({ storageError: expect.any(String) });
});

test('W-3 a failed write of the rejected list keeps the refused scan in the queue (never lost)', async () => {
  await queueOffline('a', 'b');
  failSet(Infinity, REJECTED);
  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_OWNERSHIP_REVOKED', error: 'gone' }));
  await offlineQueue.flush();
  mockFaults.set = undefined;
  expect(await storedIds()).toEqual(['a', 'b']);
  expect(await storedIds(REJECTED)).toEqual([]);
  expect(mockPost).toHaveBeenCalledTimes(3);                          // 2 live attempts + 1; 'b' not sent past an unrecorded refusal
  expect(lastNote()[3]).toMatchObject({ storageError: expect.any(String) });
});

test('W-4 a failed removal after delivery never claims "synced"; the replay is reconciled by the server answer', async () => {
  await queueOffline('a');
  failSet(1);
  mockPost.mockResolvedValueOnce({ data: {} });
  await offlineQueue.flush();
  expect(await storedIds()).toEqual(['a']);                           // still durable
  expect(claimedSynced()).toBe(false);           // never reported as synced
  expect(lastNote()[3]).toMatchObject({ storageError: expect.any(String) });

  // Next run: the server already holds it and says so for this requester.
  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: true }));
  await offlineQueue.flush();
  expect(await storedIds()).toEqual([]);
  expect(await storedIds(REJECTED)).toEqual([]);
  expect(lastNote()[0]).toBe(0);
});

// ── HIGH-2 — storage reads fail closed ──────────────────────────────────────

test('R-1 a getItem failure during enqueue never overwrites existing queued scans', async () => {
  await realSetItem(QUEUE, JSON.stringify([scan('old1'), scan('old2')]));
  failGet(1, QUEUE);
  mockPost.mockRejectedValueOnce(networkError());
  const result = await offlineQueue.submitScanWithDetail(scan('new'));
  expect(result).toMatchObject({ code: 'OFFLINE_QUEUE_WRITE_FAILED' });
  expect(await storedIds()).toEqual(['old1', 'old2']);
});

test('R-2 malformed queue JSON is preserved as-is, quarantined, and never overwritten by enqueue or flush', async () => {
  const raw = '[{"deviceEventId":"old1",';
  await realSetItem(QUEUE, raw);
  mockPost.mockRejectedValueOnce(networkError());
  const result = await offlineQueue.submitScanWithDetail(scan('new'));
  expect(result).toMatchObject({ code: 'OFFLINE_QUEUE_WRITE_FAILED' });
  await offlineQueue.flush();
  expect(await realGetItem(QUEUE)).toBe(raw);                         // untouched
  const keys = await AsyncStorage.getAllKeys();
  const quarantine = keys.filter((k: string) => k.startsWith(`${QUEUE}:corrupt:`));
  expect(quarantine.length).toBeGreaterThanOrEqual(1);
  expect(await realGetItem(quarantine[0])).toBe(raw);
  expect(mockPost).toHaveBeenCalledTimes(1);                          // only the live attempt
  expect(claimedSynced()).toBe(false);           // never "all synced"
  expect(lastNote()[3]).toMatchObject({ storageError: expect.any(String) });
});

test('R-3 a non-array JSON value is treated as corrupt, not as an empty queue', async () => {
  await realSetItem(QUEUE, '{"oops":true}');
  await expect(offlineQueue.getCount()).rejects.toThrow();
  mockPost.mockRejectedValueOnce(networkError());
  expect(await offlineQueue.submitScanWithDetail(scan('new'))).toMatchObject({ code: 'OFFLINE_QUEUE_WRITE_FAILED' });
  expect(await realGetItem(QUEUE)).toBe('{"oops":true}');
});

test('R-4 concurrent flushes during a read failure send nothing and claim nothing; entries survive and sync later', async () => {
  await queueOffline('a', 'b');
  failGet(Infinity, QUEUE);
  await Promise.all([offlineQueue.flush(), offlineQueue.flush(), offlineQueue.flush()]);
  expect(mockPost).toHaveBeenCalledTimes(2);                          // the two live attempts only
  expect(claimedSynced()).toBe(false);
  mockFaults.get = undefined;
  expect(await storedIds()).toEqual(['a', 'b']);
  mockPost.mockResolvedValue({ data: {} });
  await offlineQueue.flush();
  expect(await storedIds()).toEqual([]);
});

test('R-5 a corrupt rejected list is never overwritten by a new refusal; the refused scan stays queued', async () => {
  await realSetItem(REJECTED, 'not json');
  await queueOffline('a');
  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_OWNERSHIP_REVOKED', error: 'gone' }));
  await offlineQueue.flush();
  expect(await realGetItem(REJECTED)).toBe('not json');
  expect(await storedIds()).toEqual(['a']);
  await expect(offlineQueue.getRejected()).rejects.toThrow();
});

// ── MEDIUM-1 — lost wakeup ───────────────────────────────────────────────────

test('L-1 an enqueue racing a flush that sees an empty queue always leaves a retry scheduled', async () => {
  // Sweep every microtask offset between the flush's empty-queue read and the enqueue.
  for (let offset = 0; offset < 12; offset++) {
    await realSetItem(QUEUE, '[]');
    timers = []; active = 0;
    const flushing = offlineQueue.flush();
    for (let i = 0; i < offset; i++) await Promise.resolve();
    mockPost.mockRejectedValueOnce(networkError());
    const submitting = offlineQueue.submitScanWithDetail(scan(`x${offset}`));
    await Promise.all([flushing, submitting]);
    await tick();
    const ids = await storedIds();
    if (ids.length > 0) expect({ offset, active }).toEqual({ offset, active: 1 });
    expect({ offset, count: lastNote()[0] }).toEqual({ offset, count: ids.length });
    mockPost.mockResolvedValue({ data: {} });
    await offlineQueue.flush();
    mockPost.mockReset();
  }
});

// ── MEDIUM-3 — already-recorded scans ───────────────────────────────────────

test('D-1 committed scan, lost response, replay: authoritative "recorded for you" reconciles without review', async () => {
  mockPost.mockRejectedValueOnce(networkError());                     // response lost after commit
  await offlineQueue.submitScanWithDetail(scan('a'));
  mockPost.mockRejectedValueOnce(httpError(409, {
    code: 'PICK_SCAN_ALREADY_RECORDED', error: 'This scan is already recorded.', recorded_by_requester: true,
  }));
  await offlineQueue.flush();
  expect(await storedIds()).toEqual([]);
  expect(await storedIds(REJECTED)).toEqual([]);
  expect((mockPost.mock.calls.at(-1)?.[1] as any).device_event_id).toBe('a'); // same identity replayed
});

test('D-2 already recorded by someone else is NOT treated as delivered: kept for review as already-recorded', async () => {
  await queueOffline('a');
  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: false, error: 'x' }));
  await offlineQueue.flush();
  expect(await storedIds()).toEqual([]);
  expect(await stored(REJECTED)).toMatchObject([{ deviceEventId: 'a', reason: 'already_recorded_by_other' }]);
});

test('D-3 an ambiguous duplicate response is kept for review as outcome-uncertain', async () => {
  await queueOffline('a');
  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_SCAN_OUTCOME_UNCERTAIN', error: 'may already have been recorded' }));
  await offlineQueue.flush();
  expect(await stored(REJECTED)).toMatchObject([{ deviceEventId: 'a', reason: 'outcome_uncertain' }]);
});

test('D-4 a genuine ownership refusal is still a refusal', async () => {
  await queueOffline('a');
  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_OWNERSHIP_REVOKED', error: 'gone' }));
  await offlineQueue.flush();
  expect(await stored(REJECTED)).toMatchObject([{ deviceEventId: 'a', reason: 'refused', code: 'PICK_OWNERSHIP_REVOKED' }]);
});

test('D-5 a live replay already recorded for this operator counts as done (no error, nothing queued)', async () => {
  mockPost.mockRejectedValueOnce(httpError(409, { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: true, error: 'x' }));
  expect(await offlineQueue.submitScanWithDetail(scan('a'))).toBeUndefined();
  expect(await storedIds()).toEqual([]);
});

// ── MEDIUM-4 — transient HTTP and authentication ────────────────────────────

test('H-1 HTTP 408 is transient, not a refusal', async () => {
  await queueOffline('a');
  mockPost.mockRejectedValueOnce(httpError(408));
  await offlineQueue.flush();
  expect(await storedIds()).toEqual(['a']);
  expect(await storedIds(REJECTED)).toEqual([]);
});

test('H-2 HTTP 429 keeps the scan and waits at least Retry-After (bounded)', async () => {
  await queueOffline('a');
  timers = [];
  mockPost.mockRejectedValueOnce(httpError(429, {}, { 'retry-after': '45' }));
  await offlineQueue.flush();
  expect(await storedIds()).toEqual(['a']);
  expect(await storedIds(REJECTED)).toEqual([]);
  expect(timers.at(-1)!.ms).toBeGreaterThanOrEqual(45_000);
  timers = [];
  mockPost.mockRejectedValueOnce(httpError(429, {}, { 'retry-after': '99999' }));
  await offlineQueue.flush();
  expect(timers.at(-1)!.ms).toBeLessThanOrEqual(5 * 60_000);         // bounded
});

test('H-3 HTTP 401 pauses the queue: the scan is kept, never rejected, and not retried on a timer', async () => {
  await queueOffline('a', 'b');
  timers = [];
  mockPost.mockRejectedValueOnce(httpError(401, { error: 'TOKEN_EXPIRED' }));
  await offlineQueue.flush();
  expect(await storedIds()).toEqual(['a', 'b']);
  expect(await storedIds(REJECTED)).toEqual([]);
  expect(mockPost).toHaveBeenCalledTimes(3);                          // 2 live + 1; 'b' not sent while unauthenticated
  expect(timers).toHaveLength(0);                                      // paused until credentials return
  expect(lastNote()[3]).toMatchObject({ authPaused: true });
  // Credentials restored → next flush (foreground / live success) resumes; server re-authorizes each request.
  mockPost.mockResolvedValue({ data: {} });
  await offlineQueue.flush();
  expect(await storedIds()).toEqual([]);
  expect(lastNote()[3]).toMatchObject({ authPaused: false });
});

test('H-4 a 401 never starts the server-error window', async () => {
  await queueOffline('a');
  mockPost.mockRejectedValueOnce(httpError(401));
  await offlineQueue.flush();
  expect((await stored())[0].firstServerErrorAt).toBeUndefined();
});
