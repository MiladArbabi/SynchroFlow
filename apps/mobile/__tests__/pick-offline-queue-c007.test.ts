/**
 * SF-PICK-ASSIGN-01 — Correction 007 (REVIEW-005):
 *   M-1  corrupt-storage quarantine is bounded: one copy per distinct corrupt value;
 *   M-2  deterministic lost-wakeup regression: the enqueue / empty-decision
 *        interleaving is forced step by step with deferred AsyncStorage calls;
 *   H-1  (queue side) an offline-queued mobile scan replays the identical body,
 *        allocation and ownership generation included.
 *
 * File-local AsyncStorage: a real Map. In "gated" mode every getItem/setItem
 * parks as a pending operation until the test releases it, so the order in
 * which the queue's storage calls complete is chosen by the test, not by the
 * microtask scheduler.
 */
type Op = { kind: 'get' | 'set'; key: string; release: () => void; fail: () => void };
const mockStore = new Map<string, string>();
const mockGate: { on: boolean; pending: Op[]; failSetFor?: string } = { on: false, pending: [] };
const mockStats = { setCalls: 0 };

jest.mock('@react-native-async-storage/async-storage', () => {
  const park = <T>(kind: 'get' | 'set', key: string, apply: () => T): Promise<T> => {
    if (!mockGate.on) return Promise.resolve().then(apply);
    return new Promise<T>((resolve, reject) => {
      mockGate.pending.push({ kind, key, release: () => resolve(apply()), fail: () => reject(new Error(`io: ${kind} failed`)) });
    });
  };
  return {
    __esModule: true,
    default: {
      getItem: (key: string) => park('get', key, () => (mockStore.has(key) ? mockStore.get(key)! : null)),
      setItem: (key: string, value: string) => {
        if (mockGate.failSetFor !== undefined && key.startsWith(mockGate.failSetFor)) {
          return Promise.reject(new Error('io: setItem failed'));
        }
        mockStats.setCalls += 1;
        return park('set', key, () => { mockStore.set(key, value); });
      },
      getAllKeys: async () => [...mockStore.keys()],
    },
  };
});

const mockPost = jest.fn();
jest.mock('../../../packages/mobile-core/src/apiClient', () => ({ apiClient: { post: (...a: unknown[]) => mockPost(...a) } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { offlineQueue } = require('../../../packages/mobile-core/src/offlineQueue');

const QUEUE = 'ls:offline_queue';
const REJECTED = 'ls:offline_rejected';
const networkError = () => new Error('Network request failed');
const scan = (id: string) => ({
  deviceEventId: id,
  url: '/api/v1/wms/pick/scan',
  body: { pick_batch_id: `batch-${id}`, pick_claim_generation: 'gen-1', device_event_id: id },
});
const realTick = () => new Promise((r) => jest.requireActual('timers').setImmediate(r));
const storedIds = () => (JSON.parse(mockStore.get(QUEUE) ?? '[]') as Array<{ deviceEventId: string }>).map((e) => e.deviceEventId);
const quarantineKeys = (key: string) => [...mockStore.keys()].filter((k) => k.startsWith(`${key}:corrupt:`)).sort();

// ── Timers: exact handle accounting, callbacks kept so the test can fire them ──
let timers = new Map<number, () => void>();
let nextHandle = 0;
let timerSpy: jest.SpyInstance;
let clearSpy: jest.SpyInstance;
let notes: Array<[number, boolean, number, { storageError: string | null }]> = [];
let unsub: () => void;
const lastNote = () => notes[notes.length - 1];

beforeEach(async () => {
  timers = new Map();
  timerSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
    nextHandle += 1; timers.set(nextHandle, fn); return nextHandle as unknown as NodeJS.Timeout;
  }) as never);
  clearSpy = jest.spyOn(global, 'clearTimeout').mockImplementation(((h: number) => { timers.delete(h); }) as never);
  mockGate.on = false; mockGate.pending = []; mockGate.failSetFor = undefined;
  mockPost.mockReset();
  mockStore.clear();
  mockStore.set(QUEUE, '[]');
  mockStore.set(REJECTED, '[]');
  unsub = offlineQueue.subscribe((...a: any[]) => notes.push(a as any));
  mockPost.mockResolvedValue({ data: {} });
  await offlineQueue.flush();                     // settle module state from earlier tests
  mockPost.mockReset();
  timers.clear();
  notes = [];
  mockStats.setCalls = 0;
});
afterEach(() => {
  unsub();
  mockGate.on = false;
  timerSpy.mockRestore();
  clearSpy.mockRestore();
});

