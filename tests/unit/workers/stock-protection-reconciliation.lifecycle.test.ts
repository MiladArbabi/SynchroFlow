// tests/unit/workers/stock-protection-reconciliation.lifecycle.test.ts
//
// STOCK-PROTECT-03 Slice 4 — reconciliation worker lifecycle contract.
// PERMANENT regression contract, authored RED.
// ===========================================================================
// REQUIRED RED (at authoring time): the production module
//   api-src/workers/stockProtectionReconciliation.worker
// does not exist yet — import fails with MODULE_NOT_FOUND.
//
// Pure unit test: no disposable Postgres. db.raw is replaced with a mock
// resolving an empty candidate list so the per-shop eligibility loop never
// executes — that behavior is covered separately (DB-backed) in
// stock-protection-reconciliation.worker.contract.test.ts. This file only
// proves start/stop/idempotency/overlap scaffolding, mirroring the same
// pattern already used for the shop-snapshot dispatcher's own lifecycle test
// (see that file's header for why Object.defineProperty is used instead of
// jest.spyOn against db.raw).

import db from '@lasyncro/backend-core/db.js';
import {
  startStockProtectionReconciliationWorker,
  stopStockProtectionReconciliationWorker,
} from 'api-src/workers/stockProtectionReconciliation.worker';

const POLL_INTERVAL_MS = 15 * 60 * 1000;

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('Stock Protection reconciliation worker — lifecycle contract', () => {
  let originalRawDescriptor: PropertyDescriptor | undefined;
  let dbRawMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    originalRawDescriptor = Object.getOwnPropertyDescriptor(db, 'raw');
    dbRawMock = jest.fn().mockResolvedValue({ rows: [] });
    Object.defineProperty(db, 'raw', { value: dbRawMock, writable: true, configurable: true });
  });

  afterEach(async () => {
    await stopStockProtectionReconciliationWorker();
    jest.clearAllTimers();
    jest.useRealTimers();
    if (originalRawDescriptor) {
      Object.defineProperty(db, 'raw', originalRawDescriptor);
    }
  });

  it('1. calling start() twice runs exactly one cycle per interval, not two', async () => {
    await startStockProtectionReconciliationWorker();
    await flush();
    await startStockProtectionReconciliationWorker();
    await flush();

    const callsAfterBothStarts = dbRawMock.mock.calls.length;

    jest.advanceTimersByTime(POLL_INTERVAL_MS);
    await flush();

    // Exactly one additional cycle's worth of calls, not two.
    expect(dbRawMock.mock.calls.length - callsAfterBothStarts).toBeLessThanOrEqual(1);
  });

  it('2. no overlapping cycles — a slow cycle blocks the next fire until it resolves', async () => {
    let resolveFirstCycle!: () => void;
    const firstCycleGate = new Promise<{ rows: any[] }>((resolve) => {
      resolveFirstCycle = () => resolve({ rows: [] });
    });

    await startStockProtectionReconciliationWorker();
    await flush();
    const callsAfterInitialCycle = dbRawMock.mock.calls.length;

    dbRawMock.mockReturnValueOnce(firstCycleGate as any);
    jest.advanceTimersByTime(POLL_INTERVAL_MS);
    await flush();

    jest.advanceTimersByTime(POLL_INTERVAL_MS); // fires while the gated cycle is still in-flight
    await flush();

    expect(dbRawMock.mock.calls.length).toBe(callsAfterInitialCycle + 1);

    resolveFirstCycle();
    await flush();

    jest.advanceTimersByTime(POLL_INTERVAL_MS);
    await flush();

    expect(dbRawMock.mock.calls.length).toBeGreaterThan(callsAfterInitialCycle + 1);
  });

  it('3. stop() halts the cycle — no further cycles run after stop', async () => {
    await startStockProtectionReconciliationWorker();
    await flush();
    await stopStockProtectionReconciliationWorker();

    const callsAtStop = dbRawMock.mock.calls.length;

    jest.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    await flush();

    expect(dbRawMock.mock.calls.length).toBe(callsAtStop);
  });

  it('4. calling start() while a cycle is in-flight does not start a second concurrent cycle', async () => {
    let resolveFirstCycle!: () => void;
    const firstCycleGate = new Promise<{ rows: any[] }>((resolve) => {
      resolveFirstCycle = () => resolve({ rows: [] });
    });
    dbRawMock.mockReturnValueOnce(firstCycleGate as any);

    await startStockProtectionReconciliationWorker();
    await flush();

    expect(dbRawMock).toHaveBeenCalledTimes(1);

    await startStockProtectionReconciliationWorker();
    await flush();

    expect(dbRawMock).toHaveBeenCalledTimes(1);

    resolveFirstCycle();
    await flush();
    await stopStockProtectionReconciliationWorker();
  });
});
