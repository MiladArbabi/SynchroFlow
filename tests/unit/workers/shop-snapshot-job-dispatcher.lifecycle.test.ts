// tests/unit/workers/shop-snapshot-job-dispatcher.lifecycle.test.ts
//
// STOCK-PROTECT-03 Slice 4 — shopSnapshotJob dispatcher lifecycle contract.
// PERMANENT regression contract, authored RED.
// ===========================================================================
// REQUIRED RED (at authoring time):
//   - stopShopSnapshotJobDispatcher does not exist on the module today
//     (confirmed by audit: grep for "stop"/"clearInterval" in the dispatcher
//     file returns zero hits) — referencing it is `undefined`, calling it
//     throws, which IS the expected RED evidence for tests 3/4 below.
//   - startShopSnapshotJobDispatcher has no idempotent-start guard and no
//     overlap guard today — calling it twice creates two independent
//     setInterval loops, and a slow tick is not protected from a second
//     concurrent tick. Tests 1/2 assert the guarded behavior and fail
//     against the current unguarded implementation.
//
// Pure unit test: no disposable Postgres. db.raw is replaced with a mock
// resolving an empty due-tenant list so the per-shop processing loop never
// executes — that behavior is covered separately (DB-backed) in
// shop-snapshot-job-dispatcher.processing.contract.test.ts. This file only
// proves interval/guard scaffolding.
//
// NOTE ON MOCKING STRATEGY: db.raw is a non-writable (but configurable)
// property on the Knex callable instance — `jest.spyOn(db, 'raw')` fails
// with "Cannot assign to read only property" against this specific object
// shape. Using Object.defineProperty directly (which respects
// `configurable: true`) avoids that, restoring the original descriptor
// afterward.

import db from '@lasyncro/backend-core/db.js';
import {
  startShopSnapshotJobDispatcher,
  stopShopSnapshotJobDispatcher,
} from 'api-src/workers/projections/shopSnapshotJob.dispatcher';

const POLL_INTERVAL_MS = 2000;

describe('shopSnapshotJob dispatcher — lifecycle contract', () => {
  let originalRawDescriptor: PropertyDescriptor | undefined;
  let dbRawMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    originalRawDescriptor = Object.getOwnPropertyDescriptor(db, 'raw');
    dbRawMock = jest.fn().mockResolvedValue({ rows: [] });
    Object.defineProperty(db, 'raw', { value: dbRawMock, writable: true, configurable: true });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    if (originalRawDescriptor) {
      Object.defineProperty(db, 'raw', originalRawDescriptor);
    }
  });

  it('1. calling start() twice creates exactly one poll loop, not two', async () => {
    await startShopSnapshotJobDispatcher();
    await startShopSnapshotJobDispatcher();

    jest.advanceTimersByTime(POLL_INTERVAL_MS);
    await Promise.resolve(); // flush the interval callback's microtask queue
    await Promise.resolve();

    expect(dbRawMock).toHaveBeenCalledTimes(1);
  });

  it('2. an overlapping tick is prevented — a slow tick blocks the next fire until it resolves', async () => {
    let resolveFirstTick!: () => void;
    const firstTickGate = new Promise<{ rows: any[] }>((resolve) => {
      resolveFirstTick = () => resolve({ rows: [] });
    });
    dbRawMock.mockReturnValueOnce(firstTickGate as any);

    await startShopSnapshotJobDispatcher();

    jest.advanceTimersByTime(POLL_INTERVAL_MS); // first tick starts, hangs on firstTickGate
    await Promise.resolve();

    jest.advanceTimersByTime(POLL_INTERVAL_MS); // second interval fire while first still in-flight
    await Promise.resolve();

    expect(dbRawMock).toHaveBeenCalledTimes(1); // second fire must be skipped, not queued

    resolveFirstTick();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve(); // flush inFlightPoll .finally() lifecycle release

    jest.advanceTimersByTime(POLL_INTERVAL_MS); // now a third fire should proceed normally
    await Promise.resolve();

    expect(dbRawMock).toHaveBeenCalledTimes(2);
  });

  it('3. stop() clears the lifecycle — no further ticks fire after stop', async () => {
    await startShopSnapshotJobDispatcher();
    await stopShopSnapshotJobDispatcher();

    jest.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    await Promise.resolve();

    expect(dbRawMock).not.toHaveBeenCalled();
  });

  it('4. the dispatcher can start() again after stop() — the guard is not permanently latched', async () => {
    await startShopSnapshotJobDispatcher();
    await stopShopSnapshotJobDispatcher();
    await startShopSnapshotJobDispatcher();

    jest.advanceTimersByTime(POLL_INTERVAL_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(dbRawMock).toHaveBeenCalledTimes(1);
  });

  it('5. stop() waits for an in-flight poll to finish before lifecycle teardown completes', async () => {
    let resolveTick!: () => void;
    const tickGate = new Promise<{ rows: any[] }>((resolve) => {
      resolveTick = () => resolve({ rows: [] });
    });
    dbRawMock.mockReturnValueOnce(tickGate as any);

    await startShopSnapshotJobDispatcher();

    jest.advanceTimersByTime(POLL_INTERVAL_MS);
    await Promise.resolve();

    expect(dbRawMock).toHaveBeenCalledTimes(1);

    let stopResolved = false;
    const stopPromise = stopShopSnapshotJobDispatcher().then(() => {
      stopResolved = true;
    });

    await Promise.resolve();

    expect(stopResolved).toBe(false);

    resolveTick();
    await stopPromise;

    expect(stopResolved).toBe(true);
  });
});