/** Wait (on real macrotasks) until the queue has parked a storage call, and return it. */
async function nextOp(kind: 'get' | 'set', key: string): Promise<Op> {
  for (let i = 0; i < 200; i++) {
    const idx = mockGate.pending.findIndex((o) => o.kind === kind && o.key === key);
    if (idx >= 0) return mockGate.pending.splice(idx, 1)[0];
    await realTick();
  }
  throw new Error(`no pending ${kind}(${key}); parked: ${mockGate.pending.map((o) => `${o.kind}(${o.key})`).join(', ') || 'none'}`);
}
/** Release parked calls one at a time until both settle and nothing is parked. */
async function drainGate(...work: Promise<unknown>[]) {
  let done = false;
  const all = Promise.all(work).finally(() => { done = true; });
  while (!done) {
    await realTick();
    const op = mockGate.pending.shift();
    if (op) op.release();
  }
  await all;
}
async function fireTimers() {
  const fns = [...timers.values()];
  timers.clear();
  for (const fn of fns) fn();
  for (let i = 0; i < 5; i++) await realTick();
  await offlineQueue.flush();
}

// ── M-2 — lost wakeup, forced interleavings ───────────────────────────────────

test('LW-1 drain reads EMPTY, then an enqueue persists before the drain finishes: the scan keeps a live retry', async () => {
  mockGate.on = true;
  const flushing = offlineQueue.flush();
  const drainRead = await nextOp('get', QUEUE);              // drain's empty-queue read is in flight

  mockPost.mockRejectedValueOnce(networkError());
  const submitting = offlineQueue.submitScanWithDetail(scan('x'));
  await realTick(); await realTick();                         // live POST failed → enqueue is now contending

  drainRead.release();                                        // drain sees [] → the empty decision
  // Adversarial order: the enqueue's read and write complete (and it arms its
  // retry) BEFORE anything else the drain still has in flight is allowed to
  // complete. Correct code takes the empty decision inside the lock, so the
  // enqueue's read only appears after it; a drain that decides "empty" outside
  // the lock with storage I/O in between would clear the enqueue's timer here.
  (await nextOp('get', QUEUE)).release();                     // enqueue reads []
  (await nextOp('set', QUEUE)).release();                     // enqueue persists [x] → scheduleRetry
  await drainGate(flushing, submitting);                      // whatever the drain still holds completes last
  mockGate.on = false;

  expect(await submitting).toBeUndefined();                   // reported queued …
  expect(storedIds()).toEqual(['x']);                         // … and it is durably queued
  expect(timers.size).toBe(1);                                // … with exactly one live retry
  expect(lastNote()[0]).toBe(1);                              // the last count reflects storage
  expect(notes.filter((n) => n[0] === 0 && n[1] === true).length <= 1).toBe(true);
  const lastEmpty = notes.map((n) => n[0]).lastIndexOf(0);
  const lastOne = notes.map((n) => n[0]).lastIndexOf(1);
  expect(lastOne).toBeGreaterThan(lastEmpty);                 // "synced" was never the final word

  mockPost.mockResolvedValue({ data: {} });
  await fireTimers();                                         // the retry delivers it, once
  expect(mockPost.mock.calls.filter(([, b]) => (b as any).device_event_id === 'x')).toHaveLength(2); // live + replay
  expect(storedIds()).toEqual([]);
  expect(lastNote()[0]).toBe(0);
});

test('LW-2 enqueue persists first, then drain reads: the drain delivers the scan exactly once', async () => {
  mockGate.on = true;
  mockPost.mockRejectedValueOnce(networkError());
  const submitting = offlineQueue.submitScanWithDetail(scan('y'));
  const enqueueRead = await nextOp('get', QUEUE);

  mockPost.mockResolvedValue({ data: {} });
  const flushing = offlineQueue.flush();
  await realTick(); await realTick();

  enqueueRead.release();
  await drainGate(submitting, flushing);
  await drainGate(offlineQueue.flush());                     // a drain parked behind the enqueue finishes
  mockGate.on = false;
  await offlineQueue.flush();

  expect(await submitting).toBeUndefined();
  const replays = mockPost.mock.calls.filter(([, b]) => (b as any).device_event_id === 'y');
  expect(replays.length).toBeLessThanOrEqual(2);              // live attempt + at most one delivery
  if (storedIds().length === 0) expect(replays).toHaveLength(2);
  else expect(timers.size).toBe(1);                           // not yet delivered → still scheduled
  expect(lastNote()[0]).toBe(storedIds().length);
});

test('LW-3 many scans enqueued around repeated empty decisions: none stranded, none duplicated', async () => {
  mockGate.on = true;
  mockPost.mockRejectedValue(networkError());                   // offline throughout: every POST fails
  const work: Promise<unknown>[] = [];
  for (const id of ['a', 'b', 'c']) {
    work.push(offlineQueue.flush());
    const read = await nextOp('get', QUEUE);
    work.push(offlineQueue.submitScanWithDetail(scan(id)));
    await realTick(); await realTick();
    read.release();
    if (id === 'a') {                                           // queue was empty: same adversarial order as LW-1
      (await nextOp('get', QUEUE)).release();
      (await nextOp('set', QUEUE)).release();
    }
    await drainGate(...work);
  }
  mockGate.on = false;
  expect(storedIds()).toEqual(['a', 'b', 'c']);
  expect(timers.size).toBe(1);
  expect(lastNote()[0]).toBe(3);

  // Back online: the one live retry delivers each scan exactly once (offline attempts above all failed).
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: {} });
  await fireTimers();
  expect(storedIds()).toEqual([]);
  expect(mockPost.mock.calls.map(([, b]) => (b as any).device_event_id)).toEqual(['a', 'b', 'c']);
});

// ── H-1 (queue side) — the replayed body is the queued body ──────────────────

test('OI-1 an offline-queued mobile scan replays the identical body: allocation, generation, event id', async () => {
  const body = {
    pick_batch_id: 'b1', lasyncro_line_item_id: 'l1', lasyncro_variant_id: 'v1', lasyncro_unit_id: null,
    reservation_allocation_id: 'alloc-1', location_code: 'A-1', quantity_confirmed: 2,
    device_event_id: 'evt-1', scan_source: 'camera', pick_claim_generation: 'gen-9',
  };
  const entry = { deviceEventId: 'evt-1', url: '/api/v1/wms/pick/scan', body };
  mockPost.mockRejectedValueOnce(networkError());
  expect(await offlineQueue.submitScanWithDetail(entry)).toBeUndefined();
  mockPost.mockResolvedValue({ data: {} });
  await offlineQueue.flush();
  expect(mockPost).toHaveBeenCalledTimes(2);
  expect(mockPost.mock.calls[1]).toEqual(['/api/v1/wms/pick/scan', body]);
  expect(JSON.stringify(mockPost.mock.calls[1][1])).toBe(JSON.stringify(mockPost.mock.calls[0][1]));
  expect(storedIds()).toEqual([]);
});

// ── M-1 — bounded quarantine ──────────────────────────────────────────────────

test('Q-1 repeated reads of one corrupt queue value (retries, foreground, scans) create exactly one copy', async () => {
  const raw = '[{"deviceEventId":"old1",';
  mockStore.set(QUEUE, raw);
  for (let i = 0; i < 25; i++) {
    await offlineQueue.flush();                                  // timer / foreground triggers
    mockPost.mockRejectedValueOnce(networkError());
    expect(await offlineQueue.submitScanWithDetail(scan(`n${i}`))).toMatchObject({ code: 'OFFLINE_QUEUE_WRITE_FAILED' });
    await expect(offlineQueue.getCount()).rejects.toThrow();
  }
  await fireTimers();
  expect(quarantineKeys(QUEUE)).toHaveLength(1);
  expect(mockStore.get(quarantineKeys(QUEUE)[0])).toBe(raw);
  expect(mockStore.get(QUEUE)).toBe(raw);                        // original untouched
  expect(lastNote()[3].storageError).toEqual(expect.any(String)); // still failing closed
  expect(notes.some((n) => n[0] === 0 && !n[3]?.storageError)).toBe(false); // never "synced"
});

test('Q-2 a changed corrupt value is preserved separately; the earlier copy is kept', async () => {
  mockStore.set(QUEUE, 'corrupt-one');
  await offlineQueue.flush(); await offlineQueue.flush();
  mockStore.set(QUEUE, 'corrupt-two');
  await offlineQueue.flush(); await offlineQueue.flush();
  const keys = quarantineKeys(QUEUE);
  expect(keys).toHaveLength(2);
  expect(keys.map((k) => mockStore.get(k)).sort()).toEqual(['corrupt-one', 'corrupt-two']);
  expect(mockStore.get(QUEUE)).toBe('corrupt-two');
});

test('Q-3 valid data creates no quarantine copies and syncs normally', async () => {
  mockPost.mockRejectedValueOnce(networkError());
  await offlineQueue.submitScanWithDetail(scan('ok'));
  await offlineQueue.getCount();
  mockPost.mockResolvedValue({ data: {} });
  await offlineQueue.flush();
  expect([...mockStore.keys()].filter((k) => k.includes(':corrupt:'))).toEqual([]);
  expect(storedIds()).toEqual([]);
});

test('Q-4 a failing quarantine write never touches the original and stays bounded once storage recovers', async () => {
  const raw = 'not json at all';
  mockStore.set(QUEUE, raw);
  mockGate.failSetFor = `${QUEUE}:corrupt:`;
  for (let i = 0; i < 10; i++) await offlineQueue.flush();
  expect(quarantineKeys(QUEUE)).toEqual([]);
  expect(mockStore.get(QUEUE)).toBe(raw);
  mockGate.failSetFor = undefined;
  for (let i = 0; i < 10; i++) await offlineQueue.flush();
  expect(quarantineKeys(QUEUE)).toHaveLength(1);
  expect(mockStore.get(QUEUE)).toBe(raw);
});

test('Q-5 background retries over both corrupt keys cannot grow storage: writes stop after one copy each', async () => {
  mockStore.set(QUEUE, '{"q":');
  mockStore.set(REJECTED, '{"r":');
  await offlineQueue.flush();
  await offlineQueue.getRejected().catch(() => undefined);
  const keysAfterFirst = mockStore.size;
  const setsAfterFirst = mockStats.setCalls;
  for (let i = 0; i < 300; i++) {
    await fireTimers();
    await offlineQueue.getRejected().catch(() => undefined);
  }
  expect(mockStore.size).toBe(keysAfterFirst);
  expect(mockStats.setCalls).toBe(setsAfterFirst);               // zero writes across 300 retry cycles
  expect(quarantineKeys(QUEUE)).toHaveLength(1);
  expect(quarantineKeys(REJECTED)).toHaveLength(1);
  expect(mockStore.get(QUEUE)).toBe('{"q":');
  expect(mockStore.get(REJECTED)).toBe('{"r":');
});

test('Q-6 an occupied quarantine slot holding a different value is never overwritten', async () => {
  // Pre-seed every slot name the queue could pick for this value with foreign content.
  const raw = 'zzz-corrupt';
  mockStore.set(QUEUE, raw);
  await offlineQueue.flush();
  const [slot0] = quarantineKeys(QUEUE);
  mockStore.set(slot0, 'evidence-from-elsewhere');
  await offlineQueue.flush();
  expect(mockStore.get(slot0)).toBe('evidence-from-elsewhere');   // not overwritten
  const keys = quarantineKeys(QUEUE);
  expect(keys).toHaveLength(2);
  expect(mockStore.get(keys.find((k) => k !== slot0)!)).toBe(raw);
  for (let i = 0; i < 10; i++) await offlineQueue.flush();
  expect(quarantineKeys(QUEUE)).toHaveLength(2);
});
